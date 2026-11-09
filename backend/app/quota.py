"""Optional prototype guard, not a billing cap. Free hosts can lose this file on restart."""
import asyncio
import json
import os
from datetime import datetime, timezone
from .config import settings
from .gemini import GenerationError

_lock = asyncio.Lock()

async def reserve_call():
    if settings.daily_call_limit <= 0:
        return
    async with _lock:
        path = settings.data_dir / 'api-quota.json'
        today = datetime.now(timezone.utc).date().isoformat()
        try:
            state = json.loads(path.read_text())
        except FileNotFoundError:
            state = {'day': today, 'calls': 0}
        if state['day'] != today:
            state = {'day': today, 'calls': 0}
        if state['calls'] >= settings.daily_call_limit:
            raise GenerationError('公開試作のAPI呼出上限に達しました。次の日に試してください。勝敗と元の本文は保持しています。')
        state['calls'] += 1
        temporary = path.with_suffix('.tmp')
        temporary.write_text(json.dumps(state))
        os.replace(temporary, path)
