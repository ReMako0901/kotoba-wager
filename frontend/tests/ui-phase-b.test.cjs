const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = name => fs.readFileSync(`frontend/src/${name}`, 'utf8');

test('Phase B removes the specified display text and metadata', () => {
  const all = ['App.tsx', 'GamblePlay.tsx', 'BeginnerPlay.tsx', 'StoryHistory.tsx', 'StoryProgress.tsx', 'gamblePresentation.ts', 'GambleMotion.tsx'].map(source).join('\n');
  for (const phrase of ['勝率', '遊び方', '変化の形', 'changeShapes', 'option.description', 'o.family',
    '物語の準備ができた', '物語を準備しています', '準備完了。', '物語も準備中', '赤線の言葉をタップ', 'REGは大きく', '報酬は得られず',
    '裏向きのカードを選ぶ', '表のカードを覚えて', 'シャッフル中…', '当たりのカードを選ぶ',
    '4〜6で勝ち', 'あいこは同じ言葉と報酬', 'wager-context', 'ことばを仕分け中',
    'お話をリミックス中', 'stake-preview', 'selection-incomplete', '候補を一巡', '進行は残っています',
    '導入は賭けや書き換えの対象', '文字入力してください', '規定回数に到達しました',
    '右下を左上へ：', '反映待ちの取引は', 'このギャンブルで賭ける', 'function Status']) {
    assert.ok(!all.includes(phrase), phrase);
  }
  assert.doesNotMatch(source('StoryHistory.tsx'), /賭けた言葉：|報酬：/);
  assert.doesNotMatch(source('StoryProgress.tsx'), /<h2>/);
  assert.doesNotMatch(source('App.tsx'), /modal-intro|win_probability/);
});

test('retains required content, errors, stage, manual actions and readiness UI', () => {
  const app = source('App.tsx'), play = source('GamblePlay.tsx');
  for (const value of ['<AnomaStage portraitFocus=', '<AnomaStageProvider>', 'custom-story-intro', 'custom-story-text',
    '{customCount} / {MAX_STORY}文字', '第{round}章', 'selectedCount', '!stakesReady || busy || !games.length']) assert.ok(app.includes(value), value);
  for (const value of ['この結果を物語へ', 'spinner', 'disabled={busy || (!prepared && !error)}',
    'props.error', 'role="alert"', 'STOP', 'HIT', 'STAND', '勝利', '敗北', 'label="アノマ"', 'バンカー', 'プレイヤー']) assert.ok(play.includes(value), value);
  assert.ok(source('BeginnerPlay.tsx').includes('<span>アノマ</span>'));
  assert.ok(source('gamblePresentation.ts').includes('export function isNearMiss'));
});

test('corner arrows share the existing direction bounds and accessible drag controls', () => {
  const paper = source('StoryHistory.tsx'), css = source('book-manuscript.css');
  assert.match(paper, /filter\(direction => index \+ direction >= 0 && index \+ direction < versions.length\)/);
  assert.match(paper, /className="paper-turn-arrow" aria-hidden="true">\{direction === -1 \? '↖' : '↘'\}/);
  assert.match(paper, /aria-label=\{direction === -1 \? '右下の角を左上へドラッグして前の版へ' : '左上の角を右下へドラッグして次の版へ'\}/);
  assert.match(css, /animation:paper-turn-hint 1\.6s ease-in-out 3/);
  assert.match(css, /@keyframes paper-turn-hint.*translate\(/);
  assert.match(css, /\.corner-older \.paper-turn-arrow\{rotate:180deg;--hint-step:-3px\}/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)\{\.paper-turn-arrow\{animation:none\}\}/);
});
