import asyncio
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from app import main
from app.gemini import Gemini, Result
from app.models import MeaningResponse, StakeMeaning
from app.store import Store
from test_engine import setup, BEFORE

TEXT = '青い扉の前で、私は古い鍵を拾った。向こうでは猫が小さな鐘を鳴らした。'
INTRO = '私は旅先の宿で、朝を迎えていた。'


def test_intro_is_separate_persisted_and_idempotent(tmp_path, monkeypatch):
    repo = Store(tmp_path)
    monkeypatch.setattr(main, 'store', repo)
    payload = {'custom_text': TEXT, 'intro': INTRO, 'request_id': 'intro-session-test'}
    with TestClient(main.app) as client:
        response = client.post('/api/sessions', json=payload)
        assert response.status_code == 202
        session = response.json()
        assert session['intro'] == INTRO and session['text'] == TEXT
        assert ''.join(u['text'] for u in session['analysis']['units']) == TEXT
        assert all(TEXT[u['start']:u['end']] == u['text'] for u in session['analysis']['units'])
        assert repo.load(payload['request_id'])['intro'] == INTRO
        assert client.get('/api/sessions/' + payload['request_id']).json() == session
        assert client.post('/api/sessions', json=payload).json() == session
        assert client.post('/api/sessions', json={**payload, 'intro': '別の導入。'}).status_code == 409
        empty = client.post('/api/sessions', json={**payload, 'intro': '', 'request_id': 'empty-intro-test'}).json()
        assert empty['intro'] == '' and empty['analysis'] == session['analysis']
        assert client.post('/api/sessions', json={**payload, 'custom_text': 'ただずっとゆっくり歩いて、またただ歩いていた。', 'request_id': 'intro-no-nouns'}).status_code == 422


def test_starter_intro_comes_from_catalog_only(tmp_path, monkeypatch):
    monkeypatch.setattr(main, 'store', Store(tmp_path))
    monkeypatch.setattr(main, 'STORIES', [{**main.STORIES[0], 'intro': INTRO}])
    with TestClient(main.app) as client:
        story = client.post('/api/stories/draw', json={}).json()['stories'][0]
        assert story['intro'] == INTRO
        payload = {'story_id': story['id'], 'request_id': 'starter-intro-test'}
        assert client.post('/api/sessions', json=payload).json()['intro'] == INTRO
        assert client.post('/api/sessions', json={**payload, 'intro': '変更。'}).status_code == 422


@pytest.mark.parametrize('wins', [True, False])
@pytest.mark.parametrize('fallback', [True, False])
def test_intro_survives_generation_and_fallback(tmp_path, wins, fallback):
    repo, session, ai, engine, draws, request = setup(tmp_path, wins)
    session['intro'] = INTRO
    received = []
    for name in ('resolve_stakes', 'win', 'loss', 'review'):
        original = getattr(ai, name)
        async def contextual(*args, intro=None, _original=original, **kwargs):
            if intro is not None:
                received.append(intro)
            return await _original(*args, **kwargs)
        setattr(ai, name, contextual)
    ai.fail_rewrite = fallback
    engine.settle_draw(session, request)
    asyncio.run(engine.process_transaction(session['id']))
    done = repo.load(session['id'])
    assert done['intro'] == INTRO and received and all(i == INTRO for i in received)
    assert done['transactions'][0]['before'] == BEFORE
    assert draws == [.5] and done['version'] == 2
    assert INTRO not in done['text']


def test_resolve_payload_keeps_intro_outside_text(monkeypatch):
    editor = Gemini()
    units = [{'id': 'u1', 'text': '鍵', 'start': 0, 'end': 1}]
    async def generate(instruction, data, schema):
        assert data['intro'] == INTRO and data['text'] == '鍵。'
        assert data['selected_units'] == [{'unit_id': 'u1', 'source_text': '鍵'}]
        return Result(MeaningResponse(meanings=[StakeMeaning(unit_id='u1', source_text='鍵', label='鍵', kind='object', description='鍵', mentions=['鍵'])]), {}, 0)
    monkeypatch.setattr(editor, 'generate', generate)
    asyncio.run(editor.resolve_stakes('鍵。', units, [], intro=INTRO))


def test_draft_matches_imported_catalog():
    root = Path(__file__).resolve().parents[2]
    stories = json.loads((root / 'data/stories.json').read_text())
    rows = (root / 'docs/STARTER_INTROS_DRAFT.md').read_text().splitlines()[6:]
    assert len(rows) == len(stories) == 100
    for row, story in zip(rows, stories):
        _, story_id, text, intro, _ = row.split('|')
        assert story_id == story['id'] and text == story['text']
        assert intro and intro.count('。') in (1, 2)
        assert story['intro'] == intro
