import asyncio
from fastapi.testclient import TestClient
import pytest
from app import main
from app.gemini import ReviewRejected
from app.marks import map_edits
from app.store import Store
from test_engine import setup


def test_mark_selection_is_durable_and_immutable(tmp_path, monkeypatch):
    monkeypatch.setattr(main, 'store', Store(tmp_path))
    client = TestClient(main.app)
    sid = 'marked-story'
    session = client.post('/api/sessions', json={'story_id': main.STORIES[0]['id'], 'request_id': sid}).json()
    url = f'/api/sessions/{sid}/marks'
    units = session['analysis']['units']
    ids = [u['id'] for u in units if u['stakeable']][:3]
    for invalid in ([ids[0]] * 2, ['v2-u1'], ids + ['fourth']):
        assert client.post(url, json={'unit_ids': invalid}).status_code == 422
    for _ in range(2):
        assert client.post(url, json={'unit_ids': ids}).json()['initial_mark_ids'] == ids
    assert client.post(url, json={'unit_ids': []}).status_code == 409
    assert main.store.load(sid)['marked_unit_ids'] == ids


@pytest.mark.parametrize('won', [False, True])
def test_marks_survive_fallback_and_follow_next_version(tmp_path, won):
    repo, session, ai, engine, draws, request = setup(tmp_path, won)
    units = session['analysis']['units']
    selected = next(u for u in units if u['id'] == request.unit_ids[0])
    guarded = next(u for u in reversed(units) if u['stakeable'] and u['id'] not in request.unit_ids)
    session['marked_unit_ids'] = [selected['id'], guarded['id']]
    ai.fail_rewrite = True
    engine.settle_draw(session, request)
    asyncio.run(engine.process_transaction(session['id']))
    done = repo.load(session['id'])
    tx = done['transactions'][0]
    assert tx['used_fallback'] and tx['status'] == 'committed' and draws == [.5]
    assert tx['staked_mark_ids'] == [selected['id']]
    assert tx['guarded_mark_ids'] == [guarded['id']]
    retained = [u for u in done['analysis']['units'] if u['id'] in done['marked_unit_ids']]
    assert [u['text'] for u in retained] == ([selected['text']] if won else []) + [guarded['text']]
    assert all(done['text'][u['start']:u['end']] == u['text'] and u['stakeable'] for u in retained)


def test_edits_check_the_marked_occurrence_even_with_identical_words():
    original = '猫が来た。猫が鳴く。'
    protected = [{'text': '猫が', 'start': 5, 'end': 7}]
    assert map_edits(original, [(0, 2, '')], protected) == [3]
    with pytest.raises(ReviewRejected):
        map_edits(original, [(5, 7, '犬が')], protected)


def test_review_rejects_altered_mark_even_if_model_approves(tmp_path):
    repo, session, ai, engine, draws, request = setup(tmp_path, True)
    mark = next(u for u in session['analysis']['units'] if '雨' in u['text'])
    session['marked_unit_ids'] = [mark['id']]
    engine.settle_draw(session, request)
    asyncio.run(engine.process_transaction(session['id']))
    done = repo.load(session['id'])
    assert ai.rewrites == 2 and done['transactions'][0]['used_fallback']
    assert mark['text'] in done['text'] and len(draws) == 1
