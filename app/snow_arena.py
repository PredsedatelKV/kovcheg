"""Authoritative 20 Hz snow arena. No client positions, hits or scores are trusted."""
from __future__ import annotations
from dataclasses import dataclass, field
import heapq
import math
import random

DT = .05
LIMIT = 12.7
PLAYER_RADIUS = .34
MODES = {
    "duel": {"label": "Дуэль", "slots": 2, "seconds": 180, "goal": 7},
    "teams": {"label": "Командный бой", "slots": 4, "seconds": 240, "goal": 15},
    "waves": {"label": "Оборона", "slots": 4, "seconds": 600, "goal": 6},
}
# x, z, width, depth, height, material. The renderer uses exactly this geometry.
COVERS = [
    [-6.3,-6.0,2.8,1.15,1.8,"ice"], [6.3,6.0,2.8,1.15,1.8,"ice"],
    [-6.3,6.0,2.8,1.15,1.8,"ice"], [6.3,-6.0,2.8,1.15,1.8,"ice"],
    [-2.7,-2.8,1.2,3.0,1.0,"snow"], [2.7,2.8,1.2,3.0,1.0,"snow"],
    [2.8,-3.1,2.0,1.1,1.65,"wood"], [-2.8,3.1,2.0,1.1,1.65,"wood"],
    [-9,0,1.25,3.1,1.65,"wood"], [9,0,1.25,3.1,1.65,"wood"],
    [0,-8.2,3.0,1.05,.9,"snow"], [0,8.2,3.0,1.05,.9,"snow"],
]
PADS = [(0,0),(-7,3),(7,-3),(-4,-8),(4,8),(-8,-8),(8,8),(5,-7),(-5,7)]
SPAWNS = {0:[(-10,-9),(-10,-6),(-9,-10)],1:[(10,9),(10,6),(9,10)]}
WEAPONS = {
    "pistol": {"label":"Снежный пистолет","cooldown":.48,"damage":24,"speed":17,"ammo":-1,"pellets":1},
    "rapid": {"label":"Ледяной автомат","cooldown":.15,"damage":17,"speed":21,"ammo":36,"pellets":1},
    "spread": {"label":"Снежный дробовик","cooldown":.72,"damage":17,"speed":18,"ammo":9,"pellets":3},
    "cannon": {"label":"Морозная пушка","cooldown":.95,"damage":63,"speed":14,"ammo":7,"pellets":1},
    "snowman": {"label":"Снежок","cooldown":1.45,"damage":15,"speed":10,"ammo":-1,"pellets":1},
    "boss": {"label":"Ледяная глыба","cooldown":.85,"damage":23,"speed":12,"ammo":-1,"pellets":3},
}
def norm(x,z):
    d=math.hypot(x,z)
    return (x/d,z/d) if d>.00001 else (0.0,0.0)

def box_hit(x,z,r=.0):
    return any(abs(x-c[0])<c[2]/2+r and abs(z-c[1])<c[3]/2+r for c in COVERS)

def segment_box(x,z,dx,dz,box,r=0):
    lo,hi=0.0,1.0
    for pos,delta,center,half in [(x,dx,box[0],box[2]/2+r),(z,dz,box[1],box[3]/2+r)]:
        if abs(delta)<1e-9:
            if pos<center-half or pos>center+half:return None
        else:
            a=(center-half-pos)/delta;b=(center+half-pos)/delta
            lo=max(lo,min(a,b));hi=min(hi,max(a,b))
            if lo>hi:return None
    return lo

def segment_box3(x,y,z,dx,dy,dz,box,r=.1):
    lo,hi=0.0,1.0
    for pos,delta,low,high in [(x,dx,box[0]-box[2]/2-r,box[0]+box[2]/2+r),
                               (y,dy,-r,box[4]+r),
                               (z,dz,box[1]-box[3]/2-r,box[1]+box[3]/2+r)]:
        if abs(delta)<1e-9:
            if not low<=pos<=high:return None
        else:
            a,b=(low-pos)/delta,(high-pos)/delta
            lo=max(lo,min(a,b));hi=min(hi,max(a,b))
            if lo>hi:return None
    return lo

