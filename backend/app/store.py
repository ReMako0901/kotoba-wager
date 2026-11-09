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
        for path in self.directory.glob("*.json"):
            session = json.loads(path.read_text())
            if path.name == "api-quota.json":
                continue
            if session["status"] in ("analyzing", "generating"):
                session["status"] = "error"
                session["error"] = "サーバー再起動により処理が中断しました。本文と確定済みの勝敗を保護しました。再試行できます。"
                for tx in session["transactions"]:
                    if tx["status"] == "generating":
                        tx["status"] = "error"
                        tx["error"] = session["error"]
                self.save(session)


store = Store()
