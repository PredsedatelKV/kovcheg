"""Server-owned simulation for the Thin Ice arcade game."""
from dataclasses import dataclass, field
import math
import random

DT = .05
SIZE = 11
TILE = 1.65
HALF = SIZE * TILE * .5
DURATION = 108
SPAWNS = [(3, 3), (7, 7), (7, 3), (3, 7)]
STORMS = (24, 43, 62, 81)
ITEMS = ("bridge", "anchor", "charge")
INPUT_TTL = .32


def unit(x, z):
    scale = max(1, math.hypot(x, z))
    return x / scale, z / scale


def coords(index):
    return ((index % SIZE + .5) * TILE - HALF,
            (index // SIZE + .5) * TILE - HALF)


def tile_at(x, z):
    col, row = math.floor((x + HALF) / TILE), math.floor((z + HALF) / TILE)
    return row * SIZE + col if 0 <= col < SIZE and 0 <= row < SIZE else None


@dataclass
class Floe:
    wear: float = 0
    breaks: float = 0
    frozen: float = 0
    gone: bool = False
    storm: bool = False


@dataclass
class Skater:
    id: str
    name: str
    bot: bool = False
    connected: bool = True
    x: float = 0
    z: float = 0
    y: float = 0
    vx: float = 0
    vz: float = 0
    vy: float = 0
    ax: float = 0
    az: float = -1
    grounded: bool = True
    alive: bool = True
    eliminated: float | None = None
    jump: float = 0
    dash: float = 0
    push: float = 0
    dash_until: float = 0
    grip: float = 0
    intent: tuple = (0, 0)
    pressed: set = field(default_factory=set)
    actions: set = field(default_factory=set)
    last_input: float = -100
    decide_at: float = 0
    tiles: int = 0
    shoves: int = 0
    items: int = 0


class IceMatch:
    def __init__(self, players, seed):
        self.actors = {p.id: p for p in players}
        self.seed = seed
        self.random = random.Random(seed)
        self.phase = "countdown"
        self.tick = 0
        self.time = -3.0
        self.events = []
        self.event_id = 0
        self.floes = [Floe() for _ in range(SIZE * SIZE)]
        self.items = []
        self.storm = 0
        self.next_item = 5
        self.winner = None
        self.reason = ""
        for p, (col, row) in zip(players, SPAWNS):
            p.x, p.z = coords(row * SIZE + col)
            p.ax, p.az = unit(-p.x * 10, -p.z * 10)

    def emit(self, kind, **details):
        self.event_id += 1
        self.events.append(dict(id=self.event_id, tick=self.tick, kind=kind, **details))
        self.events = self.events[-36:]

    def finish(self, winner, reason):
        if self.phase == "finished":
            return
        self.phase, self.winner, self.reason = "finished", winner, reason
        self.emit("finish", winner=winner)

    def eliminate(self, p, reason="fall"):
        if not p.alive:
            return
        p.alive = False
        p.eliminated = max(0, self.time)
        p.actions.clear()
        self.emit(reason, actor=p.id, x=round(p.x, 2), z=round(p.z, 2))

    def connection(self, p, connected, fill):
        p.connected = connected
        p.bot = not connected and fill
        p.intent = (0, 0)
        p.actions.clear()
        p.pressed.clear()

    def set_input(self, id, data):
        p = self.actors.get(id)
        if not p or p.bot or not p.alive:
            return
        p.intent = unit(max(-1, min(1, data.get("mx", 0))), max(-1, min(1, data.get("mz", 0))))
        pressed = {key for key in ("jump", "dash", "fire") if data.get(key) is True}
        p.actions.update(pressed - p.pressed)
        p.pressed = pressed
        p.last_input = self.time

    def safe(self, x, z, future=0):
        index = tile_at(x, z)
        return index is not None and self.supports(index, future)

    def supports(self, index, future=0):
        tile = self.floes[index]
        return not tile.gone and (not tile.breaks or tile.breaks > self.time + future)

    def bot_route(self, p, x, z, jump):
        px, pz, vx, vz = p.x, p.z, p.vx, p.vz
        supported_at = 12 if jump else 1
        for step in range(1, 15 if jump else 11):
            traction = (.125 if jump and step < 12 else .22)
            vx += (x * 4.65 - vx) * traction
            vz += (z * 4.65 - vz) * traction
            px += vx * DT
            pz += vz * DT
            if step >= supported_at and not self.safe(px, pz, step * DT + .05):
                return None
        index = tile_at(px, pz)
        if index is None:
            return None
        tile = self.floes[index]
        exits = sum(self.safe(px + a * TILE, pz + b * TILE, .9)
                    for a, b in [(1, 0), (-1, 0), (0, 1), (0, -1)])
        quality = .30 * exits - .75 * tile.wear - (.68 if jump else 0)
        quality -= 1.9 if tile.storm else 0
        quality -= .043 * math.hypot(px, pz)
        quality += .25 * (p.intent[0] * x + p.intent[1] * z)
        quality -= .32 if tile_at(p.x, p.z) == index else 0
        quality += self.random.uniform(0, .38)
        return quality

    def bot_input(self, p):
        if not p.grounded or self.time < p.decide_at:
            return
        p.decide_at = self.time + self.random.uniform(.19, .30)
        best = (-math.inf, (0, 0), False)
        for jump in (False, True):
            if jump and (p.jump > self.time or best[0] > .55):
                break
            for i in range(12):
                angle = i * math.tau / 12
                x, z = math.cos(angle), math.sin(angle)
                quality = self.bot_route(p, x, z, jump)
                if quality is not None and quality > best[0]:
                    best = quality, (x, z), jump
        p.intent = best[1]
        if best[2]:
            p.actions.add("jump")
        if p.push <= self.time and self.random.random() < .26:
            if any(q is not p and q.alive and math.hypot(q.x - p.x, q.z - p.z) < 1.9
                   for q in self.actors.values()):
                p.actions.add("fire")

    def do_actions(self, p):
        x, z = p.intent
        if math.hypot(x, z) > .15:
            p.ax, p.az = unit(x * 100, z * 100)
        if "jump" in p.actions and p.grounded and self.time >= p.jump:
            p.grounded = False
            p.vy = 5.7
            p.y = .015
            p.jump = self.time + .70
            self.emit("jump", actor=p.id, x=p.x, z=p.z)
        if "dash" in p.actions and p.grounded and self.time >= p.dash:
            p.dash_until = self.time + .23
            p.dash = self.time + 3.4
            p.vx, p.vz = p.ax * 9, p.az * 9
            self.emit("dash", actor=p.id, x=p.x, z=p.z)
        if "fire" in p.actions and p.grounded and self.time >= p.push:
            p.push = self.time + 5.3
            self.emit("pulse", actor=p.id, x=p.x, z=p.z)
            for q in self.actors.values():
                dx, dz = q.x - p.x, q.z - p.z
                distance = math.hypot(dx, dz)
                if q is p or not q.alive or not 0 < distance < 2.4 or q.y > .75:
                    continue
                force = (10.5 - distance * 1.55) * (.25 if q.grip > self.time else 1)
                q.vx += dx * force / distance
                q.vz += dz * force / distance
                p.shoves += 1
        p.actions.clear()

    def wear(self, p, index):
        tile = self.floes[index]
        if tile.frozen > self.time or tile.breaks:
            return
        before = tile.wear
        tile.wear += DT * (1.25 if p.dash_until > self.time else 1)
        if before < .26 <= tile.wear:
            self.emit("fissure", tile=index)
        if tile.wear >= .73:
            tile.breaks = self.time + max(.52, 1.10 - .12 * self.storm)
            p.tiles += 1
            self.emit("crack", tile=index)

    def move(self, p):
        x, z = p.intent
        speed = 4.65 if p.bot else 5.35
        traction = 12 if p.grip > self.time else 4.4 if p.grounded else 2.5
        if p.dash_until <= self.time:
            p.vx += (x * speed - p.vx) * traction * DT
            p.vz += (z * speed - p.vz) * traction * DT
        magnitude = math.hypot(p.vx, p.vz)
        if magnitude > 13:
            p.vx *= 13 / magnitude
            p.vz *= 13 / magnitude
        p.x += p.vx * DT
        p.z += p.vz * DT
        index = tile_at(p.x, p.z)
        support = index is not None and self.supports(index)
        was_grounded = p.grounded
        if not p.grounded:
            p.vy -= 19.2 * DT
            p.y += p.vy * DT
            if p.y <= 0 and p.vy < 0 and support and p.y >= -.3:
                p.y = p.vy = 0
                p.grounded = True
                self.emit("land", actor=p.id, x=p.x, z=p.z)
            elif p.y < -.31:
                self.eliminate(p)
        elif not support:
            p.grounded = False
            p.vy = -1.8
        if p.alive and p.grounded and support:
            self.wear(p, index)
            self.collect(p)
        elif was_grounded and not support:
            self.emit("slip", actor=p.id, x=p.x, z=p.z)

    def collect(self, p):
        for item in self.items[:]:
            x, z = coords(item["tile"])
            if math.hypot(p.x - x, p.z - z) > .70:
                continue
            self.items.remove(item)
            kind = item["kind"]
            p.items += 1
            if kind == "anchor":
                p.grip = self.time + 6
            elif kind == "charge":
                p.dash = p.push = self.time
            else:
                restored = set()
                for distance in (0, TILE, 2 * TILE):
                    index = tile_at(x + p.ax * distance, z + p.az * distance)
                    if index is None or self.floes[index].storm or index in restored:
                        continue
                    self.floes[index] = Floe(frozen=self.time + 4)
                    restored.add(index)
                    self.emit("freeze", tile=index)
            self.emit("pickup", actor=p.id, item=kind, x=x, z=z)

    def weather(self):
        if self.storm < len(STORMS) and self.time >= STORMS[self.storm]:
            ring = self.storm
            self.storm += 1
            for index, tile in enumerate(self.floes):
                col, row = index % SIZE, index // SIZE
                if min(col, row, SIZE - 1 - col, SIZE - 1 - row) == ring:
                    tile.storm = True
                    if not tile.gone:
                        tile.breaks = min(tile.breaks or math.inf, self.time + 2.5)
            self.emit("storm", level=self.storm)
        # Collapse events are per tile so spectators see the same ice and effects.
        for i, tile in enumerate(self.floes):
            if tile.breaks and tile.breaks <= self.time and not tile.gone:
                tile.gone = True
                self.emit("break", tile=i)
        self.items[:] = [item for item in self.items if self.supports(item["tile"]) and item["until"] > self.time]
        if self.time >= self.next_item:
            self.next_item = self.time + 5.5
            spots = [i for i, tile in enumerate(self.floes)
                     if not tile.gone and not tile.storm and not tile.breaks
                     and all(item["tile"] != i for item in self.items)
                     and all(not p.alive or math.dist((p.x, p.z), coords(i)) > 1.3 for p in self.actors.values())]
            if spots:
                index = self.random.choice(spots)
                kind = ITEMS[(int(self.time / 5) - 1) % len(ITEMS)]
                self.items.append(dict(tile=index, kind=kind, until=self.time + 10))
                self.emit("drop", tile=index, item=kind)

    def advance(self):
        if self.phase == "finished":
            return
        self.tick += 1
        # Derive time from the integer tick, not repeated floating-point addition.
        self.time = self.tick * DT - 3
        if self.time < 0:
            return
        if self.phase == "countdown":
            self.phase = "playing"
            self.emit("start")
        self.weather()
        for p in self.actors.values():
            if not p.alive:
                continue
            if p.bot:
                self.bot_input(p)
            elif self.time - p.last_input > INPUT_TTL:
                p.intent = (0, 0)
                p.actions.clear()
            self.do_actions(p)
        for p in self.actors.values():
            if p.alive:
                self.move(p)
        alive = [p for p in self.actors.values() if p.alive]
        if len(alive) == 1:
            self.finish(alive[0].id, "Последний на льду")
        elif not alive:
            self.finish(None, "Все ушли под лёд")
        elif self.time >= DURATION:
            if all(p.tiles == alive[0].tiles for p in alive):
                self.finish(None, "Время вышло · ничья")
            else:
                ranked = sorted(alive, key=lambda p: p.tiles, reverse=True)
                self.finish(ranked[0].id if ranked[0].tiles > ranked[1].tiles else None,
                            "Время вышло · решают расколотые льдины")

    def data(self):
        actors = []
        for p in self.actors.values():
            actors.append(dict(id=p.id, name=p.name, bot=p.bot, connected=p.connected,
                               x=round(p.x, 3), y=round(p.y, 3), z=round(p.z, 3),
                               vx=round(p.vx, 2), vz=round(p.vz, 2),
                               ax=round(p.ax, 3), az=round(p.az, 3),
                               alive=p.alive, out=p.eliminated, tiles=p.tiles, shoves=p.shoves,
                               items=p.items, grip=round(max(0, p.grip - self.time), 2),
                               jump=round(max(0, p.jump - self.time), 2),
                               dash=round(max(0, p.dash - self.time), 2),
                               push=round(max(0, p.push - self.time), 2)))
        tiles = "".join("0" if t.gone else "4" if t.storm else "3" if t.breaks else
                        "5" if t.frozen > self.time and t.frozen else "2" if t.wear >= .26 else "1"
                        for t in self.floes)
        return dict(seed=self.seed, tick=self.tick, time=round(self.time, 2), phase=self.phase,
                    countdown=round(max(0, -self.time), 2), storm=self.storm,
                    remaining=round(max(0, DURATION - max(0, self.time)), 2),
                    winner=self.winner, reason=self.reason, tiles=tiles,
                    pickups=[dict(tile=item["tile"], kind=item["kind"]) for item in self.items],
                    actors=actors, events=self.events[:])
