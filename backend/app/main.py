import json
import secrets
from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI, Header, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from .config import settings
from .engine import GenerationBusy, engine, generation_target
from .generation_tasks import INTERNAL_PATH, GenerationTask, authenticate, dispatch
from .gemini import GenerationError, gemini
from .models import CreateSession, GameMoveRequest, TradeRequest
from .analysis import build_analysis, make_offers, BETTING_MODE
from .segmentation import external_lexicon, selection_dictionary
from .store import store
from .gambles import GAMES
from .starter_stories import CATALOG_PATH, load_precomputed

STORIES = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
STARTER_ANALYSES = load_precomputed()


@asynccontextmanager
async def lifespan(app):
    selection_dictionary()
    external_lexicon()
    for sid in await store.recover_pending():
        try:
            session = await store.read(sid)
        except FileNotFoundError:
            continue
        await dispatch(engine, session, generation_target(session), recovering=True)
    yield


app=FastAPI(title="ギャンブルライティングメーカー(仮称)",version="0.1.0",lifespan=lifespan)
if settings.allowed_origins:
    app.add_middleware(CORSMiddleware, allow_origins=settings.allowed_origins, allow_methods=["GET", "POST"], allow_headers=["Content-Type"], allow_credentials=False)


def validate_session(session):
    if session is None:
        raise HTTPException(404,"保存された物語が見つかりません。新しく始めてください。")
    if session.get('betting_mode') != BETTING_MODE:
        raise HTTPException(409,'この物語は旧点数方式です。保存データは残しています。「はじめる」から個数方式で遊んでください。')
    return session


async def load(sid):
    try:
        return validate_session(await store.read(sid))
    except FileNotFoundError:
        return validate_session(None)


def public(session):
    result={k:v for k,v in session.items() if not k.startswith("_") and k not in ("api_events", "custom_text")}
    result["transactions"]=[{k:v for k,v in t.items() if k!="draft"} for t in session["transactions"]]
    for tx in result['transactions']:
        if tx.get('gamble'):
            tx['gamble'] = {**tx['gamble'], 'rounds': [
                {key: value for key, value in item.items() if key != 'deck'}
                for item in tx['gamble'].get('rounds', [])
            ]}
    return result


@app.get("/api/health")
def health():
    return {"status":"ok","api_configured":gemini.configured(),"model":settings.model,"betting_mode":BETTING_MODE}


@app.get("/api/games")
def games():
    return {"games": GAMES}


class DrawRequest(BaseModel):
    exclude:list[str]=[]
    count: int = Field(default=3, ge=1, le=5)


@app.post("/api/stories/draw")
def draw_stories(request:DrawRequest):
    excluded = set(request.exclude)
    available = [story for story in STORIES if story["id"] not in excluded]
    exhausted = not available
    if exhausted:
        available=STORIES
    return {"stories":secrets.SystemRandom().sample(available,min(request.count,len(available))),"exhausted":exhausted}


@app.post("/api/sessions",status_code=202)
async def create_session(request:CreateSession):
    sid=request.request_id
    story_id = request.story_id if request.custom_text is None else f"custom-{sid}"
    def create(existing):
        if existing:
            if existing.get('betting_mode')!=BETTING_MODE:
                raise HTTPException(409,'旧点数方式の開始IDです。新しく「はじめる」から開始してください。')
            if existing["story_id"] != story_id or (
                request.custom_text is not None and existing.get("custom_text") != request.custom_text
            ):
                raise HTTPException(409,"同じ開始IDで違う物語は開始できません。")
            return None, public(existing)
        story = (
            {"id": story_id, "title": "自分の物語", "text": request.custom_text}
            if request.custom_text is not None
            else next((s for s in STORIES if s["id"] == story_id), None)
        )
        if not story:
            raise HTTPException(404,"開始文章が見つかりません。")
        starter_analysis = STARTER_ANALYSES.get(story["id"])
        if starter_analysis is None:
            try:
                starter_analysis = build_analysis(story["text"], 1)
            except GenerationError as error:
                if request.custom_text is None:
                    raise
                raise HTTPException(422, "賭けられることばが見つかりません。人物や物、場所を入れてください。") from error
        analysis = starter_analysis.model_dump()
        session={"betting_mode":BETTING_MODE,"id":sid,"story_id":story["id"],"title":story["title"],"text":story["text"],"version":1,"status":"ready","analysis":analysis,"offers":make_offers(analysis,1,1),"win_probability":settings.win_probability,"transactions":[],"lost_concepts":[],"pending_transaction_id":None,"view":"game","api_calls":0,"api_events":[],"usage":{"input":0,"output":0,"thoughts":0},"model":settings.model,"analysis_attempts":0,"error":None}
        if request.custom_text is not None:
            session["custom_text"] = request.custom_text
        return session, public(session)

    return await store.mutate(sid, create)


