import math
import unittest

from fastapi import HTTPException
from app.api.polar_express import MODE, TrainHub
from app.polar_express import Journey, Passenger, WORK, can_walk, on_platform


class JourneyTests(unittest.TestCase):
    def scene(self):
        p=Passenger("p0","Player")
        g=Journey([p],11)
        g.phase="playing";g.tick=60;g.time=0
        return g,p

    def work(self,g,p,target,seconds=None):
        x,z,_,duration=WORK[target]
        p.x=0 if not on_platform(x) else x-.76
        p.z=z
        p.ax=math.copysign(1,x-p.x)
        p.az=0
        p.use=True
        p.cooldown=0
        for _ in range(math.ceil((duration if seconds is None else seconds)/.05)+1):
            g.act(p)
        p.use=False

    def test_walk_between_all_three_cars_and_station(self):
        for z in [-9.1,-4,-1.16,-.6,0,7.39,7.98,8.53,15.35]:
            self.assertTrue(can_walk(0,z,False),z)
        self.assertFalse(can_walk(1.28,-7.36,False))
        self.assertFalse(can_walk(2.2,3.12,False))
        self.assertTrue(all(can_walk(x/10,3.12,True) for x in range(8,105)))
        self.assertFalse(can_walk(2,6,True))

    def test_take_fuel_and_use_it_once(self):
        g,p=self.scene()
        self.work(g,p,"coal")
        self.assertEqual((g.stock["coal"],p.hand),(3,"coal"))
        before=g.heat
        self.work(g,p,"furnace")
        self.assertGreater(g.heat,before)
        self.assertEqual(p.hand,"")
        self.assertEqual(p.jobs,2)
        self.work(g,p,"furnace")
        self.assertEqual(p.jobs,2)

    def test_hold_requires_aim_and_full_duration(self):
        g,p=self.scene()
        p.hand="coal";p.x=0;p.z=-7.36
        p.use=True;p.ax=1;p.az=0
        for _ in range(20):g.act(p)
        self.assertEqual(p.hand,"coal")
        self.work(g,p,"furnace",.12)
        self.assertEqual(p.hand,"coal")
        p.use=False
        g.act(p)
        self.assertEqual(p.progress,0)

    def test_wrap_load_and_deliver(self):
        g,p=self.scene()
        self.work(g,p,"parcel")
        self.work(g,p,"cargo")
        self.assertEqual(g.loaded,0)
        self.work(g,p,"seal")
        self.assertEqual(p.hand,"sealed")
        self.work(g,p,"cargo")
        self.assertEqual((g.loaded,p.hand,p.deliveries),(1,"",1))
        g.arrive()
        self.assertEqual((g.loaded,g.delivered,g.travel),(0,1,False))
        self.work(g,p,"station_signal")
        self.assertEqual((g.delivered,p.hand),(1,"priority"))
        g.time=g.depart_at
        g.depart()
        self.assertEqual(p.hand,"")
        self.assertEqual(g.priority_delivered,0)

    def test_platform_deadline_and_restart_travel(self):
        g,p=self.scene()
        g.arrive()
        self.work(g,p,"station_coal")
        self.assertEqual(p.hand,"coal")
        g.time=g.depart_at
        g.update_train()
        self.assertEqual((g.leg,g.travel,p.hand),(1,True,""))
        self.assertFalse(on_platform(p.x))
        self.assertTrue(any(e["kind"]=="recall" and e["lost"] for e in g.events))

    def test_departure_waits_for_crew_then_announces(self):
        p=Passenger("p0","A");q=Passenger("p1","B")
        g=Journey([p,q],1)
        g.phase="playing";g.time=8
        g.arrive()
        g.time+=15
        q.x=9
        self.assertFalse(g.available(p,"dispatch"))
        q.x=0
        self.assertTrue(g.available(p,"dispatch"))
        self.work(g,p,"dispatch")
        self.assertGreater(g.depart_at,g.time)
        self.assertLessEqual(g.depart_at,g.time+4)

    def test_routes_change_distance_and_damage(self):
        g,p=self.scene()
        self.work(g,p,"bridge")
        self.assertFalse(g.route)
        g.leg_distance=200
        self.work(g,p,"bridge")
        self.assertEqual(g.route,"bridge")
        g.leg=1
        short=g.end_of_leg()
        g.route="valley"
        self.assertGreater(g.end_of_leg(),short)
        g.route="bridge";g.leg_distance=71
        g.update_train()
        self.assertTrue(g.fault)
        p.hand="parts"
        self.work(g,p,"repair")
        self.assertFalse(g.fault)

    def test_emergency_grace_can_recover_or_fail(self):
        g,p=self.scene()
        g.heat=0
        for _ in range(200):g.update_train()
        self.assertGreater(g.wait_for_repair,9)
        self.assertEqual(g.phase,"playing")
        p.hand="coal"
        self.work(g,p,"furnace")
        g.update_train()
        self.assertEqual(g.wait_for_repair,0)
        g.hull=0
        for _ in range(510):g.update_train()
        self.assertEqual((g.phase,g.winner),("finished",False))

    def test_human_input_expires(self):
        g,p=self.scene()
        g.set_input(p.id,{"mx":9,"mz":9,"ax":0,"az":-1,"fire":True})
        self.assertAlmostEqual(math.hypot(*p.intent),1)
        g.tick=68;g.advance()
        self.assertEqual(p.intent,(0,0))
        self.assertFalse(p.use)

    def test_both_routes_complete_with_autonomous_crew(self):
        for route in ("bridge","valley"):
            g=Journey([Passenger(str(i),str(i),bot=True) for i in range(4)],52)
            g.route=route
            for _ in range(9620):
                g.advance()
                if g.phase=="finished":break
            self.assertEqual((g.winner,g.leg,g.travel),(True,2,False),route)
            self.assertGreaterEqual(g.delivered,9)
            self.assertEqual(g.manifest()["stars"],2)
            self.assertGreater(g.time,105)
            self.assertLess(g.time,220)
            self.assertTrue(any(e["kind"]=="finish" for e in g.events))


    def test_priority_delivery_counts_when_unloaded_and_earns_three_stars(self):
        g,p=self.scene()
        g.loaded=g.orders[0]
        g.arrive()
        self.work(g,p,"station_signal")
        p.x=0
        g.depart()
        self.work(g,p,"seal")
        self.work(g,p,"store")
        self.assertEqual(g.staged["priority_sealed"],1)
        self.work(g,p,"store")
        self.assertEqual(p.hand,"priority_sealed")
        self.work(g,p,"cargo")
        self.assertEqual((g.priority_loaded,g.priority_delivered),(1,0))
        g.loaded=g.orders[1]
        g.arrive()
        self.assertEqual(g.priority_delivered,1)
        g.depart()
        g.loaded=g.orders[2]
        g.arrive()
        self.assertEqual((g.winner,g.manifest()["stars"]),(True,3))

    def test_shortfall_can_be_recovered_at_later_stop(self):
        g,_=self.scene()
        for filled in (1,4,4):
            g.loaded=filled
            g.arrive()
            if g.leg<2:g.depart()
        self.assertEqual(g.manifest()["unloaded"],[1,4,4])
        self.assertEqual((g.winner,g.manifest()["stars"]),(True,2))

    def test_premature_departure_cancels_if_someone_goes_back_onto_platform(self):
        g,p=self.scene()
        g.arrive()
        deadline=g.depart_at
        g.time=12
        self.work(g,p,"dispatch")
        p.x=3.5
        g.time=g.depart_at
        g.update_train()
        self.assertFalse(g.travel)
        self.assertEqual(g.depart_at,deadline)

    def test_motion_clears_lateral_velocity_against_vestibule(self):
        g,p=self.scene()
        p.x,p.z=.61,7.31
        p.intent=(.7,.7)
        for _ in range(30):
            g.move(p)
            self.assertTrue(can_walk(p.x,p.z,False))
        p.intent=(-.8,.5)
        for _ in range(35):g.move(p)
        p.intent=(0,1)
        for _ in range(25):g.move(p)
        self.assertGreater(p.z,8.57)

    def test_explicit_action_stays_bound_until_item_is_available(self):
        g,p=self.scene()
        p.x,p.z,p.ax,p.az=0,2.35,-1,0
        g.set_input(p.id,{"work":"parcel","fire":True,"ax":-1,"az":0})
        for _ in range(20):g.act(p)
        self.assertEqual((p.hand,p.jobs),("parcel",1))
        g.set_input(p.id,{"work":"seal","fire":True,"ax":-1,"az":0})
        for _ in range(20):g.act(p)
        self.assertEqual(p.hand,"parcel")


    def test_two_players_cannot_take_the_same_parcel(self):
        p,q=Passenger("p0","А"),Passenger("p1","Б")
        g=Journey([p,q],11)
        g.phase,g.time="playing",0
        g.stock["parcel"]=1
        for actor in (p,q):
            actor.x,actor.z=0,2.35
            g.set_input(actor.id,{"work":"parcel","fire":True,"ax":-1,"az":0})
        for _ in range(10):
            g.act(p)
            g.act(q)
        self.assertEqual(g.stock["parcel"],0)
        self.assertEqual(sorted(a.hand for a in (p,q)),["","parcel"])


