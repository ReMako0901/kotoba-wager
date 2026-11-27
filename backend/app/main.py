import json
import secrets
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from .title_words import title_words
from .story_generation import finalize_story, generate_story
from .config import settings
from .engine import engine
from .gemini import GenerationError, gemini
from .models import CreateSession, GameMoveRequest, TradeRequest, StoryChoiceRequest
from .story_progress import update_progress, public_progress, choose_progress
from .analysis import validate_stakes, build_analysis, make_offers, BETTING_MODE
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
    for sid in store.recover():
        engine.spawn(engine.process_transaction(sid))
    yield


app=FastAPI(title="ギャンブルライティングメーカー(仮称)",version="0.1.0",lifespan=lifespan)
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



def load_progress(sid):
    """Call with the session lock held; persist legacy defaults before replying."""
    session = load(sid)
    if "story_progress" not in session:
        update_progress(session)
        store.save(session)
    return session


def public(session):
    if "story_progress" not in session:
        update_progress(session)
    result={k:v for k,v in session.items() if k not in ("api_events", "custom_text")}
    result.setdefault("intro", "")
    result["story_progress"] = public_progress(session)
    result["transactions"]=[{k:v for k,v in t.items() if k!="draft"} for t in session["transactions"]]
    for tx in result['transactions']:
        if tx.get('gamble'):
            tx['gamble'] = {**tx['gamble'], 'rounds': [
                {key: value for key, value in item.items() if key != 'deck'}
                for item in tx['gamble'].get('rounds', [])
            ]}
    return result


app.get("/api/title-words")(title_words)
app.post("/api/stories/generate")(generate_story)
app.post("/api/stories/generated/{story_id}/finalize")(finalize_story)


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


class MarkPreview(BaseModel):
    text: str = Field(min_length=20, max_length=100)


@app.post("/api/stories/mark-preview")
def mark_preview(request: MarkPreview):
    try:
        return build_analysis(request.text, 1)
    except GenerationError as error:
        raise HTTPException(422, str(error)) from None


class MarkSelection(BaseModel):
    unit_ids: list[str] = Field(min_length=1, max_length=1)


@app.post("/api/sessions/{sid}/marks")
async def confirm_marks(sid: str, request: MarkSelection):
    async with store.lock(sid):
        session = load(sid)
        if session.get("initial_mark_ids") == request.unit_ids:
            return public(session)
        if session.get("initial_mark_ids") or session["version"] != 1 or session["transactions"]:
            raise HTTPException(409, "この原稿の印は確定済みです。")
        save_marks(session, request.unit_ids)
        store.save(session)
        return public(session)


def save_marks(session, ids):
    try:
        validate_stakes(session["analysis"], ids, len(ids))
    except ValueError as error:
        raise HTTPException(422, str(error)) from None
    session.update(initial_mark_ids=ids, marked_unit_ids=ids)


