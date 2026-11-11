import asyncio
import json
import os
import tempfile
from pathlib import Path
from .config import settings


class Store:
    """Single-process local prototype. Atomic snapshots keep settled draws durable."""
    def __init__(self, directory: Path | None = None):
        self.directory = directory or settings.data_dir
        self.directory.mkdir(parents=True, exist_ok=True)
        self.locks: dict[str, asyncio.Lock] = {}

    def lock(self, sid):
        return self.locks.setdefault(sid, asyncio.Lock())

    def load(self, sid):
        if sid == "api-quota" or not sid or any(c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-" for c in sid):
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
                session.update(status="generating", error=None)
                tx.update(status="generating", error=None)
                self.save(session)
                pending.append(session["id"])
        return pending


store = Store()
