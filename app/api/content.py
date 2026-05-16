from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.db import get_db

router = APIRouter(prefix="/api/content", tags=["content"])


@router.get("/legal/{slug}", response_model=schemas.LegalTextOut)
def legal(slug: str, db: Session = Depends(get_db)) -> schemas.LegalTextOut:
    row = db.query(models.LegalText).filter(models.LegalText.slug == slug).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Текст не найден")
    return schemas.LegalTextOut(slug=row.slug, title=row.title, body=row.body)
