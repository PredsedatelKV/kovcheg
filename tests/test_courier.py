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


def trace(seed):
    track=make_track(seed);state=create_state();controls=[]
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
        controls.append(code);step(state,track,code)
    return controls,result(state)


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


if __name__=="__main__":unittest.main(verbosity=2)
