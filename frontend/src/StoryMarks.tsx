import { WagerManuscript } from './Manuscript';
import type { Unit } from './types';

export const markLine = 'それでも、本当に変えられたくない記憶には印をつけておくんだよ。もっとも、それを賭けるのが楽しいんだけどね';

export function StoryMarks({ text, units, marks, onChange, busy }: {
  text: string; units: Unit[]; marks: string[]; onChange: (ids: string[]) => void; busy: boolean;
}) {
  function toggle(id: string) {
    if (marks.includes(id)) onChange(marks.filter(mark => mark !== id));
    else if (marks.length < 3) onChange([...marks, id]);
  }
  return <>
    <small aria-live="polite">失いたくない言葉に印をつける（{marks.length} / 3）</small>
    <WagerManuscript text={text} units={units} selected={marks} markIds={marks} disabled={busy} onToggle={toggle} />
  </>;
}
