from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.api.profile import _user_task_to_out
from app.auth import current_user
from app.db import get_db

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


@router.post("/{task_id}/start", response_model=schemas.UserTaskOut)
def start_task(
    task_id: int, user: models.User = Depends(current_user), db: Session = Depends(get_db)
) -> schemas.UserTaskOut:
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
    ut = models.UserTask(user_id=user.id, task_id=task_id, status="in_progress", progress=0)
    db.add(ut)
    db.commit()
    db.refresh(ut)
    from app.notify import notify_admins_bg
    notify_admins_bg(
        f"📥 <b>{user.first_name}</b> начал(а) задание «<b>{ut.task.name}</b>» (награда {ut.task.reward})"
    )
    return _user_task_to_out(ut)


@router.post("/{user_task_id}/complete", response_model=schemas.UserTaskOut)
def complete_task(
    user_task_id: int, user: models.User = Depends(current_user), db: Session = Depends(get_db)
) -> schemas.UserTaskOut:
    ut = (
        db.query(models.UserTask)
        .filter(models.UserTask.id == user_task_id, models.UserTask.user_id == user.id)
        .one_or_none()
    )
    if ut is None:
        raise HTTPException(status_code=404, detail="Запись задания не найдена")
    if ut.status != "in_progress":
        raise HTTPException(status_code=400, detail="Задание уже завершено или отменено")
    
    ut.status = "done"
    ut.progress = ut.task.target_progress
    ut.finished_at = datetime.utcnow()
    user.wallet.balance += ut.task.reward
    db.add(
        models.Transaction(
            sender_id=None,
            recipient_id=user.id,
            amount=ut.task.reward,
            note=f"task:{ut.task.id}",
        )
    )
    db.commit()
    db.refresh(ut)
    from app.notify import notify_admins_bg
    notify_admins_bg(
        f"✅ <b>{user.first_name}</b> выполнил(а) задание «<b>{ut.task.name}</b>» — награда {ut.task.reward}"
    )
    return _user_task_to_out(ut)


@router.post("/{user_task_id}/cancel", response_model=schemas.UserTaskOut)
def cancel_task(
    user_task_id: int, user: models.User = Depends(current_user), db: Session = Depends(get_db)
) -> schemas.UserTaskOut:
    ut = (
        db.query(models.UserTask)
        .filter(models.UserTask.id == user_task_id, models.UserTask.user_id == user.id)
        .one_or_none()
    )
    if ut is None:
        raise HTTPException(status_code=404, detail="Запись задания не найдена")
    ut.status = "cancelled"
    ut.finished_at = datetime.utcnow()
    db.commit()
    db.refresh(ut)
    from app.notify import notify_admins_bg
    notify_admins_bg(
        f"🚫 <b>{user.first_name}</b> прервал(а) задание «<b>{ut.task.name}</b>»"
    )
    return _user_task_to_out(ut)
