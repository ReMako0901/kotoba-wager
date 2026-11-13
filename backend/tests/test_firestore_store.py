"""Integration tests: only connect to an explicitly configured local emulator."""
import asyncio
import os
from uuid import uuid4

import httpx
import pytest

from app import generation_tasks, main, quota
from app.config import settings
from app.engine import GameEngine, generation_target, wager_random
from app.gemini import GenerationError
from app.store import StaleSession, Store
from test_engine import AI, BEFORE

HOST = os.environ.get("FIRESTORE_EMULATOR_HOST")
emulated = pytest.mark.skipif(not HOST, reason="FIRESTORE_EMULATOR_HOST is not set")


@pytest.fixture
def firestore_repo():
    from google.cloud import firestore
    from app.firestore_store import FirestoreStore

    project = "demo-kotoba-" + uuid4().hex[:12]
    client = firestore.Client(project=project)
    yield FirestoreStore(client)
    httpx.delete(f"http://{HOST}/emulator/v1/projects/{project}/databases/(default)/documents", timeout=10).raise_for_status()
    client.close()


def wire(monkeypatch, repo, mode):
    ai = AI()
    draws = []
    engine = GameEngine(repo, ai, lambda chance: draws.append(chance) or True)
    monkeypatch.setattr(main, "store", repo)
    monkeypatch.setattr(main, "engine", engine)
    monkeypatch.setattr(settings, "generation_tasks_mode", mode)
    monkeypatch.setattr(settings, "daily_call_limit", 0)
    return engine, ai, draws


async def start(client):
    response = await client.post("/api/sessions", json={"custom_text": BEFORE, "request_id": "example-session"})
    assert response.status_code == 202
    session = response.json()
    assert session["status"] == "ready" and session["api_calls"] == 0
    for unit in session["analysis"]["units"]:
        assert session["text"][unit["start"]:unit["end"]] == unit["text"]
    offer = session["offers"][0]
    wager = {
        "request_id": "request-0001", "version": 1, "offer_id": offer["id"],
        "unit_ids": [unit["id"] for unit in session["analysis"]["units"] if unit["stakeable"]][:offer["required_count"]],
        "game": "slot",
    }
    return f"/api/sessions/{session['id']}", wager


async def reveal(client, path, tx_id):
    response = await client.post(f"{path}/transactions/{tx_id}/finish")
    assert response.status_code == 200
    return response.json()


def test_file_inline_cycle(tmp_path, monkeypatch):
    engine, ai, draws = wire(monkeypatch, Store(tmp_path), "inline")

    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
            path, wager = await start(client)
            start_response = await client.post(path + "/transactions", json=wager)
            assert start_response.status_code == 202
            await asyncio.gather(*engine.tasks)
            assert (await client.get(path)).json()["status"] == "awaiting_reveal"
            result = await reveal(client, path, wager["request_id"])
            assert result["version"] == 2 and result["view"] == "result"
            assert result["transactions"][0]["outcome"] == "win"
            assert result["text"] != BEFORE
            replay = await client.post(path + "/transactions", json=wager)
            assert replay.status_code == 202
            assert replay.json()["transactions"][0]["outcome"] == "win"
            next_round = await client.post(path + "/continue")
            assert next_round.json()["view"] == "game" and next_round.json()["offers"]

    asyncio.run(run())
    assert draws == [.5] and ai.rewrites == 1


