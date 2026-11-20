"""Snow Courier invariants, authoritative replay and atomic daily rewards."""
import json
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timedelta
from pathlib import Path
from unittest.mock import patch

from fastapi import Depends,FastAPI,HTTPException,Request
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.api import courier,arcade
from app.auth import current_user
from app.db import Base,get_db
from app.courier_engine import TICKS,create_state,make_track,step,result


def trace(seed, mechanics=None):
    track=(mechanics.make_track(seed) if mechanics else make_track(seed))
    state=(mechanics.create_state() if mechanics else create_state())
    advance=mechanics.step if mechanics else step
    summarize=mechanics.result if mechanics else result
    controls=[]
    for _ in range(TICKS):
        upcoming=track[state["cursor"]:]
        dock=next(e for e in upcoming if e["kind"]=="dock")
        braking=False
        if state["bag"] and dock["y"]-state["distance"]<950:
            target=dock["x"];braking=dock["y"]-state["distance"]<650
        else:
            target=next(e for e in upcoming if e["kind"]=="gift")["x"]
            obstacle=next((e for e in upcoming if e["kind"]=="obstacle" and e["y"]-state["distance"]<360),None)
            if obstacle and abs(target-obstacle["x"])<280:
                target=max(-900,min(900,obstacle["x"]+(-450 if obstacle["x"]>0 else 450)))
        code=max(0,min(2000,int(target*10/9)+1000))+(2048 if braking else 0)
        controls.append(code);advance(state,track,code)
    return controls,summarize(state)


