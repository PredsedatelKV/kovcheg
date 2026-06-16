"""Серверная логика русских шашек (упрощённая, англ. правила без обязательного боя).

Доска — 64 символа (8x8, индекс = row*8 + col):
  '_' пусто, 'x'/'o' простые шашки, 'X'/'O' дамки.
  x — игрок X (ходит вниз, ряды 0..2 на старте), o — игрок O (ходит вверх, ряды 5..7).
"""
from __future__ import annotations


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


def _dirs(piece: str) -> list[tuple[int, int]]:
    if _is_king(piece):
        return [(-1, -1), (-1, 1), (1, -1), (1, 1)]
    if piece == "x":  # вниз
        return [(1, -1), (1, 1)]
    return [(-1, -1), (-1, 1)]  # o вверх


def _captures_from(board: str, i: int) -> list[int]:
    piece = board[i]
    side = owner(piece)
    if side is None:
        return []
    r, c = _rc(i)
    res = []
    for dr, dc in _dirs(piece):
        mr, mc = r + dr, c + dc
        tr, tc = r + 2 * dr, c + 2 * dc
        if 0 <= tr < 8 and 0 <= tc < 8 and 0 <= mr < 8 and 0 <= mc < 8:
            if owner(board[_idx(mr, mc)]) == _opponent(side) and board[_idx(tr, tc)] == "_":
                res.append(_idx(tr, tc))
    return res


def _simple_from(board: str, i: int) -> list[int]:
    piece = board[i]
    if owner(piece) is None:
        return []
    r, c = _rc(i)
    res = []
    for dr, dc in _dirs(piece):
        nr, nc = r + dr, c + dc
        if 0 <= nr < 8 and 0 <= nc < 8 and board[_idx(nr, nc)] == "_":
            res.append(_idx(nr, nc))
    return res


def has_any_move(board: str, side: str) -> bool:
    for i, p in enumerate(board):
        if owner(p) == side and (_captures_from(board, i) or _simple_from(board, i)):
            return True
    return False


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
    b = list(board)
    captured = False
    if abs(dr) == 1 and abs(dc) == 1:
        if (dr, dc) not in _dirs(piece):
            raise ValueError("Недопустимый ход")
        b[to], b[frm] = piece, "_"
    elif abs(dr) == 2 and abs(dc) == 2:
        if (dr // 2, dc // 2) not in _dirs(piece):
            raise ValueError("Недопустимый ход")
        mid = _idx(fr + dr // 2, fc + dc // 2)
        if owner(b[mid]) != _opponent(side):
            raise ValueError("Нечего бить")
        b[to], b[frm], b[mid] = piece, "_", "_"
        captured = True
    else:
        raise ValueError("Недопустимый ход")

    became_king = False
    if piece == "x" and tr == 7:
        b[to] = "X"
        became_king = True
    elif piece == "o" and tr == 0:
        b[to] = "O"
        became_king = True

    new_board = "".join(b)
    more = bool(captured and not became_king and _captures_from(new_board, to))

    status = "playing"
    if not more:
        opp = _opponent(side)
        if not any(owner(p) == opp for p in new_board) or not has_any_move(new_board, opp):
            status = "x_won" if side == "x" else "o_won"
    return {"board": new_board, "more": more, "status": status}