def segment_actor(x,y,z,dx,dy,dz,p):
    r=.62 if p.boss else .43
    a=dx*dx+dz*dz;ox=x-p.x;oz=z-p.z
    if a<1e-12:
        if ox*ox+oz*oz>r*r:return None
        lo,hi=0.0,1.0
    else:
        b=2*(ox*dx+oz*dz);c=ox*ox+oz*oz-r*r;disc=b*b-4*a*c
        if disc<0:return None
        lo=max(0,(-b-math.sqrt(disc))/(2*a));hi=min(1,(-b+math.sqrt(disc))/(2*a))
        if lo>hi:return None
    height=3.1 if p.boss else 1.85
    if abs(dy)<1e-9:
        if not .03<=y<=height:return None
    else:
        aa,bb=(.03-y)/dy,(height-y)/dy
        lo=max(lo,min(aa,bb));hi=min(hi,max(aa,bb))
    return lo if lo<=hi else None

def clear_line(x,z,tx,tz):
    return not any(segment_box3(x,1.35,z,tx-x,0,tz-z,c,.05) is not None for c in COVERS)

def segment_circle(x,z,dx,dz,cx,cz,r):
    a=dx*dx+dz*dz
    if a<1e-12:return 0.0 if math.hypot(x-cx,z-cz)<=r else None
    ox=x-cx;oz=z-cz;b=2*(ox*dx+oz*dz);cc=ox*ox+oz*oz-r*r
    if cc<=0:return 0.0
    disc=b*b-4*a*cc
    if disc<0:return None
    t=(-b-math.sqrt(disc))/(2*a)
    return t if 0<=t<=1 else None

@dataclass
class Actor:
    id:str
    name:str
    team:int
    bot:bool=False
    enemy:bool=False
    boss:bool=False
    x:float=0
    z:float=0
    vx:float=0
    vz:float=0
    ax:float=0
    az:float=-1
    pitch:float=0
    hp:float=100
    max_hp:int=100
    weapon:str="pistol"
    ammo:int=-1
    cooldown:float=0
    shield:float=0
    spawn_protection:float=0
    respawn:float=0
    kills:int=0
    deaths:int=0
    damage:int=0
    connected:bool=True
    input:dict=field(default_factory=lambda:{"mx":0,"mz":0,"ax":0,"az":-1,"fire":False})
    path:list=field(default_factory=list)
    rethink:float=0
    ai_time:float=0
    last_input:float=0

    def data(self):
        return dict(id=self.id,name=self.name,team=self.team,bot=self.bot,enemy=self.enemy,boss=self.boss,
                    x=round(self.x,3),z=round(self.z,3),vx=round(self.vx,3),vz=round(self.vz,3),
                    ax=round(self.ax,3),az=round(self.az,3),pitch=round(self.pitch,3),hp=max(0,round(self.hp)),
                    max_hp=self.max_hp,weapon=self.weapon,ammo=self.ammo,
                    shield=round(max(self.shield,self.spawn_protection),2),respawn=round(self.respawn,1),
                    kills=self.kills,deaths=self.deaths,connected=self.connected)

