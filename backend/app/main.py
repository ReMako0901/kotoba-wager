import json
import secrets
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from .config import settings
from .engine import engine
from .gemini import gemini
from .models import CreateSession, TradeRequest
from .analysis import build_analysis, make_offers, BETTING_MODE
from .segmentation import external_lexicon, selection_dictionary
from .store import store
from .starter_stories import CATALOG_PATH, load_precomputed

STORIES = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
STARTER_ANALYSES = load_precomputed()


@asynccontextmanager
async def lifespan(app):
    selection_dictionary()
    external_lexicon()
    store.recover()
    yield


app=FastAPI(title="言葉の取引所 — Prototype B",version="0.1.0",lifespan=lifespan)
if settings.allowed_origins:
    app.add_middleware(CORSMiddleware, allow_origins=settings.allowed_origins, allow_methods=["GET", "POST"], allow_headers=["Content-Type"], allow_credentials=False)


def load(sid):
    try:
        session=store.load(sid)
        if session.get('betting_mode')!=BETTING_MODE:
            raise HTTPException(409,'この物語は旧点数方式です。保存データは残しています。「はじめる」から個数方式で遊んでください。')
        return session
    except FileNotFoundError:
        raise HTTPException(404,"保存された物語が見つかりません。新しく始めてください。") from None


def public(session):
    result={k:v for k,v in session.items() if k!="api_events"}
    result["transactions"]=[{k:v for k,v in t.items() if k!="draft"} for t in session["transactions"]]
    return result


@app.get("/api/health")
def health():
    return {"status":"ok","api_configured":gemini.configured(),"model":settings.model,"betting_mode":BETTING_MODE}


class DrawRequest(BaseModel):
    exclude:list[str]=[]


@app.post("/api/stories/draw")
def draw_stories(request:DrawRequest):
    excluded = set(request.exclude)
    available = [story for story in STORIES if story["id"] not in excluded]
    exhausted = not available
    if exhausted:
        available=STORIES
    return {"stories":secrets.SystemRandom().sample(available,min(3,len(available))),"exhausted":exhausted}


@app.post("/api/sessions",status_code=202)
async def create_session(request:CreateSession):
    sid=request.request_id
    async with store.lock(sid):
        try:
            existing=store.load(sid)
        except FileNotFoundError:
            existing=None
        if existing:
            if existing.get('betting_mode')!=BETTING_MODE:
                raise HTTPException(409,'旧点数方式の開始IDです。新しく「はじめる」から開始してください。')
            if existing["story_id"] != request.story_id:
                raise HTTPException(409,"同じ開始IDで違う物語は開始できません。")
            return public(existing)
        story=next((s for s in STORIES if s["id"]==request.story_id),None)
        if not story:
            raise HTTPException(404,"開始文章が見つかりません。")
        if not gemini.configured():
            raise HTTPException(503,"Gemini APIキーが未設定です。設定してサーバーを再起動してください。")
        starter_analysis = STARTER_ANALYSES.get(story["id"])
        if starter_analysis is None:
            starter_analysis = build_analysis(story["text"], 1)
        analysis = starter_analysis.model_dump()
        session={"betting_mode":BETTING_MODE,"id":sid,"story_id":story["id"],"title":story["title"],"text":story["text"],"version":1,"status":"ready","analysis":analysis,"offers":make_offers(analysis,1,1),"win_probability":settings.win_probability,"transactions":[],"lost_concepts":[],"pending_transaction_id":None,"view":"game","api_calls":0,"api_events":[],"usage":{"input":0,"output":0,"thoughts":0},"model":settings.model,"analysis_attempts":0,"error":None}
        store.save(session)
        return public(session)


@app.get("/api/sessions/{sid}")
def get_session(sid:str):
    return public(load(sid))


@app.post("/api/sessions/{sid}/transactions",status_code=202)
async def trade(sid:str,request:TradeRequest):
    async with store.lock(sid):
        session=load(sid)
        try:
            created=engine.settle_draw(session,request)
        except ValueError as error:
            raise HTTPException(409,str(error)) from None
        if created:
            engine.spawn(engine.process_transaction(sid))
        return public(session)


@app.post("/api/sessions/{sid}/retry",status_code=202)
async def retry(sid:str):
    load(sid)
    try:
        return public(await engine.retry(sid))
    except ValueError as error:
        raise HTTPException(409,str(error)) from None


@app.post("/api/sessions/{sid}/continue")
async def continue_play(sid:str):
    async with store.lock(sid):
        session=load(sid)
        if session["status"] != "ready":
            raise HTTPException(409,"文章の処理が完了していません。")
        session.update(view="game",pending_transaction_id=None)
        store.save(session)
        return public(session)
