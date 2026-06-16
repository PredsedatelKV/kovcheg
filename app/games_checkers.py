"""Серверная логика РУССКИХ шашек.

Доска — 64 символа (8x8, индекс = row*8 + col):
  '_' пусто, 'x'/'o' простые шашки, 'X'/'O' дамки.
  x — игрок X (ходит вверх по индексам/вниз по доске, старт ряды 0..2),
  o — игрок O (старт ряды 5..7).

Правила:
  * Дамки («летучие») ходят и бьют на любое расстояние по диагонали.
  * Простые шашки ходят вперёд на 1, но бьют в любом направлении (вперёд и назад).
  * Бой обязателен: если есть взятие — простой ход запрещён.
  * Многоходовое взятие: пока та же шашка может бить дальше — ход не передаётся (more=True).
  * Превращение в дамку — на последнем ряду. Если при бое шашка приземляется на
    дамочное поле и бой продолжается — она становится дамкой и продолжает бой уже как дамка.
"""
from __future__ import annotations

DIAG = [(-1, -1), (-1, 1), (1, -1), (1, 1)]


def _rc(i: int) -> tuple[int, int]:
    return divmod(i, 8)


def _idx(r: int, c: int) -> int:
    return r * 8 + c


def initial_board() -> str:
    b = ["_"] * 64
    for r in range(3):
        for c in range(8):
            if (r + c) % 2 == 1:
                b[_idx(r, c)] = "x"
    for r in range(5, 8):
        for c in range(8):
            if (r + c) % 2 == 1:
                b[_idx(r, c)] = "o"
    return "".join(b)


def owner(piece: str) -> str | None:
    if piece in ("x", "X"):
        return "x"
    if piece in ("o", "O"):
        return "o"
    return None


def _is_king(piece: str) -> bool:
    return piece in ("X", "O")


def _opponent(side: str) -> str:
    return "o" if side == "x" else "x"


def _forward(piece: str) -> list[tuple[int, int]]:
    """Направления простого (небьющего) хода для простой шашки."""
    if piece == "x":
        return [(1, -1), (1, 1)]  # x движется в сторону больших рядов
    return [(-1, -1), (-1, 1)]  # o движется в сторону меньших рядов


def _king_row(side: str) -> int:
    """Ряд превращения для стороны."""
    return 7 if side == "x" else 0


# ---------------------------------------------------------------------------
# Генерация взятий. Каждое взятие — это (mid, landing): индекс снятой фигуры
# и клетка приземления.
# ---------------------------------------------------------------------------

def _captures_from(board: str, i: int) -> list[tuple[int, int]]:
    """Список возможных взятий шашкой на клетке i. Возвращает (mid, landing)."""
    piece = board[i]
    side = owner(piece)
    if side is None:
        return []
    r, c = _rc(i)
    opp = _opponent(side)
    res: list[tuple[int, int]] = []

    if _is_king(piece):
        for dr, dc in DIAG:
            # ищем по диагонали первую фигуру
            nr, nc = r + dr, c + dc
            # пропускаем пустые клетки
            while 0 <= nr < 8 and 0 <= nc < 8 and board[_idx(nr, nc)] == "_":
                nr, nc = nr + dr, nc + dc
            if not (0 <= nr < 8 and 0 <= nc < 8):
                continue
            mid_piece = board[_idx(nr, nc)]
            if owner(mid_piece) != opp:
                continue  # своя фигура или ничего бить нельзя
            mid = _idx(nr, nc)
            # клетки приземления — пустые за вражеской фигурой
            lr, lc = nr + dr, nc + dc
            while 0 <= lr < 8 and 0 <= lc < 8 and board[_idx(lr, lc)] == "_":
                res.append((mid, _idx(lr, lc)))
                lr, lc = lr + dr, lc + dc
    else:
        # простая шашка бьёт в любом из 4 направлений на 1
        for dr, dc in DIAG:
            mr, mc = r + dr, c + dc
            tr, tc = r + 2 * dr, c + 2 * dc
            if 0 <= tr < 8 and 0 <= tc < 8:
                if owner(board[_idx(mr, mc)]) == opp and board[_idx(tr, tc)] == "_":
                    res.append((_idx(mr, mc), _idx(tr, tc)))
    return res


