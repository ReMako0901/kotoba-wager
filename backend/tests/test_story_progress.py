from copy import deepcopy
import pytest
from fastapi.testclient import TestClient
from app import main
from app.store import Store
from app.story_progress import summarize, update_progress, choose_progress, public_progress
from app.models import StoryChoiceRequest
from app.engine import GameEngine


_tx_seq = [0]


def tx(outcome='win', count=1, status='committed'):
    _tx_seq[0] += 1
    return dict(id=f'tx-{_tx_seq[0]}', status=status, outcome=outcome, unit_ids=list(range(count)))


def session(transactions=None):
    return dict(id='story-test', status='ready', view='result', version=6,
                transactions=transactions or [], betting_mode='count-v1')


def choice(value, rid='choice-0001', version=6):
    return StoryChoiceRequest(request_id=rid, choice=value, version=version)


def test_summary_counts_only_committed_words():
    trades = [tx('win', 3), tx('loss', 2), tx('loss', 3), tx('win', status='prepared')]
    assert summarize(trades) == dict(rounds=3, gained=1, lost=5, difference=-4)
    trades[1]['wager_count'] = 1
    assert summarize(trades)['lost'] == 4


@pytest.mark.parametrize('offset', [0, 3])
def test_range_once_and_hidden_before_reach(monkeypatch, offset):
    calls = []
    monkeypatch.setattr('app.story_progress.secrets.randbelow', lambda n: calls.append(n) or offset)
    s = session()
    assert update_progress(s)['required_rounds'] == 5 + offset
    assert 'required_rounds' not in public_progress(s)
    assert update_progress(s)['reached'] is None
    assert calls == [4]


def test_snapshot_extension_and_escape(monkeypatch):
    monkeypatch.setattr('app.story_progress.secrets.randbelow', lambda _: 0)
    s = session([tx() for _ in range(4)])
    update_progress(s)
    assert s['story_progress']['reached'] is None
    s['transactions'].append(tx('loss', 3))
    p = update_progress(s)
    reached = deepcopy(p['reached'])
    assert reached == dict(rounds=5, gained=4, lost=3, difference=1)
    assert p['phase'] == 'escapable'
    choose_progress(s, choice('continue'))
    choose_progress(s, choice('continue'))
    assert len(p['choices']) == 1 and p['phase'] == 'extension'
    s['transactions'].append(tx('loss', 2))
    s['version'] = 7
    update_progress(s)
    assert public_progress(s)['extension_rounds'] == 1
    assert p['reached'] == reached
    choose_progress(s, choice('escape', 'escape-0001', 7))
    choose_progress(s, choice('escape', 'escape-0001', 7))
    assert p['phase'] == 'ended' and len(p['choices']) == 2
    assert public_progress(s)['totals']['difference'] == -1
    with pytest.raises(ValueError):
        choose_progress(s, choice('continue', 'escape-0001', 7))


@pytest.mark.parametrize('state', ['forced', 'stale', 'pending', 'ended', 'game'])
def test_invalid_choice_rejected(state):
    s = session([tx() for _ in range(8)])
    p = update_progress(s)
    if state == 'forced':
        s['transactions'] = []
        p.update(phase='forced', reached=None)
    elif state == 'stale': s['version'] = 7
    elif state == 'pending': s['status'] = 'generating'
    elif state == 'ended': p['phase'] = 'ended'
    elif state == 'game':
        p['phase'] = 'extension'
        s['view'] = 'game'
    with pytest.raises(ValueError): choose_progress(s, choice('escape'))
    assert p['choices'] == []


def test_legacy_api_migration_new_session_and_choice_persistence(tmp_path, monkeypatch):
    repo = Store(tmp_path)
    monkeypatch.setattr(main, 'store', repo)
    calls = []
    monkeypatch.setattr('app.story_progress.secrets.randbelow', lambda n: calls.append(n) or 0)
    with TestClient(main.app) as client:
        payload = dict(story_id='robot-105', request_id='story-test-new')
        created = client.post('/api/sessions', json=payload).json()
        assert created['story_progress']['phase'] == 'forced'
        assert 'required_rounds' not in created['story_progress']
        assert client.post('/api/sessions', json=payload).json() == created
        legacy = repo.load(created['id'])
        legacy.pop('story_progress')
        legacy['transactions'] = [tx() for _ in range(6)]
        legacy.update(view='game', version=7)
        repo.save(legacy)
        loaded = client.get('/api/sessions/' + legacy['id']).json()
        assert loaded['view'] == 'result'
        assert loaded['story_progress']['reached']['rounds'] == 5
        assert client.get('/api/sessions/' + legacy['id']).json() == loaded
        assert len(calls) == 2
        base = '/api/sessions/' + legacy['id']
        assert client.post(base + '/continue').status_code == 409
        body = dict(request_id='story-escape', choice='escape', version=7)
        ended = client.post(base + '/story-choice', json=body)
        assert ended.status_code == 200
        assert ended.json()['story_progress']['phase'] == 'ended'
        assert client.post(base + '/story-choice', json=body).json() == ended.json()
        assert client.get(base).json() == ended.json()
        assert client.post(base + '/continue').status_code == 409
        assert repo.load(legacy['id'])['story_progress']['phase'] == 'ended'


@pytest.mark.parametrize('phase', ['escapable', 'ended'])
def test_new_wagers_blocked_after_reach(phase, tmp_path):
    from app.models import TradeRequest
    s = session([tx() for _ in range(8)])
    update_progress(s)['phase'] = phase
    s['view'] = 'game'
    request = TradeRequest(request_id='new-trade-0001', version=6, offer_id='offer', unit_ids=['u'])
    with pytest.raises(ValueError): GameEngine(Store(tmp_path)).settle_draw(s, request)



def test_commit_reaches_threshold_and_keeps_snapshot(tmp_path, monkeypatch):
    from types import SimpleNamespace
    monkeypatch.setattr('app.story_progress.secrets.randbelow', lambda _: 0)
    monkeypatch.setattr('app.engine.build_analysis', lambda *_: SimpleNamespace(model_dump=lambda: {'units': []}))
    monkeypatch.setattr('app.engine.make_offers', lambda *_: [])
    s = session([tx() for _ in range(4)])
    s['lost_concepts'] = []
    pending = dict(id='last', source_version=6, status='prepared', outcome='loss', unit_ids=['a', 'b'], lost=[],
                   draft=dict(text='猫が来た。', summary='変更', changes=[], checks={}))
    s['transactions'].append(pending)
    engine = GameEngine(Store(tmp_path))
    engine.commit_transaction(s, pending)
    assert s['story_progress']['phase'] == 'escapable'
    assert s['story_progress']['reached'] == dict(rounds=5, gained=4, lost=2, difference=2)
