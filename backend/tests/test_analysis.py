import pytest
from app.analysis import align_analysis, make_offers, validate_stakes
from app.models import RawAnalysis
from app.gemini import GenerationError


def fixture():
    return RawAnalysis.model_validate({"concepts":[{"id":"me","label":"私","kind":"person","description":"語り手","depends_on":[]},{"id":"rain","label":"雨","kind":"attribute","description":"雨が降る","depends_on":[]}],"units":[{"text":"私は","score":6,"concept_ids":["me"],"score_reason":"主体"},{"text":"雨を","score":2,"concept_ids":["rain"],"score_reason":"天気"},{"text":"私が","score":6,"concept_ids":["me"],"score_reason":"同じ主体"}]})


def test_exact_alignment_preserves_unicode_and_omitted_punctuation():
    text="私は、雨を。\n私が。"
    a=align_analysis(text,fixture(),1)
    assert ''.join(u.text for u in a.units)==text
    assert all(text[u.start:u.end]==u.text for u in a.units)
    assert any(u.score==0 and '\n' in u.text for u in a.units)


def test_refuses_missing_meaningful_content():
    with pytest.raises(GenerationError):
        align_analysis("私は知らない雨を私が",fixture(),1)


def test_same_person_cannot_be_wagered_twice():
    a=align_analysis("私は雨を私が",fixture(),1).model_dump()
    with pytest.raises(ValueError):
        validate_stakes(a,["v1-u1","v1-u3"],12)
    for offer in make_offers(a,1,1):
        validate_stakes(a,offer['example_unit_ids'],offer['required_points'])


def test_exact_sum_and_duplicate_validation():
    a=align_analysis("私は雨を私が",fixture(),1).model_dump()
    with pytest.raises(ValueError): validate_stakes(a,["v1-u1"],7)
    with pytest.raises(ValueError): validate_stakes(a,["v1-u1","v1-u1"],12)


def test_unidentified_meaning_is_not_stakeable():
    raw=fixture()
    raw.units[1].concept_ids=[]
    a=align_analysis("私は雨を私が",raw,1)
    assert a.units[1].score==0
    assert ''.join(u.text for u in a.units)=="私は雨を私が"


def test_undefined_concept_never_becomes_a_stake():
    raw=fixture()
    raw.units[1].concept_ids=['missing-concept']
    a=align_analysis('私は雨を私が',raw,1)
    assert a.units[1].score==0 and a.units[1].concept_ids==[]
    assert ''.join(u.text for u in a.units)=='私は雨を私が'
    with pytest.raises(ValueError):
        validate_stakes(a.model_dump(),[a.units[1].id],0)
