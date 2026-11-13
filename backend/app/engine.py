import asyncio
import hmac
import random
import secrets
from copy import deepcopy
from time import time
from .analysis import build_analysis, make_offers, validate_stakes, BETTING_MODE
from .config import settings
from .gemini import gemini, EditBudgetExceeded, EditRejected, GenerationError, ReviewRejected
from .store import store
from .quota import reserve_call
from .gambles import BEGINNER_GAMES, make_gamble, play_beginner_game
from .story_fallback import complete_story, local_concepts

STORY_GENERATION_TIMEOUT = 24
# Longer than the generation deadline. A reclaimed job uses the existing
# same-outcome fallback instead of reissuing potentially billed requests.
GENERATION_LEASE_SECONDS = 90


class GenerationBusy(RuntimeError):
    pass


class GenerationSuperseded(RuntimeError):
    pass


def require_session(session):
    if session is None:
        raise FileNotFoundError
    return session


def pending_transaction(session):
    return next((tx for tx in session["transactions"]
                 if tx["id"] == session.get("pending_transaction_id")), None)


def wager_random(session, *parts):
    seed = session.get("_wager_seed")
    if seed is None:
        return None
    message = ":".join(map(str, parts)).encode()
    return random.Random(hmac.digest(bytes.fromhex(seed), message, "sha256"))


