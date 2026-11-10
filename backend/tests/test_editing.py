import pytest
from app.editing import edit_plan, apply_edits
from app.models import EditProposal
from app.gemini import GenerationError

BEFORE='私はピザを注文した。月からスクーターで来たうさぎが、焼きたてチーズの香ばしさと共に到着する。代金の代わりに、私は彼に月夜に響くリコーダーの音色を一つ語って聞かせた。'
PRICE={'id':'price','label':'代金','kind':'attribute','description':'支払いが必要である','depends_on':[],'anchors':['代金の'],'selected_surfaces':['代金の'],'mentions':['代金の']}

def proposal(edits):
    return EditProposal(edits=edits,summary='代金を不要にした',changes=['支払い条件だけを削除'],checks={'protected_retained':True,'lost_absent':True,'reward_realized':False,'notes':''})

def edit(sid,before,after):return {'sentence_id':sid,'before':before,'after':after,'reason':'対象の消失'}


def test_price_loss_cannot_change_the_buyer_rabbit_or_delivery():
    plan=edit_plan(BEFORE,'loss',[PRICE],[PRICE])
    p=proposal([edit(2,'代金の代わりに','お礼に')])
    result=apply_edits(BEFORE,p,plan)
    assert result.text==BEFORE.replace('代金の代わりに','お礼に')
    assert result.text.split('。')[:2]==BEFORE.split('。')[:2]
    assert 'リコーダーの音色' in result.text


def test_price_loss_refuses_unrelated_sentence_rewrite():
    plan=edit_plan(BEFORE,'loss',[PRICE],[PRICE])
    with pytest.raises(GenerationError,match='関係のない文'):
        apply_edits(BEFORE,proposal([edit(0,'私はピザを注文した。','星屑がきらめいた。')]),plan)


def test_a_small_stake_cannot_rewrite_the_whole_allowed_sentence():
    plan=edit_plan(BEFORE,'loss',[PRICE],[PRICE])
    with pytest.raises(GenerationError,match='変化が大きすぎる'):
        apply_edits(BEFORE,proposal([edit(2,BEFORE.split('。')[2]+'。','星屑の降る玄関で、誰もいない夜を待ち続けた。')]),plan)


def test_multiple_core_stakes_allow_broader_changes():
    text='猫が玄関に来た。ピザが届いた。スクーターで帰った。'
    stakes=[{'id':str(i),'label':s,'kind':'object','depends_on':[],'selected_surfaces':[s],'anchors':[s]} for i,s in enumerate(['猫が','玄関に','ピザが','スクーターで'])]
    plan=edit_plan(text,'loss',stakes,stakes)
    assert plan['editable_sentence_ids']==[0,1,2]
    result=apply_edits(text,proposal([edit(0,'猫が玄関に来た。','静かな夜だ。'),edit(1,'ピザが届いた。','窓が開いていた。'),edit(2,'スクーターで帰った。','風だけが通り過ぎた。')]),plan)
    assert result.text=='静かな夜だ。窓が開いていた。風だけが通り過ぎた。'


def test_ambiguous_overlapping_and_stale_edits_are_refused():
    text='猫が猫を見た。'
    plan={'sentences':[{'sentence_id':0,'text':text,'start':0,'end':len(text)}],'editable_sentence_ids':[0],'max_changed_characters':30,'max_edited_sentences':1}
    with pytest.raises(GenerationError):apply_edits(text,proposal([edit(0,'猫','犬')]),plan)
    with pytest.raises(GenerationError):apply_edits(text,proposal([edit(0,'猫が','犬が'),edit(0,'猫が猫を','犬を')]),plan)
    with pytest.raises(GenerationError):apply_edits(text,proposal([edit(0,'魚が','犬が')]),plan)


def test_removed_entity_cannot_be_hidden_behind_an_anonymous_placeholder():
    text='うさぎがピザを届けた。'
    stake={'id':'rabbit','label':'うさぎ','kind':'person','description':'配達員のうさぎ','depends_on':[],'selected_surfaces':['うさぎが'],'anchors':['うさぎが']}
    plan=edit_plan(text,'loss',[stake],[stake])
    with pytest.raises(GenerationError,match='置き換えただけ'):
        apply_edits(text,proposal([edit(0,'うさぎが','誰かが')]),plan)
