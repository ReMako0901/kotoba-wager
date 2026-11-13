"""Firestore snapshots with atomic read/modify/write and split history."""
import asyncio
from copy import deepcopy
from functools import lru_cache
import json
import random
import secrets

from google.api_core.exceptions import Aborted
from google.cloud import firestore
from google.cloud.firestore_v1.base_query import FieldFilter

from .config import settings
from .store import StaleSession, valid_id


@lru_cache
def firestore_client():
    return firestore.Client(project=settings.firestore_project)


def encode(value):
    # JSON bytes preserve nested lists (e.g. blackjack hands), which Firestore
    # does not support natively. Only status/version/order are queried.
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()


class FirestoreStore:
    def __init__(self, client=None):
        self.client = client or firestore_client()

    def ref(self, sid):
        if not valid_id(sid):
            raise FileNotFoundError
        return self.client.collection("sessions").document(sid)

    def _load(self, sid, transaction, include_events=False):
        ref = self.ref(sid)
        snapshot = ref.get(transaction=transaction)
        if not snapshot.exists:
            return None
        body = json.loads(snapshot.get("payload"))
        body["_revision"] = snapshot.to_dict().get("revision", 0)
        body["transactions"] = [
            json.loads(doc.get("payload"))
            for doc in ref.collection("transactions").order_by("position").stream(transaction=transaction)
        ]
        body["lost_concepts"] = [
            {**concept, "transaction_id": tx["id"], "source_version": tx["source_version"]}
            for tx in body["transactions"] if tx["status"] == "committed"
            for concept in tx.get("lost", [])
        ]
        body["api_events"] = [
            json.loads(doc.get("payload"))
            for doc in ref.collection("api_events").order_by("position").stream(transaction=transaction)
        ] if include_events else []
        return body

    def _write(self, sid, before, after, transaction):
        ref = self.ref(sid)
        revision = (before["_revision"] if before else 0) + 1
        after["_revision"] = revision
        body = {k: v for k, v in after.items() if k not in ("transactions", "api_events", "lost_concepts", "_revision")}
        if before is None:
            after["_wager_seed"] = body["_wager_seed"] = secrets.token_hex(32)
        transaction.set(ref, {"status": body["status"], "version": body["version"],
                              "revision": revision, "payload": encode(body)})
        previous = {tx["id"]: tx for tx in before["transactions"]} if before else {}
        for position, tx in enumerate(after["transactions"]):
            if tx != previous.get(tx["id"]):
                transaction.set(ref.collection("transactions").document(tx["id"]), {
                    "position": position, "payload": encode(tx),
                })
        # Each successful provider response has a unique reservation number.
        for event in after.get("api_events", [])[len(before["api_events"]) if before else 0:]:
            position = event.get("call", after["api_calls"])
            transaction.set(ref.collection("api_events").document(str(position)), {
                "position": position, "payload": encode(event),
            })

    def load(self, sid, *, include_events=True):
        @firestore.transactional
        def read(transaction):
            return self._load(sid, transaction, include_events)

        result = read(self.client.transaction(read_only=True))
        if result is None:
            raise FileNotFoundError
        return result

    async def read(self, sid):
        return await asyncio.to_thread(self.load, sid, include_events=False)

    def _mutate(self, sid, change, *, include_events=False):
        @firestore.transactional
        def write(transaction):
            before = self._load(sid, transaction, include_events)
            updated, result = change(deepcopy(before))
            if updated is not None:
                self._write(sid, before, updated, transaction)
            return result

        return write(self.client.transaction())

    async def mutate(self, sid, change):
        return await asyncio.to_thread(self._mutate, sid, change)

    def save(self, session):
        def change(current):
            if current is not None and (current["version"], current["_revision"]) != (
                session["version"], session.get("_revision")
            ):
                raise StaleSession("本文の版が更新されています。選び直してください。")
            return session, None

        self._mutate(session["id"], change, include_events=True)

    def recover(self):
        return [doc.id for doc in self.client.collection("sessions").where(
            filter=FieldFilter("status", "in", ["generating", "analyzing"]),
        ).stream()]

    async def recover_pending(self):
        return await asyncio.to_thread(self.recover)

    async def reserve_call(self, today, limit):
        @firestore.transactional
        def reserve(transaction):
            ref = self.client.collection("counters").document(today)
            snapshot = ref.get(transaction=transaction)
            count = snapshot.get("calls") if snapshot.exists else 0
            if count >= limit:
                return False
            transaction.set(ref, {"calls": count + 1})
            return True

        # The emulator can abort bursts of concurrent transactions on the
        # same counter. Back off between bounded SDK retry groups.
        for attempt in range(4):
            try:
                return await asyncio.to_thread(reserve, self.client.transaction(max_attempts=3))
            except (Aborted, ValueError) as error:
                if attempt == 3 or not (isinstance(error, Aborted) or isinstance(error.__cause__, Aborted)):
                    raise
                await asyncio.sleep(random.uniform(.04, .14) * (2 ** attempt))
