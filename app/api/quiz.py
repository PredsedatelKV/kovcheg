from __future__ import annotations

import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.api._helpers import XP_MAX, award_xp, ensure_wallet
from app.auth import current_user
from app.db import begin_game_write, get_db

router = APIRouter(prefix="/api/quiz", tags=["quiz"])
MAX_QUIZ_COIN_PRIZE = 1_000_000
QUIZ_RUN_TTL = timedelta(hours=2)
MAX_GAME_BALANCE = 2_000_000_000
MAX_INVENTORY_QUANTITY = 2_000_000_000


def _validate_thresholds(q: models.Quiz, question_count: int) -> None:
    """Reject an active quiz whose grading can award impossible results."""
    good = q.threshold_good
    excellent = q.threshold_excellent
    if (
        isinstance(good, bool)
        or not isinstance(good, int)
        or isinstance(excellent, bool)
        or not isinstance(excellent, int)
        or not (1 <= good <= excellent <= question_count)
    ):
        raise HTTPException(status_code=503, detail="Пороги теста настроены некорректно")


def _expected_xp_overflow(user: models.User, amount: int) -> int:
    current_xp = max(0, min(int(user.xp or 0), XP_MAX))
    xp_added = min(amount, max(0, XP_MAX - current_xp))
    return (amount - xp_added) // 10


def _validate_prize_config(db: Session, q: models.Quiz) -> None:
    if (
        isinstance(q.prize_value, bool)
        or not isinstance(q.prize_value, int)
        or not 1 <= q.prize_value <= MAX_QUIZ_COIN_PRIZE
    ):
        raise HTTPException(status_code=503, detail="Награда теста настроена некорректно")
    if q.prize_kind == "coins":
        if q.prize_item_code:
            raise HTTPException(status_code=503, detail="Награда теста настроена некорректно")
        return
    if q.prize_kind != "item" or not q.prize_item_code:
        raise HTTPException(status_code=503, detail="Тип награды теста не поддерживается")
    item = db.query(models.Item).filter(models.Item.code == q.prize_item_code).one_or_none()
    if item is None:
        raise HTTPException(status_code=503, detail="Предмет-награда теста не найден")
    if item.lootbox_pool_code:
        pool = db.query(models.LootboxPool).filter(
            models.LootboxPool.code == item.lootbox_pool_code,
        ).one_or_none()
        if pool is None or not pool.is_active or not pool.is_droppable or pool.is_archived:
            raise HTTPException(status_code=503, detail="Предмет-награда теста сейчас недоступен")


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
        try:
            _validate_thresholds(q, q_count)
            _validate_prize_config(db, q)
        except HTTPException:
            # Do not advertise a broken legacy/admin configuration to players.
            continue
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


@router.post("/{quiz_id}/start", response_model=schemas.QuizStartOut)
def start_quiz(
    quiz_id: int,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
) -> schemas.QuizStartOut:
    begin_game_write(db)
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
    if not questions:
        raise HTTPException(status_code=503, detail="В тесте нет вопросов")
    _validate_thresholds(q, len(questions))
    _validate_prize_config(db, q)
    now = models.now_utc()
    db.query(models.QuizRun).filter(
        models.QuizRun.user_id == user.id,
        models.QuizRun.expires_at < now,
    ).delete(synchronize_session=False)
    run = models.QuizRun(
        token=secrets.token_urlsafe(32),
        quiz_id=quiz_id,
        user_id=user.id,
        question_count=len(questions),
        started_at=now,
        expires_at=now + QUIZ_RUN_TTL,
    )
    db.add(run)
    db.commit()
    public_questions = [
        schemas.QuizQuestionForUser(
            id=qq.id, text=qq.text,
            option_a=qq.option_a, option_b=qq.option_b,
            option_c=qq.option_c, option_d=qq.option_d,
        )
        for qq in questions
    ]
    return schemas.QuizStartOut(run_token=run.token, questions=public_questions)


