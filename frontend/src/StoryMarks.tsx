import { StagePublisher } from './Anoma';
import { WagerManuscript } from './Manuscript';
import type { Unit } from './types';

const markLine = '本当に変えられたくない記憶には印をつけておくんだよ。もっとも、それを賭けるのが楽しいんだけどね';

export function StoryMarks({ text, units, marks, onChange, busy }: {
  text: string; units: Unit[]; marks: string[]; onChange: (ids: string[]) => void; busy: boolean;
}) {
  function toggle(id: string) {
    onChange(marks.includes(id) ? [] : [id]);
  }
  return <section className="story-marks" aria-labelledby="story-marks-heading">
    <h3 id="story-marks-heading">印をつける</h3>
    <StagePublisher expression="normal" lines={[markLine]} />
    <WagerManuscript text={text} units={units} selected={marks} markIds={marks} disabled={busy} onToggle={toggle} />
  </section>;
}