def _simple_moves_from(board: str, i: int) -> list[int]:
    """Список небьющих ходов шашкой на клетке i."""
    piece = board[i]
    side = owner(piece)
    if side is None:
        return []
    r, c = _rc(i)
    res: list[int] = []
    if _is_king(piece):
        for dr, dc in DIAG:
            nr, nc = r + dr, c + dc
            while 0 <= nr < 8 and 0 <= nc < 8 and board[_idx(nr, nc)] == "_":
                res.append(_idx(nr, nc))
                nr, nc = nr + dr, nc + dc
    else:
        for dr, dc in _forward(piece):
            nr, nc = r + dr, c + dc
            if 0 <= nr < 8 and 0 <= nc < 8 and board[_idx(nr, nc)] == "_":
                res.append(_idx(nr, nc))
    return res


def _side_has_capture(board: str, side: str) -> bool:
    for i, p in enumerate(board):
        if owner(p) == side and _captures_from(board, i):
            return True
    return False


def has_any_move(board: str, side: str) -> bool:
    for i, p in enumerate(board):
        if owner(p) == side and (_captures_from(board, i) or _simple_moves_from(board, i)):
            return True
    return False


def _maybe_promote(board: list[str], i: int) -> bool:
    """Превращает простую шашку на клетке i в дамку, если она на дамочном ряду.
    Возвращает True, если превращение произошло."""
    piece = board[i]
    side = owner(piece)
    if side is None or _is_king(piece):
        return False
    r, _c = _rc(i)
    if r == _king_row(side):
        board[i] = "X" if side == "x" else "O"
        return True
    return False


# ---------------------------------------------------------------------------
# Применение хода.
# ---------------------------------------------------------------------------

def apply_move(board: str, side: str, frm: int, to: int) -> dict:
    """Применяет ход side ('x'/'o') frm->to. Возвращает {board, more, status}.

    more=True — есть продолжение боя той же шашкой (ход не передаётся).
    status: 'playing' | 'x_won' | 'o_won'. Бросает ValueError при недопустимом ходе.
    """
    if not (0 <= frm < 64 and 0 <= to < 64):
        raise ValueError("Неверная клетка")
    piece = board[frm]
    if owner(piece) != side:
        raise ValueError("Не ваша шашка")
    if board[to] != "_":
        raise ValueError("Клетка занята")

    fr, fc = _rc(frm)
    tr, tc = _rc(to)
    dr, dc = tr - fr, tc - fc
    if dr == 0 or abs(dr) != abs(dc):
        raise ValueError("Ход не по диагонали")

    must_capture = _side_has_capture(board, side)
    captures = _captures_from(board, frm)

    # Является ли запрошенный ход одним из доступных взятий этой шашкой?
    chosen_capture = None
    for mid, landing in captures:
        if landing == to:
            chosen_capture = mid
            break

    b = list(board)

    if chosen_capture is not None:
        # ---- ВЗЯТИЕ ----
        b[chosen_capture] = "_"
        b[to], b[frm] = piece, "_"
        # превращение при приземлении (русские правила: продолжаем бой уже дамкой)
        _maybe_promote(b, to)
        new_board = "".join(b)
        # продолжение боя той же шашкой
        more = bool(_captures_from(new_board, to))
        if more:
            return {"board": new_board, "more": True, "status": "playing"}
        return _finish(new_board, side)

    # ---- НЕ взятие ----
    if must_capture:
        raise ValueError("Обязательно бить")

    # простой ход
    step = (1 if dr > 0 else -1, 1 if dc > 0 else -1)
    if _is_king(piece):
        # дамка: вся диагональ между frm и to должна быть пустой
        r, c = fr + step[0], fc + step[1]
        while (r, c) != (tr, tc):
            if b[_idx(r, c)] != "_":
                raise ValueError("Путь занят")
            r, c = r + step[0], c + step[1]
        b[to], b[frm] = piece, "_"
    else:
        # простая шашка: только на 1 вперёд
        if (dr, dc) not in _forward(piece):
            raise ValueError("Недопустимый ход")
        b[to], b[frm] = piece, "_"
        _maybe_promote(b, to)

    new_board = "".join(b)
    return _finish(new_board, side)


def _finish(new_board: str, side: str) -> dict:
    """Завершает ход (бой не продолжается): считает статус игры."""
    opp = _opponent(side)
    status = "playing"
    if not any(owner(p) == opp for p in new_board) or not has_any_move(new_board, opp):
        status = "x_won" if side == "x" else "o_won"
    return {"board": new_board, "more": False, "status": status}