@router.post("/submit", response_model=schemas.QuizResultOut)
def submit_quiz(
    payload: schemas.QuizSubmitRequest,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
) -> schemas.QuizResultOut:
    begin_game_write(db)
    # Serialize all quiz submissions by one user, including submissions made
    # with two different valid run tokens on databases with row-level locks.
    db.query(models.User.id).filter(models.User.id == user.id).with_for_update().one()
    q = db.query(models.Quiz).filter(
        models.Quiz.id == payload.quiz_id,
        models.Quiz.is_active.is_(True),
    ).one_or_none()
    if q is None:
        raise HTTPException(status_code=404, detail="Тест не найден")
    already = db.query(models.QuizAttempt).filter(
        models.QuizAttempt.quiz_id == payload.quiz_id, models.QuizAttempt.user_id == user.id
    ).first()
    if already:
        raise HTTPException(status_code=400, detail="Ты уже проходил этот тест")

    now = models.now_utc()
    run = (
        db.query(models.QuizRun)
        .filter(
            models.QuizRun.token == payload.run_token,
            models.QuizRun.quiz_id == payload.quiz_id,
            models.QuizRun.user_id == user.id,
        )
        .with_for_update()
        .one_or_none()
    )
    if run is None:
        raise HTTPException(status_code=409, detail="Сначала открой тест заново")
    if run.consumed_at is not None:
        raise HTTPException(status_code=409, detail="Этот результат уже был отправлен")
    if run.expires_at <= now:
        raise HTTPException(status_code=409, detail="Время прохождения теста истекло")

    questions = db.query(models.QuizQuestion).filter(models.QuizQuestion.quiz_id == payload.quiz_id).all()
    q_map = {qq.id: qq for qq in questions}
    total = len(questions)
    if total == 0:
        raise HTTPException(status_code=503, detail="В тесте нет вопросов")
    _validate_thresholds(q, total)
    _validate_prize_config(db, q)
    if total != run.question_count:
        raise HTTPException(status_code=409, detail="Тест был обновлён — открой его заново")
    minimum_seconds = max(2.0, min(30.0, total * 0.75))
    if (now - run.started_at).total_seconds() < minimum_seconds:
        raise HTTPException(status_code=409, detail="Результат отправлен слишком быстро")
    unknown_question_ids = set(payload.answers) - set(q_map)
    if unknown_question_ids:
        raise HTTPException(status_code=400, detail="Ответ содержит неизвестный вопрос")
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

    prize_item = None
    prize_inventory = None
    xp_award = 0
    xp_overflow_coins = 0
    if grade in ("good", "excellent"):
        xp_award = 25 if grade == "excellent" else 10
        xp_overflow_coins = _expected_xp_overflow(user, xp_award)
        if q.prize_kind == "coins":
            if (
                isinstance(q.prize_value, bool)
                or not isinstance(q.prize_value, int)
                or q.prize_value <= 0
                or q.prize_value > MAX_QUIZ_COIN_PRIZE
            ):
                raise HTTPException(status_code=503, detail="Награда теста настроена некорректно")
        elif q.prize_kind == "item":
            if (
                isinstance(q.prize_value, bool)
                or not isinstance(q.prize_value, int)
                or q.prize_value <= 0
                or q.prize_value > MAX_QUIZ_COIN_PRIZE
            ):
                raise HTTPException(status_code=503, detail="Количество предмета-награды настроено некорректно")
            if not q.prize_item_code:
                raise HTTPException(status_code=503, detail="Для теста не выбран предмет-награда")
            prize_item = db.query(models.Item).filter(models.Item.code == q.prize_item_code).one_or_none()
            if prize_item is None:
                raise HTTPException(status_code=503, detail="Предмет-награда теста не найден")
            prize_inventory = (
                db.query(models.InventoryItem)
                .filter(models.InventoryItem.user_id == user.id, models.InventoryItem.item_id == prize_item.id)
                .with_for_update()
                .one_or_none()
            )
            if prize_inventory is not None and (
                prize_inventory.quantity < 0
                or prize_inventory.quantity > MAX_INVENTORY_QUANTITY - q.prize_value
            ):
                raise HTTPException(status_code=409, detail="Достигнут предел количества предмета")
        else:
            raise HTTPException(status_code=503, detail="Тип награды теста не поддерживается")

        # XP overflow and the configured coin prize share one wallet.  Validate
        # their combined effect before creating an attempt or changing XP.
        coin_prize = q.prize_value if q.prize_kind == "coins" else 0
        wallet = ensure_wallet(db, user)
        wallet_increment = coin_prize + xp_overflow_coins
        if wallet.balance < 0 or wallet.balance > MAX_GAME_BALANCE - wallet_increment:
            raise HTTPException(status_code=409, detail="Достигнут предел баланса")

    attempt = models.QuizAttempt(
        quiz_id=q.id,
        user_id=user.id,
        score=score,
        total=total,
        grade=grade,
    )
    db.add(attempt)
    db.flush()
    run.consumed_at = now

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
    xp_to_coins = 0
    if grade in ("good", "excellent"):
        xp_to_coins = award_xp(db, user, xp_award)["coins"]
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
        elif q.prize_kind == "item" and prize_item is not None:
            if prize_inventory:
                prize_inventory.quantity += q.prize_value
            else:
                db.add(models.InventoryItem(
                    user_id=user.id,
                    item_id=prize_item.id,
                    quantity=q.prize_value,
                ))
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
        xp_to_coins=xp_to_coins,
    )
