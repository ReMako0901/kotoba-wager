import asyncio
from copy import deepcopy
import pytest
from app.analysis import align_analysis, make_offers
from app.engine import GameEngine
from app.gemini import GenerationError, Result, api_schema
from app.models import RawAnalysis, Rewrite, TradeRequest
from app.store import Store

BEFORE = '私は雨を見つめていた。静かな駅の屋根から、水滴が線路へ落ちている。'
AFTER = '私は晴れた空を見つめていた。静かな駅の屋根の向こうに、青い光が広がっている。'

def analysis(text):
    return RawAnalysis.model_validate({'units':[{'text':text,'score':3,'concept_ids':['weather'],'score_reason':'天候'}], 'concepts':[{'id':'weather','label':'雨','kind':'attribute','description':'雨が降っている','depends_on':[]}]})

class AI:
    def __init__(self): self.fail_rewrite=False; self.fail_analysis=False; self.rewrites=0
    async def analyze(self,text,lost):
        if self.fail_analysis: raise GenerationError('解析失敗')
        return Result(analysis(text), {'input':1,'output':1,'thoughts':0}, .1)
    async def win(self,*args):
        self.rewrites+=1
        if self.fail_rewrite: raise GenerationError('通信失敗')
        return Result(Rewrite(text=AFTER,summary='変化',changes=['空が変化'],checks={'protected_retained':True,'lost_absent':True,'reward_realized':True,'notes':'テスト用'}),{},.1)
    async def loss(self,*args): return await self.win(*args)

def setup(tmp_path,outcome):
    repository=Store(tmp_path)
    a=align_analysis(BEFORE,analysis(BEFORE),1).model_dump()
    s={'id':'test-session','text':BEFORE,'version':1,'status':'ready','view':'game','analysis':a,'offers':make_offers(a,1,1),'transactions':[],'pending_transaction_id':None,'win_probability':.5,'lost_concepts':[],'api_calls':0,'api_events':[],'usage':{'input':0,'output':0,'thoughts':0},'analysis_attempts':1,'error':None}
    repository.save(s); ai=AI(); draws=[]
    engine=GameEngine(repository,ai,lambda p: draws.append(p) or outcome)
    o=s['offers'][0]
    req=TradeRequest(request_id='request-0001',version=1,offer_id=o['id'],unit_ids=o['example_unit_ids'])
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


def test_draft_cached_when_followup_analysis_fails(tmp_path):
    repo,s,ai,engine,draws,req=setup(tmp_path,True)
    engine.settle_draw(s,req); ai.fail_analysis=True
    asyncio.run(engine.process_transaction(s['id']))
    assert repo.load(s['id'])['text']==BEFORE
    assert repo.load(s['id'])['transactions'][0]['draft']['text']==AFTER
    ai.fail_analysis=False
    asyncio.run(engine.process_transaction(s['id']))
    assert repo.load(s['id'])['version']==2 and ai.rewrites==1 and len(draws)==1


def test_interrupted_draw_is_recovered_without_redraw(tmp_path):
    repo,s,ai,engine,draws,req=setup(tmp_path,False)
    engine.settle_draw(s,req)
    Store(tmp_path).recover()
    recovered=repo.load(s['id'])
    assert recovered['status']=='error' and recovered['transactions'][0]['outcome']=='loss'
    assert recovered['text']==BEFORE


def test_schema_is_inline_without_large_decode_bounds():
    schema=api_schema(RawAnalysis)
    assert '$ref' not in str(schema) and 'maxItems' not in str(schema)
    assert schema['properties']['units']['items']['properties']['score']['type']=='integer'
    with pytest.raises(ValueError):
        RawAnalysis.model_validate({'units':[],'concepts':[]})


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
