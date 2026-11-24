"""Original Kovcheg taps and the legendary opening score."""
import math
import random
import struct
import sys
import wave
from pathlib import Path

RATE = 44100
TAU = math.tau
REVEAL = 4.2


def bell(t, frequency, decay):
    if t < 0 or t > 1.8:
        return 0.0
    a = min(1, t / .006) * math.exp(-decay * t)
    phase = TAU * frequency * t
    return a * (.8 * math.sin(phase) + .15 * math.sin(phase * 2.01) + .05 * math.sin(phase * 3.47))


def brass(t, frequency, drive, attack=.09, decay=1.6):
    if t < 0:
        return 0.0
    env = min(1, t / attack) * math.exp(-t * decay)
    p = TAU * frequency * t + .03 * math.sin(TAU * 4.7 * t)
    return env * (math.sin(p) + drive * (.41 * math.sin(2 * p) + .17 * math.sin(3 * p) + .09 * math.sin(5 * p)))


def mix_note(left_right, sample, pan):
    left_right[0] += sample * (1 - pan * .51)
    left_right[1] += sample * (1 + pan * .51)


def write(path, duration, voice):
    data = bytearray()
    for i in range(round(duration * RATE)):
        t = i / RATE
        fade = min(1, (duration - t) / .12)
        left, right = voice(t)
        data.extend(struct.pack("<hh", *(round(fade * math.tanh(1.17 * v) * 30000) for v in (left, right))))
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(2)
        wav.setsampwidth(2)
        wav.setframerate(RATE)
        wav.writeframes(data)


def small_sound(path, pitch, accent, duration):
    def voice(t):
        tap = .36 * bell(t, pitch * .61, 39) + .27 * bell(t, pitch * 2.47, 56)
        ring = .42 * bell(t, pitch, 18)
        shimmer = accent * bell(t - .021, pitch * 1.51, 13)
        return tap + ring + shimmer * .85, tap + ring + shimmer
    write(path, duration, voice)


def grand_sound(path):
    rng = random.Random(719)
    smooth = 0.0
    prelude_notes = (
        (.34, 146.83, .15, -.19), (.66, 220.00, .105, .3),
        (1.02, 293.66, .125, -.27), (1.38, 369.99, .145, .32),
        (1.73, 440.00, .145, -.34), (2.04, 587.33, .146, .48),
        (2.33, 659.25, .155, -.4), (2.64, 739.99, .145, .43),
        (2.91, 880.00, .174, -.35), (3.19, 987.77, .185, .39),
        (3.45, 1108.73, .168, -.39), (3.75, 1318.51, .179, .45),
    )
    finale = (
        (0, 55., .27, -.12), (0, 73.42, .28, .12), (0, 146.83, .18, .03), (.018, 220.0, .10, -.36),
        (.036, 293.66, .105, .27), (.054, 369.99, .096, -.40), (.058, 440.0, .095, .46),
        (.028, 587.33, .172, -.49), (.125, 739.99, .156, .54),
        (.245, 880.0, .142, -.39), (.44, 1174.66, .133, .42),
        (.58, 1479.98, .091, .53), (.73, 1760.0, .079, -.52),
        (.85, 2349.32, .069, .47),
        (1.03, 587.33, .14, -.27), (1.09, 880.0, .141, .24),
        (1.28, 1174.66, .125, -.47), (1.52, 1479.98, .097, .51),
        (1.77, 1760., .081, -.36), (2.04, 2349.32, .069, .46),
        (1.04, 146.83, .15, -.17), (1.06, 220., .10, .22), (1.18, 293.66, .10, -.12),
    )
    drums = (.41, 1.18, 1.91, 2.63, 3.11, 3.51, 3.80, 4.03, REVEAL)

    def voice(t):
        nonlocal smooth
        hiss = rng.uniform(-1, 1)
        smooth += (hiss - smooth) * .13
        sound = [0.0, 0.0]
        click = bell(t, 651, 46) * .29 + bell(t, 1040, 55) * .12
        mix_note(sound, click, 0)
        if t < REVEAL:
            x = t / REVEAL
            arc = (x ** 1.1) * min(1, (REVEAL - t) / .12)
            sweep = math.sin(TAU * (52 * t + 6.5 * t * t + 2.1 * t ** 3))
            drone = brass(t, 73.42, .46, .37, .13)
            mix_note(sound, .085 * drone + arc * (.072 * sweep + .116 * (hiss - smooth)), 0)
            mix_note(sound, .055 * arc * brass(t, 110, .58, .65, .1), -.44)
        for at, hz, amp, pan in prelude_notes:
            mix_note(sound, amp * bell(t - at, hz, 5.6), pan)
        for index, at in enumerate(drums):
            elapsed = t - at
            if 0 <= elapsed < .28:
                amp = .15 + index * .026
                env = min(1, elapsed / .006) * math.exp(-elapsed * 15)
                phase = TAU * (48 * elapsed + 2.4 * (1 - math.exp(-24 * elapsed)))
                mix_note(sound, amp * env * (math.sin(phase) + .36 * smooth), 0 if index % 2 else -.15)
        for at, hz, amp, pan in finale:
            elapsed = t - REVEAL - at
            if elapsed >= 0:
                sample = brass(elapsed, hz, .41, .018, 2.45) if hz < 460 else bell(elapsed, hz, 3.7)
                echo = 0.24 * bell(elapsed - .140, hz, 3.5)
                mix_note(sound, amp * sample, pan)
                mix_note(sound, amp * echo, -pan)
        return sound

    write(path, 7.35, voice)


output = Path(sys.argv[1])
small_sound(output / "box-tap.wav", 605, .025, .17)
for count, (pitch, accent) in enumerate([(630, .10), (803, .13), (1009, .15)], 1):
    small_sound(output / f"star-{count}.wav", pitch, accent, .27)
grand_sound(output / "grand-reveal.wav")
