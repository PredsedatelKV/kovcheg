"""The shared payout model for the server and offline casino audit."""
import math

RTP_PERCENT = 93

RISKWHEEL_PAYOUTS = (
    (5, 15), (25, 13), (50, 12), (75, 16), (100, 15),
    (150, 14), (200, 8), (250, 4), (300, 3),
)
ROULETTE_PAYOUTS = (
    (10, 900), (20, 1_100), (30, 1_000), (40, 1_000), (50, 920),
    (100, 3_470), (200, 1_280), (500, 300), (1_000, 30),
)
ROULETTE_JACKPOT = ROULETTE_PAYOUTS[-1][0]
DICE_EXACT_PAYOUT_PERCENT = 6 * RTP_PERCENT
DICE_EVEN_PAYOUT_PERCENT = 2 * RTP_PERCENT
DICE_CHOICES = frozenset(("odd", "even", "low", "high", "1", "2", "3", "4", "5", "6"))
ROCKET_MIN_MULTIPLIER = 1.0
ROCKET_MAX_MULTIPLIER = 5.0
VAULT_PAYOUTS = (55, 80, 100, 137)
VAULT_KEYS = ("left", "right")


def pay_percent(amount, percent, rng):
    """Round to whole Kovbucks with the exact fractional expected value."""
    whole, fraction = divmod(amount * percent, 100)
    return whole + int(fraction != 0 and rng.randrange(100) < fraction)


def weighted_payout(table, rng, total):
    ticket = rng.randrange(1, total + 1)
    for index, (value, weight) in enumerate(table):
        ticket -= weight
        if ticket <= 0:
            return value, index
    raise ValueError("Invalid casino payout weights")


def roll_dice(choice, rng):
    roll = rng.randrange(1, 7)
    if choice.isdigit():
        percent = DICE_EXACT_PAYOUT_PERCENT if roll == int(choice) else 0
    else:
        won = {"odd": roll % 2 == 1, "even": roll % 2 == 0, "low": roll <= 3, "high": roll >= 4}
        percent = DICE_EVEN_PAYOUT_PERCENT if won[choice] else 0
    return {"roll": roll, "choice": choice, "payout_percent": percent}


def rocket_crash_point(rng):
    roll = rng.random()
    rtp = RTP_PERCENT / 100
    if roll >= rtp:
        return ROCKET_MIN_MULTIPLIER
    if roll <= rtp / ROCKET_MAX_MULTIPLIER:
        return ROCKET_MAX_MULTIPLIER
    return rtp / roll


def rocket_outcome(draw):
    # A payable displayed hundredth stays available until the next tick.
    # Reaching the cap alive is distinct from crashing on that tick.
    return {
        "crash_at": math.ceil(draw * 100) / 100,
        "auto_cashout_at_cap": draw == ROCKET_MAX_MULTIPLIER,
        "round_payout": True,
    }


def open_vault(choice, amount, rng):
    offers = list(VAULT_PAYOUTS)
    rng.shuffle(offers)
    return {
        "choice": choice,
        "offer": pay_percent(amount, offers[int(choice) - 1], rng),
        "winning_key": rng.choice(VAULT_KEYS),
    }
