"""Complete a settled trade when Gemini cannot return a usable story."""
from .gemini import GenerationError
from .models import Rewrite
from .marks import protected_units, map_edits

WIN_ENDINGS = {
    'ちょっと名文': 'そのひとときは、しおりを挟みたくなる一ページのようだった。',
    'ラッキーな発見': 'ふと足元を見ると、なくしたと思っていた小さなお守りが見つかった。',
    'まさかの出来事': '気づけば、思いがけない拍手に包まれていた。',
    'いい感じの空気': 'その場の空気が、やわらかな余韻として感じられた。',
    'うれしい知らせ': 'そこへ、ずっと待っていた知らせが届いた。願いがかなったのだ。',
    '新しい出会い': '帰り道で出会った旅人と、また会う約束をした。',
    'ひとことの魔法': 'その瞬間は、時の流れに浮かぶ小さな灯だった。',
    'まさかの正体': 'あとになって、この出来事が友人からの贈り物だったと分かった。',
    '新しい行き先': 'それを機に、次の朝から新しい町へ向かうことにした。',
    '鮮やかな比喩': 'そのひとときは、そっと磨かれた宝石のようだった。',
    '心の声': 'このひとときを大切にしたいと、心の中で思った。',
    '次の場面へ': 'やがて翌朝を迎え、その続きへ踏み出した。',
    '新しい場所': 'その先に小さな広場を見つけ、足を踏み入れた。',
    '誰かの約束・目的': 'もう一度ここを訪れようと決め、その準備を始めた。',
    '関係の変化': 'この出来事を機に、互いに頼れる仲になった。',
    '小さな危機の接近': '雨雲が近づいてきたので、濡れる前に歩を進めた。',
}


def local_concepts(units):
    return [
        {
            'id': unit['id'], 'label': unit['text'], 'kind': 'object',
            'description': f'本文中の「{unit["text"]}」が指す内容',
            'selected_surfaces': [unit['text']], 'anchors': [unit['text']],
            'mentions': [unit['text']], 'depends_on': [],
        }
        for unit in units
    ]


def complete_story(tx, past_losses):
    original = tx['before']
    won = tx['outcome'] == 'win'
    if won:
        prefix = original
        ending = WIN_ENDINGS.get(tx['offer']['title'], '最後には、小さな喜びが残った。')
        if original.endswith(ending):
            ending = 'その余韻は、しばらく心に残った。'
        summary = f'物語に「{tx["offer"]["title"]}」を加えました。'
    else:
        from .editing import sentences
        anchors = {surface for concept in tx['lost'] for surface in concept.get('mentions', [])}
        anchors.update(unit['text'] for unit in tx['selected_units'])
        offsets = [original.index(anchor) for anchor in anchors if anchor and anchor in original]
        cutoff = min(offsets, default=0)
        try:
            prefix = ''.join(chunk['text'] for chunk in sentences(original) if chunk['end'] <= cutoff)
        except GenerationError:
            prefix = ''
        ending = ('楽しみにしていたことはかなわず、長い沈黙だけが残った。'
                  if tx.get('gamble', {}).get('strength', 1) >= 4 else
                  '楽しみにしていた予定は流れ、残念な気持ちが残った。')
        summary = '賭けたことばに関わる場面が失われ、結末が変わりました。'
    excluded = [*past_losses, *tx['lost']]
    surfaces = {surface for concept in excluded for surface in concept.get('selected_surfaces', []) if surface}
    if any(surface in ending for surface in surfaces):
        endings = (('小さな幸運が訪れ、思わず笑顔になった。', 'うれしい余韻が残った。')
                   if won else ('やがて日が暮れた。', '空はすっかり暗くなった。', '長い夜が訪れた。'))
        ending = next((line for line in endings if not any(s in line for s in surfaces)), endings[0])
    marks = protected_units(tx)
    edits = []
    if marks and not won:
        # Keep surrounding prose. Remove selected occurrences and their resolved mentions
        # while giving a protected occurrence precedence over overlapping references.
        ranges = {(u['start'], u['end']) for u in tx['selected_units']}
        for anchor in anchors:
            pos = 0
            while anchor and (pos := original.find(anchor, pos)) >= 0:
                ranges.add((pos, pos + len(anchor)))
                pos += len(anchor)
        merged = []
        for start, end in sorted(ranges):
            if any(start < m['end'] and end > m['start'] for m in marks):
                continue
            if merged and start <= merged[-1][1]:
                merged[-1] = (merged[-1][0], max(end, merged[-1][1]))
            else:
                merged.append((start, end))
        edits = [(start, end, '') for start, end in merged]
        prefix = original
        for start, end, replacement in reversed(edits):
            prefix = prefix[:start] + replacement + prefix[end:]
    starts = map_edits(original, edits, marks)
    if prefix and prefix[-1] not in '。！？!?」』':
        prefix += '。'
    return Rewrite(
        mark_starts=starts, text=prefix + ending, summary=summary, changes=[summary],
        checks={'protected_retained': won, 'lost_absent': True, 'reward_realized': won,
                'notes': '定型文で補完。文脈に沿った意味の確認には限界があります。'},
    )
