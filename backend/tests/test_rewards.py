from app.review_policy import REVIEW_DEDUCTIONS
import asyncio
from copy import deepcopy

import pytest
from fastapi.testclient import TestClient

from app import main
from app.analysis import make_offers, validate_stakes
from app.gemini import Gemini, Result
from app.models import Rewrite, StoryReview
from app.rewards import LEGACY_REWARDS, REWARD_POOLS
from app.store import Store
from app.story_fallback import WIN_ENDINGS
from test_engine import setup


@pytest.mark.parametrize('tier', [1, 2, 3])
@pytest.mark.parametrize('count', [1, 2, 3])
def test_every_cell_has_both_families_and_keeps_legacy_reward(tier, count):
    pools = REWARD_POOLS[tier, count]
    assert set(pools) == {'expression', 'plot'}
    assert all(pools.values())
    assert LEGACY_REWARDS[tier][count-1] in pools['expression' if count == 1 else 'plot']
    assert all(title in WIN_ENDINGS for pool in pools.values() for title, _ in pool)


@pytest.mark.parametrize('available', [1, 2, 3, 6])
@pytest.mark.parametrize('round_number,tier', [(1, 1), (2, 1), (3, 2), (4, 2), (5, 3), (20, 3)])
def test_offers_always_have_plot_and_only_exact_affordable_prices(available, round_number, tier):
    analysis = {'units': [dict(id=str(i), text='猫', start=i, end=i+1, stakeable=True) for i in range(available)]}
    for _ in range(30):
        offers = make_offers(analysis, round_number, 7)
        assert [o['required_count'] for o in offers] == list(range(1, min(available, 3)+1))
        assert any(o['family'] == 'plot' for o in offers)
        assert len({o['id'] for o in offers}) == len(offers)
        for offer in offers:
            assert offer['tier'] == tier
            assert offer['change_scale'] == offer['required_count']
            assert (offer['title'], offer['description']) in REWARD_POOLS[tier, offer['required_count']][offer['family']]
            ids = [u['id'] for u in analysis['units']][:offer['required_count']]
            assert len(validate_stakes(analysis, ids, offer['required_count'])) == offer['required_count']
            with pytest.raises(ValueError):
                validate_stakes(analysis, ids[:-1], offer['required_count'])


def test_round_offers_survive_reload_start_resend_and_continue(tmp_path, monkeypatch):
    repo = Store(tmp_path)
    monkeypatch.setattr(main, 'store', repo)
    payload = {'story_id': 'robot-105', 'request_id': 'saved-rewards-test'}
    with TestClient(main.app) as client:
        first = client.post('/api/sessions', json=payload).json()
        def forbidden(*args):
            raise AssertionError('保存済み報酬を再抽選してはいけない')
        monkeypatch.setattr(main, 'make_offers', forbidden)
        assert client.post('/api/sessions', json=payload).json()['offers'] == first['offers']
        assert client.get('/api/sessions/' + first['id']).json()['offers'] == first['offers']
        saved = Store(tmp_path).load(first['id'])
        assert saved['offers'] == first['offers']
        saved['view'] = 'result'
        repo.save(saved)
        assert client.post('/api/sessions/' + first['id'] + '/continue').json()['offers'] == first['offers']


def test_transaction_resend_keeps_selected_offer_and_next_round_offers(tmp_path):
    repo, session, ai, engine, draws, request = setup(tmp_path, True)
    offers = deepcopy(session['offers'])
    engine.settle_draw(session, request)
    saved = repo.load(session['id'])
    assert saved['offers'] == offers
    assert saved['transactions'][0]['offer'] == offers[0]
    assert not engine.settle_draw(saved, request)
    assert repo.load(session['id'])['offers'] == offers
    asyncio.run(engine.process_transaction(session['id']))
    done = repo.load(session['id'])
    next_offers = deepcopy(done['offers'])
    assert any(o['family'] == 'plot' for o in next_offers)
    assert not engine.settle_draw(done, request)
    assert repo.load(session['id'])['offers'] == next_offers
    assert draws == [.5]


@pytest.mark.parametrize('family,policy', [('expression', '新しい要素を足さず、既存要素の描写を深める'), ('plot', '新しい要素を1つ追加し、物語を前へ進める')])
def test_edit_and_review_prompts_switch_policy_without_affecting_loss(monkeypatch, family, policy):
    editor = Gemini()
    captured = []
    candidate = Rewrite(text='猫が笑った。', summary='変更', changes=['変更'], checks=dict(protected_retained=True, lost_absent=True, reward_realized=True, notes=''))
    async def edit(instruction, text, payload, outcome, stakes):
        captured.append((instruction, payload))
        return Result(candidate, {}, 0)
    async def generate(instruction, payload, schema, **kwargs):
        captured.append((instruction, payload))
        return Result(StoryReview(findings={key: {'present': False, 'reason': ''} for key in REVIEW_DEDUCTIONS}, verdict='accept', edits=[], summary='', changes=[], checks=candidate.checks), {}, 0)
    monkeypatch.setattr(editor, 'edit', edit)
    monkeypatch.setattr(editor, 'generate', generate)
    offer = dict(family=family, title='心の声', change_scale=1)
    asyncio.run(editor.win('猫。', offer, [], []))
    asyncio.run(editor.review('猫。', candidate, 'win', offer, [], []))
    assert all(policy in instruction for instruction, _ in captured)
    captured.clear()
    lost_stake = {'id': 'c1', 'label': '猫', 'kind': 'object', 'mentions': ['猫'], 'selected_surfaces': ['猫']}
    asyncio.run(editor.loss('猫。', [lost_stake], [], []))
    asyncio.run(editor.review('猫。', candidate, 'loss', offer, [lost_stake], []))
    assert all(policy not in instruction for instruction, _ in captured)
    assert captured[-1][1]['reward'] is None