class RoomTests(unittest.TestCase):
    def test_solo_fill_limits_handoff_and_rematch(self):
        hub=TrainHub()
        room=hub.create(1,"A",MODE,True)
        for uid in (2,3,4):hub.join(uid,str(uid),room.code)
        with self.assertRaises(HTTPException):hub.join(5,"B",room.code)
        with self.assertRaises(HTTPException):hub.start(2)
        hub.start(1)
        self.assertEqual(len(room.game.actors),4)
        hub.leave(1)
        self.assertEqual(room.owner,2)
        self.assertTrue(room.game.actors["p0"].bot)
        with self.assertRaises(HTTPException):hub.rematch_lobby(2)
        room.game.finish(True,"done")
        hub.rematch_lobby(2)
        self.assertIsNone(room.game)
        for member in room.members.values():member.connected=True
        hub.start(2)
        self.assertEqual(sum(p.bot for p in room.game.actors.values()),1)

    def test_departed_member_does_not_keep_ticket(self):
        hub=TrainHub()
        room=hub.create(1,"A",MODE,True)
        hub.join(2,"B",room.code)
        ticket=hub.ticket(2)
        hub.leave(2)
        hub.join(2,"B",room.code)
        self.assertIsNone(hub.consume_ticket(ticket))

    def test_one_slot_solo_without_bots(self):
        hub=TrainHub()
        room=hub.create(1,"Solo",MODE,False)
        hub.start(1)
        self.assertEqual(len(room.game.actors),1)
        hub.leave(1)
        self.assertFalse(hub.rooms)
