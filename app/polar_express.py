"""Authoritative simulation of a cooperative winter railway journey."""
from dataclasses import dataclass
import math
import random

DT = .05
WALK_SPEED = 3.65
SPAWNS = [(0, 2.40), (0, -4.1), (0, 9.1), (0, 5.65)]
STATION_ORDERS = (2, 3, 4)
BOARDING_Z = 3.06
STOCK_LIMIT = 14
CARGO_LIMIT = 9
STOP_SECONDS = 29
RECOVERY_SECONDS = 24
INPUT_TTL = .35
REACH = 1.72
LOADED_ITEMS = {"sealed", "priority_sealed"}
UNWRAPPED_ITEMS = {"parcel", "priority"}
STATIONS = ("Еловая застава", "Снежное депо", "Северный терминал")
TRAVEL_ZONES = (
    (-1.48, 1.48, -9.45, -1.15),
    (-.66, .66, -1.22, .03),
    (-1.48, 1.48, -.04, 7.39),
    (-.66, .66, 7.32, 8.57),
    (-1.48, 1.48, 8.50, 15.45),
)
STOP_ZONES = ((1.34, 3.25, 2.17, 3.93), (3.13, 12.25, -9.55, 14.4))
OBSTACLES = (
    (-1.48, -.73, -8.9, -6.84), (.73, 1.48, -8.9, -6.70),
    (-1.48, -.76, .49, 1.97), (-1.48, -.76, 4.48, 6.83),
    (.73, 1.48, 4.52, 6.83), (-1.48, -.79, 9.03, 11.65),
    (.75, 1.48, 9.10, 11.70), (-1.48, -.76, 2.01, 2.71), (-1.48, -.76, 12.77, 15.31),
    (.75, 1.48, 12.77, 15.31),
    (5.98, 6.77, -2.94, -2.27), (8.05, 8.80, 5.78, 6.49),
    (9.04, 9.76, 9.99, 10.74), (8.95, 9.77, -6.44, -5.69),
)
# Coordinates are in the train frame. Station-only objects are on its platform.
WORK = {
    "furnace": (-1.03, -7.36, "Топка", .55),
    "repair": (1.03, -7.41, "Редуктор", .60),
    "plow": (-.94, -5.48, "Плуг", .48),
    "bridge": (-.75, -3.66, "Мост", .30),
    "valley": (.75, -3.66, "Долина", .30),
    "seal": (-1.02, 1.27, "Упаковочный стол", .46),
    "store": (-1.02, 5.56, "Кладовая", .23),
    "cargo": (1.02, 5.73, "Погрузка", .26),
    "dispatch": (-.74, 3.18, "Отправление", .36),
    "coal": (-1.02, 10.25, "Ящик угля", .31),
    "parts": (1.02, 10.25, "Ящик деталей", .31),
    "parcel": (-1.02, 2.35, "Подарки", .20),
    "lamp": (1.02, 13.81, "Сигнальный фонарь", .36),
    "station_coal": (6.1, -2.6, "Уголь на платформе", .35),
    "station_parts": (8.1, 6.13, "Детали на платформе", .35),
    "station_parcel": (9.2, 10.36, "Подарки на платформе", .35),
    "station_signal": (9.05, -6.03, "Срочная посылка", .28),
}
HAZARDS = {
    0: ((77, "snow"),),
    1: ((67, "bearing"), (145, "snow")),
    2: ((67, "frost"), (150, "snow"), (218, "bearing")),
}


def inside(x, z, rect):
    x0, x1, z0, z1 = rect
    return x0 <= x <= x1 and z0 <= z <= z1


def can_walk(x, z, station):
    return (any(inside(x, z, rect) for rect in TRAVEL_ZONES) or
            station and any(inside(x, z, rect) for rect in STOP_ZONES)) and not any(
                inside(x, z, rect) for rect in OBSTACLES)


def on_platform(x):
    return x > 1.48


def limit_vector(x, z):
    length = max(1, math.hypot(x, z))
    return x / length, z / length


@dataclass
class Passenger:
    id: str
    name: str
    bot: bool = False
    connected: bool = True
    x: float = 0
    z: float = 2
    vx: float = 0
    vz: float = 0
    ax: float = 0
    az: float = -1
    pitch: float = 0
    hand: str = ""
    intent: tuple = (0, 0)
    use: bool = False
    stamp: float = -10
    requested: str = ""
    warp: int = 0
    target: str = ""
    progress: float = 0
    cooldown: float = 0
    next_plan: float = 0
    goal: str = ""
    jobs: int = 0
    deliveries: int = 0


