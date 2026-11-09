import asyncio
import json
import pytest
from app.config import settings
from app.quota import reserve_call
from app.gemini import GenerationError
from app.store import Store


def test_public_api_call_cap_is_reserved_before_generation(tmp_path,monkeypatch):
    monkeypatch.setattr(settings,'daily_call_limit',2)
    monkeypatch.setattr(settings,'data_dir',tmp_path)
    async def run():
        await reserve_call()
        await reserve_call()
        with pytest.raises(GenerationError,match='上限'):
            await reserve_call()
    asyncio.run(run())
    assert json.loads((tmp_path/'api-quota.json').read_text())['calls']==2
    Store(tmp_path).recover()  # quota records must not be treated as game sessions


def test_cors_only_accepts_the_configured_page_origin():
    from starlette.applications import Starlette
    from starlette.middleware.cors import CORSMiddleware
    from starlette.testclient import TestClient
    app=CORSMiddleware(Starlette(),allow_origins=['https://remako0901.github.io'],allow_methods=['GET','POST'],allow_headers=['Content-Type'])
    client=TestClient(app)
    good=client.options('/api/health',headers={'Origin':'https://remako0901.github.io','Access-Control-Request-Method':'POST'})
    assert good.status_code==200
    assert good.headers['access-control-allow-origin']=='https://remako0901.github.io'
    bad=client.options('/api/health',headers={'Origin':'https://example.com','Access-Control-Request-Method':'POST'})
    assert bad.status_code==400 and 'access-control-allow-origin' not in bad.headers
