import { useEffect, useState, type CSSProperties } from 'react';
import { api } from './api';

function placement(word: string): CSSProperties {
  let hash = 2166136261;
  for (const letter of word) hash = Math.imul(hash ^ letter.codePointAt(0)!, 16777619);
  const seed = hash >>> 0;
  const depth = (seed >>> 24) / 255;
  return {
    left: `${8 + seed % 85}%`,
    top: `${7 + (seed >>> 10) % 87}%`,
    fontSize: `${11 + depth * 8}px`,
    opacity: 0.15 + depth * 0.18,
    transform: `translateZ(${depth * 90 - 65}px) translate(-50%, -50%)`,
    animationDelay: `-${seed % 17}s`,
  };
}

export function TitleWords() {
  const [words, setWords] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    api<string[]>('/title-words').then(result => {
      if (active && Array.isArray(result)) setWords(result.slice(0, 16));
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  if (!words.length) return null;
  return <div className="title-words" aria-hidden="true">
    {words.map(word => <span key={word} style={placement(word)}><i>{word}</i></span>)}
  </div>;
}