class Battle:
    def __init__(self,mode,players,seed=1):
        if mode not in MODES:raise ValueError("mode")
        if not 1<=len(players)<=MODES[mode]["slots"]:raise ValueError("player limit")
        self.mode=mode;self.rng=random.Random(seed);self.time=0.0;self.tick=0
        self.actors={p.id:p for p in players};self.balls=[];self.pickups=[];self.events=[];self.event_id=0
        self.serial=0;self.score=[0,0];self.phase="countdown";self.countdown=3.0;self.remaining=MODES[mode]["seconds"]
        self.winner=None;self.reason="";self.wave=0;self.wave_delay=0;self.to_spawn=0;self.spawn_timer=0
        self.next_pickup=7.0;self.wave_pending=False
        self.nav={};self.free=set()
        for gx in range(-12,13):
            for gz in range(-12,13):
                if not box_hit(gx,gz,.45):self.free.add((gx,gz))
        for cell in self.free:
            self.nav[cell]=[(cell[0]+dx,cell[1]+dz) for dx,dz in [(1,0),(-1,0),(0,1),(0,-1)]
                            if (cell[0]+dx,cell[1]+dz) in self.free]
        for i,p in enumerate(players):self.spawn(p,i)
        self.emit("start",mode=mode)
    def emit(self,kind,**data):
        self.event_id+=1;self.events.append(dict(id=self.event_id,kind=kind,**data))
        self.events=self.events[-22:]
    def spawn(self,p,index=0):
        if self.mode=="waves":
            spots=[(-3,9),(3,9),(-5,9),(5,9)]
        else:spots=SPAWNS[p.team]
        p.x,p.z=spots[index%len(spots)];p.hp=p.max_hp;p.respawn=0;p.shield=0;p.spawn_protection=2.0
        p.weapon="pistol";p.ammo=-1;p.cooldown=.35;p.vx=p.vz=0;p.path=[]
        p.ax,p.az=(0,-1) if self.mode=="waves" else norm(-p.x,-p.z)
    def set_input(self,id,data):
        p=self.actors.get(id)
        if not p or p.enemy:return
        mx=float(data.get("mx",0));mz=float(data.get("mz",0));ax=float(data.get("ax",0));az=float(data.get("az",-1))
        if not all(math.isfinite(v) and abs(v)<=1.01 for v in [mx,mz,ax,az]):raise ValueError("input")
        mag=math.hypot(mx,mz)
        if mag>1:mx/=mag;mz/=mag
        pitch=float(data.get("pitch",0))
        if not math.isfinite(pitch) or abs(pitch)>.86:raise ValueError("pitch")
        ax,az=norm(ax,az)
        p.input={"mx":mx,"mz":mz,"ax":ax,"az":az,"pitch":pitch,"fire":data.get("fire") is True}
        p.last_input=self.time
    def path_to(self,p,tx,tz):
        source=(round(p.x),round(p.z));target=(round(tx),round(tz))
        if source not in self.free:source=min(self.free,key=lambda c:(p.x-c[0])**2+(p.z-c[1])**2)
        if target not in self.free:target=min(self.free,key=lambda c:(tx-c[0])**2+(tz-c[1])**2)
        heap=[(0,source)];came={source:None};cost={source:0}
        while heap:
            _,cell=heapq.heappop(heap)
            if cell==target:break
            for n in self.nav[cell]:
                nc=cost[cell]+1
                if nc<cost.get(n,99999):
                    cost[n]=nc;came[n]=cell;heapq.heappush(heap,(nc+abs(n[0]-target[0])+abs(n[1]-target[1]),n))
        if target not in came:return []
        route=[];c=target
        while c!=source:route.append(c);c=came[c]
        return route[::-1]
    def ai(self,p):
        targets=[a for a in self.actors.values() if a.team!=p.team and a.hp>0]
        if not targets:return {"mx":0,"mz":0,"ax":p.ax,"az":p.az,"fire":False}
        t=min(targets,key=lambda a:(a.x-p.x)**2+(a.z-p.z)**2)
        dist=math.hypot(t.x-p.x,t.z-p.z);visible=clear_line(p.x,p.z,t.x,t.z)
        p.ai_time+=DT;p.rethink-=DT
        goal=(t.x,t.z);resource=False
        if not p.enemy:
            candidates=[d for d in self.pickups if (d["kind"]=="heal" and p.hp<65) or
                        (d["kind"] in ["rapid","spread","cannon"] and p.weapon=="pistol") or
                        (d["kind"]=="shield" and dist<7)]
            if candidates:
                item=min(candidates,key=lambda d:(d["x"]-p.x)**2+(d["z"]-p.z)**2)
                if math.hypot(item["x"]-p.x,item["z"]-p.z)<7 or p.hp<40:
                    goal=(item["x"],item["z"]);resource=True
        if p.rethink<=0:
            p.path=self.path_to(p,*goal);p.rethink=.5+self.rng.random()*.25
        mx=mz=0
        if visible and 3.7<dist<8.2 and not resource:
            side=1 if int(p.ai_time/2.2+sum(map(ord,p.id)))%2 else -1
            dx,dz=norm(t.x-p.x,t.z-p.z)
            mx,mz=-dz*side*.65,dx*side*.65
        else:
            while p.path and math.hypot(p.path[0][0]-p.x,p.path[0][1]-p.z)<.32:p.path.pop(0)
            if p.path:mx,mz=norm(p.path[0][0]-p.x,p.path[0][1]-p.z)
            elif not visible:mx,mz=norm(goal[0]-p.x,goal[1]-p.z)
        if dist<2.5 and not resource:mx,mz=norm(p.x-t.x,p.z-t.z)
        speed=WEAPONS[p.weapon]["speed"];lead=min(.5,dist/speed)*.65
        ax,az=norm(t.x+t.vx*lead-p.x,t.z+t.vz*lead-p.z)
        error=math.sin(p.ai_time*2.7+sum(map(ord,p.id)))*(.13 if p.enemy else .10)
        ax,az=ax*math.cos(error)-az*math.sin(error),ax*math.sin(error)+az*math.cos(error)
        return dict(mx=mx,mz=mz,ax=ax,az=az,pitch=math.atan2(1.15-(2.15 if p.boss else 1.35),max(.1,dist)),fire=visible and dist<16 and p.ai_time>.6)
    def move(self,p,mx,mz):
        speed=2.15 if p.enemy else 4.5
        if p.boss:speed=1.65
        ox,oz=p.x,p.z
        nx=max(-LIMIT,min(LIMIT,p.x+mx*speed*DT))
        if not box_hit(nx,p.z,PLAYER_RADIUS):p.x=nx
        nz=max(-LIMIT,min(LIMIT,p.z+mz*speed*DT))
        if not box_hit(p.x,nz,PLAYER_RADIUS):p.z=nz
        p.vx=(p.x-ox)/DT;p.vz=(p.z-oz)/DT
    def fire(self,p):
        w=WEAPONS[p.weapon];p.cooldown=w["cooldown"]
        if p.spawn_protection>0:p.spawn_protection=0
        for i in range(w["pellets"]):
            angle=math.atan2(p.ax,p.az)+(i-(w["pellets"]-1)/2)*.15
            dx,dz=math.sin(angle)*math.cos(p.pitch),math.cos(angle)*math.cos(p.pitch)
            self.serial+=1
            self.balls.append(dict(id=self.serial,owner=p.id,team=p.team,x=p.x+dx*.4,z=p.z+dz*.4,
                                   y=2.15 if p.boss else 1.35,vy=math.sin(p.pitch)*w["speed"],vx=dx*w["speed"],vz=dz*w["speed"],life=1.55,damage=w["damage"],
                                   big=p.weapon in ["cannon","boss"],blast=p.weapon=="cannon"))
        self.emit("shot",actor=p.id,weapon=p.weapon)
        if p.ammo>0:
            p.ammo-=1
            if p.ammo==0:p.weapon="pistol";p.ammo=-1
    def hit(self,p,damage,owner):
        if p.shield>0 or p.spawn_protection>0:
            self.emit("block",actor=p.id,x=round(p.x,2),z=round(p.z,2));return
        taken=min(p.hp,damage);p.hp-=damage
        attacker=self.actors.get(owner)
        if attacker:attacker.damage+=int(taken)
        self.emit("hit",actor=p.id,owner=owner,x=round(p.x,2),z=round(p.z,2),damage=damage)
        if p.hp<=0:
            p.hp=0;p.deaths+=1;p.vx=p.vz=0;p.respawn=8 if self.mode=="waves" else 3
            if attacker:
                attacker.kills+=1
                if self.mode!="waves" and attacker.team in [0,1]:self.score[attacker.team]+=1
            self.emit("down",actor=p.id,owner=owner,name=p.name,by=attacker.name if attacker else "Снеговик")
            if p.enemy:
                p.respawn=0
                if self.rng.random()<.22:self.drop("heal",p.x,p.z)
    def drop(self,kind,x,z):
        if len(self.pickups)>=7:return
        self.serial+=1
        self.pickups.append(dict(id=self.serial,kind=kind,x=x,z=z,ttl=25))
        self.emit("spawn_item",kind_name=kind,x=x,z=z)
    def spawn_pickup(self):
        options=[p for p in PADS if all(math.hypot(p[0]-d["x"],p[1]-d["z"])>1 for d in self.pickups)]
        if not options:return
        x,z=self.rng.choice(options)
        # Every third scheduled drop is a weapon; other drops alternate sustain and shield.
        kinds=["rapid","heal","shield","spread","heal","shield","cannon","heal","shield"]
        kind=kinds[(int((self.time-7)/6))%len(kinds)]
        self.drop(kind,x,z)
    def start_wave(self):
        self.wave+=1;self.to_spawn=3+self.wave*2;self.spawn_timer=0;self.wave_pending=False
        for i,p in enumerate(self.actors.values()):
            if not p.enemy:
                if p.hp<=0:self.spawn(p,i)
                p.hp=p.max_hp
        self.emit("wave",wave=self.wave,total=MODES["waves"]["goal"])
    def spawn_enemy(self):
        self.serial+=1
        spots=[(-11,-10),(-7,-11),(7,-11),(11,-10),(-11,7),(11,7)]
        x,z=self.rng.choice(spots)
        boss=self.wave==6 and self.to_spawn==1
        hp=380 if boss else 52+self.wave*9
        p=Actor("e"+str(self.serial),"Морозный великан" if boss else "Снеговик",1,True,True,boss,
                x=x,z=z,hp=hp,max_hp=hp,weapon="boss" if boss else "snowman")
        self.actors[p.id]=p
        self.emit("enemy_spawn",actor=p.id,x=x,z=z,boss=boss)
    def finish(self,winner,reason):
        if self.phase=="finished":return
        self.phase="finished";self.winner=winner;self.reason=reason
        self.balls=[]
        self.emit("finish",winner=winner,reason=reason)
    def advance(self):
        if self.phase=="finished":return
        self.tick+=1
        if self.phase=="countdown":
            self.countdown=max(0,self.countdown-DT)
            if self.countdown<1e-5:
                self.phase="playing"
                if self.mode=="waves":self.start_wave()
            return
        self.time+=DT;self.remaining=max(0,MODES[self.mode]["seconds"]-self.time)
        if self.remaining<=0:
            if self.mode=="waves":self.finish(1,"Время обороны вышло")
            else:self.finish(None if self.score[0]==self.score[1] else int(self.score[1]>self.score[0]),"Время вышло")
            return
        for p in list(self.actors.values()):
            if p.hp<=0:
                if p.enemy:continue
                p.respawn=max(0,p.respawn-DT)
                if p.respawn<1e-5:self.spawn(p,sum(map(ord,p.id)))
                continue
            p.shield=max(0,p.shield-DT);p.spawn_protection=max(0,p.spawn_protection-DT);p.cooldown=max(0,p.cooldown-DT)
            if p.shield<1e-6:p.shield=0
            if p.spawn_protection<1e-6:p.spawn_protection=0
            control=self.ai(p) if p.bot else p.input
            if not p.bot and p.connected and self.time-p.last_input>.4:
                control=dict(mx=0,mz=0,ax=p.ax,az=p.az,fire=False)
            self.move(p,control["mx"],control["mz"])
            if abs(control["ax"])+abs(control["az"])>.1:p.ax,p.az=norm(control["ax"],control["az"])
            p.pitch=control.get("pitch",0)
            if control["fire"] and p.cooldown<1e-5:self.fire(p)
        live_balls=[]
        for ball in self.balls:
            dx,dy,dz=ball["vx"]*DT,ball["vy"]*DT,ball["vz"]*DT;nearest=1.1;target=None
            for c in COVERS:
                hit=segment_box3(ball["x"],ball["y"],ball["z"],dx,dy,dz,c,.10)
                if hit is not None and hit<nearest:nearest=hit;target="wall"
            for p in self.actors.values():
                if p.hp<=0 or p.team==ball["team"]:continue
                hit=segment_actor(ball["x"],ball["y"],ball["z"],dx,dy,dz,p)
                if hit is not None and hit<nearest:nearest=hit;target=p
            if target is not None:
                x=ball["x"]+dx*nearest;z=ball["z"]+dz*nearest
                if target!="wall":self.hit(target,ball["damage"],ball["owner"])
                if ball.get("blast"):
                    for other in self.actors.values():
                        if other is target or other.hp<=0 or other.team==ball["team"]:continue
                        distance=math.hypot(other.x-x,other.z-z)
                        if distance<1.65 and clear_line(x,z,other.x,other.z):
                            self.hit(other,max(1,round(35*(1-distance/1.65))),ball["owner"])
                self.emit("impact",x=round(x,2),y=round(ball["y"]+dy*nearest,2),z=round(z,2),big=ball["big"])
                continue
            ball["x"]+=dx;ball["y"]+=dy;ball["z"]+=dz;ball["life"]-=DT
            if ball["life"]>0 and .0<ball["y"]<10 and max(abs(ball["x"]),abs(ball["z"]))<14:live_balls.append(ball)
        self.balls=live_balls
        for item in self.pickups[:]:
            item["ttl"]-=DT
            if item["ttl"]<=0:self.pickups.remove(item);continue
            for p in self.actors.values():
                if p.enemy or p.hp<=0 or math.hypot(p.x-item["x"],p.z-item["z"])>.7:continue
                kind=item["kind"]
                if kind=="heal":
                    if p.hp>=p.max_hp:continue
                    p.hp=min(p.max_hp,p.hp+28)
                elif kind=="shield":p.shield=3.0
                else:p.weapon=kind;p.ammo=WEAPONS[kind]["ammo"];p.cooldown=min(p.cooldown,.2)
                self.pickups.remove(item);self.emit("pickup",actor=p.id,item=kind);break
        if self.time>=self.next_pickup:
            self.spawn_pickup();self.next_pickup+=6
        if self.mode=="waves":
            players=[p for p in self.actors.values() if not p.enemy]
            if not any(p.hp>0 for p in players):self.finish(1,"Вся команда выбыла");return
            # Remove defeated enemies after their hit event; clients keep short death particles.
            self.actors={id:p for id,p in self.actors.items() if not p.enemy or p.hp>0}
            if self.to_spawn:
                self.spawn_timer-=DT
                if self.spawn_timer<=0:
                    self.spawn_enemy();self.to_spawn-=1;self.spawn_timer=.85
            elif not any(p.enemy for p in self.actors.values()):
                if self.wave>=MODES["waves"]["goal"]:self.finish(0,"Все волны отбиты")
                elif not self.wave_pending:
                    self.wave_pending=True;self.wave_delay=5
                    self.emit("wave_clear",wave=self.wave)
                else:
                    self.wave_delay-=DT
                    if self.wave_delay<=0:self.start_wave()
        else:
            if max(self.score)>=MODES[self.mode]["goal"]:
                self.finish(int(self.score[1]>self.score[0]),"Победный счёт достигнут")
    def data(self):
        return dict(phase=self.phase,tick=self.tick,time=round(self.time,2),remaining=round(self.remaining,1),
                    countdown=round(self.countdown,1),mode=self.mode,score=self.score[:],goal=MODES[self.mode]["goal"],
                    wave=self.wave,wave_delay=round(self.wave_delay,1),enemies_left=self.to_spawn+sum(p.enemy and p.hp>0 for p in self.actors.values()),
                    winner=self.winner,reason=self.reason,actors=[p.data() for p in self.actors.values()],
                    balls=[{k:round(v,3) if isinstance(v,float) else v for k,v in b.items() if k not in ["damage","life","vx","vy","vz"]} for b in self.balls],
                    pickups=[{k:v for k,v in d.items() if k!="ttl"} for d in self.pickups],events=self.events[:])
