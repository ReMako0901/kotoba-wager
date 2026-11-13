import asyncio
import json
import os
import tempfile
from pathlib import Path
from .config import settings


def valid_id(sid):
    return isinstance(sid, str) and bool(sid) and sid != "api-quota" and all(
        c in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-" for c in sid
    )


class StaleSession(ValueError):
    """The snapshot is no longer safe to write."""


class Store:
    """Single-process local prototype. Atomic snapshots keep settled draws durable."""
    def __init__(self, directory: Path | None = None):
        self.directory = directory or settings.data_dir
        self.directory.mkdir(parents=True, exist_ok=True)
        self.locks: dict[str, asyncio.Lock] = {}

    def lock(self, sid):
        return self.locks.setdefault(sid, asyncio.Lock())

    def load(self, sid):
        if not valid_id(sid):
            raise FileNotFoundError
        return json.loads((self.directory / f"{sid}.json").read_text())

    def save(self, session):
        fd, tmp = tempfile.mkstemp(dir=self.directory, suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as file:
                json.dump(session, file, ensure_ascii=False, indent=2)
                file.flush()
                os.fsync(file.fileno())
            os.replace(tmp, self.directory / f"{session['id']}.json")
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)

    async def read(self, sid):
        return self.load(sid)

    async def mutate(self, sid, change):
        async with self.lock(sid):
            try:
                current = self.load(sid)
            except FileNotFoundError:
                current = None
            updated, result = change(current)
            if updated is not None:
                self.save(updated)
            return result

    async def recover_pending(self):
        return self.recover()

    def recover(self):
        pending = []
        for path in self.directory.glob("*.json"):
            if path.name == "api-quota.json":
                continue
            session = json.loads(path.read_text())
            if session["status"] not in ("generating", "error"):
                continue
            tx = next((item for item in session["transactions"]
                       if item["id"] == session.get("pending_transaction_id")), None)
            if tx and tx["status"] != "committed":
                if claim := session.get("_generation_claim"):
                    claim["expires"] = 0
                session.update(status="generating", error=None)
                tx.update(status="generating", error=None)
                self.save(session)
                pending.append(session["id"])
        return pending


def configured_store():
    if settings.storage_backend == "firestore":
        from .firestore_store import FirestoreStore
        return FirestoreStore()
    return Store()


store = configured_store()