def generation_target(session):
    if session["status"] == "analyzing":
        return ("initial", None, session.get("_job_epoch", 0))
    tx = pending_transaction(session)
    if session["status"] == "generating" and tx and tx["outcome"] is not None:
        return ("transaction", tx["id"], session.get("_job_epoch", 0))
    return None



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

    async def call(self, context, method, *args, **kwargs):
        def begin(session, tx):
            session["api_calls"] += 1
            return session["api_calls"]

        call_number = await self.update_generation(context, begin)
        await reserve_call()
        result = await method(*args, **kwargs)

        def record(session, tx):
            for key in session["usage"]:
                session["usage"][key] += result.usage.get(key, 0)
            event = {"operation": method.__name__, "usage": result.usage,
                     "elapsed_seconds": result.elapsed_seconds}
            event["call"] = call_number
            session["api_events"].append(event)

        await self.update_generation(context, record)
        return result.value

    async def update_generation(self, context, change):
        sid, target, owner = context

        def update(session):
            if session is None or generation_target(session) != target or session.get("_generation_claim", {}).get("owner") != owner:
                raise GenerationSuperseded
            return session, change(session, pending_transaction(session))

        return await self.store.mutate(sid, update)

    async def claim_generation(self, sid, target):
        owner = secrets.token_hex(16)

        def claim(session):
            if session is None or generation_target(session) != target:
                return None, None
            lease = session.get("_generation_claim")
            if lease and lease["expires"] > time():
                raise GenerationBusy
            session["_generation_claim"] = {"owner": owner, "expires": time() + GENERATION_LEASE_SECONDS}
            tx = pending_transaction(session)
            if tx is not None:
                tx["attempts"] += 1
            else:
                session["analysis_attempts"] += 1
            return session, (session, bool(lease))

        claimed = await self.store.mutate(sid, claim)
        if claimed is None:
            return None
        session, interrupted = claimed
        return (sid, target, owner), session, interrupted

    async def prepare_initial(self, sid, target=None):
        if target is None:
            target = generation_target(await self.store.read(sid))
        if not target or target[0] != "initial":
            return
        claimed = await self.claim_generation(sid, target)
        if claimed is None:
            return
        context, _, _ = claimed

        def prepare(session, tx):
            try:
                analysis = build_analysis(session["text"], session["version"]).model_dump()
                session.update(analysis=analysis, offers=make_offers(analysis, 1, session["version"]),
                               status="ready", error=None, betting_mode=BETTING_MODE)
            except GenerationError as error:
                session.update(status="error", error=str(error))
            except Exception:
                session.update(status="error", error="解析中に予期しないエラーが発生しました。本文を保護しました。")
            session.pop("_generation_claim", None)

        await self.update_generation(context, prepare)

    async def start_trade(self, sid, request, validate=require_session):
        # The SDK may replay this callback on contention. Reuse any random
        # plan from the first valid attempt instead of sampling again.
        plan = None

        def sample(session):
            nonlocal plan
            if plan is None:
                rng = wager_random(session, "trade", request.request_id)
                draw = self.draw if rng is None else lambda chance: rng.randrange(1_000_000) < chance * 1_000_000
                gamble = make_gamble(request.game, draw, rng) if request.game else None
                outcome = gamble["outcome"] if gamble else "win" if draw(session["win_probability"]) else "loss"
                plan = gamble, outcome
            return deepcopy(plan)

        def change(session):
            session = validate(session)
            before = len(session["transactions"])
            generate = self.settle_draw(session, request, save=False, sample=sample)
            target = generation_target(session)
            pending = target if target and target[1] == request.request_id else None
            return (session if len(session["transactions"]) != before else None), (session, generate, pending)

        return await self.store.mutate(sid, change)

    async def make_move(self, sid, transaction_id, request, validate=require_session):
        sampled_game = None

        def change(session):
            nonlocal sampled_game
            session = validate(session)

            def play(game):
                nonlocal sampled_game
                if sampled_game is None:
                    rng = wager_random(session, "move", transaction_id, request.attempt)
                    play_beginner_game(game, request.choice, rng)
                    sampled_game = deepcopy(game)
                else:
                    game.update(deepcopy(sampled_game))

            tx = next((item for item in session["transactions"] if item["id"] == transaction_id), None)
            before = len(tx["gamble"]["moves"]) if tx and tx.get("gamble", {}).get("kind") in BEGINNER_GAMES else 0
            settled = self.apply_game_move(session, transaction_id, request, save=False, play=play)
            target = generation_target(session)
            pending = target if target and target[1] == transaction_id else None
            return (session if request.attempt == before else None), (session, settled, pending)

        return await self.store.mutate(sid, change)

    def settle_draw(self, session, request, *, save=True, sample=None):
        """Persist the wager under the session lock. Return whether generation can start."""
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
        if sample is not None:
            gamble, outcome = sample(session)
        else:
            gamble = make_gamble(request.game, self.draw) if request.game else None
            outcome = gamble["outcome"] if gamble else "win" if self.draw(session["win_probability"]) else "loss"
        tx = {"id":request.request_id,"source_version":session["version"],"status":"generating","outcome":outcome,"offer":deepcopy(offer),"unit_ids":request.unit_ids,"wager_count":len(units),"stakes":[u["text"] for u in units],"selected_units":deepcopy(units),"staked_concepts":[],"lost":[],"meanings_resolved":False,"before":session["text"],"attempts":0}
        if gamble:
            tx['gamble'] = gamble
            tx['presentation_completed'] = False
            if outcome is not None:
                tx['offer']['narrative_change'] = {'strength': gamble['strength'], 'outcome': outcome}
        session["transactions"].append(tx)
        if outcome is None:
            tx['status'] = 'awaiting_play'
        session.update(status=tx['status'], pending_transaction_id=tx['id'], error=None)
        if save:
            self.store.save(session)
        return outcome is not None

    def apply_game_move(self, session, transaction_id, request, *, save=True, play=None):
        tx = next((item for item in session['transactions'] if item['id'] == transaction_id), None)
        game = tx.get('gamble') if tx else None
        if not game or game['kind'] not in BEGINNER_GAMES:
            raise ValueError('操作できるゲームが見つかりません。')
        attempt = len(game['moves'])
        if request.attempt < attempt:
            return False
        if request.attempt != attempt or tx['status'] != 'awaiting_play' or session.get('pending_transaction_id') != transaction_id:
            raise ValueError('現在の手番を確認してください。')
        if play is None:
            play_beginner_game(game, request.choice)
        else:
            play(game)
        outcome = game['outcome']
        if outcome is not None:
            tx.update(outcome=outcome, status='generating')
            tx['offer']['narrative_change'] = {'strength': game['strength'], 'outcome': outcome}
            session.update(status='generating', error=None)
        if save:
            self.store.save(session)
        return outcome is not None

    async def process_transaction(self, sid, target=None):
        if target is None:
            target = generation_target(await self.store.read(sid))
        if not target or target[0] != "transaction":
            return
        claimed = await self.claim_generation(sid, target)
        if claimed is None:
            return
        context, session, interrupted = claimed
        tx = pending_transaction(session)
        try:
            if tx.get("draft"):
                edited = None
            elif interrupted:
                edited = self.fallback(tx, session)
            else:
                try:
                    edited = await asyncio.wait_for(
                        self.generate_story(context, session, tx), timeout=STORY_GENERATION_TIMEOUT,
                    )
                except (GenerationError, TimeoutError):
                    edited = self.fallback(tx, session)

            def finish(current, live_tx):
                if edited is not None:
                    live_tx["draft"] = edited.model_dump()
                for key in ("meanings_resolved", "staked_concepts", "lost", "used_fallback"):
                    if key in tx:
                        live_tx[key] = tx[key]
                if live_tx.get("gamble") and not live_tx.get("presentation_completed"):
                    live_tx["status"] = "prepared"
                    current.update(status="awaiting_reveal", error=None)
                else:
                    self.commit_transaction(current, live_tx)
                current.pop("_generation_claim", None)

            await self.update_generation(context, finish)
        except GenerationSuperseded:
            return
        except Exception as error:
            def fail(current, live_tx):
                message = str(error) if isinstance(error, GenerationError) else "文章の反映中に予期しないエラーが発生しました。"
                live_tx.update(status="error", error=message)
                current.update(status="error", error=message)
                current.pop("_generation_claim", None)

            try:
                await self.update_generation(context, fail)
            except GenerationSuperseded:
                return

    @staticmethod
    def fallback(tx, session):
        if not tx.get("meanings_resolved"):
            tx["staked_concepts"] = local_concepts(tx["selected_units"])
            if tx["outcome"] == "loss":
                tx["lost"] = deepcopy(tx["staked_concepts"])
            tx["meanings_resolved"] = True
        tx["used_fallback"] = True
        return complete_story(tx, session["lost_concepts"])

    async def generate_story(self, context, session, tx):
        if not tx.get("meanings_resolved"):
            resolution = await self.call(context, self.ai.resolve_stakes, tx["before"], tx["selected_units"], session["lost_concepts"])
            tx["staked_concepts"] = [concept.model_dump() for concept in resolution.concepts]
            tx["lost"] = deepcopy(tx["staked_concepts"]) if tx["outcome"] == "loss" else []
            tx["meanings_resolved"] = True
            def remember(current, live_tx):
                for key in ("meanings_resolved", "staked_concepts", "lost"):
                    live_tx[key] = tx[key]

            await self.update_generation(context, remember)
        edited = await self.edit_and_review(context, session, tx)
        build_analysis(edited.text, session["version"] + 1)
        return edited

    async def edit_and_review(self, context, session, tx):
        outcome = tx["outcome"]
        original = tx["before"]
        offer = tx["offer"]
        stakes = tx["staked_concepts"]
        lost = session["lost_concepts"]
        feedback = {}
        relaxed = False
        for attempt in range(2):
            candidate = None
            try:
                if outcome == "win":
                    candidate = await self.call(context, self.ai.win, original, offer, stakes, lost, **feedback)
                else:
                    loss_args = (original, stakes, lost, [])
                    if tx.get("gamble"):
                        loss_args += (offer["narrative_change"],)
                    candidate = await self.call(context, self.ai.loss, *loss_args, **feedback)
                if feedback and candidate.text == feedback["previous_review"].get("rejected_text"):
                    raise ReviewRejected("不採用になった本文と同じ文章が返りました。")
                review_options = {"relax_budget": True} if relaxed else {}
                edited = await self.call(context, self.ai.review, original, candidate, outcome, offer, stakes, lost, **review_options)
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
                relaxed = isinstance(error.__cause__, EditBudgetExceeded)
                previous_review = {"reason": str(error)}
                if relaxed:
                    previous_review["relax_budget"] = True
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

    async def finish_gamble(self, sid, transaction_id, validate=require_session):
        def change(session):
            session = validate(session)
            tx = next((t for t in session["transactions"] if t["id"] == transaction_id), None)
            if tx is None or not tx.get("gamble"):
                raise ValueError("開始済みのギャンブルが見つかりません。")
            if tx["status"] == "committed":
                return None, session
            if session.get("pending_transaction_id") != transaction_id:
                raise ValueError("別の取引が進行中です。")
            if tx["status"] == "awaiting_play":
                raise ValueError("ゲームの結果がまだ決まっていません。")
            tx["presentation_completed"] = True
            if tx["status"] == "prepared":
                self.commit_transaction(session, tx)
            return session, session

        return await self.store.mutate(sid, change)

    async def prepare_retry(self, sid, validate=require_session):
        def change(session):
            session = validate(session)
            if session["status"] != "error":
                target = generation_target(session)
                if target and session.get("_job_epoch", 0) and settings.generation_tasks_mode == "cloud":
                    return None, (session, target)
                raise ValueError("現在は再試行が必要な状態ではありません。")
            tx = pending_transaction(session)
            attempts = tx["attempts"] if tx else session["analysis_attempts"]
            if attempts >= settings.max_attempts:
                raise ValueError("試作用の再試行上限（3回）です。本文と勝敗は保存されています。設定と生成結果を確認してください。")
            session["status"] = "generating" if tx else "analyzing"
            if tx:
                tx["status"] = "generating"
            session["error"] = None
            session["_job_epoch"] = session.get("_job_epoch", 0) + 1
            session.pop("_generation_claim", None)
            session.pop("_enqueued_job", None)
            return session, (session, generation_target(session))

        return await self.store.mutate(sid, change)

    async def retry(self, sid):
        session, target = await self.prepare_retry(sid)
        self.spawn(self.process_transaction(sid, target) if target[0] == "transaction"
                   else self.prepare_initial(sid, target))
        return session


engine = GameEngine()
