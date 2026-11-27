"""Track the marked source occurrence through literal edits and manuscript versions."""
from difflib import SequenceMatcher
from .gemini import ReviewRejected


def protected_units(tx):
    lost_ids = set(tx['unit_ids']) if tx['outcome'] == 'loss' else set()
    return [u for u in tx.get('marked_units', []) if u['id'] not in lost_ids]


def map_edits(original, edits, units):
    """Map untouched offsets. An edit covering a mark must retain its exact characters."""
    starts = []
    for u in units:
        start, end = u['start'], u['end']
        shift = 0
        for left, right, after in sorted(edits):
            if right <= start:
                shift += len(after) - (right - left)
            elif left < end:
                # Include either end of a mark if an edit covers only part of it.
                lo, hi = min(left, start), max(right, end)
                changed = original[lo:left] + after + original[right:hi]
                surface = u['text']
                if original[lo:hi].count(surface) > 1 and changed.count(surface) < original[lo:hi].count(surface):
                    raise ReviewRejected('同じ表現のどの箇所を残したか確認できません。')
                for a, b, size in SequenceMatcher(None, original[lo:hi], changed, autojunk=False).get_matching_blocks():
                    if a <= start - lo and end - lo <= a + size:
                        shift += b - a
                        break
                else:
                    raise ReviewRejected('印付きのコマは一字一句そのまま残してください。')
        starts.append(start + shift)
    return starts


def marked_ranges(tx, text, starts):
    units = protected_units(tx)
    if not units:
        return []
    if starts is None:
        starts = map_edits(tx['before'], [(0, len(tx['before']), text)], units)
    if len(starts) != len(units):
        raise ReviewRejected('印付きのコマの位置を確認できません。')
    ranges = []
    for start, unit in zip(starts, units):
        end = start + len(unit['text'])
        if start < 0 or text[start:end] != unit['text'] or (ranges and start < ranges[-1][1]):
            raise ReviewRejected('印付きのコマは一字一句そのまま残してください。')
        ranges.append((start, end))
    return ranges