@app.post("/api/sessions",status_code=202)
async def create_session(request:CreateSession):
    sid=request.request_id
    story_id = request.story_id if request.custom_text is None else f"custom-{sid}"
    async with store.lock(sid):
        try:
            existing=store.load(sid)
        except FileNotFoundError:
            existing=None
        if existing:
            if existing.get('betting_mode')!=BETTING_MODE:
                raise HTTPException(409,'旧点数方式の開始IDです。新しく「はじめる」から開始してください。')
            if existing["story_id"] != story_id or (
                request.custom_text is not None and (existing.get("custom_text") != request.custom_text or existing.get("intro", "") != request.intro
                    or existing["title"] != (request.title or "自分の物語")
                    or existing.get("generated_story_id") != request.generated_story_id)
            ):
                raise HTTPException(409,"同じ開始IDで違う物語は開始できません。")
            if request.mark_ids is not None and existing.get("initial_mark_ids") != request.mark_ids:
                raise HTTPException(409, "開始時の印が一致しません。")
            update_progress(existing)
            store.save(existing)
            return public(existing)
        story = (
            {"id": story_id, "title": request.title or "自分の物語", "text": request.custom_text, "intro": request.intro}
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
                raise HTTPException(422, "文章が短すぎます。人物や物、様子を表す言葉を足して、もう一度入力してください") from error
        if request.custom_text is not None and sum(unit.stakeable for unit in starter_analysis.units) < 3:
            raise HTTPException(422, "文章が短すぎます。人物や物、様子を表す言葉を足して、もう一度入力してください")
        analysis = starter_analysis.model_dump()
        session={"betting_mode":BETTING_MODE,"id":sid,"story_id":story["id"],"title":story["title"],"intro":story.get("intro", ""),"text":story["text"],"version":1,"status":"ready","analysis":analysis,"offers":make_offers(analysis,1,1),"win_probability":settings.win_probability,"transactions":[],"lost_concepts":[],"pending_transaction_id":None,"view":"game","api_calls":0,"api_events":[],"usage":{"input":0,"output":0,"thoughts":0},"model":settings.model,"analysis_attempts":0,"error":None}
        if request.mark_ids is not None:
            save_marks(session, request.mark_ids)
        if request.custom_text is not None:
            session["custom_text"] = request.custom_text
            if request.generated_story_id:
                session["generated_story_id"] = request.generated_story_id
        update_progress(session)
        store.save(session)
        return public(session)


@app.get("/api/sessions/{sid}")
async def get_session(sid:str):
    session = load(sid)
    if "story_progress" in session:
        return public(session)
    # Only legacy migration needs the lock; normal polling must not wait for generation.
    async with store.lock(sid):
        session = load_progress(sid)
        if "story_progress" not in session:
            update_progress(session)
            store.save(session)
        return public(session)


@app.post("/api/sessions/{sid}/transactions",status_code=202)
async def trade(sid:str,request:TradeRequest):
    async with store.lock(sid):
        session=load_progress(sid)
        update_progress(session)
        try:
            if not session["transactions"] and len(session.get("initial_mark_ids", [])) != 1:
                raise ValueError("開始前に言葉を1つ選んで印をつけてください。")
            generate=engine.settle_draw(session,request)
        except ValueError as error:
            raise HTTPException(409,str(error)) from None
        if generate:
            engine.spawn(engine.process_transaction(sid))
        return public(session)


@app.post("/api/sessions/{sid}/transactions/{transaction_id}/play", status_code=202)
async def play_game(sid: str, transaction_id: str, request: GameMoveRequest):
    async with store.lock(sid):
        session = load_progress(sid)
        update_progress(session)
        try:
            settled = engine.apply_game_move(session, transaction_id, request)
        except ValueError as error:
            raise HTTPException(409, str(error)) from None
        if settled:
            engine.spawn(engine.process_transaction(sid))
        return public(session)


@app.post("/api/sessions/{sid}/transactions/{transaction_id}/finish")
async def finish_gamble(sid: str, transaction_id: str):
    await get_session(sid)
    try:
        return public(await engine.finish_gamble(sid, transaction_id))
    except ValueError as error:
        raise HTTPException(409, str(error)) from None


@app.post("/api/sessions/{sid}/retry",status_code=202)
async def retry(sid:str):
    await get_session(sid)
    try:
        return public(await engine.retry(sid))
    except ValueError as error:
        raise HTTPException(409,str(error)) from None


@app.post("/api/sessions/{sid}/continue")
async def continue_play(sid:str):
    async with store.lock(sid):
        session=load_progress(sid)
        update_progress(session)
        if session["story_progress"]["phase"] in ("escapable", "ended"):
            raise HTTPException(409,"脱出・継続の選択が必要か、すでに終了しています。")
        if session["status"] != "ready":
            raise HTTPException(409,"文章の処理が完了していません。")
        session.update(view="game",pending_transaction_id=None)
        store.save(session)
        return public(session)


@app.post("/api/sessions/{sid}/story-choice")
async def story_choice(sid: str, request: StoryChoiceRequest):
    async with store.lock(sid):
        session = load_progress(sid)
        try:
            choose_progress(session, request)
        except ValueError as error:
            raise HTTPException(409, str(error)) from None
        store.save(session)
        return public(session)
