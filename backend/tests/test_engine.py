import asyncio
from copy import deepcopy
import pytest
from app.analysis import build_analysis, make_offers
from app.engine import GameEngine
from app.gemini import GenerationError, Result, ReviewRejected, api_schema
from app.models import Rewrite, TradeRequest, StakesResolution, ResolvedConcept, MeaningResponse
from app.store import Store

BEFORE = '私は雨を見つめていた。静かな駅の屋根から、水滴が線路へ落ちている。'
AFTER = '私は晴れた空を見つめていた。静かな駅の屋根の向こうに、青い光が広がっている。'

class AI:
    def __init__(self): self.fail_rewrite=False; self.fail_resolution=False; self.rewrites=0; self.resolutions=0
    async def resolve_stakes(self,text,units,lost):
        self.resolutions+=1
        if self.fail_resolution: raise GenerationError('解釈失敗')
        c=ResolvedConcept(id='weather',label='雨',kind='attribute',description='雨が降る',selected_surfaces=[u['text'] for u in units],mentions=['雨を'])
        return Result(StakesResolution(concepts=[c]),{'input':1,'output':1,'thoughts':0},.1)
    async def win(self,*args, **kwargs):
        self.rewrites+=1
        if self.fail_rewrite: raise GenerationError('通信失敗')
        return Result(Rewrite(text=AFTER,summary='変化',changes=['空が変化'],checks={'protected_retained':True,'lost_absent':True,'reward_realized':True,'notes':'テスト用'}),{},.1)
    async def loss(self,*args, **kwargs):
        result = await self.win(*args, **kwargs)
        result.value.checks.reward_realized = False
        return result

    async def review(self, original, candidate, outcome, offer, stakes, lost):
        return Result(candidate, {}, .1)

def setup(tmp_path,outcome):
    repository=Store(tmp_path)
    a=build_analysis(BEFORE,1).model_dump()
    s={'id':'test-session','text':BEFORE,'version':1,'status':'ready','view':'game','analysis':a,'offers':make_offers(a,1,1),'transactions':[],'pending_transaction_id':None,'win_probability':.5,'lost_concepts':[],'api_calls':0,'api_events':[],'usage':{'input':0,'output':0,'thoughts':0},'analysis_attempts':1,'error':None}
    repository.save(s); ai=AI(); draws=[]
    engine=GameEngine(repository,ai,lambda p: draws.append(p) or outcome)
    o=s['offers'][0]
    req=TradeRequest(request_id='request-0001',version=1,offer_id=o['id'],unit_ids=[u['id'] for u in a['units'] if u['stakeable']][:o['required_count']])
    return repository,s,ai,engine,draws,req

@pytest.mark.parametrize('outcome',[True,False])
def test_commit_and_duplicate_draw(tmp_path,outcome):
    repo,s,ai,engine,draws,req=setup(tmp_path,outcome)
    assert engine.settle_draw(s,req)
    assert not engine.settle_draw(s,req)
    asyncio.run(engine.process_transaction(s['id']))
    done=repo.load(s['id'])
    assert done['version']==2 and done['text']==AFTER and done['view']=='result'
    assert len(draws)==1 and len(done['transactions'])==1
    assert bool(done['lost_concepts']) is (not outcome)
    assert not engine.settle_draw(done,req)
    assert len(draws)==1


def test_failed_generation_preserves_text_and_outcome_after_restart(tmp_path):
    repo,s,ai,engine,draws,req=setup(tmp_path,False)
    engine.settle_draw(s,req); ai.fail_rewrite=True
    asyncio.run(engine.process_transaction(s['id']))
    failed=repo.load(s['id'])
    assert failed['text']==BEFORE and failed['version']==1 and failed['status']=='error'
    assert failed['transactions'][0]['outcome']=='loss'
    # A restarted server reuses the persisted result; it never invokes the draw.
    ai.fail_rewrite=False
    resumed=GameEngine(Store(tmp_path),ai,lambda p: pytest.fail('redraw'))
    asyncio.run(resumed.process_transaction(s['id']))
    assert repo.load(s['id'])['version']==2 and len(draws)==1


def test_resolved_meaning_is_cached_when_edit_fails(tmp_path):
    repo,s,ai,engine,draws,req=setup(tmp_path,True)
    engine.settle_draw(s,req);ai.fail_rewrite=True
    asyncio.run(engine.process_transaction(s['id']))
    assert repo.load(s['id'])['text']==BEFORE
    assert repo.load(s['id'])['transactions'][0]['meanings_resolved']
    ai.fail_rewrite=False
    asyncio.run(engine.process_transaction(s['id']))
    assert repo.load(s['id'])['version']==2 and ai.resolutions==1 and len(draws)==1


