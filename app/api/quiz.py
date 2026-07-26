from __future__ import annotations

import json
import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.api._helpers import MAX_PLAYER_LEVEL, XP_PER_LEVEL, award_xp, ensure_wallet
from app.auth import current_user
from app.db import begin_game_write, get_db

router = APIRouter(prefix="/api/quiz", tags=["quiz"])
MAX_QUIZ_COIN_PRIZE = 1_000_000
QUIZ_RUN_TTL = timedelta(hours=2)
MAX_GAME_BALANCE = 2_000_000_000
MAX_INVENTORY_QUANTITY = 2_000_000_000


def _expected_xp_overflow(user: models.User, amount: int) -> int:
    level = max(1, min(int(getattr(user, "level", 1) or 1), MAX_PLAYER_LEVEL))
    current_xp = 0 if level >= MAX_PLAYER_LEVEL else max(0, min(int(user.xp or 0), XP_PER_LEVEL - 1))
    available = max(0, (MAX_PLAYER_LEVEL - level) * XP_PER_LEVEL - current_xp)
    return max(0, amount - available) // 10


def serialize_quiz_rewards(rewards: list[schemas.QuizReward]) -> str:
    return json.dumps(
        [{"kind": reward.kind, "amount": reward.amount, "item_id": reward.item_id} for reward in rewards],
        ensure_ascii=False,
    )


def quiz_rewards_out(db: Session, q: models.Quiz, grade: str) -> list[schemas.QuizReward]:
    attr = f"rewards_{grade}"
    try:
        raw = json.loads(getattr(q, attr, "[]") or "[]")
    except (TypeError, json.JSONDecodeError):
        raise HTTPException(status_code=503, detail="Награды теста настроены некорректно") from None
    if not isinstance(raw, list) or len(raw) > 3:
        raise HTTPException(status_code=503, detail="Награды теста настроены некорректно")
    result: list[schemas.QuizReward] = []
    seen: set[str] = set()
    for entry in raw:
        if not isinstance(entry, dict):
            raise HTTPException(status_code=503, detail="Награды теста настроены некорректно")
        kind = entry.get("kind")
        amount = entry.get("amount")
        item_id = entry.get("item_id")
        if kind not in {"xp", "kovbucks", "item"} or kind in seen:
            raise HTTPException(status_code=503, detail="Награды теста настроены некорректно")
        if isinstance(amount, bool) or not isinstance(amount, int) or not 1 <= amount <= MAX_QUIZ_COIN_PRIZE:
            raise HTTPException(status_code=503, detail="Награды теста настроены некорректно")
        seen.add(kind)
        if kind == "xp":
            result.append(schemas.QuizReward(kind=kind, amount=amount, label=f"{amount} XP", icon="/static/img/ui/xp.png"))
        elif kind == "kovbucks":
            result.append(schemas.QuizReward(kind=kind, amount=amount, label=f"{amount} ковбаксов", icon="/static/img/ui/kovbaks.png"))
        else:
            if isinstance(item_id, bool) or not isinstance(item_id, int):
                raise HTTPException(status_code=503, detail="Предмет-награда теста не выбран")
            item = db.query(models.Item).filter(models.Item.id == item_id).one_or_none()
            if item is None:
                raise HTTPException(status_code=503, detail="Предмет-награда теста не найден")
            result.append(schemas.QuizReward(
                kind=kind,
                amount=amount,
                item_id=item.id,
                label=f"{item.name} ×{amount}",
                icon=item.image_url or item.icon,
            ))
    return result


