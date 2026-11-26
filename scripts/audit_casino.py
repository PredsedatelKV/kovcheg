"""Offline RTP audit using server rules. Run with python -m scripts.audit_casino."""
import argparse
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
import math
from random import Random

from app import casino_math as rules, casino_slots as slots

STAKE = 137
SEED = 93_0112


@dataclass
class Stats:
    payout: int = 0
    squared: int = 0
    wins: int = 0
    refunds: int = 0
    empty: int = 0
    jackpots: int = 0
    loss_run: int = 0
    longest_loss: int = 0

    def record(self, payout, stake, jackpot=False):
        self.payout += payout
        self.squared += payout * payout
        self.wins += payout > stake
        self.refunds += payout == stake
        self.empty += payout == 0
        self.jackpots += jackpot
        self.loss_run = self.loss_run + 1 if payout < stake else 0
        self.longest_loss = max(self.longest_loss, self.loss_run)

    def summary(self, rounds, stake):
        rtp = self.payout / rounds / stake
        spread = math.sqrt(max(0, self.squared / rounds / stake**2 - rtp**2))
        margin = 1.96 * spread / math.sqrt(rounds)
        assert abs(rtp - rules.RTP_PERCENT / 100) <= 4 * margin, (rtp, margin)
        return (f"{100*rtp:6.3f}% ±{100*margin:.3f} п.п. | "
                f"выигрыш {100*self.wins/rounds:6.2f}% | нулевая выплата {100*self.empty/rounds:6.2f}% | "
                f"возврат ставки {100*self.refunds/rounds:5.2f}% | "
                f"джекпоты {self.jackpots:,} | длиннейшая серия минусов {self.longest_loss}")


def audit(label, rounds, seed):
    rng = Random(seed)
    stats = Stats()
    stake = 100 if label == "Рулетка" else STAKE
    if label.startswith("Ракетка"):
        target = int(label.split()[-1])

    for _ in range(rounds):
        jackpot = False
        if label == "Слоты":
            outcome = slots.spin(rng)
            payout = rules.pay_percent(stake, outcome["payout_percent"], rng)
            jackpot = outcome["jackpot"]
        elif label == "Рулетка":
            payout, _ = rules.weighted_payout(rules.ROULETTE_PAYOUTS, rng, 10_000)
            jackpot = payout == rules.ROULETTE_JACKPOT
        elif label.startswith("Кубик"):
            outcome = rules.roll_dice("5" if label.endswith("число") else "even", rng)
            payout = rules.pay_percent(stake, outcome["payout_percent"], rng)
        elif label.startswith("Сейф"):
            outcome = rules.open_vault("2", stake, rng)
            payout = outcome["offer"]
            if label.endswith("ключ"):
                payout = payout * 2 if outcome["winning_key"] == "left" else 0
        else:
            outcome = rules.rocket_outcome(rules.rocket_crash_point(rng))
            alive = target < round(outcome["crash_at"] * 100) or outcome["auto_cashout_at_cap"]
            payout = rules.pay_percent(stake, target, rng) if alive else 0
        stats.record(payout, stake, jackpot)
    return label, stats.summary(rounds, stake)


def exact_check():
    assert sum(w for _, w in rules.ROULETTE_PAYOUTS) == 10_000
    assert sum(p*w for p, w in rules.ROULETTE_PAYOUTS) == rules.RTP_PERCENT * 10_000
    assert sum(w for _, w in rules.RISKWHEEL_PAYOUTS) == 100
    assert sum(p*w for p, w in rules.RISKWHEEL_PAYOUTS) == rules.RTP_PERCENT * 100
    assert sum(rules.VAULT_PAYOUTS) == rules.RTP_PERCENT * 4
    assert rules.DICE_EXACT_PAYOUT_PERCENT == rules.RTP_PERCENT * 6
    assert rules.DICE_EVEN_PAYOUT_PERCENT == rules.RTP_PERCENT * 2
    base, matched, jackpots, maximum = slots.measure_strips()
    assert base == slots.BASE_TOTAL
    assert base + slots.DOUBLE_TICKETS + 2*slots.TRIPLE_TICKETS == rules.RTP_PERCENT*slots.TOTAL_STOPS
    print(f"Exact model {rules.RTP_PERCENT}% | slots {slots.TOTAL_STOPS:,} grids, {matched:,} matches, "
          f"{jackpots} jackpot grids, max ×{3*maximum/100:.2f}", flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--rounds", type=int, default=3_000_000)
    args = parser.parse_args()
    if args.rounds <= 0:
        parser.error("--rounds must be positive")
    exact_check()
    labels = ["Слоты", "Рулетка", "Кубик точное число", "Кубик чётность", "Сейф забрать", "Сейф ключ",
              "Ракетка 100", "Ракетка 149", "Ракетка 200", "Ракетка 300", "Ракетка 500"]
    print(f"{args.rounds:,} rounds per strategy, {args.rounds * len(labels):,} total", flush=True)
    with ProcessPoolExecutor(max_workers=6) as pool:
        futures = [pool.submit(audit, label, args.rounds, SEED+i) for i, label in enumerate(labels)]
        for f in futures:
            label, result = f.result()
            print(f"{label:<22} {result}", flush=True)


if __name__ == "__main__":
    main()