def test_failed_meaning_resolution_keeps_the_settled_draw(tmp_path):
    repo,s,ai,engine,draws,req=setup(tmp_path,False)
    engine.settle_draw(s,req);ai.fail_resolution=True
    asyncio.run(engine.process_transaction(s['id']))
    assert repo.load(s['id'])['status']=='error'
    assert repo.load(s['id'])['text']==BEFORE and len(draws)==1
    ai.fail_resolution=False
    asyncio.run(engine.process_transaction(s['id']))
    assert repo.load(s['id'])['version']==2 and len(draws)==1


def test_interrupted_draw_is_recovered_without_redraw(tmp_path):
    repo,s,ai,engine,draws,req=setup(tmp_path,False)
    engine.settle_draw(s,req)
    Store(tmp_path).recover()
    recovered=repo.load(s['id'])
    assert recovered['status']=='error' and recovered['transactions'][0]['outcome']=='loss'
    assert recovered['text']==BEFORE


def test_schema_is_inline_without_large_decode_bounds():
    schema=api_schema(MeaningResponse)
    assert '$ref' not in str(schema) and 'maxItems' not in str(schema)
    assert schema['properties']['meanings']['items']['properties']['source_text']['type']=='string'
    with pytest.raises(ValueError):
        MeaningResponse.model_validate({'meanings':[]})


def test_manual_retry_limit_does_not_redraw(tmp_path):
    repo,s,ai,engine,draws,req=setup(tmp_path,False)
    engine.settle_draw(s,req); ai.fail_rewrite=True
    asyncio.run(engine.process_transaction(s['id']))
    async def retry_once():
        await engine.retry(s['id'])
        await asyncio.gather(*engine.tasks)
    asyncio.run(retry_once())
    asyncio.run(retry_once())
    with pytest.raises(ValueError,match='上限'):
        asyncio.run(engine.retry(s['id']))
    done=repo.load(s['id'])
    assert done['transactions'][0]['attempts']==3 and len(draws)==1
    assert done['version']==1 and done['text']==BEFORE


@pytest.mark.parametrize('wins,finish_first', [(True,False),(False,False),(True,True)])
def test_gamble_keeps_text_until_generation_and_reveal(tmp_path,wins,finish_first):
    from app.main import public
    repo,s,ai,engine,draws,req=setup(tmp_path,wins)
    req=req.model_copy(update={'game':'blackjack'})
    assert engine.settle_draw(s,req)
    tx=s['transactions'][0]
    assert tx['gamble']['rounds'][0]['deck']
    assert not engine.settle_draw(s,req)
    assert 'deck' not in public(s)['transactions'][0]['gamble']['rounds'][0]
    assert s['text']==BEFORE and not tx['presentation_completed']
    if finish_first:
        assert asyncio.run(engine.finish_gamble(s['id'],tx['id']))['text']==BEFORE
    asyncio.run(engine.process_transaction(s['id']))
    if not finish_first:
        awaiting=repo.load(s['id'])
        assert awaiting['status']=='awaiting_reveal'
        assert awaiting['version']==1 and awaiting['text']==BEFORE and not awaiting['lost_concepts']
        assert 'draft' not in public(awaiting)['transactions'][0]
    done=asyncio.run(engine.finish_gamble(s['id'],tx['id']))
    assert done['version']==2 and done['text']==AFTER and done['view']=='result'
    assert done['transactions'][0]['gamble']==tx['gamble']
    assert bool(done['lost_concepts']) is (not wins)
    assert draws==[.6] and ai.rewrites==1


def test_gamble_error_and_retry_reuse_the_plan(tmp_path):
    repo,s,ai,engine,draws,req=setup(tmp_path,False)
    req=req.model_copy(update={'game':'baccarat'})
    engine.settle_draw(s,req)
    tx=s['transactions'][0]
    ai.fail_rewrite=True
    asyncio.run(engine.process_transaction(s['id']))
    failed=asyncio.run(engine.finish_gamble(s['id'],tx['id']))
    assert failed['status']=='error' and failed['text']==BEFORE
    ai.fail_rewrite=False
    async def retry():
        await engine.retry(s['id'])
        await asyncio.gather(*engine.tasks)
    asyncio.run(retry())
    done=repo.load(s['id'])
    assert done['status']=='ready' and done['text']==AFTER
    assert done['transactions'][0]['gamble']==tx['gamble'] and draws==[.45]


