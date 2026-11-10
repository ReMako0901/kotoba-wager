"""Assemble literal, bounded edits locally; untouched sentences remain byte-identical."""
import re
from difflib import SequenceMatcher
from .gemini import GenerationError
from .models import Rewrite


def sentences(text):
    result=[]
    for match in re.finditer(r'[^。！？!?\n]+[。！？!?\n]*|[。！？!?\n]+',text):
        result.append({'sentence_id':len(result),'text':match.group(),'start':match.start(),'end':match.end()})
    if ''.join(s['text'] for s in result)!=text:
        raise GenerationError('本文の範囲を確認できませんでした。')
    return result


def edit_plan(text, outcome, stakes, dependencies, offer=None):
    chunks=sentences(text)
    if outcome=='win':
        tier=(offer or {}).get('tier',1)
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
    if any(c['kind']=='person' for c in stakes) or len(selected)>=4:
        budget=max(budget,int(len(text)*.85))
    return {'sentences':chunks,'editable_sentence_ids':allowed,'max_changed_characters':min(140,budget),'max_edited_sentences':len(allowed),'instruction':'選んだ語が直接表す意味と成立しなくなる依存描写だけを最小修正。ほかの文は完全保存。'}


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
        start=chunk['start']+chunk['text'].index(edit.before)
        end=start+len(edit.before)
        if any(start<b and a<end for a,b,_ in spans):
            raise GenerationError('変更箇所が重複しています。本文を保護しました。')
        spans.append((start,end,edit.after));changed_sentences.add(edit.sentence_id)
        cost+=change_size(edit.before,edit.after)
    if not spans:
        raise GenerationError('本文に変化がありませんでした。')
    if cost>plan['max_changed_characters'] or len(changed_sentences)>plan['max_edited_sentences']:
        raise GenerationError('今回の賭けに対して変化が大きすぎるため、反映せず本文を保護しました。同じ勝敗で再試行できます。')
    result=text
    for start,end,after in sorted(spans,reverse=True):
        result=result[:start]+after+result[end:]
    if len(result)>140 or not result.strip():
        raise GenerationError('編集後の長さが条件を満たしませんでした。本文を保護しました。')
    return Rewrite(text=result,summary=proposal.summary,changes=proposal.changes,checks=proposal.checks)
