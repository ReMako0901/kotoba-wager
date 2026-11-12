type ChangeMark = 'rewritten' | 'cut-before' | 'cut-after';

export function manuscriptChanges(before: string, after: string) {
  const oldText = Array.from(before);
  const newText = Array.from(after);
  const common = Array.from({ length: oldText.length + 1 }, () => new Uint32Array(newText.length + 1));

  for (let i = oldText.length - 1; i >= 0; i--) {
    for (let j = newText.length - 1; j >= 0; j--) {
      common[i][j] = oldText[i] === newText[j]
        ? common[i + 1][j + 1] + 1
        : Math.max(common[i + 1][j], common[i][j + 1]);
    }
  }

  const marks = new Map<number, ChangeMark>();
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldText.length || newIndex < newText.length) {
    if (oldIndex < oldText.length && oldText[oldIndex] === newText[newIndex]) {
      oldIndex++;
      newIndex++;
      continue;
    }

    const start = newIndex;
    while (oldIndex < oldText.length || newIndex < newText.length) {
      if (oldIndex < oldText.length && oldText[oldIndex] === newText[newIndex]) break;
      if (oldIndex < oldText.length && common[oldIndex + 1][newIndex] >= (common[oldIndex][newIndex + 1] ?? 0)) {
        oldIndex++;
      } else {
        if (newText[newIndex].trim()) marks.set(newIndex, 'rewritten');
        newIndex++;
      }
    }

    // A pure deletion has no new glyph. Mark the seam where the text joined.
    if (start === newIndex) {
      const next = newText.findIndex((glyph, index) => index >= start && !!glyph.trim());
      if (next >= 0) marks.set(next, 'cut-before');
      else {
        let previous = start - 1;
        while (previous >= 0 && !newText[previous].trim()) previous--;
        if (previous >= 0 && !marks.has(previous)) marks.set(previous, 'cut-after');
      }
    }
  }
  return marks;
}
