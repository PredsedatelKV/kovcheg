from __future__ import annotations

import hashlib
import logging
import re

from fastapi import Request
from fastapi.responses import JSONResponse, Response
from sqlalchemy.exc import IntegrityError

from app import models
from app.db import SessionLocal

log = logging.getLogger(__name__)

IDEMPOTENCY_HEADER = "X-Idempotency-Key"
KEY_RE = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")
MAX_STORED_RESPONSE_BYTES = 512 * 1024

# These actions either move game value or change the configuration used to
# award it. Read-only requests and social actions deliberately stay outside.
CRITICAL_PREFIXES = (
    "/api/home/daily-reward/claim",
    "/api/battlepass/claim",
    "/api/battlepass/open-lootbox",
    "/api/profile/transfer",
    "/api/profile/inventory/",
    "/api/shop/buy",
    "/api/market/list",
    "/api/market/unlist/",
    "/api/market/buy",
    "/api/tasks/",
    "/api/quiz/",
    "/api/wheel/spin",
    "/api/arcade/first-win",
    "/api/arcade/casino/",
    "/api/arcade/roulette/",
    "/api/arcade/clicker/",
    "/api/game/",
    "/api/admin/",
)


def _is_critical(request: Request) -> bool:
    return request.method in {"POST", "PUT", "PATCH", "DELETE"} and request.url.path.startswith(CRITICAL_PREFIXES)


def _finish_receipt(
    key: str,
    status: str,
    *,
    response_status: int | None = None,
    response_body: bytes | None = None,
    response_content_type: str | None = None,
) -> None:
    with SessionLocal() as db:
        receipt = db.get(models.IdempotencyReceipt, key)
        if receipt is not None and receipt.status == "processing":
            receipt.status = status
            receipt.response_status = response_status
            receipt.response_body = response_body
            receipt.response_content_type = response_content_type
            receipt.completed_at = models.now_utc()
            db.commit()


def _duplicate_response(storage_key: str) -> Response:
    """Replay only a fully persisted success; uncertain outcomes stay blocked."""
    with SessionLocal() as db:
        receipt = db.get(models.IdempotencyReceipt, storage_key)
        if (
            receipt is not None
            and receipt.status == "completed"
            and receipt.response_status is not None
            and receipt.response_body is not None
        ):
            headers = {}
            if receipt.response_content_type:
                headers["content-type"] = receipt.response_content_type
            headers["x-idempotency-status"] = "replayed"
            return Response(
                content=bytes(receipt.response_body),
                status_code=receipt.response_status,
                headers=headers,
            )
        if receipt is not None and receipt.status == "unreplayable":
            detail = "Операция уже выполнена, но её ответ слишком велик для безопасного повтора"
        else:
            detail = "Эта операция уже выполняется или была обработана"
        receipt_status = receipt.status if receipt is not None else "unknown"
        return JSONResponse(
            status_code=409,
            content={"detail": detail},
            headers={"X-Idempotency-Status": receipt_status},
        )


async def _capture_response(response: Response) -> tuple[Response, bytes]:
    """Read a middleware response once and rebuild it unchanged for the caller."""
    chunks: list[bytes] = []
    body_iterator = getattr(response, "body_iterator", None)
    if body_iterator is not None:
        async for chunk in body_iterator:
            if isinstance(chunk, str):
                chunk = chunk.encode(getattr(response, "charset", "utf-8"))
            chunks.append(bytes(chunk))
        body = b"".join(chunks)
    else:
        body = bytes(getattr(response, "body", b""))

    rebuilt = Response(
        content=body,
        status_code=response.status_code,
        background=getattr(response, "background", None),
    )
    # Preserve all original headers (including duplicate Set-Cookie headers)
    # for the first delivery. Replays intentionally persist only content-type.
    rebuilt.raw_headers = list(response.raw_headers)
    return rebuilt, body


async def protect_game_mutation(request: Request, call_next):
    """Guard a game mutation and replay a durably saved successful response.

    The client assigns one key to one in-flight mutation. The receipt is
    committed before the endpoint starts, so another worker/device retrying the
    same HTTP action cannot enter its read/validate/write transaction. Failed
    and uncertain outcomes remain guarded but are never executed again.
    """
    if not _is_critical(request):
        return await call_next(request)

    key = (request.headers.get(IDEMPOTENCY_HEADER) or "").strip()
    if not KEY_RE.fullmatch(key):
        return JSONResponse(
            status_code=400,
            content={"detail": "Для игровой операции требуется корректный X-Idempotency-Key"},
        )
    auth_scope = (
        request.headers.get("X-Telegram-Init-Data")
        or request.cookies.get("kovcheg_session")
        or "anonymous"
    )
    storage_key = hashlib.sha256(
        f"{request.method}\n{request.url.path}\n{auth_scope}\n{key}".encode("utf-8")
    ).hexdigest()

    now = models.now_utc()
    with SessionLocal() as db:
        try:
            db.add(models.IdempotencyReceipt(
                key=storage_key,
                method=request.method,
                path=request.url.path,
                status="processing",
                created_at=now,
            ))
            db.commit()
        except IntegrityError:
            db.rollback()
            return _duplicate_response(storage_key)

    try:
        response = await call_next(request)
        response, response_body = await _capture_response(response)
    except Exception:
        # The endpoint may already have committed before response rendering or
        # a notification failed. Keep uncertain receipts to prevent a replay.
        _finish_receipt(storage_key, "failed")
        raise

    if response.status_code < 400:
        content_type = response.headers.get("content-type")
        if len(response_body) <= MAX_STORED_RESPONSE_BYTES and (
            content_type is None or len(content_type) <= 256
        ):
            _finish_receipt(
                storage_key,
                "completed",
                response_status=response.status_code,
                response_body=response_body,
                response_content_type=content_type,
            )
        else:
            # The operation has succeeded, so it must never be executed again.
            # Avoid unbounded database growth while retaining a durable guard.
            _finish_receipt(storage_key, "unreplayable")
    else:
        _finish_receipt(storage_key, "failed")
    return response
