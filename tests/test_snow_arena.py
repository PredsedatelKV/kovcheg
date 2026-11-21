import asyncio
from contextlib import ExitStack, asynccontextmanager
import json
import math
import time
import unittest

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from app import models
from app.auth import current_user
from app.api import arena
from app.snow_arena import Actor,Battle,COVERS,DT,MODES,WEAPONS,box_hit,segment_actor

class PhysicsTests(unittest.TestCase):
    def game(self,mode="duel"):
        p=Actor("p0","Blue",0);q=Actor("p1","Red",1 if mode!="waves" else 0)
        b=Battle(mode,[p,q],71);b.phase="playing"
        for a in b.actors.values():a.spawn_protection=0
        return b,p,q
    def test_movement_normalized_and_cover_collision(self):
        b,p,_=self.game();p.x=p.z=-11
        for _ in range(20):
            b.set_input("p0",dict(mx=1,mz=1,ax=1,az=0));b.advance()
        self.assertAlmostEqual(math.hypot(p.x+11,p.z+11),4.5,places=5)
        p.x=-9;p.z=-6
        for _ in range(60):
            b.set_input("p0",dict(mx=1,mz=0,ax=1,az=0));b.advance()
        self.assertLessEqual(p.x,-6.3-2.8/2-.34+.23)
        self.assertFalse(box_hit(p.x,p.z,.339))
    def test_authoritative_shooting_and_no_friendly_fire(self):
        b,p,q=self.game();p.x=-1;p.z=0;q.x=1;q.z=0
        for _ in range(9):
            b.set_input("p0",dict(mx=0,mz=0,ax=1,az=0,pitch=0,fire=True));b.advance()
        self.assertEqual(q.hp,76)
        q.team=0;q.hp=100;p.cooldown=0
        for _ in range(9):
            b.set_input("p0",dict(ax=1,az=0,fire=True));b.advance()
        self.assertEqual(q.hp,100)
    def test_3d_cover_and_shooting_above_target(self):
        b,p,q=self.game();p.x=-9.5;p.z=-6;q.x=-3.5;q.z=-6
        for _ in range(30):
            b.set_input("p0",dict(ax=1,az=0,fire=True));b.advance()
        self.assertEqual(q.hp,100)
        p.x=-1;p.z=0;q.x=1;q.z=0;p.cooldown=0
        for _ in range(12):
            b.set_input("p0",dict(ax=1,az=0,pitch=.8,fire=True));b.advance()
        self.assertEqual(q.hp,100)
    def test_shield_exact_three_seconds_and_heal_cap(self):
        b,p,q=self.game();p.x=p.z=0
        b.drop("shield",0,0);b.advance()
        self.assertEqual(p.shield,3)
        b.hit(p,100,"p1");self.assertEqual(p.hp,100)
        for _ in range(59):b.advance()
        self.assertGreater(p.shield,0)
        b.advance();self.assertAlmostEqual(p.shield,0,places=5)
        b.hit(p,45,"p1");self.assertEqual(p.hp,55)
        b.drop("heal",0,0);b.advance();self.assertEqual(p.hp,83)
        b.drop("heal",0,0);b.advance();self.assertEqual(p.hp,100)
    def test_weapon_pickup_and_ammo_fallback(self):
        b,p,q=self.game();p.x=p.z=0
        b.drop("rapid",0,0);b.advance()
        self.assertEqual((p.weapon,p.ammo),("rapid",36))
        p.ammo=1;p.cooldown=0;b.set_input("p0",dict(ax=1,az=0,fire=True));b.advance()
        self.assertEqual((p.weapon,p.ammo),("pistol",-1))
        self.assertEqual(b.balls[-1]["damage"],17)
    def test_cannon_splash_and_shielded_targets(self):
        b,p,q=self.game();p.x=-2;p.z=0;q.x=0;q.z=0
        third=Actor("p2","Near target",1,x=.7,z=.6);third.spawn_protection=0
        b.actors[third.id]=third;p.weapon="cannon";p.ammo=7;p.cooldown=0
        for _ in range(10):
            b.set_input("p0",dict(ax=1,az=0,fire=True));b.advance()
        self.assertEqual(q.hp,37)
        self.assertLess(third.hp,100)
        self.assertGreater(third.hp,50)
        self.assertEqual(p.ammo,6)

    def test_wave_lifecycle_and_team_wipe(self):
        b,p,q=self.game("waves");b.start_wave()
        self.assertEqual(b.wave,1)
        b.to_spawn=0
        b.advance();self.assertTrue(b.wave_pending)
        for _ in range(102):b.advance()
        self.assertEqual(b.wave,2)
        p.hp=q.hp=0;p.respawn=q.respawn=8;b.advance()
        self.assertEqual((b.phase,b.winner),("finished",1))
    def test_bad_inputs_and_forged_state(self):
        b,p,_=self.game()
        for input in [dict(mx=float("nan")),dict(ax=8),dict(pitch=2),dict(mz=float("inf"))]:
            with self.assertRaises(ValueError):b.set_input(p.id,input)
        before=(p.hp,p.x)
        b.set_input(p.id,dict(hp=99999,x=999,kills=99))
        self.assertEqual((p.hp,p.x),before);self.assertEqual(p.kills,0)
    def test_bots_complete_match_with_bounded_cost(self):
        players=[Actor("b"+str(i),"Bot",i%2,True) for i in range(4)]
        game=Battle("teams",players,411);start=time.perf_counter()
        for _ in range(5000):
            game.advance()
            if game.phase=="finished":break
        self.assertEqual(game.phase,"finished")
        self.assertGreater(sum(p.kills for p in players),0)
        self.assertTrue(all(not box_hit(p.x,p.z,.33) for p in players))
        self.assertLess(time.perf_counter()-start,18)

