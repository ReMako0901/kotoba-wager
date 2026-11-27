from app import title_words


def test_title_words_filters_saved_stories(monkeypatch):
    record = dict(title='おやつ', text='古い時計を見た。', final_text='猫はプリンとプリンを買った。', name='猫')
    records = [record, dict(record, title='バカな話', final_text='金魚を見た。'),
               dict(record, text='死ねと言った。', final_text='栗を拾った。'),
               dict(record, final_text='連絡先は test@example.com です。')]
    monkeypatch.setattr(title_words, 'generated_records', lambda: records)
    words = title_words.title_words()
    assert 'プリンと' in words
    assert len(words) == len(set(words))
    assert all(fragment not in ''.join(words) for fragment in ('猫', '時計', '金魚', '栗', 'example', 'test', 'com'))


def test_title_words_read_failure(monkeypatch):
    def failed_read():
        raise OSError()
    monkeypatch.setattr(title_words, 'generated_records', failed_read)
    assert title_words.title_words() == []
