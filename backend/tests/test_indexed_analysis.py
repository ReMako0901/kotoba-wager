"""Post-draw semantic resolution cannot change the player's selection or its count."""
import pytest
from app.gemini import materialize_meanings,GenerationError
from app.models import MeaningResponse

TEXT='私の隣で、私のロボットがお弁当と一緒に笑った。'
UNITS=[{'id':'a','text':'私の'},{'id':'b','text':'私の'},{'id':'c','text':'お弁当と'}]


def response(units):
    return MeaningResponse(meanings=[{'unit_id':u['id'],'source_text':u['text'],'label':'私との関係' if u['text']=='私の' else 'お弁当','kind':'relation' if u['text']=='私の' else 'object','description':'原文にある意味','mentions':[u['text']]} for u in units])


def test_repeated_meanings_merge_only_after_the_chips_have_been_counted():
    r=materialize_meanings(TEXT,UNITS,response(UNITS))
    assert len(UNITS)==3 and len(r.concepts)==2
    assert r.concepts[0].selected_surfaces==['私の']


def test_selected_source_must_match_even_with_a_valid_identifier():
    r=response(UNITS)
    r.meanings[2].source_text='語って聞かせた'
    with pytest.raises(GenerationError):materialize_meanings(TEXT,UNITS,r)


def test_resolution_cannot_drop_duplicate_or_add_a_selected_chip():
    for items in [UNITS[:2],UNITS+[UNITS[0]],[*UNITS,{'id':'other','text':'隣で'}]]:
        with pytest.raises(GenerationError):materialize_meanings(TEXT,UNITS,response(items))


def test_nonexistent_mentions_are_rejected_without_changing_the_draw():
    r=response(UNITS);r.meanings[0].mentions=['存在しない語句']
    with pytest.raises(GenerationError):materialize_meanings(TEXT,UNITS,r)
