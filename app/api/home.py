from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app import models, schemas
from app.api.profile import _user_task_to_out, _user_to_out
from app.auth import current_user
from app.config import get_settings
from app.db import get_db

router = APIRouter(prefix="/api/home", tags=["home"])

MSK = timezone(timedelta(hours=3))

MONTHS_RU = [
    "",
    "января",
    "февраля",
    "марта",
    "апреля",
    "мая",
    "июня",
    "июля",
    "августа",
    "сентября",
    "октября",
    "ноября",
    "декабря",
]


def msk_now_label() -> str:
    now = datetime.now(MSK)
    return f"{now.day} {MONTHS_RU[now.month]}, {now.hour:02d}:{now.minute:02d}"


def _task_to_out(t: models.Task) -> schemas.TaskOut:
    return schemas.TaskOut(
        id=t.id,
        name=t.name,
        description=t.description,
        icon=t.icon,
        reward=t.reward,
        target_progress=t.target_progress,
        is_daily_plan=t.is_daily_plan,
    )


@router.get("/news", response_model=list[schemas.NewsOut])
def list_news(user: models.User = Depends(current_user), db: Session = Depends(get_db)) -> list[schemas.NewsOut]:
    rows = (
        db.query(models.News)
        .filter(models.News.is_active.is_(True))
        .order_by(models.News.published_at.desc())
        .all()
    )
    return [
        schemas.NewsOut(
            id=n.id,
            image_url=n.image_url,
            title=n.title,
            body=n.body,
            published_at=n.published_at,
        )
        for n in rows
    ]


@router.get("", response_model=schemas.HomePayload)
def get_home(user: models.User = Depends(current_user), db: Session = Depends(get_db)) -> schemas.HomePayload:
    settings = get_settings()
    banners = db.query(models.Banner).filter(models.Banner.is_active.is_(True)).order_by(models.Banner.sort_order).all()
    news_rows = (
        db.query(models.News)
        .filter(models.News.is_active.is_(True))
        .order_by(models.News.published_at.desc())
        .all()
    )
    daily_plan = db.query(models.Task).filter(models.Task.is_daily_plan.is_(True), models.Task.is_active.is_(True)).first()
    tasks = (
        db.query(models.Task)
        .filter(models.Task.is_active.is_(True), models.Task.is_daily_plan.is_(False))
        .order_by(models.Task.sort_order, models.Task.id)
        .all()
    )
    user_tasks = (
        db.query(models.UserTask)
        .filter(models.UserTask.user_id == user.id, models.UserTask.status == "in_progress")
        .all()
    )

    return schemas.HomePayload(
        user=_user_to_out(user),
        server_time_msk=msk_now_label(),
        banners=[schemas.BannerOut(id=b.id, image_url=b.image_url, title=b.title) for b in banners],
        news=[
            schemas.NewsOut(
                id=n.id,
                image_url=n.image_url,
                title=n.title,
                body=n.body,
                published_at=n.published_at,
            )
            for n in news_rows
        ],
        daily_plan=_task_to_out(daily_plan) if daily_plan else None,
        tasks=[_task_to_out(t) for t in tasks],
        user_tasks=[_user_task_to_out(ut) for ut in user_tasks],
        channel_url=settings.channel_url,
    )
