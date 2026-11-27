import { useState, useEffect, useRef } from 'react';
import { StagePublisher } from './Anoma';
import { interviewDialogue as d } from './sceneDialogue';
import { api, requestId } from './api';
import { GenerationSkeleton } from './GenerationSkeleton';
import type { Session } from './types';

const SHORT_ANSWER = 5;
type Answer = { question: string; text: string };
type Story = { generated_story_id: string; title: string; intro: string; text: string };

function drawQuestions() {
  const pool = [...d.questions];
  const draw = () => pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
  return [{ question: d.name, followup: '' }, draw(), draw()];
}

export function StoryInterview({ busy, act, onPreset, accept }: {
  busy: boolean; act: (fn: () => Promise<void>) => Promise<void>; onPreset: () => void; accept: (s: Session) => void;
}) {
  const [questions] = useState(drawQuestions);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [name, setName] = useState('');
  const [first, setFirst] = useState('');
  const [input, setInput] = useState('');
  const [waiting, setWaiting] = useState(false);
  const [introLine, setIntroLine] = useState(true);
  const [story, setStory] = useState<Story>();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState('');
  const [intro, setIntro] = useState('');
  const sid = useRef('');
  useEffect(() => {
    if (!introLine) return;
    const timer = window.setTimeout(() => setIntroLine(false), 2200);
    return () => window.clearTimeout(timer);
  }, [introLine]);
  const index = answers.length;
  const { question, followup } = questions[index];
  const value = input.trim();
  const contact = /[\w.+-]+@[\w.-]+\.[\w-]+|(?:\+?\d[\s().‐‑–ー-]*){9,}\d/u.test(
    (first + ' ' + value).normalize('NFKC')
  );
  const line = first ? followup : question;
  function answer() {
    if (!value || contact || busy) return;
    if (!index && !first) setName(value);
    if (index !== 0 && !first && Array.from(value).length <= SHORT_ANSWER) {
      setFirst(value); setInput(''); return;
    }
    const next = [...answers, { question, text: first ? first + ' ' + value : value }];
    if (next.length < questions.length) {
      setAnswers(next); setFirst(''); setInput(''); return;
    }
    void act(async () => {
      setWaiting(true);
      try {
        const payload = { name, answers: next };
        const generated = await api<Story>('/stories/generate', payload);
        sid.current = requestId();
        setStory(generated);
        setBody(generated.text);
        setIntro(generated.intro);
      } finally { setWaiting(false); }
    });
  }
  if (story) {
    const finalText = body.trim(), finalIntro = intro.trim();
    const start = () => act(async () => {
      if (finalText !== story.text || finalIntro !== story.intro) {
        await api('/stories/generated/' + story.generated_story_id + '/finalize', {
          final_text: finalText, final_intro: finalIntro
        });
      }
      accept(await api<Session>('/sessions', { generated_story_id: story.generated_story_id,
        title: story.title, intro: finalIntro, custom_text: finalText, request_id: sid.current }));
    });
    return <main className="story-interview">
      <StagePublisher expression="normal" lines={['これでいいかしら？']} />
      <h2>{story.title}</h2>
      {editing ? <>
        <label>導入<textarea value={intro} maxLength={500} disabled={busy} onChange={e => setIntro(e.target.value)} /></label>
        <label>本文（20〜100文字）<textarea rows={4} value={body} disabled={busy} onChange={e => setBody(e.target.value)} /></label>
        <button className="primary" disabled={busy || [...finalText].length < 20 || [...finalText].length > 100} onClick={start}>これで始める</button>
      </> : <>
        <p>{intro}</p><p>{body}</p>
        <div className="review-actions">
          <button disabled={busy} onClick={() => setEditing(true)}>手動で修正する</button>
          <button className="primary" disabled={busy} onClick={start}>はい</button>
        </div>
      </>}
    </main>;
  }
  return <main className="story-interview">
    <StagePublisher expression="normal" lines={[introLine ? d.intro : line]} />
    {waiting ? <GenerationSkeleton /> : <>
      {introLine && <button className="interview-advance" aria-label="質問へ進む" onClick={() => setIntroLine(false)} />}
      {!introLine && <>
      <textarea aria-label={line} id="interview-answer" rows={2} value={input} disabled={busy}
        maxLength={!index && !first ? 40 : 480} onChange={event => setInput(event.target.value)} />
      <small>{d.note}</small>
      {contact && <small role="alert">{d.contact}</small>}
      <button className="primary" onClick={answer} disabled={!value || contact || busy}>答える</button></>}
      <button className="secondary interview-preset" onClick={onPreset} disabled={busy}>プリセットの文で始める</button>
    </>}
  </main>;
}
