"""Серверная логика РУССКИХ шашек.

Доска — 64 символа (8x8, индекс = row*8 + col):
  '_' пусто, 'x'/'o' простые шашки, 'X'/'O' дамки.
  x — игрок X (ходит вверх по индексам/вниз по доске, старт ряды 0..2),
  o — игрок O (старт ряды 5..7).

Правила:
  * Дамки («летучие») ходят и бьют на любое расстояние по диагонали.
  * Простые шашки ходят вперёд на 1, но бьют в любом направлении (вперёд и назад).
  * Бой обязателен: если есть взятие — простой ход запрещён.
  * Многоходовое взятие: бьём НЕСКОЛЬКО шашек за один ход. Игрок выбирает шашку и
    кликает КОНЕЧНУЮ клетку — сервер находит полную цепочку боя (DFS) и снимает все
    побитые фигуры. После полного боя ход передаётся сопернику (more всегда False).
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
# Полные цепочки боя (DFS).
#
# Каждая цепочка описывается как (end, captured, board_after):
#   end          — клетка, на которой фигура остановилась пройдя весь путь боя;
#   captured     — frozenset индексов снятых вражеских фигур;
#   board_after  — итоговая доска (строка) после снятия всех фигур.
# Цепочка терминальна, если из end дальше бить нельзя (с учётом уже снятых).
# ---------------------------------------------------------------------------

def _capture_steps(board: list[str], i: int, captured: frozenset[int]) -> list[tuple[int, int]]:
    """Доступные взятия фигурой на клетке i при уже снятых (но ещё стоящих на доске)
    фигурах captured. Возвращает (mid, landing). Дважды одну фигуру не бьём, и
    приземление не должно попадать на уже снятую (она физически ещё на доске).
    """
    piece = board[i]
    side = owner(piece)
    if side is None:
        return []
    r, c = _rc(i)
    opp = _opponent(side)
    res: list[tuple[int, int]] = []

    if _is_king(piece):
        for dr, dc in DIAG:
            nr, nc = r + dr, c + dc
            # пропускаем пустые и уже снятые (они «прозрачны») клетки
            while 0 <= nr < 8 and 0 <= nc < 8 and (
                board[_idx(nr, nc)] == "_" or _idx(nr, nc) in captured
            ):
                nr, nc = nr + dr, nc + dc
            if not (0 <= nr < 8 and 0 <= nc < 8):
                continue
            mid = _idx(nr, nc)
            if owner(board[mid]) != opp or mid in captured:
                continue  # своя фигура, ничего, или уже снятая — бить нельзя
            lr, lc = nr + dr, nc + dc
            while 0 <= lr < 8 and 0 <= lc < 8 and (
                board[_idx(lr, lc)] == "_" or _idx(lr, lc) in captured
            ):
                res.append((mid, _idx(lr, lc)))
                lr, lc = lr + dr, lc + dc
    else:
        for dr, dc in DIAG:
            mr, mc = r + dr, c + dc
            tr, tc = r + 2 * dr, c + 2 * dc
            if 0 <= tr < 8 and 0 <= tc < 8:
                mid = _idx(mr, mc)
                land = _idx(tr, tc)
                if (
                    owner(board[mid]) == opp and mid not in captured
                    and (board[land] == "_" or land in captured)
                ):
                    res.append((mid, land))
    return res


def _capture_chains(board: str, frm: int) -> list[tuple[int, frozenset[int]]]:
    """Все терминальные цепочки боя из клетки frm. Возвращает список (end, captured).

    Снятые фигуры остаются на доске в процессе поиска (нельзя приземляться на них
    и нельзя проходить дамкой так, будто их нет — они «прозрачны», но не убираются,
    чтобы корректно работало правило «нельзя бить одну фигуру дважды»).
    """
    results: list[tuple[int, frozenset[int]]] = []

    def dfs(b: list[str], pos: int, piece: str, captured: frozenset[int], progressed: bool) -> None:
        steps = _capture_steps(b, pos, captured)
        if not steps:
            if progressed:
                results.append((pos, captured))
            return
        for mid, landing in steps:
            nb = list(b)
            nb[pos] = "_"
            nb[landing] = piece
            new_piece = piece
            # превращение посреди боя: дальше бьём уже дамкой
            if not _is_king(piece):
                lr, _lc = _rc(landing)
                if lr == _king_row(owner(piece)):
                    new_piece = "X" if owner(piece) == "x" else "O"
                    nb[landing] = new_piece
            dfs(nb, landing, new_piece, captured | {mid}, True)

    dfs(list(board), frm, board[frm], frozenset(), False)
    return results


# ---------------------------------------------------------------------------
# Применение хода.
# ---------------------------------------------------------------------------

def apply_move(board: str, side: str, frm: int, to: int) -> dict:
    """Применяет ход side ('x'/'o') frm->to. Возвращает {board, more, status}.

    Если у стороны есть обязательный бой, ход frm->to валиден только если есть полная
    цепочка боя, заканчивающаяся ровно на `to`; снимаются ВСЕ побитые фигуры. Если
    таких цепочек несколько — выбирается с максимальным числом взятий. Ход после
    полного боя всегда передаётся сопернику (more=False).

    Если боя нет — обычный ход. more всегда False.
    status: 'playing' | 'x_won' | 'o_won'. Бросает ValueError при недопустимом ходе.
    """
    if not (0 <= frm < 64 and 0 <= to < 64):
        raise ValueError("Неверная клетка")
    piece = board[frm]
    if owner(piece) != side:
        raise ValueError("Не ваша шашка")
    if board[to] != "_":
        raise ValueError("Клетка занята")

    must_capture = _side_has_capture(board, side)

    if must_capture:
        # ---- ОБЯЗАТЕЛЬНЫЙ БОЙ: ищем полную цепочку, заканчивающуюся на `to` ----
        chains = [ch for ch in _capture_chains(board, frm) if ch[0] == to]
        if not chains:
            # либо этой шашкой бить нельзя, либо `to` не является концом цепочки боя
            raise ValueError("Обязательно бить")
        # из нескольких — с максимальным числом взятий
        end, captured = max(chains, key=lambda ch: len(ch[1]))
        b = list(board)
        new_piece = piece
        if not _is_king(piece):
            tr, _tc = _rc(to)
            if tr == _king_row(side):
                new_piece = "X" if side == "x" else "O"
        b[frm] = "_"
        for mid in captured:
            b[mid] = "_"
        b[to] = new_piece
        return _finish("".join(b), side)

    # ---- НЕ взятие: обычный ход ----
    fr, fc = _rc(frm)
    tr, tc = _rc(to)
    dr, dc = tr - fr, tc - fc
    if dr == 0 or abs(dr) != abs(dc):
        raise ValueError("Ход не по диагонали")

    b = list(board)
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


def legal_moves(board: str, side: str) -> dict[int, list[int]]:
    """Карта допустимых ходов для стороны side: {клетка_фигуры: [конечные клетки]}.

    При наличии боя — только конечные клетки полных цепочек боя; иначе — простые ходы.
    Используется для подсветки на фронте.
    """
    must_capture = _side_has_capture(board, side)
    res: dict[int, list[int]] = {}
    for i, p in enumerate(board):
        if owner(p) != side:
            continue
        if must_capture:
            ends = sorted({end for end, _cap in _capture_chains(board, i)})
            if ends:
                res[i] = ends
        else:
            moves = sorted(_simple_moves_from(board, i))
            if moves:
                res[i] = moves
    return res


def _finish(new_board: str, side: str) -> dict:
    """Завершает ход (бой не продолжается): считает статус игры."""
    opp = _opponent(side)
    status = "playing"
    if not any(owner(p) == opp for p in new_board) or not has_any_move(new_board, opp):
        status = "x_won" if side == "x" else "o_won"
    return {"board": new_board, "more": False, "status": status}
