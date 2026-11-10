import pytest
from app.gemini import materialize_analysis, GenerationError
from app.models import IndexedAnalysis
from app.analysis import align_analysis


def indexed(rows, parts):
    return IndexedAnalysis.model_validate({'units':[{'unit_index':i,'source_text':parts[i] if i<len(parts) else '?','score':score,'concept_ids':['c'],'score_reason':'対象'} for i,score in rows], 'concepts':[{'id':'c','label':'人物','kind':'person','description':'語り手','depends_on':[],'anchors':parts}]})


def test_omitted_punctuation_never_interrupts_reanalysis():
    parts=['私は','、','プリンを','買った','。']
    raw=materialize_analysis(parts,indexed([(0,6),(2,3),(3,3)],parts))
    a=align_analysis(''.join(parts),raw,1)
    assert ''.join(u.text for u in a.units)==''.join(parts)
    assert a.units[1].score==a.units[4].score==0


def test_missing_or_conflicting_scores_are_not_invented():
    parts=['私は','プリンを','買って','家へ','帰った']
    raw=materialize_analysis(parts,indexed([(0,6),(1,2),(1,7),(2,3),(3,3),(4,3)],parts))
    assert raw.units[1].score==0 and raw.units[1].concept_ids==[]
    raw=materialize_analysis(parts,indexed([(0,6),(2,3),(3,3),(4,3)],parts))
    assert raw.units[1].score==0


def test_sparse_and_unknown_indices_still_stop_safely():
    with pytest.raises(GenerationError):
        materialize_analysis(['私は','プリンを','買った'],indexed([(0,6)],['私は','プリンを','買った']))
    with pytest.raises(GenerationError):
        materialize_analysis(['私は'],indexed([(5,6)],['私は']))


def test_correct_number_with_wrong_surface_cannot_be_wagered():
    parts=['私は','プリンを','買って','家へ','帰った']
    response=indexed([(i,3) for i in range(5)],parts)
    response.units[1].source_text='語って聞かせた'
    raw=materialize_analysis(parts,response)
    assert raw.units[1].score==0 and raw.units[1].scoring_state=='unresolved'


def test_concept_must_have_the_exact_source_anchor():
    parts=['私は','代金の','代わりに','話を','した']
    response=indexed([(i,3) for i in range(5)],parts)
    response.concepts[0].anchors.remove('代金の')
    raw=materialize_analysis(parts,response)
    assert raw.units[1].score==0 and raw.units[1].concept_ids==[]


def test_literal_anchor_can_omit_the_attached_particle():
    parts=['私は','代金の','代わりに','話を','した']
    response=indexed([(i,3) for i in range(5)],parts)
    response.concepts[0].anchors=['私','代金','代わり','話','した']
    raw=materialize_analysis(parts,response)
    assert raw.units[1].score==3
