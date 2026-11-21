import math
import unittest

from fastapi import HTTPException
from app.api.thin_ice import IceHub, MODE
from app.thin_ice import DT, DURATION, SIZE, TILE, Floe, IceMatch, Skater, coords, tile_at


class Physics(unittest.TestCase):
    def game(self):
        a, b = Skater("p0", "A"), Skater("p1", "B")
        game = IceMatch([a, b], 88)
        game.tick = 60
        game.time = 0
        game.phase = "playing"
        return game, a, b

    def advance(self, game, ticks):
        for _ in range(ticks):
            game.advance()

    def test_crack_warning_then_collapse(self):
        game, a, b = self.game()
        index = tile_at(a.x, a.z)
        self.advance(game, 17)
        self.assertEqual(game.data()["tiles"][index], "3")
        self.assertTrue(a.alive)
        self.assertTrue(any(e["kind"] == "fissure" for e in game.events))
        self.advance(game, 40)
        self.assertTrue(game.floes[index].gone)
        self.assertFalse(a.alive)

    def test_crosses_single_missing_floe_when_jumping(self):
        game, a, b = self.game()
        a.x = -TILE + .52
        a.z = 0
        a.vx = 5.35
        game.floes[tile_at(0,0)].gone = True
        for i in range(12):
            game.set_input(a.id, {"mx":1, "jump":i < 2})
            game.advance()
        self.assertTrue(a.grounded and a.alive)
        self.assertGreater(a.x, TILE*.5)
        self.assertEqual(sum(e["kind"]=="jump" for e in game.events), 1)

    def test_dash_cooldown_and_release(self):
        game,a,b=self.game()
        game.set_input(a.id, {"mx":1, "dash":True})
        game.advance()
        self.assertGreater(a.vx, 8)
        self.assertAlmostEqual(a.dash, game.time+3.4)
        game.set_input(a.id, {"mx":1,"dash":False})
        game.set_input(a.id, {"mx":1,"dash":True})
        game.advance()
        self.assertEqual(sum(e["kind"]=="dash" for e in game.events),1)

    def test_pulse_respects_distance_airtime_and_grip(self):
        game,a,b=self.game()
        b.x,b.z=a.x+1.4,a.z
        a.actions.add("fire")
        game.do_actions(a)
        self.assertGreater(b.vx, 7)
        self.assertEqual(a.shoves,1)
        a.push=0;b.vx=0;b.grip=5
        a.actions.add("fire")
        game.do_actions(a)
        self.assertLess(b.vx, 2.3)
        a.push=0;b.vx=0;b.y=1.2
        a.actions.add("fire")
        game.do_actions(a)
        self.assertEqual(b.vx,0)

    def test_bridge_restores_floes_but_cannot_cancel_storm(self):
        game,a,b=self.game()
        i=tile_at(a.x,a.z)
        a.ax,a.az=1,0
        game.floes[i+1]=Floe(gone=True)
        game.floes[i+2]=Floe(storm=True,gone=True)
        game.items=[{"kind":"bridge","tile":i,"until":5}]
        game.collect(a)
        game.collect(b)
        self.assertEqual((a.items,b.items),(1,0))
        self.assertFalse(game.floes[i+1].gone)
        self.assertGreater(game.floes[i+1].frozen,0)
        self.assertTrue(game.floes[i+2].gone)

    def test_pickups_anchor_and_charge(self):
        game,a,b=self.game()
        i=tile_at(a.x,a.z)
        game.items=[{"kind":"anchor","tile":i,"until":5},{"kind":"charge","tile":i,"until":5}]
        a.dash=a.push=4
        game.collect(a)
        self.assertEqual((a.items,a.dash,a.push,a.grip),(2,0,0,6))
        self.assertFalse(game.items)

    def test_four_storm_rings_never_touch_core_and_remove_items(self):
        game,a,b=self.game()
        outer=0
        center=tile_at(0,0)
        game.items=[{"kind":"charge","tile":outer,"until":200}]
        for i,at in enumerate((24,43,62,81)):
            game.time=at
            game.weather()
            self.assertEqual(game.storm,i+1)
            game.time=at+2.6
            game.weather()
        self.assertTrue(game.floes[outer].gone)
        self.assertFalse(game.floes[center].gone)
        self.assertNotIn(outer, [item["tile"] for item in game.items])

    def test_expired_input_cannot_move_or_fire(self):
        game,a,b=self.game()
        x=a.x
        game.set_input(a.id, {"mx":99,"mz":99,"fire":True})
        self.assertAlmostEqual(math.hypot(*a.intent),1)
        game.tick=100
        game.advance()
        self.assertEqual(a.x,x)
        self.assertFalse(a.actions)
        self.assertEqual(a.push,0)

    def test_last_survivor_and_time_limit(self):
        game,a,b=self.game()
        game.eliminate(b)
        game.advance()
        self.assertEqual((game.phase,game.winner),("finished","p0"))
        game,a,b=self.game()
        game.tick=round((DURATION+3)/DT)-1
        a.tiles=3
        game.advance()
        self.assertEqual((game.phase,game.winner),("finished","p0"))

    def test_bot_training_stays_active_long_enough_for_items(self):
        game=IceMatch([Skater(f"b{i}",str(i),bot=True) for i in range(4)], 5)
        self.advance(game,2300)
        self.assertEqual(game.phase,"finished")
        self.assertGreater(game.time,15)
        self.assertLessEqual(game.time,DURATION)
        self.assertGreater(sum(p.items for p in game.actors.values()),0)
        self.assertGreater(sum(p.shoves for p in game.actors.values()),0)


class Rooms(unittest.TestCase):
    def test_lobby_limits_host_transfer_and_rejoin(self):
        hub=IceHub()
        r=hub.create(1,"Host",MODE,False)
        with self.assertRaises(HTTPException):hub.start(1)
        for i in range(2,5):hub.join(i,str(i),r.code)
        with self.assertRaises(HTTPException):hub.join(5,"5",r.code)
        with self.assertRaises(HTTPException):hub.start(2)
        hub.start(1)
        member=r.members[2]
        token=hub.ticket(2)
        self.assertEqual(hub.consume_ticket(token),(r,member))
        self.assertIsNone(hub.consume_ticket(token))
        hub.set_connected(r,member,False)
        hub.set_connected(r,member,True)
        self.assertTrue(r.game.actors[member.id].connected)
        hub.leave(1)
        self.assertFalse(r.game.actors["p0"].alive)
        self.assertEqual(r.owner,2)
        with self.assertRaises(HTTPException):hub.rematch_lobby(2)
        r.game.finish(member.id,"test")
        hub.rematch_lobby(2)
        self.assertIsNone(r.game)
        hub.start(2)
        self.assertEqual(len(r.game.actors),3)

    def test_solo_fills_and_bookkeeping_cleans(self):
        hub=IceHub()
        r=hub.create(1,"Host",MODE,True)
        hub.start(1)
        self.assertEqual(sum(p.bot for p in r.game.actors.values()),3)
        for uid in list(r.members):hub.leave(uid)
        self.assertFalse(hub.rooms)
        self.assertFalse(hub.membership)
