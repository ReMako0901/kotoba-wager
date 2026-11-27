from unittest.mock import AsyncMock, Mock

import pytest
from fastapi.testclient import TestClient

from app import main, story_generation as generation
from app.gemini import Result
from app.store import Store

ANSWERS = [{'question': q, 'text': a} for q, a in
           [('お名前は？', 'ミオ 海の色から'), ('今の気分は？', '明るい'), ('好きなものは？', '小さな鍵')]]
PAYLOAD = {'name': 'ミオ', 'answers': ANSWERS}
# Same length range, six and five stakeable units respectively.
GOOD = '私は駅で猫と犬と鳥と虫をじっと見つめていた。'
FEW = '私は駅で猫と犬と鳥をずっとじっと見つめていた。'


@pytest.mark.parametrize('texts, fallback', [([GOOD], False), ([FEW, GOOD], False), ([FEW, FEW], True)])
def test_generate_and_start(tmp_path, monkeypatch, texts, fallback):
    reserve = AsyncMock()
    generate = AsyncMock(side_effect=[
        Result(generation.GeneratedStory(title='鍵', intro='私はミオ。', text=text), {}, 0)
        for text in texts
    ])
    save = Mock()
    monkeypatch.setattr(generation, 'reserve_call', reserve)
    monkeypatch.setattr(generation.gemini, 'generate', generate)
    monkeypatch.setattr(generation, 'save_generated', save)
    monkeypatch.setattr(main, 'store', Store(tmp_path))
    client = TestClient(main.app)
    response = client.post('/api/stories/generate', json=PAYLOAD)
    assert response.status_code == 200
    story = response.json()
    assert reserve.await_count == generate.await_count == len(texts)
    if len(texts) == 2:
        assert generate.await_args_list[0].args[0] != generate.await_args_list[1].args[0]
    story_id = story.pop('generated_story_id')
    units = story.pop('analysis')['units']
    save.assert_called_once_with(story_id, {**PAYLOAD, **story})
    assert 'ミオ' in story['intro']
    assert (story['text'] != GOOD) == fallback
    assert sum(u.stakeable for u in generation.build_analysis(story['text'], 1).units) >= 6
    start = dict(request_id='interview-session', custom_text=story.pop('text'),
                 generated_story_id=story_id, **story)
    assert client.post('/api/sessions', json=start).status_code == 422
    start['mark_ids'] = [next(u['id'] for u in units if u['stakeable'])]
    session = client.post('/api/sessions', json=start)
    assert session.status_code == 202
    assert session.json()['title'] == story['title']
    assert main.store.load(start['request_id'])['generated_story_id'] == story_id


@pytest.mark.parametrize('field, value', [('name', 'abc@example.com'), ('text', '０９０－１２３４－５６７８'),
                                           ('question', '03 (1234) 5678')])
def test_contact_rejected_before_generation(monkeypatch, field, value):
    generate = AsyncMock()
    save = Mock()
    monkeypatch.setattr(generation.gemini, 'generate', generate)
    monkeypatch.setattr(generation, 'save_generated', save)
    payload = {**PAYLOAD, 'answers': [dict(a) for a in ANSWERS]}
    (payload if field == 'name' else payload['answers'][1])[field] = value
    response = TestClient(main.app).post('/api/stories/generate', json=payload)
    assert response.status_code == 422
    assert '使えません' in response.json()['detail']
    generate.assert_not_awaited()
    save.assert_not_called()


def test_finalize_updates_existing_generated_story(monkeypatch):
    write = Mock()
    monkeypatch.setattr(generation, 'write_generated', write)
    story_id = 'a' * 32
    payload = {'final_text': GOOD, 'final_intro': '私はミオ。'}
    client = TestClient(main.app)
    url = f'/api/stories/generated/{story_id}/finalize'
    assert client.post(url, json=payload).status_code == 200
    write.assert_called_once_with(story_id, payload, finalize=True)
    assert client.post(url, json={**payload, 'final_text': '短い'}).status_code == 422
    assert write.call_count == 1
