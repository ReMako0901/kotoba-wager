const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { mount } = require('./component-harness.cjs');
const { stageMount, PortraitPublisher } = require('./anoma-stage-harness.cjs');
const { AnomaStage } = require('../src/Anoma.tsx');
const current = ui => ui.find(n => n.props.className?.includes('anoma-portrait-current'));
const closed = ui => ui.find(n => n.props.className?.includes('anoma-portrait-closed'));
const finishFade = ui => {
  current(ui).props.onLoad(); ui.draw();
  current(ui).props.onAnimationEnd(); ui.draw();
};

test('squeeze hint is visual only, unopened only and disabled for reduced motion', () => {
  const source = fs.readFileSync('frontend/src/BaccaratCard.tsx', 'utf8');
  const css = fs.readFileSync('frontend/src/book-games.css', 'utf8');
  assert.ok(!source.includes('上下左右にスワイプして絞る'));
  assert.ok(source.includes('伏せ札。上下左右にスワイプ、または矢印キーで絞る'));
  assert.match(css, /\.baccarat-zoom\.squeeze-back\[data-hint="true"\]::after\s*\{[^}]*pointer-events: none;[^}]*animation: baccarat-corner-hint 3\.6s ease-in-out 3/);
  assert.match(css, /@keyframes baccarat-corner-hint/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.baccarat-zoom\.squeeze-back\[data-hint="true"\]::after \{ display: none;/);
});

test('breathing uses the full portrait and closed eyes share the absolute image geometry', () => {
  const css = fs.readFileSync('frontend/src/book.css', 'utf8');
  assert.match(css, /\.app-shell:not\(\[data-screen="game"\]\) \.anoma-portrait\s*\{[^}]*animation: anoma-breathe 6s/);
  assert.match(css, /scale\(1\.014\)/);
  assert.match(css, /\.anoma-portrait img\s*\{[^}]*position: absolute;\s*inset: 0;/);
  assert.match(css, /\.anoma-portrait-closed \{ visibility: hidden;/);
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /\.anoma-portrait \{ animation: none; transform: none;/);
  assert.match(reduced, /\.anoma-portrait-closed, \.anoma-portrait-talk \{ display: none;/);
});

test('blink waits for fade and closed asset load, overlays for 130ms and clears timers', () => {
  const ui = stageMount(PortraitPublisher, { expression: 'laugh', line: 'a' });
  const timers = new Map(); let serial = 0;
  window.setTimeout = (fn, delay) => { timers.set(++serial, { fn, delay }); return serial; };
  window.clearTimeout = id => timers.delete(id);
  assert.equal(closed(ui), undefined);
  finishFade(ui);
  assert.equal(closed(ui).props.src, '/anoma/laugh-closed.webp');
  assert.equal(timers.size, 0);
  closed(ui).props.onLoad(); ui.draw();
  const run = () => { const [id, timer] = [...timers].find(([, timer]) => timer.delay === 130 || timer.delay >= 2800); timers.delete(id); timer.fn(); ui.draw(); return timer.delay; };
  const delay = run();
  assert.ok(delay >= 2800 && delay <= 5500);
  assert.ok(closed(ui).props.className.includes('anoma-portrait-blinking'));
  assert.equal(run(), 130);
  assert.ok(!closed(ui).props.className.includes('anoma-portrait-blinking'));
  // Changing expression cancels the old blink and waits for the next fade.
  ui.draw({ expression: 'surprise', line: 'b' });
  assert.equal([...timers.values()].filter(timer => timer.delay >= 2800).length, 0);
  assert.equal(closed(ui), undefined);
  finishFade(ui); closed(ui).props.onLoad(); ui.draw();
  run(); // Unmount while the eyes are closed.
  ui.unmount();
  assert.equal(timers.size, 0);
});

test('missing closed asset disables that expression across remounts without hiding open eyes', () => {
  const ui = stageMount(PortraitPublisher, { expression: 'perplexed', line: 'a' });
  finishFade(ui);
  closed(ui).props.onError(); ui.draw();
  assert.equal(closed(ui), undefined);
  assert.ok(current(ui));
  ui.unmount();
  const next = stageMount(PortraitPublisher, { expression: 'perplexed', line: 'b' });
  finishFade(next);
  assert.equal(closed(next), undefined);
  next.unmount();
});

test('reduced motion never loads or schedules closed eyes, including preference changes', () => {
  const ui = mount(AnomaStage, {}, true);
  let notify; let removed = false;
  // The initial media preference already prevents blinking.
  finishFade(ui);
  assert.equal(closed(ui), undefined);
  ui.unmount();
  // Install a live media listener for the next mounted portrait.
  const media = { matches: false, addEventListener(_, fn) { notify = fn; }, removeEventListener(_, fn) { removed = fn === notify; } };
  // stageMount creates a fresh window; replace its media before changing expression.
  const live = stageMount(PortraitPublisher, { expression: 'normal', line: 'a' });
  window.matchMedia = () => media;
  live.draw({ expression: 'smile', line: 'b' });
  finishFade(live); closed(live).props.onLoad(); live.draw();
  live.tick();
  media.matches = true; notify(); live.draw();
  assert.equal(closed(live), undefined);
  live.tick();
  assert.equal(closed(live), undefined);
  live.unmount();
  assert.ok(removed);
});

test('speech starts on a new line, expires, and missing talk art leaves the base portrait', () => {
  const ui = stageMount(PortraitPublisher, { expression: 'composed', line: 'a' });
  const timers = new Map();
  window.setTimeout = (run, delay) => { timers.set(delay, run); return delay; };
  window.clearTimeout = delay => timers.delete(delay);
  const talk = () => ui.find(n => n.props.className?.includes('anoma-portrait-talk'));
  ui.draw({ expression: 'composed', line: 'こんにちは' });
  assert.match(talk().props.className, /anoma-portrait-speaking/);
  assert.equal(talk().props.src, '/anoma/composed-talk.webp');
  assert.equal(talk().props['data-ready'], false);
  current(ui).props.onLoad();
  talk().props.onLoad();
  ui.draw();
  assert.equal(talk().props['data-ready'], true);
  timers.get(850)();
  ui.draw();
  assert.doesNotMatch(talk().props.className, /anoma-portrait-speaking/);
  ui.draw({ expression: 'composed', line: 'もう一度' });
  assert.match(talk().props.className, /anoma-portrait-speaking/);
  talk().props.onError();
  ui.draw();
  assert.equal(talk(), undefined);
  assert.ok(current(ui));
  ui.unmount();
  assert.equal(mount(AnomaStage, {}, true).find(n => n.props.className?.includes('anoma-portrait-talk')), undefined);
});
