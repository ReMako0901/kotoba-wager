import asyncio
import secrets
from copy import deepcopy
from .analysis import build_analysis, make_offers, validate_stakes, BETTING_MODE
from .config import settings
from .gemini import gemini, EditRejected, GenerationError, ReviewRejected
from .store import store
from .quota import reserve_call
from .gambles import make_gamble


class GameEngine:
    def __init__(self, repository=store, ai=gemini, draw=None):
        self.store = repository
        self.ai = ai
        self.draw = draw or (lambda probability: secrets.randbelow(1_000_000) < probability * 1_000_000)
        self.tasks = set()

    def spawn(self, coroutine):
        task = asyncio.create_task(coroutine)
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)

    async def call(self, session, method, *args, **kwargs):
        session["api_calls"] += 1
        self.store.save(session)
        await reserve_call()
        result = await method(*args, **kwargs)
        for k in session["usage"]:
            session["usage"][k] += result.usage.get(k, 0)
        session["api_events"].append({"operation":method.__name__,"usage":result.usage,"elapsed_seconds":result.elapsed_seconds})
        self.store.save(session)
        return result.value

    async def prepare_initial(self, sid):
        async with self.store.lock(sid):
            session = self.store.load(sid)
            try:
                session["analysis_attempts"] += 1
                self.store.save(session)
                analysis = build_analysis(session['text'],session['version']).model_dump()
                session.update(analysis=analysis, offers=make_offers(analysis,1,session['version']), status='ready', error=None, betting_mode=BETTING_MODE)
            except GenerationError as error:
                session.update(status="error", error=str(error))
            except Exception:
                session.update(status="error", error="解析中に予期しないエラーが発生しました。本文を保護しました。")
            self.store.save(session)

    def settle_draw(self, session, request):
        """Caller holds session lock. Persist the draw before any generation."""
        existing = next((tx for tx in session["transactions"] if tx["id"]==request.request_id), None)
        if existing:
            if (existing["unit_ids"] != request.unit_ids or existing["offer"]["id"] != request.offer_id
                    or existing.get("gamble", {}).get("kind") != request.game):
                raise ValueError("同じ取引IDで異なる内容を送信できません。")
            return False
        if session["status"] != "ready" or session["view"] == "result" or session.get("pending_transaction_id"):
            raise ValueError("前の取引の処理または結果確認が終わっていません。")
        if session["version"] != request.version:
            raise ValueError("本文の版が更新されています。選び直してください。")
        offer = next((o for o in session["offers"] if o["id"]==request.offer_id),None)
        if offer is None:
            raise ValueError("報酬が更新されています。選び直してください。")
        units = validate_stakes(session["analysis"],request.unit_ids,offer["required_count"])
        gamble = make_gamble(request.game, self.draw) if request.game else None
        outcome = gamble['outcome'] if gamble else "win" if self.draw(session["win_probability"]) else "loss"
        tx = {"id":request.request_id,"source_version":session["version"],"status":"generating","outcome":outcome,"offer":deepcopy(offer),"unit_ids":request.unit_ids,"wager_count":len(units),"stakes":[u["text"] for u in units],"selected_units":deepcopy(units),"staked_concepts":[],"lost":[],"meanings_resolved":False,"before":session["text"],"attempts":0}
        if gamble:
            tx['gamble'] = gamble
            tx['presentation_completed'] = False
            tx['offer']['narrative_change'] = {'strength': gamble['strength'], 'outcome': outcome}
        session["transactions"].append(tx)
        session.update(status="generating",pending_transaction_id=tx["id"],error=None)
        self.store.save(session)
        return True

    async def process_transaction(self,sid):
        async with self.store.lock(sid):
            session=self.store.load(sid)
            tx=next(t for t in session["transactions"] if t["id"]==session["pending_transaction_id"])
            if tx["status"] == "committed":
                return
            try:
                tx["attempts"] += 1
                tx["status"]="generating"
                self.store.save(session)
                if not tx.get("meanings_resolved"):
                    resolution=await self.call(session,self.ai.resolve_stakes,tx['before'],tx['selected_units'],session['lost_concepts'])
                    tx['staked_concepts']=[c.model_dump() for c in resolution.concepts]
                    tx['lost']=deepcopy(tx['staked_concepts']) if tx['outcome']=='loss' else []
                    tx['meanings_resolved']=True
                    self.store.save(session)
                if not tx.get("draft"):
                    edited = await self.edit_and_review(session, tx)
                    # All next-round chips are local. Verify playability before
                    # caching the draft so a bad proposal can be regenerated manually.
                    build_analysis(edited.text,session['version']+1)
                    tx["draft"]=edited.model_dump()
                    self.store.save(session)
                if tx.get('gamble') and not tx.get('presentation_completed'):
                    tx['status'] = 'prepared'
                    session.update(status='awaiting_reveal', error=None)
                else:
                    self.commit_transaction(session, tx)
            except GenerationError as error:
                tx.update(status="error",error=str(error))
                session.update(status="error",error=str(error))
            except Exception:
                tx.update(status="error",error="文章の反映中に予期しないエラーが発生しました。")
                session.update(status="error",error=tx["error"])
            self.store.save(session)

    async def edit_and_review(self, session, tx):
        outcome = tx["outcome"]
        original = tx["before"]
        offer = tx["offer"]
        stakes = tx["staked_concepts"]
        lost = session["lost_concepts"]
        feedback = {}
        for attempt in range(2):
            candidate = None
            try:
                if outcome == "win":
                    candidate = await self.call(session, self.ai.win, original, offer, stakes, lost, **feedback)
                else:
                    loss_args = (original, stakes, lost, [])
                    if tx.get("gamble"):
                        loss_args += (offer["narrative_change"],)
                    candidate = await self.call(session, self.ai.loss, *loss_args, **feedback)
                if feedback and candidate.text == feedback["previous_review"].get("rejected_text"):
                    raise ReviewRejected("不採用になった本文と同じ文章が返りました。")
                edited = await self.call(session, self.ai.review, original, candidate, outcome, offer, stakes, lost)
                if edited.text == original:
                    raise ReviewRejected("編集後の本文が原文と同じです。")
                if outcome == "win" and not lost:
                    edited.checks.lost_absent = True
                if not edited.checks.lost_absent:
                    raise ReviewRejected("消失設定が本文に残っています。")
                if outcome == "win" and not (edited.checks.protected_retained and edited.checks.reward_realized):
                    raise ReviewRejected("賭けた設定の保持または報酬の実現を確認できません。")
                if outcome == "loss" and edited.checks.reward_realized:
                    raise ReviewRejected("敗北時に報酬が反映されています。")
                return edited
            except EditRejected as error:
                if attempt == 1:
                    raise GenerationError("本文を自動で作り直しましたが、確認を通りませんでした。元の本文と勝敗は保存されています。") from error
                previous_review = {"reason": str(error)}
                if candidate is not None:
                    previous_review["rejected_text"] = candidate.text
                feedback = {"previous_review": previous_review}

    def commit_transaction(self, session, tx):
        draft=tx["draft"]
        lost=deepcopy(session["lost_concepts"])
        for c in tx["lost"]:
            lost.append({**c,"transaction_id":tx["id"],"source_version":tx["source_version"]})
        version=session["version"]+1
        analysis=build_analysis(draft['text'],version).model_dump()
        completed=sum(t["status"]=="committed" for t in session["transactions"])+1
        offers=make_offers(analysis,completed+1,version)
        tx.update(status="committed",after=draft["text"],summary=draft["summary"],changes=draft["changes"],checks=draft["checks"],error=None)
        tx.pop("draft",None)
        session.update(text=tx["after"],version=version,analysis=analysis,offers=offers,lost_concepts=lost,status="ready",view="result",error=None)

    async def finish_gamble(self, sid, transaction_id):
        async with self.store.lock(sid):
            session = self.store.load(sid)
            tx = next((t for t in session['transactions'] if t['id'] == transaction_id), None)
            if tx is None or not tx.get('gamble'):
                raise ValueError('開始済みのギャンブルが見つかりません。')
            if tx['status'] == 'committed':
                return session
            if session.get('pending_transaction_id') != transaction_id:
                raise ValueError('別の取引が進行中です。')
            tx['presentation_completed'] = True
            if tx['status'] == 'prepared':
                self.commit_transaction(session, tx)
            self.store.save(session)
            return session

    async def retry(self,sid):
        async with self.store.lock(sid):
            session=self.store.load(sid)
            if session["status"] != "error":
                raise ValueError("現在は再試行が必要な状態ではありません。")
            tx=next((t for t in session["transactions"] if t["id"]==session.get("pending_transaction_id")),None)
            attempts=tx["attempts"] if tx else session["analysis_attempts"]
            if attempts >= settings.max_attempts:
                raise ValueError("試作用の再試行上限（3回）です。本文と勝敗は保存されています。設定と生成結果を確認してください。")
            session["status"]="generating" if tx else "analyzing"
            session["error"]=None
            self.store.save(session)
            self.spawn(self.process_transaction(sid) if tx else self.prepare_initial(sid))
            return session


engine=GameEngine()