class CourierAPITests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.engine=create_engine("sqlite:///"+str(Path(self.tmp.name)/"courier.db"),
                                  connect_args={"check_same_thread":False,"timeout":10})
        self.sessions=sessionmaker(bind=self.engine,expire_on_commit=False)
        Base.metadata.create_all(self.engine)
        with self.sessions() as db:
            for i in [1,2]:
                db.add(models.User(id=i,telegram_id=900000001000000+i,first_name="Курьер "+str(i)))
                db.add(models.Wallet(user_id=i,balance=100))
            db.commit()
        def fixture_db():
            with self.sessions() as db:yield db
        def fixture_user(request:Request,db=Depends(get_db)):
            user=db.get(models.User,int(request.headers.get("X-Test-User","1")))
            if user is None:raise HTTPException(401)
            return user
        app=FastAPI();app.include_router(courier.router);app.include_router(arcade.router)
        app.dependency_overrides[get_db]=fixture_db
        app.dependency_overrides[current_user]=fixture_user
        self.client=TestClient(app)
        self.now=datetime(2026,11,20,12)
        self.day="2026-11-20"
        self.clock=patch.object(courier.models,"now_utc",side_effect=lambda:self.now);self.clock.start()
        self.calendar=patch.object(courier,"daily_day",side_effect=lambda:self.day);self.calendar.start()

    def tearDown(self):
        self.clock.stop();self.calendar.stop();self.client.close();self.engine.dispose();self.tmp.cleanup()

    def start(self,user=1):
        r=self.client.post("/api/arcade/courier/start",json={},headers={"X-Test-User":str(user)})
        self.assertEqual(r.status_code,200,r.text)
        return r.json()

    def finish(self,run,controls,user=1,**extra):
        return self.client.post("/api/arcade/courier/finish",json=dict(token=run["token"],controls=controls,**extra),
                                headers={"X-Test-User":str(user)})

    def wallet(self,user=1):
        with self.sessions() as db:return db.get(models.User,user).wallet.balance

    def test_score_replayed_from_controls_and_reward_granted_only_once(self):
        run=self.start();controls,expected=trace(run["seed"]);self.now+=timedelta(seconds=123)
        r=self.finish(run,controls,score=999999999)
        self.assertEqual(r.status_code,200,r.text);out=r.json()
        self.assertEqual(out["score"],expected["score"]);self.assertEqual(out["delivered"],expected["delivered"])
        self.assertGreaterEqual(out["delivered"],12);self.assertEqual(out["reward"],75)
        replay=self.finish(run,controls)
        self.assertEqual(replay.status_code,200,replay.text);self.assertTrue(replay.json()["replayed"])
        self.assertEqual(self.wallet(),175)
        with self.sessions() as db:
            self.assertEqual(db.query(models.ArcadeFirstWin).count(),1)
            self.assertEqual(db.query(models.Transaction).count(),1)
        changed=controls[:];changed[0]=1000 if changed[0]!=1000 else 1001
        self.assertEqual(self.finish(run,changed).status_code,409)
        self.assertEqual(self.finish(run,controls,user=2).status_code,404)

    def test_early_and_malformed_finish_cannot_consume_or_pay(self):
        run=self.start();controls,_=trace(run["seed"])
        self.assertEqual(self.finish(run,controls).status_code,400)
        for bad in [controls[:-1],controls+[0],[True]+controls[1:],[-1]+controls[1:],[2047]+controls[1:]]:
            r=self.finish(run,bad);self.assertEqual(r.status_code,422,r.text)
        self.assertEqual(self.wallet(),100)
        with self.sessions() as db:self.assertEqual(db.query(models.CourierRun).one().status,"started")

    def test_competing_finishes_share_one_result_and_one_payment(self):
        run=self.start();controls,_=trace(run["seed"]);self.now+=timedelta(seconds=123)
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses=list(pool.map(lambda _:self.finish(run,controls),range(2)))
        for response in responses:self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(sum(not r.json()["replayed"] for r in responses),1)
        self.assertEqual(self.wallet(),175)

    def test_daily_limit_next_day_and_leaderboard(self):
        for day,expected_reward,balance in [("2026-11-20",75,175),("2026-11-20",0,175),("2026-11-21",75,250)]:
            self.day=day;run=self.start();controls,_=trace(run["seed"]);self.now+=timedelta(seconds=123)
            r=self.finish(run,controls);self.assertEqual(r.status_code,200,r.text)
            self.assertEqual(r.json()["reward"],expected_reward);self.assertEqual(self.wallet(),balance)
            board=self.client.get("/api/arcade/courier/status").json()
            self.assertEqual(len(board["leaders"]),1);self.assertEqual(board["rank"],1)
            self.assertEqual(board["day"],day);self.assertTrue(board["reward_claimed"])
        denied=self.client.post("/api/arcade/round/start",json={"game":"snow_courier"})
        self.assertEqual(denied.status_code,400)

    def test_abandoned_expired_and_failed_runs_never_pay(self):
        old=self.start();self.now+=timedelta(seconds=3);new=self.start()
        controls,_=trace(old["seed"]);self.now+=timedelta(seconds=123)
        self.assertEqual(self.finish(old,controls).status_code,409)
        stationary=[1000]*TICKS
        r=self.finish(new,stationary);self.assertEqual(r.status_code,200,r.text)
        self.assertEqual(r.json()["reward"],0);self.assertEqual(self.wallet(),100)
        next_run=self.start();self.now+=timedelta(minutes=91)
        self.assertEqual(self.finish(next_run,controls).status_code,409)


    def test_legacy_run_can_finish_but_does_not_dominate_new_ranking_or_repeat_reward(self):
        from app import courier_engine_v1 as old
        token="old-version-courier-token-123456789"
        with self.sessions() as db:
            db.add(models.CourierRun(token=token,user_id=1,day=self.day,seed=313,
                engine_version=1,status="started",started_at=self.now-timedelta(seconds=123),
                expires_at=self.now+timedelta(minutes=30)))
            db.commit()
        controls,expected=trace(313,old)
        response=self.finish({"token":token},controls)
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(response.json()["engine_version"],1)
        self.assertEqual(response.json()["score"],expected["score"])
        self.assertEqual(response.json()["reward"],75)
        status=self.client.get("/api/arcade/courier/status").json()
        self.assertEqual(status["best"],0)
        self.assertEqual(status["previous_best"],expected["score"])
        self.assertEqual(status["leaders"],[])
        self.assertTrue(status["reward_claimed"])
        current=self.start();commands,_=trace(current["seed"]);self.now+=timedelta(seconds=123)
        finished=self.finish(current,commands)
        self.assertEqual(finished.status_code,200,finished.text)
        self.assertEqual(finished.json()["reward"],0)
        self.assertEqual(finished.json()["engine_version"],2)
        self.assertEqual(self.wallet(),175)
        replayed=self.finish({"token":token},controls)
        self.assertEqual(replayed.status_code,200,replayed.text)
        self.assertTrue(replayed.json()["replayed"])
        with self.sessions() as db:self.assertEqual(db.query(models.CourierRun).count(),2)

    def test_new_route_requires_more_precise_pickups_and_has_more_hazards(self):
        from app import courier_engine as current,courier_engine_v1 as old
        a,b=old.make_track(321),current.make_track(321)
        gifts=lambda t:sum(e["kind"]=="gift" and e["y"]<50000 for e in t)
        obstacles=lambda t:sum(e["kind"]=="obstacle" and e["y"]<50000 for e in t)
        self.assertLess(gifts(b),gifts(a)*.75)
        self.assertGreater(obstacles(b),obstacles(a)*1.5)
        moving=[e for e in b if e.get("motion")]
        self.assertTrue(moving)
        for e in moving:
            positions=[current.entity_x(e,t) for t in range(e["period"])]
            self.assertEqual(min(positions),e["x"]-e["motion"])
            self.assertEqual(max(positions),e["x"]+e["motion"])
        for dx,expected in [(105,1),(106,0)]:
            state=current.create_state()
            current.step(state,[dict(y=0,x=dx,kind="gift")],1000)
            self.assertEqual(state["picked"],expected)



if __name__=="__main__":unittest.main(verbosity=2)
