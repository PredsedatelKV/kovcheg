from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.assistant.service import ask

router = APIRouter(prefix="/api/assistant", tags=["assistant"])


class AskRequest(BaseModel):
    question: str
    history: list[dict[str, str]] = []


class AskResponse(BaseModel):
    answer: str
    sources: list[dict] = []


@router.post("/ask", response_model=AskResponse)
async def ask_endpoint(req: AskRequest) -> AskResponse:
    if not req.question or len(req.question.strip()) < 2:
        raise HTTPException(status_code=400, detail="Вопрос слишком короткий, сосед.")
    result = await ask(req.question.strip(), history=req.history)
    return AskResponse(answer=result["answer"], sources=result["sources"])