class RoomTests(unittest.TestCase):
    def setUp(self):
        self.h=arena.ArenaHub()
    def test_limits_teams_and_owner(self):
        room=self.h.create(1,"First","teams",True)
        for i in [2,3,4]:self.h.join(i,"Player",room.code)
        self.assertEqual([sum(m.team==t for m in room.members.values()) for t in [0,1]],[2,2])
        with self.assertRaises(Exception):self.h.join(5,"Fifth",room.code)
        with self.assertRaises(Exception):self.h.start(2)
        self.h.start(1);self.assertEqual(len(room.game.actors),4)
        with self.assertRaises(Exception):self.h.join(6,"Late",room.code)
    def test_fill_optional_duel_and_coop(self):
        room=self.h.create(1,"One","duel",False)
        with self.assertRaises(Exception):self.h.start(1)
        room.bots=True;self.h.start(1)
        self.assertEqual(len(room.game.actors),2)
        self.assertEqual(sum(p.bot for p in room.game.actors.values()),1)
        self.h.leave(1);self.assertFalse(self.h.rooms)
        room=self.h.create(1,"One","waves",True);self.h.start(1)
        self.assertEqual(len(room.game.actors),4)
        self.assertTrue(all(p.team==0 for p in room.game.actors.values()))
    def test_ticket_single_use_expiry_and_membership(self):
        room=self.h.create(1,"One","duel",True)
        token=self.h.ticket(1);self.assertIsNotNone(self.h.consume_ticket(token))
        self.assertIsNone(self.h.consume_ticket(token))
        token=self.h.ticket(1);self.h.tickets[token]=(1,room.code,time.monotonic()-1)
        self.assertIsNone(self.h.consume_ticket(token))
        token=self.h.ticket(1);self.h.leave(1)
        self.assertIsNone(self.h.consume_ticket(token))
    def test_host_migration_and_leave_conversion(self):
        room=self.h.create(1,"One","teams",True);self.h.join(2,"Two",room.code)
        self.h.start(1);id=room.members[1].id;self.h.leave(1)
        self.assertEqual(room.owner,2);self.assertTrue(room.game.actors[id].bot)
        self.assertEqual(len(room.game.actors),4)

class SocketTests(unittest.TestCase):
    def setUp(self):
        arena.hub=arena.ArenaHub()
        @asynccontextmanager
        async def life(app):
            yield
            await arena.hub.shutdown()
        app=FastAPI(lifespan=life);app.include_router(arena.router);app.include_router(arena.socket_router)
        async def user(request:Request):
            uid=int(request.headers.get("X-Test-User","1"))
            return models.User(id=uid,telegram_id=1000+uid,first_name="Test "+str(uid))
        app.dependency_overrides[current_user]=user
        self.client=TestClient(app);self.client.__enter__()
    def tearDown(self):
        self.client.__exit__(None,None,None)
    def post(self,path,uid=1,body=None):
        return self.client.post("/api/arcade/arena"+path,json=body or {},headers={"X-Test-User":str(uid)})
    def test_four_real_sockets_and_same_match(self):
        room=self.post("/rooms",body={"mode":"teams","bots":False}).json();code=room["room"]
        for uid in [2,3,4]:self.assertEqual(self.post("/join",uid,{"code":code}).status_code,200)
        self.assertEqual(self.post("/join",5,{"code":code}).status_code,409)
        with ExitStack() as stack:
            sockets=[]
            for uid in [1,2,3,4]:
                ticket=self.post("/ticket",uid).json()["ticket"]
                ws=stack.enter_context(self.client.websocket_connect("/ws/arena"))
                ws.send_json({"ticket":ticket});self.assertEqual(ws.receive_json()["type"],"state");sockets.append(ws)
            result=self.post("/start").json()
            self.assertEqual(len(result["game"]["actors"]),4)
            for ws in sockets:
                for _ in range(20):
                    data=ws.receive_json()
                    if data.get("game"):break
                self.assertEqual(data["room"],code);self.assertEqual(data["game"]["phase"],"countdown")
            self.assertEqual(arena.hub.failures,0)
    def test_bad_ticket_origin_and_replay(self):
        with self.assertRaises(Exception):
            with self.client.websocket_connect("/ws/arena",headers={"origin":"https://wrong.example"}) as ws:
                ws.send_json({"ticket":"x"*40});ws.receive_json()
        with self.assertRaises(Exception):
            with self.client.websocket_connect("/ws/arena") as ws:
                ws.send_json({"ticket":"x"*40});ws.receive_json()

if __name__=="__main__":unittest.main()
