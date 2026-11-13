"""Dispatch generation without depending on CPU after an HTTP response."""
import asyncio
import hashlib
import json
import logging
from functools import lru_cache
from time import time
from typing import Literal
from urllib.parse import urlsplit

from fastapi import HTTPException
from pydantic import BaseModel, Field, model_validator

from .config import settings
from .engine import GenerationBusy, generation_target

logger = logging.getLogger(__name__)
INTERNAL_PATH = "/internal/generation/process"
IDENTIFIER = r"^[a-zA-Z0-9_-]{8,80}$"


class GenerationTask(BaseModel):
    session_id: str = Field(pattern=IDENTIFIER)
    kind: Literal["initial", "transaction"]
    transaction_id: str | None = Field(default=None, pattern=IDENTIFIER)
    epoch: int = Field(default=0, ge=0)

    @model_validator(mode="after")
    def matching_kind(self):
        if (self.kind == "transaction") != (self.transaction_id is not None):
            raise ValueError("transaction_id must match the task kind")
        return self

    @property
    def target(self):
        return self.kind, self.transaction_id, self.epoch

    @property
    def key(self):
        return hashlib.sha256(self.model_dump_json().encode()).hexdigest()


def audience():
    url = settings.tasks_target_url
    parsed = urlsplit(url)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
            or parsed.path or parsed.query or parsed.fragment):
        raise ValueError("TASKS_TARGET_URL must be the HTTPS service origin")
    return url


@lru_cache
def tasks_client():
    from google.cloud import tasks_v2
    return tasks_v2.CloudTasksClient()


def enqueue(task):
    from google.api_core.exceptions import AlreadyExists
    from google.cloud import tasks_v2

    origin = audience()
    client = tasks_client()
    queue = client.queue_path(settings.tasks_project, settings.tasks_location, settings.tasks_queue)
    try:
        client.create_task(parent=queue, task={
            "name": f"{queue}/tasks/{task.key}",
            "dispatch_deadline": {"seconds": 60},
            "http_request": {
                "http_method": tasks_v2.HttpMethod.POST,
                "url": origin + INTERNAL_PATH,
                "headers": {"Content-Type": "application/json"},
                "body": task.model_dump_json().encode(),
                "oidc_token": {"service_account_email": settings.tasks_service_account, "audience": origin},
            },
        }, timeout=5)
    except AlreadyExists:
        # The task name is stable across ambiguous network errors and restarts.
        return


def verify_token(token, expected_audience):
    import requests
    from google.auth.transport.requests import Request
    from google.oauth2 import id_token

    class VerificationRequest(Request):
        def __call__(self, *args, **kwargs):
            kwargs["timeout"] = 5
            return super().__call__(*args, **kwargs)

    with requests.Session() as session:
        return id_token.verify_oauth2_token(token, VerificationRequest(session), audience=expected_audience)


async def authenticate(authorization):
    if settings.generation_tasks_mode != "cloud":
        raise HTTPException(404)
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(401, "Cloud Tasks authentication required")
    try:
        claims = await asyncio.to_thread(verify_token, token, audience())
    except Exception:
        raise HTTPException(401, "Invalid Cloud Tasks identity token") from None
    if claims.get("email") != settings.tasks_service_account or claims.get("email_verified") is not True:
        raise HTTPException(403, "Unexpected Cloud Tasks service account")


async def dispatch(engine, session, target, *, fresh=False, recovering=False):
    if not target:
        return
    sid = session["id"]
    if settings.generation_tasks_mode == "inline":
        if fresh or recovering:
            async def run():
                process = engine.process_transaction if target[0] == "transaction" else engine.prepare_initial
                try:
                    await process(sid, target)
                except GenerationBusy:
                    if recovering:
                        claim = session.get("_generation_claim") or {}
                        await asyncio.sleep(max(0, claim.get("expires", 0) - time()) + 1)
                        try:
                            await process(sid, target)
                        except GenerationBusy:
                            pass

            engine.spawn(run())
        return

    task = GenerationTask(session_id=sid, kind=target[0], transaction_id=target[1], epoch=target[2])
    if session.get("_enqueued_job") == task.key:
        return

    def mark(current):
        if current is None or generation_target(current) != target or current.get("_enqueued_job") == task.key:
            return None, None
        current["_enqueued_job"] = task.key
        return current, None

    try:
        await asyncio.to_thread(enqueue, task)
        await engine.store.mutate(sid, mark)
    except Exception as error:
        # The draw is already saved. Polling and request replays can retry
        # enqueueing with the same name if the first submission didn't finish.
        logger.warning("Generation enqueue not confirmed (%s)", type(error).__name__)