def quiz_reward_label(rewards: list[schemas.QuizReward]) -> str:
    return " · ".join(reward.label for reward in rewards)


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
            rewards_bad = quiz_rewards_out(db, q, "bad")
            rewards_good = quiz_rewards_out(db, q, "good")
            rewards_excellent = quiz_rewards_out(db, q, "excellent")
        except HTTPException:
            # Do not advertise a broken legacy/admin configuration to players.
            continue
        result.append(
            schemas.QuizForUser(
                id=q.id,
                title=q.title,
                description=q.description,
                prize_label=quiz_reward_label(rewards_excellent),
                question_count=q_count,
                already_passed=q.id in passed_ids,
                time_limit_seconds=q.time_limit_seconds,
                rewards_bad=rewards_bad,
                rewards_good=rewards_good,
                rewards_excellent=rewards_excellent,
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
    for grade in ("bad", "good", "excellent"):
        quiz_rewards_out(db, q, grade)
    now = models.now_utc()
    db.query(models.QuizRun).filter(
        models.QuizRun.user_id == user.id,
        models.QuizRun.expires_at < now,
    ).delete(synchronize_session=False)
    ttl = timedelta(seconds=q.time_limit_seconds) if q.time_limit_seconds > 0 else QUIZ_RUN_TTL
    expires_at = now + min(ttl, QUIZ_RUN_TTL)
    run = models.QuizRun(
        token=secrets.token_urlsafe(32),
        quiz_id=quiz_id,
        user_id=user.id,
        question_count=len(questions),
        started_at=now,
        expires_at=expires_at,
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
    return schemas.QuizStartOut(
        run_token=run.token,
        questions=public_questions,
        time_limit_seconds=q.time_limit_seconds,
        expires_at=expires_at,
    )


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
    percent = score * 100 / total
    grade = "bad" if percent <= 40 else "good" if percent <= 70 else "excellent"
    rewards = quiz_rewards_out(db, q, grade)
    xp_award = sum(reward.amount for reward in rewards if reward.kind == "xp")
    kovbucks_award = sum(reward.amount for reward in rewards if reward.kind == "kovbucks")
    xp_overflow_coins = _expected_xp_overflow(user, xp_award)
    wallet = ensure_wallet(db, user)
    wallet_increment = kovbucks_award + xp_overflow_coins
    if wallet.balance < 0 or wallet.balance > MAX_GAME_BALANCE - wallet_increment:
        raise HTTPException(status_code=409, detail="Достигнут предел баланса")

    item_rewards: list[tuple[schemas.QuizReward, models.Item, models.InventoryItem | None]] = []
    for reward in rewards:
        if reward.kind != "item":
            continue
        item = db.query(models.Item).filter(models.Item.id == reward.item_id).one()
        inventory = (
            db.query(models.InventoryItem)
            .filter(models.InventoryItem.user_id == user.id, models.InventoryItem.item_id == item.id)
            .with_for_update()
            .one_or_none()
        )
        if inventory is not None and (
            inventory.quantity < 0 or inventory.quantity > MAX_INVENTORY_QUANTITY - reward.amount
        ):
            raise HTTPException(status_code=409, detail="Достигнут предел количества предмета")
        item_rewards.append((reward, item, inventory))

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

    prize_awarded = bool(rewards)
    xp_to_coins = 0
    if xp_award:
        xp_to_coins = award_xp(db, user, xp_award)["coins"]
    if kovbucks_award:
        wallet.balance += kovbucks_award
        db.add(models.Transaction(
            sender_id=None,
            recipient_id=user.id,
            amount=kovbucks_award,
            note=f"quiz:{q.id}:{grade}",
        ))
    for reward, item, inventory in item_rewards:
        if inventory:
            inventory.quantity += reward.amount
        else:
            db.add(models.InventoryItem(user_id=user.id, item_id=item.id, quantity=reward.amount))
    attempt.prize_awarded = prize_awarded

    db.commit()
    db.refresh(attempt)

    grade_labels = {"bad": "Плохо", "good": "Хорошо", "excellent": "Отлично"}
    return schemas.QuizResultOut(
        score=score,
        total=total,
        grade=grade,
        grade_label=grade_labels.get(grade, grade),
        prize_label=quiz_reward_label(rewards),
        prize_awarded=prize_awarded,
        xp_to_coins=xp_to_coins,
        rewards=rewards,
    )
