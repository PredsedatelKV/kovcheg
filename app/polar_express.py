"""Authoritative simulation of a cooperative winter railway journey."""
from dataclasses import dataclass
import math
import random

DT = .05
WALK_SPEED = 3.65
SPAWNS = [(0, -3.7), (0, 2.0), (0, 8.5), (0, 12.8)]
STATIONS = ("Еловая застава", "Снежное депо", "Северный терминал")
TRAVEL_ZONES = (
    (-1.48, 1.48, -9.45, -1.15),
    (-.70, .70, -1.18, -.02),
    (-1.48, 1.48, -.04, 7.39),
    (-.70, .70, 7.36, 8.54),
    (-1.48, 1.48, 8.50, 15.45),
)
STOP_ZONES = ((1.34, 3.25, 2.17, 3.93), (3.13, 12.25, -9.55, 14.4))
OBSTACLES = (
    (-1.48, -.73, -8.9, -6.84), (.73, 1.48, -8.9, -6.70),
    (-1.48, -.76, .49, 1.97), (-1.48, -.76, 4.48, 6.83),
    (.73, 1.48, 4.52, 6.83), (-1.48, -.76, 9.03, 11.65),
    (.75, 1.48, 9.10, 11.70), (-1.48, -.76, 12.77, 14.77),
    (.75, 1.48, 12.77, 14.77),
)
# Coordinates are in the train frame. Station-only objects are on its platform.
WORK = {
    "furnace": (-1.03, -7.36, "Топка", .58),
    "repair": (1.03, -7.41, "Редуктор", .78),
    "plow": (-.94, -5.48, "Снегоочиститель", .92),
    "bridge": (-.75, -3.66, "Стрелка · мост", .35),
    "valley": (.75, -3.66, "Стрелка · долина", .35),
    "seal": (-1.02, 1.27, "Упаковочный стол", .69),
    "store": (-1.02, 5.56, "Кладовая", .45),
    "cargo": (1.02, 5.73, "Грузовой лоток", .57),
    "dispatch": (-.74, 3.18, "Отправление", .58),
    "coal": (-1.02, 10.25, "Ящик угля", .31),
    "parts": (1.02, 10.25, "Ящик деталей", .31),
    "parcel": (-1.02, 13.81, "Подарок", .31),
    "lamp": (1.02, 13.81, "Сигнальный фонарь", .36),
    "station_coal": (6.1, -2.6, "Уголь на платформе", .35),
    "station_parts": (8.1, 6.13, "Детали на платформе", .35),
    "station_parcel": (9.2, 10.36, "Подарки на платформе", .35),
    "station_signal": (9.05, -6.03, "Почтовая стойка", .55),
}
ITEM_LABELS = {"coal": "уголь", "parts": "деталь", "parcel": "подарок", "sealed": "упакованный подарок"}
ORDERS = ((40,"frost"),(109,"snow"),(199,"bearing"),(246,"snow"),(330,"frost"),
          (490,"bearing"),(610,"snow"),(762,"frost"),(958,"bearing"),(1120,"snow"),(1270,"frost"))


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
    target: str = ""
    progress: float = 0
    cooldown: float = 0
    next_plan: float = 0
    goal: str = ""
    jobs: int = 0
    deliveries: int = 0


