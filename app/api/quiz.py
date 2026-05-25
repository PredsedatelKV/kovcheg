from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.auth import current_user
from app.db import get_db

router = APIRouter(prefix="/api/quiz", tags=["quiz"])


@router.get("/available", response_model=list[schemas.QuizForUser])
def available(user: models.User = Depends(current_user), db: Session = Depends(get_db)) -> list[schemas.QuizForUser]:
    quizzes = db.query(models.Quiz).filter(models.Quiz.is_active.is_(True)).order_by(models.Quiz.id).all()
    passed_ids = set(
        a.quiz_id
        for a in db.query(models.QuizAttempt).filter(models.QuizAttempt.user_id == user.id).all()
    )
    result = []
    for q in quizzes:
        q_count = db.query(models.QuizQuestion).filter(models.QuizQuestion.quiz_id == q.id).count()
        result.append(
            schemas.QuizForUser(
                id=q.id,
                title=q.title,
                description=q.description,
                prize_label=q.prize_label,
                question_count=q_count,
                already_passed=q.id in passed_ids,
            )
        )
    return result


@router.get("/{quiz_id}/start", response_model=list[schemas.QuizQuestionForUser])
def start_quiz(quiz_id: int, user: models.User = Depends(current_user), db: Session = Depends(get_db)) -> list[schemas.QuizQuestionForUser]:
    q = db.query(models.Quiz).filter(models.Quiz.id == quiz_id, models.Quiz.is_active.is_(True)).one_or_none()
    if q is None:
        raise HTTPException(status_code=404, detail="Тест не найден")
    already = db.query(models.QuizAttempt).filter(
        models.QuizAttempt.quiz_id == quiz_id, models.QuizAttempt.user_id == user.id
    ).first()
    if already:
        raise HTTPException(status_code=400, detail="Ты уже проходил этот тест")
    questions = (
        db.query(models.QuizQuestion)
        .filter(models.QuizQuestion.quiz_id == quiz_id)
        .order_by(models.QuizQuestion.sort_order, models.QuizQuestion.id)
        .all()
    )
    return [
        schemas.QuizQuestionForUser(
            id=qq.id, text=qq.text,
            option_a=qq.option_a, option_b=qq.option_b,
            option_c=qq.option_c, option_d=qq.option_d,
        )
        for qq in questions
    ]


@router.post("/submit", response_model=schemas.QuizResultOut)
def submit_quiz(
    payload: schemas.QuizSubmitRequest,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
) -> schemas.QuizResultOut:
    q = db.query(models.Quiz).filter(models.Quiz.id == payload.quiz_id).one_or_none()
    if q is None:
        raise HTTPException(status_code=404, detail="Тест не найден")
    already = db.query(models.QuizAttempt).filter(
        models.QuizAttempt.quiz_id == payload.quiz_id, models.QuizAttempt.user_id == user.id
    ).first()
    if already:
        raise HTTPException(status_code=400, detail="Ты уже проходил этот тест")

    questions = db.query(models.QuizQuestion).filter(models.QuizQuestion.quiz_id == payload.quiz_id).all()
    q_map = {qq.id: qq for qq in questions}
    score = 0
    for q_id, answer in payload.answers.items():
        qq = q_map.get(q_id)
        if qq and qq.correct_option == answer.lower():
            score += 1

    total = len(questions)
    if score >= q.threshold_excellent:
        grade = "excellent"
    elif score >= q.threshold_good:
        grade = "good"
    else:
        grade = "bad"

    attempt = models.QuizAttempt(
        quiz_id=q.id,
        user_id=user.id,
        score=score,
        total=total,
        grade=grade,
    )
    db.add(attempt)

    # Award prize if grade is good or excellent
    if grade in ("good", "excellent"):
        prize_awarded = True
        user.xp += 25 if grade == "excellent" else 10
        if q.prize_kind == "coins":
            user.wallet.balance += q.prize_value
            db.add(
                models.Transaction(
                    sender_id=None,
                    recipient_id=user.id,
                    amount=q.prize_value,
                    note=f"quiz:{q.id}:{grade}",
                )
            )
        elif q.prize_kind == "item" and q.prize_item_code:
            item = db.query(models.Item).filter(models.Item.code == q.prize_item_code).one_or_none()
            if item:
                inv = (
                    db.query(models.InventoryItem)
                    .filter(models.InventoryItem.user_id == user.id, models.InventoryItem.item_id == item.id)
                    .one_or_none()
                )
                if inv:
                    inv.quantity += 1
                else:
                    db.add(models.InventoryItem(user_id=user.id, item_id=item.id, quantity=1))
        attempt.prize_awarded = True
    else:
        prize_awarded = False

    db.commit()
    db.refresh(attempt)

    grade_labels = {"bad": "Плохо", "good": "Хорошо", "excellent": "Отлично"}
    return schemas.QuizResultOut(
        score=score,
        total=total,
        grade=grade,
        grade_label=grade_labels.get(grade, grade),
        prize_label=q.prize_label,
        prize_awarded=prize_awarded,
    )