class Journey:
    def __init__(self, players, seed, crew_size=None):
        self.actors = {p.id:p for p in players}
        self.seed = seed
        self.rng = random.Random(seed)
        self.phase = "countdown"
        self.tick = 0
        self.time = -3.0
        self.events = []
        self.event_id = 0
        self.travel = True
        self.track = 0
        self.leg = 0
        self.leg_distance = 0.0
        self.speed = 0.0
        self.heat = 80.0
        self.hull = 100.0
        self.snow = 0.0
        self.stock = {"coal": 4, "parts": 3, "parcel": 5}
        self.staged = {"sealed": 0, "priority_sealed": 0, "priority": 0}
        crew_size = crew_size if crew_size is not None else sum(not p.bot for p in players)
        self.orders = tuple(n + (crew_size >= 3) for n in STATION_ORDERS)
        self.unloaded = [0, 0, 0]
        self.priority_loaded = 0
        self.priority_delivered = 0
        self.reached = False
        self.station_stock = {}
        self.loaded = 0
        self.delivered = 0
        self.route = ""
        self.signal_count = 0
        self.depart_requested = False
        self.stop_at = 0.0
        self.depart_at = 0.0
        self.lamp = False
        self.wait_for_repair = 0.0
        self.order = 0
        self.hazard = ""
        self.hazard_until = 0
        self.fault = False
        self.winner = None
        self.reason = ""
        for p, (x,z) in zip(players, SPAWNS):
            p.x, p.z = x,z
        if players:
            players[0].ax, players[0].az, players[0].pitch = -1, 0, -.21

    def emit(self, kind, **details):
        self.event_id += 1
        self.events.append(dict(id=self.event_id,tick=self.tick,kind=kind,**details))
        self.events = self.events[-28:]

    def finish(self, winner, reason):
        if self.phase != "finished":
            self.phase, self.winner, self.reason = "finished", winner, reason
            self.emit("finish", success=winner is True)

    def connection(self, p, connected, fill):
        p.connected = connected
        p.bot = not connected and fill
        p.intent = (0,0)
        p.use = False
        p.requested = ""
        p.goal = ""
        p.vx = p.vz = 0
        p.target = ""
        p.progress = 0.0

    def set_input(self, actor_id, packet):
        p = self.actors.get(actor_id)
        if not p or p.bot or not p.connected:
            return
        p.intent = limit_vector(max(-1,min(1,packet.get("mx",0))),max(-1,min(1,packet.get("mz",0))))
        x = max(-1,min(1,packet.get("ax",0)))
        z = max(-1,min(1,packet.get("az",-1)))
        length = math.hypot(x,z)
        if length > .15:
            p.ax,p.az = x/length,z/length
        p.pitch = max(-1.37,min(1.28, packet.get("pitch",0)))
        requested = packet.get("work", "")
        p.requested = requested if isinstance(requested, str) and requested in WORK else ""
        p.use = packet.get("fire") is True and (requested == "" or bool(p.requested))
        p.stamp = self.time

    def end_of_leg(self):
        return (175, 182 if self.route == "bridge" else 235, 258)[self.leg]

    def signal_open(self):
        return self.leg == 0 and self.leg_distance >= 42

    def work_score(self, p, target):
        x, z, _, _ = WORK[target]
        if target.startswith("station_") and (self.travel or not on_platform(p.x)):
            return None
        if not target.startswith("station_") and on_platform(p.x):
            return None
        dx, dz = x-p.x, z-p.z
        distance = math.hypot(dx, dz)
        if distance > REACH:
            return None
        dot = (dx*p.ax+dz*p.az)/max(.001, distance)
        if distance > .34 and dot < .45:
            return None
        return dot*.68-distance*.49

    def select_work(self, p):
        if p.requested:
            return p.requested if self.work_score(p, p.requested) is not None else None
        best, best_score = None, -math.inf
        for target in WORK:
            score = self.work_score(p, target)
            if score is not None and self.available(p, target) and score > best_score:
                best, best_score = target, score
        return best

    def boarding(self):
        return not any(on_platform(p.x) for p in self.actors.values() if p.connected and not p.bot)

    def available(self, p, target):
        if target in self.stock:
            return not p.hand and self.stock[target] > 0
        if target in self.station_stock:
            return not self.travel and not p.hand and self.station_stock[target] > 0
        if target == "furnace":
            return p.hand == "coal" and self.heat < 91
        if target == "repair":
            return p.hand == "parts" and (self.hull < 94 or self.fault)
        if target == "plow":
            return self.snow > 15
        if target in ("bridge", "valley"):
            return self.signal_open() and self.route != target
        if target == "seal":
            return p.hand in UNWRAPPED_ITEMS
        if target == "cargo":
            return p.hand in LOADED_ITEMS and self.loaded < CARGO_LIMIT
        if target == "store":
            return (self.staged.get(p.hand, self.stock.get(p.hand, STOCK_LIMIT)) < STOCK_LIMIT
                    if p.hand else any(self.staged.values()))
        if target == "lamp":
            return not self.lamp
        if target == "station_signal":
            return not p.hand and not self.travel and self.signal_count <= self.leg
        if target == "dispatch":
            return (not self.travel and not self.depart_requested and self.time >= self.stop_at+8
                    and self.boarding())
        return False

    def return_item(self, hand):
        source = self.staged if hand in self.staged else self.stock
        if hand in source:
            source[hand] = min(STOCK_LIMIT, source[hand]+1)

    def completed_work(self, p, target):
        if target in self.stock or target in self.station_stock:
            source = self.stock if target in self.stock else self.station_stock
            source[target] -= 1
            p.hand = target.removeprefix("station_")
        elif target == "furnace":
            self.heat = min(100,self.heat+38);p.hand = ""
        elif target == "repair":
            self.hull = min(100,self.hull+43);p.hand = "";self.fault = False
        elif target == "plow":
            self.snow = max(0,self.snow-67)
        elif target in ("bridge", "valley"):
            self.route = target
            self.emit("route",route=target)
        elif target == "seal":
            p.hand = "priority_sealed" if p.hand == "priority" else "sealed"
        elif target == "cargo":
            self.loaded += 1
            self.priority_loaded += p.hand == "priority_sealed"
            p.deliveries += 1
            p.hand = ""
        elif target == "store":
            if p.hand:
                self.return_item(p.hand)
                p.hand = ""
            else:
                p.hand = next(kind for kind, count in self.staged.items() if count)
                self.staged[p.hand] -= 1
        elif target == "lamp":
            self.lamp = True
        elif target == "station_signal":
            self.signal_count = self.leg+1
            p.hand = "priority"
        elif target == "dispatch":
            self.depart_requested = True
            self.depart_at = min(self.depart_at,self.time+4)
        p.jobs += 1
        self.emit("work",actor=p.id,target=target,x=p.x,z=p.z)

    def act(self, p):
        target = self.select_work(p) if p.use and self.time >= p.cooldown else None
        if not target or not self.available(p,target):
            p.target,p.progress = "",0
            return
        if target != p.target:
            p.target,p.progress = target,0
        p.progress += DT * (.75 if p.bot else 1)
        if p.progress + 1e-6 >= WORK[target][3]:
            self.completed_work(p,target)
            p.cooldown = self.time + (.52 if p.bot else .18)
            p.target,p.progress = "",0

    def move(self, p):
        mx,mz = p.intent
        p.vx += (mx*WALK_SPEED-p.vx)*.67
        p.vz += (mz*WALK_SPEED-p.vz)*.67
        x,z = p.x+p.vx*DT,p.z+p.vz*DT
        if can_walk(x,p.z,not self.travel):p.x=x
        else:p.vx=0
        if can_walk(p.x,z,not self.travel):p.z=z
        else:p.vz=0

    def bot_job(self, p):
        if p.hand == "coal":
            return "furnace" if self.heat < 78 else "store"
        if p.hand == "parts":
            return "repair" if self.hull < 84 or self.fault else "store"
        if p.hand in UNWRAPPED_ITEMS:
            return "seal"
        if p.hand in LOADED_ITEMS:
            return "cargo" if self.loaded < CARGO_LIMIT else "store"
        if self.snow > 60 and not self.reserved(p,"plow"):
            return "plow"
        if (self.hull < 62 or self.fault) and self.stock["parts"] and not self.reserved(p,"parts"):
            return "parts"
        if self.heat < 42 and self.stock["coal"] and not self.reserved(p,"coal"):
            return "coal"
        if not self.travel:
            if on_platform(p.x) and self.depart_at-self.time<8:
                return "store"
            if self.depart_at-self.time>13 and self.stock["coal"] < 3 and self.station_stock.get("station_coal") and not self.reserved(p,"station_coal"):
                return "station_coal"
            if self.depart_at-self.time>13 and self.stock["parts"] < 2 and self.station_stock.get("station_parts") and not self.reserved(p,"station_parts"):
                return "station_parts"
        if self.travel and self.loaded < self.orders[self.leg]:
            if any(self.staged.values()) and not self.reserved(p,"store"):
                return "store"
            if self.stock["parcel"] and not self.reserved(p,"parcel"):
                return "parcel"
        if (self.leg==2 or self.snow>43) and not self.lamp and not self.reserved(p,"lamp"):
            return "lamp"
        return ""

    def reserved(self,p,goal):
        return any(q is not p and q.bot and q.goal==goal for q in self.actors.values())

    def bot_input(self,p):
        if self.time>=p.next_plan:
            p.next_plan=self.time+self.rng.uniform(.58,.91)
            p.goal=self.bot_job(p)
            p.requested=p.goal
        p.use=False
        if not p.goal:
            p.intent=(0,0)
            return
        tx,tz,_,_ = WORK[p.goal]
        station_target=on_platform(tx)
        outside=on_platform(p.x)
        if outside and not station_target:
            if p.x > 3.16 and abs(p.z-BOARDING_Z)>.24:
                wx,wz=max(p.x,3.49),BOARDING_Z
            else:
                wx,wz=.10,BOARDING_Z
        elif station_target and p.x < 3.36:
            wx,wz=(min(1.25, p.x),BOARDING_Z) if abs(p.z-BOARDING_Z)>.26 else (3.61,BOARDING_Z)
        elif station_target:
            dx,dz=tx-p.x,tz-p.z
            d=math.hypot(dx,dz)
            wx,wz=(p.x,p.z) if d<1.08 else (tx,tz)
        elif abs(p.x)>.23:
            wx,wz=0,p.z
        elif abs(p.z-tz)>.26:
            wx,wz=0,tz
        else:
            wx,wz=p.x,p.z
        dx,dz=wx-p.x,wz-p.z
        if math.hypot(dx,dz)>.19:
            p.intent=limit_vector(dx*1.8,dz*1.8)
            length=math.hypot(dx,dz)
            p.ax,p.az=dx/length,dz/length
        else:
            p.intent=(0,0)
            dx,dz=tx-p.x,tz-p.z
            length=max(.01,math.hypot(dx,dz))
            p.ax,p.az=dx/length,dz/length
            p.use=True

    def manifest(self):
        total = sum(self.orders)
        stars = int(self.reached) + int(self.reached and self.delivered >= total)
        stars += int(stars == 2 and all(a >= b for a, b in zip(self.unloaded, self.orders))
                     and self.priority_delivered > 0)
        return dict(orders=self.orders, unloaded=self.unloaded[:], total=total, stars=stars,
                    reached=self.reached, express=self.priority_delivered, aboard=self.priority_loaded,
                    stage=self.orders[self.leg], limit=CARGO_LIMIT)

    def arrive(self):
        self.unloaded[self.leg] = self.loaded
        self.delivered += self.loaded
        self.priority_delivered += self.priority_loaded
        self.loaded = self.priority_loaded = 0
        self.travel = False
        self.speed = 0
        self.hazard = ""
        self.wait_for_repair = 0
        if self.leg == 2:
            self.reached = True
            self.stop_at = self.depart_at = self.time
            fulfilled = self.delivered >= sum(self.orders)
            self.finish(fulfilled,"Заказы доставлены" if fulfilled else "Терминал достигнут, но части подарков не хватило")
            return
        self.stop_at = self.time
        self.depart_at = self.time + STOP_SECONDS
        self.depart_requested = False
        self.station_stock = {"station_coal":3,"station_parts":2,"station_parcel":3}
        self.emit("arrive",station=self.leg,unloaded=self.unloaded[self.leg],order=self.orders[self.leg])

    def depart(self):
        for i,p in enumerate(self.actors.values()):
            if on_platform(p.x):
                p.x,p.z = 1.04,BOARDING_Z+(i-1.5)*.22
                p.vx=p.vz=0
                p.intent,p.use=(0,0),False
                p.target,p.progress="",0
                p.goal=p.requested=""
                p.warp+=1
                lost=bool(p.hand)
                p.hand=""
                self.emit("recall",actor=p.id,lost=lost)
        self.leg += 1
        self.travel = True
        self.leg_distance = 0
        self.order = 0
        self.station_stock.clear()
        self.stock["parcel"] = max(self.stock["parcel"], self.orders[self.leg]+2)
        if not self.route:
            self.route = "valley"
        self.emit("depart",leg=self.leg)

    def apply_hazard(self, kind):
        self.hazard, self.hazard_until = kind, self.time+5
        if kind == "bearing":
            severe = self.leg == 1 and self.route == "bridge"
            self.hull = max(0,self.hull-(28 if severe else 15))
            self.fault = severe or self.hull < 63
        elif kind == "frost":
            self.heat = max(0,self.heat-(10 if self.lamp else 28))
        else:
            self.snow = min(100,self.snow+57)
        self.emit("hazard",hazard=kind)

    def update_train(self):
        if not self.travel:
            if self.time >= self.depart_at:
                # A manual bell can't send the train off while a player is on the platform.
                if self.depart_requested and not self.boarding() and self.time < self.stop_at+STOP_SECONDS:
                    self.depart_requested = False
                    self.depart_at = self.stop_at+STOP_SECONDS
                    return
                self.depart()
            return
        if self.hazard and self.time >= self.hazard_until:
            self.hazard = ""
        self.heat = max(0,self.heat-DT*(.22 if self.leg == 0 else .31))
        self.snow = min(100,self.snow+(.15 if self.leg < 2 else .25)*DT)
        schedule = HAZARDS[self.leg]
        if self.order < len(schedule) and self.leg_distance >= schedule[self.order][0]:
            _, kind = schedule[self.order]
            self.order += 1
            self.apply_hazard(kind)
        if self.heat <= 0 or self.hull <= 14:
            self.wait_for_repair += DT
            if self.wait_for_repair >= RECOVERY_SECONDS:
                self.finish(False,"Поезд остановился в метели")
                return
        else:
            self.wait_for_repair = 0
        if self.snow > 80:
            self.hull = max(0,self.hull-DT*.17)
        heat_factor = max(.25,min(1,self.heat/40))
        snow_factor = 1-self.snow*.004
        hull_factor = max(.30,min(1,self.hull/65))*(.79 if self.fault else 1)
        cruise = (8.8 if self.leg == 1 and self.route == "bridge" else 7.2)*heat_factor*snow_factor*hull_factor
        brake = min(1,max(.29,(self.end_of_leg()-self.leg_distance)/14))
        self.speed += (cruise*brake-self.speed)*.11
        distance = self.speed*DT
        self.track += distance
        self.leg_distance += distance
        if self.leg_distance >= self.end_of_leg():
            self.arrive()

    def advance(self):
        if self.phase=="finished":
            return
        self.tick+=1
        self.time=round(self.tick*DT-3,4)
        if self.time<0:
            return
        if self.phase=="countdown":
            self.phase="playing";self.emit("start")
        if self.time>=320:
            self.finish(False,"Время рейса вышло")
            return
        for p in self.actors.values():
            if p.bot:
                self.bot_input(p)
            elif self.time-p.stamp>INPUT_TTL:
                p.intent,p.use=(0,0),False
            self.move(p)
            self.act(p)
        self.update_train()

    def data(self):
        actors=[dict(id=p.id,name=p.name,x=round(p.x,3),z=round(p.z,3),vx=round(p.vx,2),vz=round(p.vz,2),
                     ax=round(p.ax,3),az=round(p.az,3),pitch=round(p.pitch,2),hand=p.hand,bot=p.bot,
                     connected=p.connected,target=p.target,progress=round(p.progress,2),jobs=p.jobs,
                     deliveries=p.deliveries,warp=p.warp,actions=[key for key in WORK if self.available(p,key)])
                for p in self.actors.values()]
        return dict(tick=self.tick,seed=self.seed,time=self.time,phase=self.phase,countdown=max(0,-self.time),
                    travel=self.travel,track=round(self.track,3),distance=round(self.leg_distance,2),leg=self.leg,
                    length=self.end_of_leg(),speed=round(self.speed,3),heat=round(self.heat,1),hull=round(self.hull,1),
                    snow=round(self.snow,1),route=self.route,signals=self.signal_count,signal_open=self.signal_open(),
                    stop_elapsed=round(max(0,self.time-self.stop_at),2) if not self.travel else 0,
                    stop_timer=round(max(0,self.depart_at-self.time),2) if not self.travel else 0,
                    stock=self.stock.copy(),station_stock=self.station_stock.copy(),lamp=self.lamp,fault=self.fault,
                    loaded=self.loaded,delivered=self.delivered,critical=round(self.wait_for_repair,2),
                    manifest=self.manifest(),staged=self.staged.copy(),hazard=self.hazard,
                    winner=self.winner,reason=self.reason,actors=actors,events=self.events[:])


def map_data():
    return dict(train=TRAVEL_ZONES,platform=STOP_ZONES,obstacles=OBSTACLES,work=WORK,stations=STATIONS,
                reach=REACH,step=DT,speed=WALK_SPEED,recovery=RECOVERY_SECONDS,version=2)