class Journey:
    def __init__(self, players, seed):
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
        self.heat = 74.0
        self.hull = 100.0
        self.snow = 0.0
        self.stock = {"coal":4, "parts":3, "parcel":2}
        self.station_stock = {}
        self.loaded = 2
        self.delivered = 0
        self.route = ""
        self.signal_count = 0
        self.stop_at = 0.0
        self.depart_at = 0.0
        self.lamp = False
        self.wait_for_repair = 0.0
        self.order = 0
        self.orders = [(distance+self.rng.uniform(-7,7),kind) for distance,kind in ORDERS]
        self.fault = False
        self.winner = None
        self.reason = ""
        for p, (x,z) in zip(players, SPAWNS):
            p.x, p.z = x,z

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
        p.use = packet.get("fire") is True
        p.stamp = self.time

    def end_of_leg(self):
        return (350, 438 if self.route=="bridge" else 530, 582)[self.leg]

    def signal_open(self):
        return self.leg == 0 and self.leg_distance >= 160 and self.leg_distance < 310 and self.travel

    def select_work(self, p):
        best = None
        best_score = -math.inf
        for key, (x,z,_,_) in WORK.items():
            if key.startswith("station_") and self.travel:
                continue
            dx,dz = x-p.x,z-p.z
            distance = math.hypot(dx,dz)
            if distance > 1.83:
                continue
            dot = (dx*p.ax+dz*p.az)/max(.001,distance)
            if distance > .33 and dot < .52:
                continue
            score = dot*.64-distance*.43
            if score > best_score:
                best, best_score = key, score
        return best

    def available(self, p, target):
        if target in self.stock:
            return not p.hand and self.stock[target] > 0
        if target in self.station_stock:
            return not p.hand and self.station_stock[target] > 0
        if target == "furnace":
            return p.hand == "coal" and self.heat < 91
        if target == "repair":
            return p.hand == "parts" and (self.hull < 94 or self.fault)
        if target == "plow":
            return self.travel and self.snow > 13
        if target in ("bridge","valley"):
            return self.signal_open() and self.route != target
        if target == "seal":
            return p.hand == "parcel"
        if target == "cargo":
            return p.hand == "sealed" and self.loaded < 9
        if target == "store":
            return p.hand in self.stock or p.hand == "sealed"
        if target == "lamp":
            return not self.lamp and (self.leg==2 or self.snow>35)
        if target == "station_signal":
            return not self.travel and self.signal_count <= self.leg
        if target == "dispatch":
            return not self.travel and self.time >= self.stop_at+11 and not any(
                on_platform(a.x) for a in self.actors.values() if not a.bot and a.connected)
        return False

    def completed_work(self, p, target):
        if target in self.stock or target in self.station_stock:
            source = self.stock if target in self.stock else self.station_stock
            source[target] -= 1
            p.hand = target.removeprefix("station_")
        elif target == "furnace":
            self.heat = min(100,self.heat+31);p.hand = ""
        elif target == "repair":
            self.hull = min(100,self.hull+36);p.hand = "";self.fault = False
        elif target == "plow":
            self.snow = max(0,self.snow-49)
        elif target in ("bridge","valley"):
            self.route = target
        elif target == "seal":
            p.hand = "sealed"
        elif target == "cargo":
            self.loaded += 1;p.deliveries += 1;p.hand = ""
        elif target == "store":
            kind = "parcel" if p.hand == "sealed" else p.hand
            self.stock[kind] += 1;p.hand = ""
        elif target == "lamp":
            self.lamp = True
        elif target == "station_signal":
            self.signal_count = self.leg+1
            self.delivered += 1
        elif target == "dispatch":
            self.depart_at = min(self.depart_at,self.time+3.2)
        p.jobs += 1
        self.emit("work",actor=p.id,target=target,x=p.x,z=p.z)

    def act(self, p):
        target = self.select_work(p) if p.use and self.time >= p.cooldown else None
        if not target or not self.available(p,target):
            p.target,p.progress = "",0
            return
        if target != p.target:
            p.target,p.progress = target,0
        p.progress += DT * (.53 if p.bot else 1)
        if p.progress >= WORK[target][3]:
            self.completed_work(p,target)
            p.cooldown = self.time + (.75 if p.bot else .29)
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
        if p.hand == "parcel":
            return "seal"
        if p.hand == "sealed":
            return "cargo" if self.loaded < 9 else ""
        if self.snow > 52 and not self.reserved(p,"plow"):
            return "plow"
        if (self.hull < 62 or self.fault) and self.stock["parts"] and not self.reserved(p,"parts"):
            return "parts"
        if self.heat < 58 and self.stock["coal"] and not self.reserved(p,"coal"):
            return "coal"
        if not self.travel:
            if on_platform(p.x) and self.depart_at-self.time<7:
                return "store"
            if self.stock["coal"] < 4 and self.station_stock.get("station_coal") and not self.reserved(p,"station_coal"):
                return "station_coal"
            if self.stock["parts"] < 2 and self.station_stock.get("station_parts") and not self.reserved(p,"station_parts"):
                return "station_parts"
        if self.stock["parcel"] and self.loaded < 7 and not self.reserved(p,"parcel"):
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
        p.use=False
        if not p.goal:
            p.intent=(0,0)
            return
        tx,tz,_,_ = WORK[p.goal]
        station_target=on_platform(tx)
        outside=on_platform(p.x)
        if outside and not station_target:
            wx,wz=(p.x,3.12) if abs(p.z-3.12)>.28 else (.10,3.12)
        elif not outside and station_target:
            wx,wz=(.05,3.12) if abs(p.z-3.12)>.28 else (3.55,3.12)
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

    def arrive(self):
        self.delivered += self.loaded
        self.loaded = 0
        if self.leg == 2:
            self.travel = False
            self.speed = 0
            self.stop_at = self.depart_at = self.time
            self.finish(True,"Поезд прибыл на Северный терминал")
            return
        self.travel = False
        self.stop_at = self.time
        self.depart_at = self.time + (33 if self.leg==0 else 37)
        self.speed = 0
        self.station_stock = {"station_coal":5,"station_parts":4,"station_parcel":4}
        self.emit("arrive",station=self.leg)

    def depart(self):
        for i,p in enumerate(self.actors.values()):
            if on_platform(p.x):
                p.x,p.z = SPAWNS[(i+1)%len(SPAWNS)]
                p.vx=p.vz=0
                p.target,p.progress="",0
                p.goal=""
                if not p.bot:
                    lost = bool(p.hand)
                    p.hand = ""
                    self.emit("recall",actor=p.id,lost=lost)
        self.leg += 1
        self.travel = True
        self.leg_distance = 0
        self.station_stock.clear()
        if not self.route:
            self.route = "valley"
        self.emit("depart",leg=self.leg)

    def update_train(self):
        if not self.travel:
            if self.time >= self.depart_at:
                self.depart()
            return
        travel_heat=.225 if self.leg==0 else .30 if self.route=="valley" else .27
        if self.leg==2:travel_heat+=.07
        if self.lamp:travel_heat-=.025
        self.heat=max(0,self.heat-DT*travel_heat)
        snow_rate=.22 if self.leg==0 else .36 if self.route=="bridge" else .21
        self.snow=min(100,self.snow+snow_rate*DT)
        if self.order < len(self.orders) and self.track >= self.orders[self.order][0]:
            _, kind=self.orders[self.order];self.order+=1
            if kind=="bearing":
                self.hull=max(0,self.hull-(20 if self.route=="bridge" else 11))
                if self.route=="bridge":self.fault=True
            elif kind=="frost":
                self.heat=max(0,self.heat-7)
            else:
                self.snow=min(100,self.snow+25)
            self.emit("hazard",hazard=kind)
        # There is always a recovery window and gradual slowdown, even in solo play.
        if self.heat<=0 or self.hull<=14:
            self.wait_for_repair+=DT
            if self.wait_for_repair>=21:
                self.finish(False,"Поезд остановился в метели")
                return
        else:self.wait_for_repair=0
        if self.route=="bridge" and self.leg==1 and self.leg_distance>95 and self.leg_distance<310:
            self.hull=max(0,self.hull-DT*.24)
        if self.snow>73:self.hull=max(0,self.hull-DT*.23)
        heat_factor=max(.20,min(1,self.heat/42))
        snow_factor=1-self.snow*.0048
        hull_factor=max(.28,min(1,self.hull/57))*(.76 if self.fault else 1)
        cruise=(6.2 if self.leg==1 and self.route=="bridge" else 5.85)*heat_factor*snow_factor*hull_factor
        brake=min(1,max(.2,(self.end_of_leg()-self.leg_distance)/14))
        self.speed+=(cruise*brake-self.speed)*.075
        distance=self.speed*DT
        self.track+=distance
        self.leg_distance+=distance
        if not self.route and self.leg==0 and self.leg_distance>=310:
            self.route="valley";self.emit("route",route=self.route)
        if self.leg_distance>=self.end_of_leg():
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
        if self.time>=480:
            self.finish(False,"Время рейса вышло")
            return
        for p in self.actors.values():
            if p.bot:
                self.bot_input(p)
            elif self.time-p.stamp>.33:
                p.intent,p.use=(0,0),False
            self.move(p)
            self.act(p)
        self.update_train()

    def data(self):
        actors=[dict(id=p.id,name=p.name,x=round(p.x,3),z=round(p.z,3),vx=round(p.vx,2),vz=round(p.vz,2),
                     ax=round(p.ax,3),az=round(p.az,3),pitch=round(p.pitch,2),hand=p.hand,bot=p.bot,
                     connected=p.connected,target=p.target,progress=round(p.progress,2),jobs=p.jobs,
                     deliveries=p.deliveries) for p in self.actors.values()]
        return dict(tick=self.tick,seed=self.seed,time=self.time,phase=self.phase,countdown=max(0,-self.time),
                    travel=self.travel,track=round(self.track,3),distance=round(self.leg_distance,2),leg=self.leg,
                    length=self.end_of_leg(),speed=round(self.speed,3),heat=round(self.heat,1),hull=round(self.hull,1),
                    snow=round(self.snow,1),route=self.route,signals=self.signal_count,signal_open=self.signal_open(),
                    stop_elapsed=round(max(0,self.time-self.stop_at),2) if not self.travel else 0,
                    stop_timer=round(max(0,self.depart_at-self.time),2) if not self.travel else 0,
                    stock=self.stock.copy(),station_stock=self.station_stock.copy(),lamp=self.lamp,fault=self.fault,
                    loaded=self.loaded,delivered=self.delivered,critical=round(self.wait_for_repair,2),
                    winner=self.winner,reason=self.reason,actors=actors,events=self.events[:])


def map_data():
    return dict(train=TRAVEL_ZONES,platform=STOP_ZONES,obstacles=OBSTACLES,work=WORK,stations=STATIONS)
