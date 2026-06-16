from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.api._helpers import ensure_wallet
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
    total = len(questions)
    score = 0
    counted: set = set()
    for q_id, answer in payload.answers.items():
        qq = q_map.get(q_id)
        if qq is None or q_id in counted:
            continue
        if not isinstance(answer, str) or not answer.strip():
            continue
        if qq.correct_option == answer.strip().lower():
            score += 1
        counted.add(q_id)
    # Защита от выхода за число вопросов (дубликаты/мусор в payload).
    if score > total:
        score = total
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
    db.flush()

    # Повторная проверка на гонку/двойную отправку: между первой проверкой и
    # коммитом мог появиться другой attempt этого юзера для теста.
    duplicate = (
        db.query(models.QuizAttempt)
        .filter(
            models.QuizAttempt.quiz_id == payload.quiz_id,
            models.QuizAttempt.user_id == user.id,
            models.QuizAttempt.id != attempt.id,
        )
        .first()
    )
    if duplicate is not None:
        db.rollback()
        raise HTTPException(status_code=400, detail="Ты уже проходил этот тест")

    # Award prize if grade is good or excellent
    prize_awarded = False
    if grade in ("good", "excellent"):
        user.xp += 25 if grade == "excellent" else 10
        if q.prize_kind == "coins":
            wallet = ensure_wallet(db, user)
            wallet.balance += q.prize_value
            db.add(
                models.Transaction(
                    sender_id=None,
                    recipient_id=user.id,
                    amount=q.prize_value,
                    note=f"quiz:{q.id}:{grade}",
                )
            )
            prize_awarded = True
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
                prize_awarded = True
        attempt.prize_awarded = prize_awarded

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
