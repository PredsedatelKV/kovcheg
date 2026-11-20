"""Snow Courier: seeded routes, authoritative replay, daily records and reward."""
from datetime import datetime, timedelta, timezone
import hashlib
import json
import secrets
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, StrictInt
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import models
from app.auth import current_user
from app.db import begin_game_write, get_db
from app.api._helpers import ensure_wallet, require_open_section
from app.courier_engine import ENGINE_VERSION, TICKS, STEP_MS, replay
from app.courier_engine_v1 import replay as replay_v1
REPLAY_ENGINES = {1: replay_v1, ENGINE_VERSION: replay}

router = APIRouter(prefix="/api/arcade/courier", tags=["courier"],
                   dependencies=[Depends(require_open_section("arcade"))])
MSK = timezone(timedelta(hours=3))
GAME = "snow_courier"
DAILY_REWARD = 75
DELIVERY_GOAL = 12
MIN_HOUSES = 2


def daily_day():
    return datetime.now(MSK).strftime("%Y-%m-%d")


def daily_seed(day):
    return int.from_bytes(hashlib.blake2s(("kovcheg-courier-v2:"+day).encode(), digest_size=4).digest(), "big") & 0x7FFFFFFF


def _claimed(db, user_id, day):
    return db.query(models.ArcadeFirstWin.id).filter_by(user_id=user_id, game=GAME, win_date=day).first() is not None


def _board(db, user_id, day, version=ENGINE_VERSION):
    best = db.query(models.CourierRun.user_id.label("uid"),
                    func.max(models.CourierRun.score).label("score")).filter(
        models.CourierRun.day == day, models.CourierRun.status == "finished",
        models.CourierRun.engine_version == version
    ).group_by(models.CourierRun.user_id).subquery()
    rows = db.query(best.c.uid, best.c.score, models.User.first_name).join(
        models.User, models.User.id == best.c.uid
    ).order_by(best.c.score.desc(), best.c.uid).limit(10).all()
    mine = db.query(best.c.score).filter(best.c.uid == user_id).scalar()
    rank = None
    if mine is not None:
        rank = db.query(func.count()).select_from(best).filter(
            (best.c.score > mine) | ((best.c.score == mine) & (best.c.uid < user_id))
        ).scalar()+1
    return {"leaders": [dict(place=i+1, name=(name or "Курьер")[:40], score=score, is_me=uid==user_id)
                        for i, (uid, score, name) in enumerate(rows)],
            "best": mine or 0, "rank": rank}


@router.get("/status")
def status(user: models.User=Depends(current_user), db: Session=Depends(get_db)):
    day = daily_day()
    previous_best = db.query(func.max(models.CourierRun.score)).filter(
        models.CourierRun.user_id==user.id, models.CourierRun.day==day,
        models.CourierRun.status=="finished",models.CourierRun.engine_version!=ENGINE_VERSION,
    ).scalar() or 0
    return dict(day=day, seed=daily_seed(day), engine_version=ENGINE_VERSION, previous_best=previous_best,
                duration_ms=TICKS*STEP_MS, player_id=user.id,
                daily_reward=DAILY_REWARD, delivery_goal=DELIVERY_GOAL,
                min_houses=MIN_HOUSES, reward_claimed=_claimed(db,user.id,day),
                **_board(db,user.id,day))


@router.post("/start")
def start(user: models.User=Depends(current_user), db: Session=Depends(get_db)):
    begin_game_write(db)
    now = models.now_utc()
    latest = db.query(models.CourierRun).filter_by(user_id=user.id).order_by(models.CourierRun.id.desc()).first()
    if latest is not None and (now-latest.started_at).total_seconds() < 2:
        raise HTTPException(429,"Подождите пару секунд перед новым заездом")
    db.query(models.CourierRun).filter_by(user_id=user.id,status="started").update(
        {"status":"abandoned"},synchronize_session=False)
    day = daily_day()
    run = models.CourierRun(token=secrets.token_urlsafe(32),user_id=user.id,day=day,
        seed=daily_seed(day),engine_version=ENGINE_VERSION,status="started",
        started_at=now,expires_at=now+timedelta(minutes=90))
    db.add(run);db.commit()
    return dict(token=run.token,day=day,seed=run.seed,engine_version=run.engine_version,
                duration_ms=TICKS*STEP_MS)


Control = Annotated[StrictInt,Field(ge=0,le=4048)]


class FinishBody(BaseModel):
    token: str=Field(min_length=32,max_length=64,pattern=r"^[A-Za-z0-9_-]+$")
    controls: list[Control]=Field(min_length=TICKS,max_length=TICKS)


@router.post("/finish")
def finish(body: FinishBody, user: models.User=Depends(current_user), db: Session=Depends(get_db)):
    if any((c & 2047)>2000 for c in body.controls):
        raise HTTPException(422,"Некорректная запись управления")
    digest = hashlib.sha256(json.dumps(body.controls,separators=(",",":")).encode()).hexdigest()
    begin_game_write(db)
    run = db.query(models.CourierRun).filter_by(token=body.token,user_id=user.id).one_or_none()
    if run is None:
        raise HTTPException(404,"Заезд не найден")
    if run.status == "finished":
        if run.input_hash != digest:
            raise HTTPException(409,"Этот заезд уже завершён с другим результатом")
        return dict(json.loads(run.result_json),engine_version=run.engine_version,replayed=True,balance=ensure_wallet(db,user).balance)
    now = models.now_utc()
    if run.status != "started" or run.expires_at < now:
        raise HTTPException(409,"Заезд истёк. Начните новый маршрут")
    if run.engine_version not in REPLAY_ENGINES:
        raise HTTPException(409,"Игра обновилась. Начните новый маршрут")
    if (now-run.started_at).total_seconds() < TICKS*STEP_MS/1000-.5:
        raise HTTPException(400,"Заезд ещё не мог завершиться")
    computed = REPLAY_ENGINES[run.engine_version](run.seed,body.controls)
    if computed["duration_ms"] != TICKS*STEP_MS:
        raise HTTPException(422,"Неполная запись заезда")
    reward = 0
    eligible = computed["delivered"] >= DELIVERY_GOAL and computed["deliveries"] >= MIN_HOUSES
    # A run crossing midnight belongs to its starting day's route and reward.
    if eligible and not _claimed(db,user.id,run.day):
        wallet = ensure_wallet(db,user)
        if wallet.balance > 2_000_000_000-DAILY_REWARD:
            raise HTTPException(409,"Достигнут максимальный баланс ковбаксов")
        wallet.balance += DAILY_REWARD
        db.add(models.ArcadeFirstWin(user_id=user.id,game=GAME,win_date=run.day))
        db.add(models.Transaction(recipient_id=user.id,amount=DAILY_REWARD,note="courier:"+run.token))
        reward = DAILY_REWARD
    run.status="finished";run.finished_at=now;run.score=computed["score"]
    run.delivered=computed["delivered"];run.deliveries=computed["deliveries"];run.input_hash=digest
    response=dict(**computed,day=run.day,engine_version=run.engine_version,eligible=eligible,reward=reward,
                  reward_claimed=_claimed(db,user.id,run.day) or reward>0,
                  balance=ensure_wallet(db,user).balance)
    db.flush()
    response.update(_board(db,user.id,run.day,run.engine_version))
    run.result_json=json.dumps(response,ensure_ascii=False)
    db.commit()
    return dict(response,replayed=False)
