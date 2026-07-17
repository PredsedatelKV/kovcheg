from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app import models, schemas
from app.api.profile import _user_task_to_out, _user_to_out
from app.auth import current_user
from app.config import get_settings
from app.db import begin_game_write, get_db

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
        .options(joinedload(models.UserTask.task))
        .filter(models.UserTask.user_id == user.id, models.UserTask.status == "in_progress")
        .all()
    )

    return schemas.HomePayload(
        user=_user_to_out(user),
        server_time_msk=msk_now_label(),
        server_epoch_ms=int(datetime.now(timezone.utc).timestamp() * 1000),
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


def _today_str() -> str:
    return datetime.now(MSK).strftime("%Y-%m-%d")


def _yesterday_str() -> str:
    return (datetime.now(MSK) - timedelta(days=1)).strftime("%Y-%m-%d")


@router.get("/daily-reward")
def get_daily_reward(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    dr = db.query(models.DailyReward).filter(models.DailyReward.user_id == user.id).first()
    today = _today_str()
    if not dr:
        return {"streak": 0, "claimed_today": False, "reward": 1}
    claimed_today = dr.last_claim_date == today
    if claimed_today:
        # Уже забрано сегодня: показываем текущую серию и полученную награду.
        return {"streak": dr.streak, "claimed_today": True, "reward": min(dr.streak, 7)}
    # Не забрано сегодня. Серия продолжается только если забирали вчера, иначе сбрасывается.
    if dr.last_claim_date == _yesterday_str():
        next_streak = min(dr.streak + 1, 7)
    else:
        next_streak = 1  # пропущен календарный день — серия сброшена
    return {"streak": dr.streak, "claimed_today": False, "reward": next_streak}


@router.post("/daily-reward/claim")
def claim_daily_reward(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    from app.api._helpers import ensure_wallet

    begin_game_write(db)
    today = _today_str()
    dr = db.query(models.DailyReward).filter(models.DailyReward.user_id == user.id).first()
    if dr and dr.last_claim_date == today:
        raise HTTPException(409, "Награда уже получена сегодня")

    if dr:
        if dr.last_claim_date == _yesterday_str():
            dr.streak = min(dr.streak + 1, 7)
        else:
            dr.streak = 1
        dr.last_claim_date = today
    else:
        dr = models.DailyReward(user_id=user.id, streak=1, last_claim_date=today)
        db.add(dr)

    reward = dr.streak
    wallet = ensure_wallet(db, user)
    wallet.balance += reward
    db.add(models.Transaction(recipient_id=user.id, amount=reward, note=f"Ежедневная награда (день {dr.streak})"))
    db.commit()
    db.refresh(user)
    return {"ok": True, "streak": dr.streak, "reward": reward, "balance": user.wallet.balance}
