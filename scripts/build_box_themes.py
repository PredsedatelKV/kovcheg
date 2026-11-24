"""Synthesize original sound cues for the three Kovbox opening themes."""
import math
import random
import struct
import sys
import wave
from pathlib import Path

RATE = 32000
TWOPI = math.tau
IMPACT = .64


def ring(t, hz, decay, harmonics):
    if t < 0:
        return 0.0
    attack = min(1, t / .003)
    return attack * math.exp(-t * decay) * sum(
        level * math.sin(TWOPI * hz * ratio * t) for ratio, level in harmonics
    )


HARMONICS = {
    "magic": ((1, 1), (2, .28), (2.76, .10)),
    "ice": ((1, .63), (1.52, .39), (2.28, .17), (3.37, .15)),
    "festive": ((1, .90), (2.01, .35), (2.71, .15), (4.07, .09)),
}
TAP_NOTES = {
    "magic": [(0, 1050, .56, 0), (.032, 1575, .26, .25)],
    "ice": [(0, 1660, .45, -.25), (.016, 2370, .34, .38), (.048, 3105, .16, -.53)],
    "festive": [(0, 883, .48, -.19), (.019, 1320, .34, .22), (.064, 1765, .27, -.52)],
}
SWEEP_NOTES = {
    "magic": [(.21, 659, .13, -.30), (.36, 987, .17, .40), (.51, 1319, .18, -.30)],
    "ice": [(.24, 1700, .11, .42), (.39, 2218, .14, -.27), (.54, 2960, .10, .54)],
    "festive": [(.19, 784, .22, .27), (.31, 987, .23, -.32), (.46, 1319, .22, .31), (.55, 1568, .17, -.34)],
}
FINALE_NOTES = {
    "magic": [(0, 784, .32, -.18), (.018, 1175, .30, .16), (.054, 1568, .26, -.33), (.135, 2349, .17, .41)],
    "ice": [(0, 1110, .31, -.22), (.023, 1663, .34, .34), (.076, 2218, .24, -.39), (.16, 3322, .15, .52)],
    "festive": [(0, 523, .30, -.19), (.018, 1047, .36, .24), (.072, 1319, .28, -.36), (.135, 1568, .27, .4), (.234, 2093, .23, -.43)],
}


def render(path, theme, reveal):
    rng = random.Random(6871)
    slow = 0.
    fast = 0.
    duration = 1.92 if reveal else .33
    taps = TAP_NOTES[theme]
    notes = [(*note, 21 if theme != "festive" else 13) for note in taps]
    if reveal:
        notes += [(*note, 10) for note in SWEEP_NOTES[theme]]
        notes += [(at + IMPACT, hz, level, pan, 4.25 if theme == "festive" else 5.9)
                  for at, hz, level, pan in FINALE_NOTES[theme]]
        notes += [(at + IMPACT + .106, hz, level * .18, -pan, 5.4)
                  for at, hz, level, pan in FINALE_NOTES[theme]]
    samples = bytearray()
    for i in range(round(duration * RATE)):
        t = i / RATE
        left = 0.
        right = 0.
        for at, hz, level, pan, decay in notes:
            sound = level * ring(t - at, hz, decay, HARMONICS[theme])
            left += sound * (1 - pan * .58)
            right += sound * (1 + pan * .58)
        white = rng.uniform(-1, 1)
        fast += .17 * (white - fast)
        slow += .015 * (white - slow)
        if theme == "ice":
            breath = (fast - slow) * (1 + .22 * math.sin(TWOPI * 8 * t))
            gust = .34 * min(1, t / .015) * math.exp(-14 * t)
            if reveal:
                gust += .52 * math.exp(-((t - .56) / .19) ** 2)
                gust += .68 * math.exp(-((t - .74) / .135) ** 2)
            left += breath * gust
            right += (breath + .20 * fast * math.sin(TWOPI * 7 * t)) * gust
        elif theme == "festive":
            jingle = (white - fast) * .095 * min(1, t / .006) * math.exp(-37 * t)
            if reveal and t >= IMPACT:
                jingle += fast * .22 * math.exp(-9 * (t - IMPACT))
            left += jingle
            right += .88 * jingle
        fade = min(1, (duration - t) / (.17 if reveal else .09))
        samples.extend(struct.pack("<hh", *(round(fade * math.tanh(value) * 31400) for value in (left, right))))
    with wave.open(str(path), "wb") as wav:
        wav.setparams((2, 2, RATE, 0, "NONE", "not compressed"))
        wav.writeframes(samples)


if __name__ == "__main__":
    dest = Path(sys.argv[1])
    dest.mkdir(parents=True, exist_ok=True)
    for theme in HARMONICS:
        render(dest / f"{theme}-tap.wav", theme, False)
        render(dest / f"{theme}-reveal.wav", theme, True)
