"""Deterministic integer-only replay of the Snow Courier browser simulation."""
ENGINE_VERSION = 2
STEP_MS = 50
TICKS = 2400
MAX_BAG = 12


def truncdiv(value, divisor):
    return (abs(value) // divisor) * (-1 if value < 0 else 1)


def rng(seed):
    state = seed & 0xFFFFFFFF

    def pick(n):
        nonlocal state
        state = (state * 1664525 + 1013904223) & 0xFFFFFFFF
        return state % n
    return pick


def zone_at(distance):
    part = distance % 24000
    return 2 if part >= 16500 else 1 if part >= 9000 else 0


def entity_x(e, tick):
    if not e.get("motion"):
        return e["x"]
    half = e["period"] // 2
    phase = (tick + e["phase"]) % e["period"]
    triangle = phase if phase <= half else e["period"] - phase
    return e["x"] + truncdiv((triangle * 2 - half) * e["motion"], half)


def make_track(seed):
    r = rng(seed)
    track = []
    y, safe = 500, 2
    for i in range(420):
        y += 240 + r(61)
        if i % 18 == 16:
            track.append(dict(y=y, x=650 if r(2) else -650, kind="dock", style=r(3), id=len(track)))
            continue
        tier = min(3, y // 15000)
        safe = max(0, min(4, safe + r(3) - 1))
        has_gift = i < 6 or r(100) < 62
        gift_lane = safe
        if has_gift:
            if r(100) < 28:
                gift_lane = max(0, min(4, safe + (1 if r(2) else -1)))
            track.append(dict(y=y, x=(gift_lane-2)*360+r(161)-80, kind="gift", style=r(4), id=len(track)))
        if i > 4 and i % 18 not in (15,17):
            lanes = [lane for lane in range(5) if lane != safe and (not has_gift or lane != gift_lane)]
            count = min(len(lanes), 1 if tier == 0 else 2 if tier == 1 else 2+r(2) if tier == 2 else 3)
            for _ in range(count):
                chosen = r(len(lanes))
                lane = lanes.pop(chosen)
                style = r(3)
                motion = (70 if abs(lane-safe)<2 else 160) if style == 2 and tier > 0 else 0
                period = 120+r(3)*40 if motion else 160
                phase = r(period) if motion else 0
                track.append(dict(y=y+r(121)-60, x=(lane-2)*360+r(51)-25,
                                  kind="obstacle",style=style,motion=motion,period=period,phase=phase,id=len(track)))
    track.sort(key=lambda e:(e["y"],e["id"]))
    return track


def create_state():
    return dict(tick=0, x=0, vx=0, distance=0, speed=0, bag=0, score=0,
                delivered=0, deliveries=0, picked=0, lost=0, hits=0, combo=0,
                bestCombo=0, cooldown=0, cursor=0, finished=False, events=[])


def step(state, track, code):
    if state["finished"]:
        return state
    s = state
    s["events"] = []
    aim = (code & 2047)-1000
    brake = code >= 2048
    target = truncdiv(aim*9, 10)
    icy = zone_at(s["distance"]) == 1 and s["x"] >= 0
    grip = (10 if s["bag"] >= 8 else 13) if icy else (20 if s["bag"] >= 8 else 26)
    desired = max(-75, min(75, truncdiv(target-s["x"], 6)))
    s["vx"] = truncdiv(s["vx"]*(100-grip)+desired*grip, 100)
    s["x"] = max(-1080, min(1080, s["x"]+s["vx"]))
    zone = zone_at(s["distance"])
    base = 37 if icy else 28 if zone == 2 else 27 if zone == 1 else 30
    base -= s["bag"]//3
    if brake:
        base = base*55//100
    if s["cooldown"] > 0:
        base = base*65//100
        s["cooldown"] -= 1
    if abs(s["x"]) > 900:
        base = base*65//100
    delta = max(8, base)-s["speed"]
    s["speed"] += (1 if delta > 0 else -1 if delta < 0 else 0)*max(1, abs(delta)//4)
    s["distance"] += s["speed"]
    while s["cursor"] < len(track) and track[s["cursor"]]["y"] <= s["distance"]:
        e = track[s["cursor"]]
        s["cursor"] += 1
        contact_x = entity_x(e, s["tick"])
        dx = abs(s["x"]-contact_x)
        if e["kind"] == "gift" and dx <= 105 and s["bag"] < MAX_BAG:
            s["bag"] += 1
            s["picked"] += 1
            s["score"] += 5
            s["events"].append(dict(kind="gift", x=e["x"], value=1))
        elif e["kind"] == "obstacle" and dx <= 195 and not s["cooldown"]:
            lost = min(2, s["bag"])
            s["bag"] -= lost
            s["lost"] += lost
            s["hits"] += 1
            s["cooldown"] = 14
            s["combo"] = 0
            s["events"].append(dict(kind="hit", x=contact_x, value=lost))
        elif e["kind"] == "dock":
            if s["bag"] > 0 and dx <= 320 and s["speed"] <= 21:
                delivered = s["bag"]
                s["combo"] = min(5, s["combo"]+1)
                s["bestCombo"] = max(s["bestCombo"], s["combo"])
                points = delivered*(80+s["combo"]*15)+50
                s["score"] += points
                s["delivered"] += delivered
                s["deliveries"] += 1
                s["bag"] = 0
                s["events"].append(dict(kind="delivery", x=e["x"], value=delivered, points=points))
            elif s["bag"] > 0:
                s["combo"] = 0
                s["events"].append(dict(kind="brake" if dx <= 320 else "miss", x=e["x"], value=0))
    s["tick"] += 1
    s["finished"] = s["tick"] >= TICKS
    return s


def result(state):
    return dict(score=state["score"], delivered=state["delivered"], deliveries=state["deliveries"],
                picked=state["picked"], lost=state["lost"], hits=state["hits"],
                best_combo=state["bestCombo"], distance=state["distance"],
                duration_ms=state["tick"]*STEP_MS)


def replay(seed, controls):
    track = make_track(seed)
    state = create_state()
    for code in controls:
        step(state, track, code)
    return result(state)
