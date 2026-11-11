import pytest
from app.analysis import build_analysis,make_offers,validate_stakes

TEXT='私の隣の席には、料理好きのロボットがいる。昼休み、彼はお弁当と一緒にラブレターをくれた。宛名は、私の炊飯器だった。'


def test_content_chips_are_equal_and_connectors_are_not_wagered():
    a=build_analysis(TEXT,1)
    assert ''.join(u.text for u in a.units)==TEXT
    assert all(TEXT[u.start:u.end]==u.text for u in a.units)
    for word in ['お弁当と','一緒に','宛名は']:
        assert next(u for u in a.units if u.text==word).stakeable
    assert not next(u for u in a.units if u.text=='いる').stakeable
    assert all('score' not in u.model_dump() for u in a.units)
    assert all(not u.stakeable for u in a.units if u.text in ['。','、'])


def test_any_pair_is_accepted_without_semantic_or_value_matching():
    a=build_analysis(TEXT,1).model_dump()
    choices=[u for u in a['units'] if u['stakeable']]
    for i,x in enumerate(choices):
        for y in choices[i+1:]:
            assert len(validate_stakes(a,[x['id'],y['id']],2))==2
    repeated=[u['id'] for u in choices if u['text']=='私の']
    assert len(repeated)==2
    assert len(validate_stakes(a,repeated,2))==2


def test_exact_count_duplicates_stale_ids_and_punctuation():
    a=build_analysis(TEXT,1).model_dump()
    valid=next(u['id'] for u in a['units'] if u['stakeable'])
    punctuation=next(u['id'] for u in a['units'] if not u['stakeable'])
    with pytest.raises(ValueError):validate_stakes(a,[valid],2)
    with pytest.raises(ValueError):validate_stakes(a,[valid,valid],2)
    with pytest.raises(ValueError):validate_stakes(a,['old-id'],1)
    with pytest.raises(ValueError):validate_stakes(a,[punctuation],1)


def test_offers_use_counts_and_separate_reward_scale_from_round_phase():
    a=build_analysis(TEXT,1).model_dump()
    for round_number in [1,3,5,20]:
        offers=make_offers(a,round_number,1)
        assert [o['required_count'] for o in offers]==[1,2,3]
        assert [o['change_scale'] for o in offers]==[1,2,3]
        assert all('required_points' not in o for o in offers)


def test_one_chip_remaining_never_has_an_impossible_price():
    a=build_analysis('猫。',1).model_dump()
    assert [o['required_count'] for o in make_offers(a,1,1)]==[1]
    assert make_offers(a,1,1)[0]['change_scale']==1


def test_action_chains_and_adverbs_remain_plain_text():
    text='私は晴れた日に、黄色い傘を持って出た。なぜか浮き輪を二つ持ってきた。'
    a=build_analysis(text,1)
    by_text={u.text:u for u in a.units}
    for word in ['持って出た','なぜか','持ってきた']:
        assert not by_text[word].stakeable
        with pytest.raises(ValueError):
            validate_stakes(a.model_dump(),[by_text[word].id],1)
    for word in ['私は','晴れた日に','黄色い','傘を','浮き輪を','二つ']:
        assert by_text[word].stakeable
    assert ''.join(u.text for u in a.units)==text
    assert all(text[u.start:u.end]==u.text for u in a.units)
