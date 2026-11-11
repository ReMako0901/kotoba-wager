"""Assemble literal, bounded edits locally; untouched sentences remain byte-identical."""
import re
from difflib import SequenceMatcher
from .gemini import EditBudgetExceeded, GenerationError
from .models import Rewrite
from .segmentation import noun_literals


def sentences(text):
    result=[]
    for match in re.finditer(r'[^。！？!?\n]+[。！？!?\n]*|[。！？!?\n]+',text):
        result.append({'sentence_id':len(result),'text':match.group(),'start':match.start(),'end':match.end()})
    if ''.join(s['text'] for s in result)!=text:
        raise GenerationError('本文の範囲を確認できませんでした。')
    return result


def base_edit_plan(text, outcome, stakes, dependencies, offer=None):
    chunks=sentences(text)
    if outcome=='win':
        tier=(offer or {}).get('change_scale',1)
        return {'sentences':chunks,'editable_sentence_ids':[s['sentence_id'] for s in chunks], 'max_changed_characters':{1:24,2:46,3:90}.get(tier,24),'max_edited_sentences':{1:1,2:2,3:len(chunks)}.get(tier,1),'instruction':'原文を保ち、報酬のための小さな差分だけを返す。'}
    lost={c['id'] for c in stakes}
    affected=set(lost)
    while True:
        extra={c['id'] for c in dependencies if set(c['depends_on'])&affected}
        if extra<=affected:break
        affected |= extra
    targets=[*stakes,*[c for c in dependencies if c['id'] in affected-lost]]
    anchors=list(dict.fromkeys(a for c in targets for a in [*c.get('selected_surfaces',[]),*c.get('mentions',[]),*c.get('anchors',[])] if a.strip()))
    # Legacy local data has no anchors; use the concept's literal name only as a
    # fallback. Current AI analyses must provide and validate exact source anchors.
    if not anchors:
        anchors=[c['label'] for c in stakes]
    allowed=[s['sentence_id'] for s in chunks if any(a in s['text'] for a in anchors)]
    if not allowed:
        raise GenerationError('賭けた言葉と編集箇所を対応できませんでした。本文を保護しました。')
    selected=list(dict.fromkeys(a for c in stakes for a in c.get('selected_surfaces',c.get('anchors',[c['label']]))))
    budget=max(12,2*sum(map(len,selected))+4*(len(selected)-1))
    # A central actor's disappearance can require changes across its mentions.
    if any(c['kind']=='person' for c in stakes) or len(selected)>=3:
        budget=max(budget,int(sum(len(s['text']) for s in chunks if s['sentence_id'] in allowed)*.85))
    elif len(allowed)>1:
        # Semantic dependencies can span sentences even for one grammatical chip.
        # This changes edit scope, never the number of chips or their equal price.
        budget=max(budget,int(sum(len(s['text']) for s in chunks if s['sentence_id'] in allowed)*.75))
    protected=[n for n in noun_literals(text) if not any(n in surface for surface in selected)] if all(c['kind']=='relation' for c in stakes) else []
    return {'must_keep_literals':protected,'loss_anchors':selected,'sentences':chunks,'editable_sentence_ids':allowed,'max_changed_characters':min(140,budget),'max_edited_sentences':len(allowed),'instruction':'選んだ語が直接表す意味と成立しなくなる依存描写だけを最小修正。ほかの文は完全保存。'}


def edit_plan(text, outcome, stakes, dependencies, offer=None, narrative_change=None):
    plan = base_edit_plan(text, outcome, stakes, dependencies, offer)
    change = narrative_change or (offer or {}).get('narrative_change')
    if not change:
        return plan
    strength = change['strength']
    plan['narrative_change'] = change
    budget = {1: 24, 2: 36, 4: 65, 8: 112, 9: 126, 10: 140}[strength]
    if outcome == 'win':
        plan['max_changed_characters'] = budget
        plan['max_edited_sentences'] = min(strength, len(plan['sentences']))
    elif strength >= 4:
        plan['max_changed_characters'] = max(plan['max_changed_characters'], budget)
    if strength >= 4:
        plan['editable_sentence_ids'] = [s['sentence_id'] for s in plan['sentences']]
        plan['max_edited_sentences'] = len(plan['sentences'])
        plan['instruction'] = '賭けと勝敗に結びつく大きな展開を許可する。関係ない設定は維持する。'
    plan['instruction'] += f' 物語の変化の強さは{strength}/10。勝利はポジティブに、敗北はネガティブに進展させる。'
    return plan


def change_size(before,after):
    return sum(max(i2-i1,j2-j1) for tag,i1,i2,j1,j2 in SequenceMatcher(None,before,after,autojunk=False).get_opcodes() if tag!='equal')


def apply_edits(text, proposal, plan):
    lookup={s['sentence_id']:s for s in plan['sentences']}
    spans=[]
    changed_sentences=set()
    cost=0
    for edit in proposal.edits:
        if edit.sentence_id not in plan['editable_sentence_ids']:
            raise GenerationError('関係のない文の変更を検出したため、本文を保護しました。')
        chunk=lookup[edit.sentence_id]
        if chunk['text'].count(edit.before)!=1:
            raise GenerationError('変更箇所を原文で一意に確認できませんでした。本文を保護しました。')
        if edit.before==edit.after:continue
        if any(a and a in edit.before for a in plan.get('loss_anchors', [])) and any(alias in edit.after and alias not in edit.before for alias in ('誰か', '何か', '名前のない人', '名もない人')):
            raise GenerationError('失う対象を「誰か」「何か」に置き換えただけの編集を検出したため、本文を保護しました。')
        start=chunk['start']+chunk['text'].index(edit.before)
        end=start+len(edit.before)
        if any(start<b and a<end for a,b,_ in spans):
            raise GenerationError('変更箇所が重複しています。本文を保護しました。')
        spans.append((start,end,edit.after));changed_sentences.add(edit.sentence_id)
        cost+=change_size(edit.before,edit.after)
    if not spans:
        raise GenerationError('本文に変化がありませんでした。')
    if cost>plan['max_changed_characters'] or len(changed_sentences)>plan['max_edited_sentences']:
        raise EditBudgetExceeded(
            '今回の賭けに対して変化が大きすぎます。'
            f'変更は{cost}文字・{len(changed_sentences)}文、'
            f'上限は{plan["max_changed_characters"]}文字・{plan["max_edited_sentences"]}文です。'
        )
    result=text
    for start,end,after in sorted(spans,reverse=True):
        result=result[:start]+after+result[end:]
    if any(result.count(noun)<text.count(noun) for noun in plan.get('must_keep_literals', [])):
        raise GenerationError('関係だけの消失で対象の物まで削除されたため、本文を保護しました。')
    if len(result)>140 or not result.strip():
        raise GenerationError('編集後の長さが条件を満たしませんでした。本文を保護しました。')
    return Rewrite(text=result,summary=proposal.summary,changes=proposal.changes,checks=proposal.checks)