@app.get("/api/sessions/{sid}")
async def get_session(sid: str):
    session = await load(sid)
    if settings.generation_tasks_mode == "cloud":
        await dispatch(engine, session, generation_target(session))
    return public(session)


@app.post("/api/sessions/{sid}/transactions",status_code=202)
async def trade(sid:str,request:TradeRequest):
    try:
        session, generate, target = await engine.start_trade(sid, request, validate_session)
    except FileNotFoundError:
        return validate_session(None)
    except ValueError as error:
        raise HTTPException(409, str(error)) from None
    await dispatch(engine, session, target, fresh=generate)
    return public(session)


@app.post("/api/sessions/{sid}/transactions/{transaction_id}/play", status_code=202)
async def play_game(sid: str, transaction_id: str, request: GameMoveRequest):
    try:
        session, settled, target = await engine.make_move(sid, transaction_id, request, validate_session)
    except FileNotFoundError:
        return validate_session(None)
    except ValueError as error:
        raise HTTPException(409, str(error)) from None
    await dispatch(engine, session, target, fresh=settled)
    return public(session)


@app.post("/api/sessions/{sid}/transactions/{transaction_id}/finish")
async def finish_gamble(sid: str, transaction_id: str):
    try:
        return public(await engine.finish_gamble(sid, transaction_id, validate_session))
    except FileNotFoundError:
        return validate_session(None)
    except ValueError as error:
        raise HTTPException(409, str(error)) from None


@app.post("/api/sessions/{sid}/retry", status_code=202)
async def retry(sid: str):
    try:
        session, target = await engine.prepare_retry(sid, validate_session)
    except FileNotFoundError:
        return validate_session(None)
    except ValueError as error:
        raise HTTPException(409, str(error)) from None
    await dispatch(engine, session, target, fresh=True)
    return public(session)


@app.post("/api/sessions/{sid}/continue")
async def continue_play(sid: str):
    def change(session):
        session = validate_session(session)
        if session["status"] != "ready":
            raise HTTPException(409, "文章の処理が完了していません。")
        session.update(view="game", pending_transaction_id=None)
        return session, public(session)

    try:
        return await store.mutate(sid, change)
    except FileNotFoundError:
        return validate_session(None)


async def authenticate_generation(authorization: str | None = Header(default=None)):
    await authenticate(authorization)


@app.post(INTERNAL_PATH, status_code=204, include_in_schema=False,
          dependencies=[Depends(authenticate_generation)])
async def process_generation(task: GenerationTask):
    try:
        if task.kind == "transaction":
            await engine.process_transaction(task.session_id, task.target)
        else:
            await engine.prepare_initial(task.session_id, task.target)
    except GenerationBusy:
        # A previous delivery still holds the lease. Ask Cloud Tasks to retry
        # in case that delivery died and its lease needs to be reclaimed.
        raise HTTPException(503, "Generation already in progress", headers={"Retry-After": "10"}) from None
    return Response(status_code=204)
