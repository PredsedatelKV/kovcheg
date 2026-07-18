from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.api.profile import _user_task_to_out
from app.auth import current_user
from app.db import begin_game_write, get_db
from app.models import now_utc

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


@router.post("/{task_id}/start", response_model=schemas.UserTaskOut)
def start_task(
    task_id: int, user: models.User = Depends(current_user), db: Session = Depends(get_db)
) -> schemas.UserTaskOut:
    begin_game_write(db)
    task = db.query(models.Task).filter(models.Task.id == task_id, models.Task.is_active.is_(True)).one_or_none()
    if task is None or task.is_daily_plan:
        raise HTTPException(status_code=404, detail="Задание не найдено")
    existing = (
        db.query(models.UserTask)
        .filter(
            models.UserTask.user_id == user.id,
            models.UserTask.task_id == task_id,
            models.UserTask.status == "in_progress",
        )
        .one_or_none()
    )
    if existing:
        return _user_task_to_out(existing)
    if not task.is_daily_plan:
        done = (
            db.query(models.UserTask)
            .filter(
                models.UserTask.user_id == user.id,
                models.UserTask.task_id == task_id,
                models.UserTask.status == "done",
            )
            .first()
        )
        if done is not None:
            raise HTTPException(status_code=400, detail="Задание уже выполнено")
    ut = models.UserTask(user_id=user.id, task_id=task_id, status="in_progress", progress=0)
    db.add(ut)
    db.commit()
    db.refresh(ut)
    from app.notify import notify_admins_bg
    rewards = []
    if task.reward:
        rewards.append(f"{task.reward} ковбаксов")
    if task.xp_reward:
        rewards.append(f"{task.xp_reward} XP")
    if task.reward_item and task.reward_item_quantity:
        rewards.append(f"{task.reward_item.name} ×{task.reward_item_quantity}")
    notify_admins_bg(
        f"📥 <b>{user.first_name}</b> начал(а) задание «<b>{ut.task.name}</b>» "
        f"(награда: {', '.join(rewards)})"
    )
    return _user_task_to_out(ut)


@router.post("/{user_task_id}/complete", response_model=schemas.UserTaskOut)
def complete_task(
    user_task_id: int, user: models.User = Depends(current_user), db: Session = Depends(get_db)
) -> schemas.UserTaskOut:
    raise HTTPException(status_code=403, detail="Выполнение задания подтверждает администратор")


@router.post("/{user_task_id}/cancel", response_model=schemas.UserTaskOut)
def cancel_task(
    user_task_id: int, user: models.User = Depends(current_user), db: Session = Depends(get_db)
) -> schemas.UserTaskOut:
    begin_game_write(db)
    ut = (
        db.query(models.UserTask)
        .filter(models.UserTask.id == user_task_id, models.UserTask.user_id == user.id)
        .one_or_none()
    )
    if ut is None:
        raise HTTPException(status_code=404, detail="Запись задания не найдена")
    if ut.status != "in_progress":
        raise HTTPException(status_code=400, detail="Задание нельзя отменить")
    ut.status = "cancelled"
    ut.finished_at = now_utc()
    db.commit()
    db.refresh(ut)
    from app.notify import notify_admins_bg
    notify_admins_bg(
        f"🚫 <b>{user.first_name}</b> прервал(а) задание «<b>{ut.task.name}</b>»"
    )
    return _user_task_to_out(ut)
