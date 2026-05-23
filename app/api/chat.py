from __future__ import annotations

from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app import models, schemas
from app.auth import current_user

router = APIRouter(prefix="/api/chat", tags=["chat"])

MSK = timezone(timedelta(hours=3))


def _to_msk(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    msk = dt.astimezone(MSK)
    return msk.strftime("%H:%M")


@router.get("/messages", response_model=list[schemas.ChatMessageOut])
def list_messages(
    limit: int = 50,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
) -> list[schemas.ChatMessageOut]:
    rows = (
        db.query(models.ChatMessage)
        .order_by(models.ChatMessage.created_at.desc())
        .limit(limit)
        .all()
    )
    rows.reverse()
    return [
        schemas.ChatMessageOut(
            id=m.id,
            user_id=m.user_id,
            user_name=m.user.first_name or m.user.username or "Аноним",
            content=m.content,
            message_type=m.message_type,
            created_at=m.created_at,
            created_at_msk=_to_msk(m.created_at),
        )
        for m in rows
    ]


@router.post("/send", response_model=schemas.ChatMessageOut)
def send_message(
    payload: schemas.ChatSendRequest,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
) -> schemas.ChatMessageOut:
    content = payload.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Пустое сообщение")
    if len(content) > 1000:
        raise HTTPException(status_code=400, detail="Слишком длинное сообщение")

    m = models.ChatMessage(
        user_id=user.id,
        content=content,
        message_type=payload.message_type,
    )
    db.add(m)
    db.commit()
    db.refresh(m)

    return schemas.ChatMessageOut(
        id=m.id,
        user_id=m.user_id,
        user_name=user.first_name or user.username or "Аноним",
        content=m.content,
        message_type=m.message_type,
        created_at=m.created_at,
        created_at_msk=_to_msk(m.created_at),
    )
