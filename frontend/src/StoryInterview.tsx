import { useState, useRef } from 'react';
import { StagePublisher } from './Anoma';
import { interviewDialogue as d } from './sceneDialogue';
import { api, requestId } from './api';
import { GenerationSkeleton } from './GenerationSkeleton';
import type { Session } from './types';

const SHORT_ANSWER = 10;
type Answer = { question: string; text: string };
type Story = { generated_story_id: string; title: string; intro: string; text: string };

function drawQuestions() {
  const pool = [...d.questions];
  const draw = () => pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
  return [d.name, draw(), draw()];
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
  const saved = useRef<{ key: string; story: Story; sid: string } | undefined>(undefined);
  const index = answers.length;
  const question = questions[index];
  const value = input.trim();
  const contact = /[\w.+-]+@[\w.-]+\.[\w-]+|(?:\+?\d[\s().‐‑–ー-]*){9,}\d/u.test(
    (first + ' ' + value).normalize('NFKC')
  );
  const line = first ? d.more : question;
  function answer() {
    if (!value || contact || busy) return;
    if (!index && !first) setName(value);
    if (index !== 0 && !first && Array.from(value).length < SHORT_ANSWER) {
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
        const key = JSON.stringify(payload);
        if (saved.current?.key !== key) {
          const story = await api<Story>('/stories/generate', payload);
          saved.current = { key, story, sid: requestId() };
        }
        const { story, sid } = saved.current;
        accept(await api<Session>('/sessions', { generated_story_id: story.generated_story_id,
          title: story.title, intro: story.intro, custom_text: story.text, request_id: sid }));
      } finally { setWaiting(false); }
    });
  }
  return <main className="story-interview">
    <StagePublisher expression="normal" lines={!index && !first ? [d.intro, d.caution, question] : [line]} />
    {waiting ? <GenerationSkeleton /> : <>
      <label htmlFor="interview-answer">{line}</label>
      <textarea id="interview-answer" rows={2} value={input} disabled={busy}
        maxLength={!index && !first ? 40 : 480} onChange={event => setInput(event.target.value)} />
      <small>{d.note}</small>
      {contact && <small role="alert">{d.contact}</small>}
      <button className="primary" onClick={answer} disabled={!value || contact || busy}>答える</button>
      <button className="secondary interview-preset" onClick={onPreset} disabled={busy}>プリセットの文で始める</button>
    </>}
  </main>;
}
