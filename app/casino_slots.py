"""Five cyclic reel strips, nine line shapes, and server-authoritative payouts."""
from itertools import product
from math import prod

STRIPS = tuple(tuple(strip) for strip in (
    "CLCGCLDGCLGS",
    "LCGLWCGDLCGS",
    "CGDLCGWDCLGS",
    "GCLDCGLWSCLG",
    "LGCWLDGCGLCS",
))
LINES = (
    (1, 1, 1, 1, 1), (0, 0, 0, 0, 0), (2, 2, 2, 2, 2),
    (0, 1, 2, 1, 0), (2, 1, 0, 1, 2), (0, 0, 1, 2, 2),
    (2, 2, 1, 0, 0), (1, 0, 1, 2, 1), (1, 2, 1, 0, 1),
)
PAYTABLE = {
    "C": (30, 100, 240),
    "L": (32, 110, 280),
    "G": (45, 150, 360),
    "D": (75, 225, 650),
    "S": (100, 400, 1600),
}
WINDOWS = tuple(tuple(
    (reel[(stop - 1) % len(reel)], reel[stop], reel[(stop + 1) % len(reel)])
    for stop in range(len(reel))
) for reel in STRIPS)
TOTAL_STOPS = prod(map(len, STRIPS))


def line_result(grid, pattern):
    symbol = grid[0][pattern[0]]
    count = 1
    for col in range(1, len(pattern)):
        if grid[col][pattern[col]] not in (symbol, "W"):
            break
        count += 1
    if count < 3:
        return None
    return symbol, count, PAYTABLE[symbol][count - 3]


def wins_for_grid(grid):
    wins = []
    for line, pattern in enumerate(LINES, start=1):
        win = line_result(grid, pattern)
        if win:
            symbol, count, percent = win
            wins.append({"line": line, "symbol": symbol, "count": count, "percent": percent})
    return wins


def measure_strips():
    # Every row of each strip has the same marginal distribution. Exact
    # enumeration still verifies overlaps and the actual public line evaluator.
    total = hit = jackpots = maximum = 0
    for grid in product(*WINDOWS):
        wins = wins_for_grid(grid)
        payout = sum(win["percent"] for win in wins)
        total += payout
        hit += bool(wins)
        jackpots += any(win["symbol"] == "S" and win["count"] == 5 for win in wins)
        maximum = max(maximum, payout)
    return total, hit, jackpots, maximum

# Exact sum of the base line awards across TOTAL_STOPS. A weighted choice of
# ×1, ×2, or ×3 calibrates the return without changing the drawn reel stops.
BASE_TOTAL = 17_549_208
EXTRA_TOTAL = 90 * TOTAL_STOPS - BASE_TOTAL
TRIPLE_TICKETS = EXTRA_TOTAL // 6
DOUBLE_TICKETS = EXTRA_TOTAL - 2 * TRIPLE_TICKETS


def spin(rng):
    grid = [rng.choice(windows) for windows in WINDOWS]
    wins = wins_for_grid(grid)
    base = sum(win["percent"] for win in wins)
    multiplier = 1
    if base:
        ticket = rng.randrange(BASE_TOTAL)
        if ticket < TRIPLE_TICKETS:
            multiplier = 3
        elif ticket < TRIPLE_TICKETS + DOUBLE_TICKETS:
            multiplier = 2
    return {
        "grid": grid,
        "wins": wins,
        "multiplier": multiplier,
        "payout_percent": base * multiplier,
        "jackpot": any(win["symbol"] == "S" and win["count"] == 5 for win in wins),
    }
