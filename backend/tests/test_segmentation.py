import json
from pathlib import Path
import pytest
from app.segmentation import split_phrases
from app.models import Rewrite


def test_short_phrases_preserve_particles_and_auxiliary_verbs():
    parts=split_phrases('私は駅前でプリンを買った。王様が昼寝していた。')
    assert parts==['私は','駅前で','プリンを','買った','。','王様が','昼寝していた','。']


def test_spacing_emoji_and_newlines_are_preserved():
    text='私は 🍮を買った。\n猫が「こんにちは！」と鳴いた。'
    assert ''.join(split_phrases(text))==text


def test_starting_stories_are_short_and_fully_segmented():
    stories=json.loads((Path(__file__).parents[2]/'data/stories.json').read_text())
    for s in stories:
        assert 40<=len(s['text'])<=90
        parts=split_phrases(s['text'])
        assert ''.join(parts)==s['text']
        assert max(map(len,parts))<=12


def test_long_rewrites_cannot_grow_the_story():
    with pytest.raises(ValueError):
        Rewrite(text='あ'*141,summary='test',changes=['test'],checks={'protected_retained':True,'lost_absent':True,'reward_realized':True,'notes':''})


def test_compound_emotion_keeps_its_meaning_without_absorbing_next_action():
    text='拍子抜けして笑ってしまう。'
    assert split_phrases(text)==['拍子抜けして','笑ってしまう','。']
    assert split_phrases('拍子抜けだった。')==['拍子抜けだった','。']
    # Ordinary rhythm and a separate action must not become this idiom.
    assert split_phrases('拍子を合わせた。')==['拍子を','合わせた','。']


def test_te_form_does_not_merge_unrelated_actions():
    assert split_phrases('笑って走った。')==['笑って','走った','。']
    assert split_phrases('持って出た。')==['持って出た','。']


def test_external_dictionary_changes_both_boundaries_and_availability(tmp_path, monkeypatch):
    from app import segmentation
    path=tmp_path/'dictionary.json'
    path.write_text(json.dumps({'version':1,'fixed_compounds':['気が抜け'],
                                'non_wager_connectors':['一緒に']},ensure_ascii=False))
    rules=segmentation.load_selection_dictionary(path)
    monkeypatch.setattr(segmentation,'selection_dictionary',lambda:rules)
    assert segmentation.split_phrases('気が抜けた。')==['気が抜けた','。']
    assert segmentation.is_stakeable_phrase('気が抜けた')
    assert not segmentation.is_stakeable_phrase('一緒に')


def test_dictionary_rejects_invalid_data_instead_of_ignoring_it(tmp_path):
    from app.segmentation import load_selection_dictionary
    path=tmp_path/'dictionary.json'
    examples=[{'version':2,'fixed_compounds':[],'non_wager_connectors':[]},
              {'version':1,'fixed_compounds':['拍子抜け','拍子抜け'],'non_wager_connectors':[]},
              {'version':1,'fixed_compounds':[''],'non_wager_connectors':[]},
              {'version':1,'fixed_compounds':[],'non_wager_connectors':[1]},
              {'version':1,'fixed_compounds':[],'non_wager_connectors':[],'typo':[]},
              []]
    for value in examples:
        path.write_text(json.dumps(value))
        with pytest.raises(ValueError):load_selection_dictionary(path)