@pytest.mark.parametrize('has_past_loss', [False, True])
def test_win_checks_absence_only_when_there_are_prior_losses(tmp_path,has_past_loss):
    repo,s,ai,engine,draws,req=setup(tmp_path,True)
    if has_past_loss:
        s['lost_concepts']=[{'label':'前に消えた設定'}]
    original_win=ai.win
    async def misunderstood_check(*args, **kwargs):
        result=await original_win(*args)
        result.value.checks.lost_absent=False
        return result
    ai.win=misunderstood_check
    engine.settle_draw(s,req)
    asyncio.run(engine.process_transaction(s['id']))
    done=repo.load(s['id'])
    assert done['text']==(BEFORE if has_past_loss else AFTER)
    assert done['status']==('error' if has_past_loss else 'ready')


def test_failed_review_never_reflects_the_unreviewed_candidate(tmp_path):
    repo, session, ai, engine, draws, request = setup(tmp_path, True)
    request = request.model_copy(update={'game': 'blackjack'})
    engine.settle_draw(session, request)
    async def reject(original, candidate, outcome, offer, stakes, lost):
        assert original == BEFORE and candidate.text == AFTER
        assert outcome == 'win' and offer['narrative_change']['strength'] == 1
        raise GenerationError('文章全体の読み直しで違和感が残りました。')
    ai.review = reject
    asyncio.run(engine.process_transaction(session['id']))
    failed = asyncio.run(engine.finish_gamble(session['id'], request.request_id))
    assert failed['status'] == 'error' and failed['text'] == BEFORE
    assert failed['api_calls'] == 3 and draws == [.6]


@pytest.mark.parametrize('repeat_rejected_text', [False, True])
def test_invalid_review_regenerates_once_without_another_draw(tmp_path, repeat_rejected_text):
    repo, session, ai, engine, draws, request = setup(tmp_path, True)
    request = request.model_copy(update={'game': 'blackjack'})
    engine.settle_draw(session, request)
    rewrite = ai.win
    review = ai.review
    second_draft = '私は雨を見つめていた。静かな駅に、待っていた友達がやって来た。'
    review_calls = []

    async def draft(*args, previous_review=None):
        result = await rewrite(*args)
        if previous_review:
            assert previous_review == {'rejected_text': AFTER, 'reason': '初稿と同じ本文'}
            if not repeat_rejected_text:
                result.value.text = second_draft
        return result

    async def read(original, candidate, outcome, offer, stakes, lost):
        review_calls.append(candidate.text)
        assert outcome == 'win'
        if candidate.text == AFTER:
            raise ReviewRejected('初稿と同じ本文')
        return await review(original, candidate, outcome, offer, stakes, lost)

    ai.win = draft
    ai.review = read
    asyncio.run(engine.process_transaction(session['id']))
    assert repo.load(session['id'])['text'] == BEFORE
    done = asyncio.run(engine.finish_gamble(session['id'], request.request_id))
    assert draws == [.6] and ai.rewrites == 2
    assert done['transactions'][0]['outcome'] == 'win'
    if repeat_rejected_text:
        assert done['text'] == BEFORE and done['status'] == 'error'
        assert review_calls == [AFTER]
    else:
        assert done['text'] == second_draft and done['status'] == 'ready'
        assert review_calls == [AFTER, second_draft] and done['api_calls'] == 5


def test_oversized_initial_edit_is_replaced_before_review(tmp_path, monkeypatch):
    from app.gemini import Gemini
    from app.models import EditProposal

    repo, session, ai, engine, draws, request = setup(tmp_path, True)
    request = request.model_copy(update={'game': 'blackjack'})
    editor = Gemini()
    feedback = []

    async def generate(instruction, payload, schema, *, thinking_level):
        feedback.append(payload['previous_review'])
        edits = [{'sentence_id': 0, 'before': '雨を', 'after': '銀色の雨を', 'reason': '描写を加える'}]
        if len(feedback) == 1:
            edits.append({'sentence_id': 1, 'before': '静かな', 'after': '暗い', 'reason': '描写を変える'})
        return Result(EditProposal(
            edits=edits, summary='雨の描写', changes=['雨に色がついた'],
            checks={'protected_retained': True, 'lost_absent': True, 'reward_realized': True, 'notes': ''},
        ), {}, .1)

    monkeypatch.setattr(editor, 'generate', generate)
    ai.win = editor.win
    engine.settle_draw(session, request)
    asyncio.run(engine.process_transaction(session['id']))
    waiting = repo.load(session['id'])
    assert waiting['status'] == 'awaiting_reveal' and waiting['text'] == BEFORE
    done = asyncio.run(engine.finish_gamble(session['id'], request.request_id))
    assert done['text'] == BEFORE.replace('雨を', '銀色の雨を') and draws == [.6]
    assert done['api_calls'] == 4 and len(feedback) == 2
    assert feedback[0] is None and '上限は24文字・1文' in feedback[1]['reason']
