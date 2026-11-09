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
