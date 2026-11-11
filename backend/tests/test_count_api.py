from fastapi.testclient import TestClient
from app import main
from app.store import Store


def test_session_is_selectable_immediately_without_an_ai_call(tmp_path,monkeypatch):
    repo=Store(tmp_path)
    monkeypatch.setattr(main,'store',repo)
    monkeypatch.setattr(main.gemini,'configured',lambda:True)
    monkeypatch.setattr(main.engine,'spawn',lambda *_: (_ for _ in ()).throw(AssertionError('開始時のAIは不要')))
    def unexpected_segmentation(*_):
        raise AssertionError("開始文は保存済みの区切りを使う")

    monkeypatch.setattr(main, "build_analysis", unexpected_segmentation)
    with TestClient(main.app) as client:
        r=client.post('/api/sessions',json={'story_id':'robot-105','request_id':'count-api-session'})
        assert r.status_code==202
        s=r.json()
        assert s['status']=='ready' and s['api_calls']==0
        assert s['betting_mode']=='count-v1'
        assert [o['required_count'] for o in s['offers']]==[1,2,3]
        assert any(u['text']=='お弁当と' and u['stakeable'] for u in s['analysis']['units'])
        assert all('score' not in u for u in s['analysis']['units'])
        assert client.get('/api/sessions/count-api-session').json()['text']==s['text']


def test_old_points_state_is_not_silently_reinterpreted_as_count(tmp_path,monkeypatch):
    repo=Store(tmp_path);repo.save({'id':'old-session','status':'ready','transactions':[]})
    monkeypatch.setattr(main,'store',repo)
    with TestClient(main.app) as client:
        assert client.get('/api/sessions/old-session').status_code==409
    assert repo.load('old-session')['transactions']==[]
