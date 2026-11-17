import asyncio
import logging

import pytest
from pydantic import ValidationError

from app.gemini import EditRejected, Gemini, Result, ReviewScoreRejected, api_schema
from app.models import ReviewFindings, StoryReview
from app.review_policy import (
    REVIEW_DEDUCTIONS, REVIEW_FULL_SCORE, REVIEW_REJECTION_THRESHOLD, evaluate_review,
)
from test_engine import setup, BEFORE, AFTER


def findings(*present):
    return {key: {'present': key in present, 'reason': f'{label}の具体的な箇所' if key in present else ''}
            for key, (label, _) in REVIEW_DEDUCTIONS.items()}


@pytest.mark.parametrize('key', REVIEW_DEDUCTIONS)
def test_each_item_has_one_fixed_deduction(key):
    total, rows = evaluate_review(ReviewFindings.model_validate(findings(key)))
    label, points = REVIEW_DEDUCTIONS[key]
    assert total == points
    assert rows == [dict(item=key, label=label, points=points, reason=f'{label}の具体的な箇所')]


def test_all_items_are_summed():
    total, rows = evaluate_review(ReviewFindings.model_validate(findings(*REVIEW_DEDUCTIONS)))
    assert total == sum(points for _, points in REVIEW_DEDUCTIONS.values())
    assert len(rows) == 5


@pytest.mark.parametrize('invalid', ['missing', 'empty_reason', 'non_boolean'])
def test_findings_cannot_silently_default_to_zero(invalid):
    data = findings('lost_reference')
    if invalid == 'missing':
        del data['style_shift']
    elif invalid == 'empty_reason':
        data['lost_reference']['reason'] = ' '
    else:
        data['lost_reference']['present'] = 1
    with pytest.raises(ValidationError):
        ReviewFindings.model_validate(data)


@pytest.mark.parametrize('present, rejected', [
    ((), False), (('style_shift',), False), (('setting_conflict',), False),
    (('setting_conflict', 'style_shift'), True), (('lost_reference',), True),
])
@pytest.mark.parametrize('wins', [True, False])
def test_real_review_with_fake_response_threshold_logs_fallback_and_call_count(
        tmp_path, monkeypatch, caplog, present, rejected, wins):
    from app.main import public

    repo, session, ai, engine, draws, request = setup(tmp_path, wins)
    editor = Gemini()
    calls = []

    async def generate(instruction, payload, schema, *, thinking_level):
        calls.append(payload)
        assert schema is StoryReview and thinking_level == 'MEDIUM'
        policy = payload['review_policy']
        assert policy['full_score'] == REVIEW_FULL_SCORE
        assert policy['rejection_threshold'] == REVIEW_REJECTION_THRESHOLD
        assert set(policy['deductions']) == set(REVIEW_DEDUCTIONS)
        assert all(key in instruction for key in REVIEW_DEDUCTIONS)
        # Even a model's erroneous accept cannot bypass the local threshold.
        return Result(schema.model_validate(dict(
            verdict='accept', findings=findings(*present), edits=[], summary='', changes=[],
            checks=dict(protected_retained=True, lost_absent=True, reward_realized=wins, notes=''),
        )), {}, .1)

    monkeypatch.setattr(editor, 'generate', generate)
    ai.review = editor.review
    engine.settle_draw(session, request)
    with caplog.at_level(logging.WARNING, logger='app.gemini'):
        asyncio.run(engine.process_transaction(session['id']))
    done = repo.load(session['id'])
    tx = done['transactions'][0]
    assert done['status'] == 'ready' and done['version'] == 2
    assert tx['outcome'] == ('win' if wins else 'loss') and draws == [.5]
    assert done['api_calls'] == 3 and len(calls) == ai.rewrites == ai.resolutions == 1
    assert bool(tx.get('used_fallback')) == rejected
    if rejected:
        assert done['text'] != AFTER
        if wins:
            assert done['text'].startswith(BEFORE)
        else:
            assert all(word not in done['text'] for word in tx['stakes'])
        total = sum(REVIEW_DEDUCTIONS[key][1] for key in present)
        assert f'total_deduction={total}' in caplog.text
        for key in present:
            label, points = REVIEW_DEDUCTIONS[key]
            assert key in caplog.text and label in caplog.text
            assert f'"points": {points}' in caplog.text
            assert f'{label}の具体的な箇所' in caplog.text
    else:
        assert done['text'] == AFTER and not caplog.records
    # Scores/findings live only inside the model call and server log.
    exposed = str(public(done))
    for private in ('review_policy', 'findings', 'total_deduction', 'rejection_threshold'):
        assert private not in exposed
    assert not engine.settle_draw(done, request) and draws == [.5]


def test_review_response_requires_all_five_items_in_api_schema():
    schema = api_schema(StoryReview)
    assert 'findings' in schema['required']
    assert set(schema['properties']['findings']['required']) == set(REVIEW_DEDUCTIONS)
    assert not issubclass(ReviewScoreRejected, EditRejected)