@emulated
def test_firestore_replay_stale_version_and_concurrent_delivery(firestore_repo, monkeypatch):
    from app.firestore_store import FirestoreStore

    engine, ai, draws = wire(monkeypatch, firestore_repo, "cloud")
    second = FirestoreStore(firestore_repo.client)
    worker = GameEngine(second, ai, engine.draw)
    enqueued = {}
    enqueue_calls = []
    monkeypatch.setattr(settings, "tasks_target_url", "https://example.run.app")
    monkeypatch.setattr(generation_tasks, "verify_token", lambda token, aud: {
        "email": settings.tasks_service_account if token == "valid" else "other@example.com",
        "email_verified": True,
    })

    def fake_enqueue(task):
        enqueue_calls.append(task.key)
        if len(enqueue_calls) == 1:
            raise OSError("queue temporarily unavailable")
        enqueued[task.key] = task.model_dump()

    monkeypatch.setattr(generation_tasks, "enqueue", fake_enqueue)
    original_resolve = ai.resolve_stakes

    async def run():
        started = asyncio.Event()
        release = asyncio.Event()

        async def hold(*args):
            started.set()
            await release.wait()
            return await original_resolve(*args)

        monkeypatch.setattr(ai, "resolve_stakes", hold)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
            path, wager = await start(client)
            sid = path.rsplit("/", 1)[1]
            stale = second.load(sid)
            first = await client.post(path + "/transactions", json=wager)
            assert first.status_code == 202 and not enqueued
            expected_outcome = first.json()["transactions"][0]["outcome"]
            assert firestore_repo.recover() == [sid]
            # A replay and polling recover the saved job without resampling.
            observed = await client.get(path)
            assert observed.json()["transactions"][0]["outcome"] == expected_outcome
            assert len(set(enqueue_calls)) == 1 and len(enqueued) == 1
            replay = await client.post(path + "/transactions", json=wager)
            assert replay.status_code == 202 and replay.json()["transactions"] == first.json()["transactions"]
            assert len(enqueue_calls) == 2
            task = next(iter(enqueued.values()))
            endpoint = generation_tasks.INTERNAL_PATH
            assert (await client.post(endpoint, json=task)).status_code == 401
            assert (await client.post(endpoint, json=task, headers={"Authorization": "Bearer wrong"})).status_code == 403
            assert ai.resolutions == 0
            headers = {"Authorization": "Bearer valid"}
            primary = asyncio.create_task(client.post(endpoint, json=task, headers=headers))
            try:
                await asyncio.wait_for(started.wait(), 8)
                # Different store instance, same persisted lease.
                monkeypatch.setattr(main, "engine", worker)
                duplicate = await client.post(endpoint, json=task, headers=headers)
                assert duplicate.status_code == 503
                # Reveal may arrive during generation and must not be overwritten.
                early = await reveal(client, path, wager["request_id"])
                assert early["version"] == 1 and early["transactions"][0]["presentation_completed"]
            finally:
                release.set()
                delivery = await primary
            assert delivery.status_code == 204
            result = (await client.get(path)).json()
            assert result["version"] == 2 and result["transactions"][0]["status"] == "committed"
            assert result["transactions"][0]["outcome"] == expected_outcome and result["api_calls"] == 3
            assert not any(key.startswith("_") for key in result)
            assert len(second.load(sid)["api_events"]) == 3
            assert (await client.post(endpoint, json=task, headers=headers)).status_code == 204
            assert firestore_repo.recover() == []
            with pytest.raises(StaleSession):
                second.save(stale)
            assert (await client.post(path + "/continue")).json()["view"] == "game"
            assert (await client.post(path + "/transactions", json={**wager, "request_id": "stale-0002"})).status_code == 409
            current = second.load(sid)
            next_offer = current["offers"][0]
            next_wager = {**wager, "request_id": "request-0002", "version": 2,
                          "offer_id": next_offer["id"], "unit_ids": [
                              u["id"] for u in current["analysis"]["units"] if u["stakeable"]
                          ][:next_offer["required_count"]]}
            assert (await client.post(path + "/transactions", json=next_wager)).status_code == 202
            assert (await client.post(endpoint, json=task, headers=headers)).status_code == 204
            assert second.load(sid)["transactions"][-1]["id"] == next_wager["request_id"]
            assert second.load(sid)["transactions"][-1]["attempts"] == 0
            ref = second.ref(sid)
            payload = ref.get().get("payload")
            assert b'"transactions"' not in payload and b'"api_events"' not in payload
            assert len(list(ref.collection("transactions").stream())) == 2

    asyncio.run(run())
    assert draws == [] and ai.rewrites == ai.resolutions == 1


@emulated
def test_concurrent_transaction_requests_draw_once(firestore_repo, monkeypatch):
    from app.firestore_store import FirestoreStore
    from app.models import TradeRequest

    engine, _, draws = wire(monkeypatch, firestore_repo, "inline")
    peer = GameEngine(FirestoreStore(firestore_repo.client), draw=engine.draw)

    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
            path, wager = await start(client)
        req = TradeRequest.model_validate(wager)
        sid = path.rsplit("/", 1)[1]
        rng = wager_random(firestore_repo.load(sid), "trade", req.request_id)
        expected_outcome = "win" if rng.randrange(1_000_000) < 500_000 else "loss"
        responses = await asyncio.gather(engine.start_trade(sid, req), peer.start_trade(sid, req))
        assert sorted(result[1] for result in responses) == [False, True]
        assert responses[0][0]["transactions"] == responses[1][0]["transactions"]
        assert responses[0][0]["transactions"][0]["outcome"] == expected_outcome

    asyncio.run(run())
    assert draws == []


@emulated
def test_expired_claim_recovers_using_saved_outcome(firestore_repo, monkeypatch):
    engine, ai, draws = wire(monkeypatch, firestore_repo, "inline")

    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
            path, wager = await start(client)
            from app.models import TradeRequest
            sid = path.rsplit("/", 1)[1]
            state, _, target = await engine.start_trade(sid, TradeRequest.model_validate(wager))
            context, _, _ = await engine.claim_generation(sid, target)
            assert target == generation_target(state)
            await engine.update_generation(context, lambda s, _: s["_generation_claim"].update(expires=0))
            assert firestore_repo.recover() == [sid]
            await engine.process_transaction(sid, target)
            result = await reveal(client, path, wager["request_id"])
            assert result["version"] == 2 and result["transactions"][0]["used_fallback"]
            assert result["transactions"][0]["outcome"] == state["transactions"][0]["outcome"]

    asyncio.run(run())
    assert draws == [] and ai.resolutions == ai.rewrites == 0


@emulated
def test_quota_is_atomic_and_utc_partitioned(firestore_repo, monkeypatch):
    from datetime import datetime, timezone

    monkeypatch.setattr(quota, "store", firestore_repo)
    monkeypatch.setattr(settings, "storage_backend", "firestore")
    monkeypatch.setattr(settings, "daily_call_limit", 3)

    async def run():
        results = await asyncio.gather(*(quota.reserve_call() for _ in range(5)), return_exceptions=True)
        assert results.count(None) == 3
        errors = [r for r in results if isinstance(r, GenerationError)]
        assert len(errors) == 2 and all(str(r) == quota.LIMIT_ERROR for r in errors), repr(results)
        date = datetime.now(timezone.utc).date().isoformat()
        assert firestore_repo.client.collection("counters").document(date).get().get("calls") == 3
        assert await firestore_repo.reserve_call("2040-01-02", 3)

    asyncio.run(run())
