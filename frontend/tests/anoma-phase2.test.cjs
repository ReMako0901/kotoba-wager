const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { mount } = require('./component-harness.cjs');
const { expressionForTrigger, expressionForEnding } = require('../src/scenario.ts');
const { AnomaFrame, AnomaResult, Opening } = require('../src/Anoma.tsx');
const { StoryDecision, NormalEnding } = require('../src/StoryProgress.tsx');
const current = ui => ui.find(n => n.type === 'img' && n.props.className.includes('anoma-portrait-current'));
const tx = (outcome, extra = {}) => ({ id: 'round', status: 'committed', outcome, lost: [], ...extra });
const progress = (phase, difference = 0) => ({ phase, totals: { rounds: 5, gained: 2, lost: 2, difference }, extension_start: 5 });

test('all result triggers use the specified expressions and retain reaction kinds', () => {
  assert.deepEqual(expressionForTrigger, { gain: 'smile', winStreak: 'laugh', loss: 'taunt', lossStreak: 'perplexed', change: 'uncanny' });
  for (const [transactions, expression, reaction] of [
    [[tx('win')], 'smile', 'gain'], [[tx('win'), tx('win')], 'laugh', 'gain'],
    [[tx('loss')], 'taunt', 'loss'], [[tx('loss'), tx('loss')], 'perplexed', 'loss'],
    [[tx('loss', { lost: [{}, {}] })], 'uncanny', 'change'],
  ]) {
    const ui = mount(AnomaResult, { transactions });
    assert.equal(current(ui).props.src, `/anoma/${expression}.webp`);
    assert.equal(ui.find(n => n.props['data-reaction']).props['data-reaction'], reaction);
  }
});

test('opening, arrival, extension welcome and all ending signs select their expressions', () => {
  assert.equal(current(mount(Opening, { busy: false, onComplete() {} })).props.src, '/anoma/normal.webp');
  for (const [phase, expression] of [['escapable', 'surprise'], ['extension', 'taunt']]) {
    const ui = mount(StoryDecision, { progress: progress(phase), busy: false, onChoice() {} });
    assert.ok(ui.all(n => n.type === 'img' && n.props.className.includes('current')).every(n => n.props.src === `/anoma/${expression}.webp`));
  }
  for (const [difference, expression] of [[10, 'smile'], [0, 'normal'], [-10, 'displeased']]) {
    assert.equal(expressionForEnding(difference), expression);
    const ui = mount(NormalEnding, { progress: progress('ended', difference), onTitle() {} });
    assert.equal(current(ui).props.src, `/anoma/${expression}.webp`);
  }
});

test('portrait remembers the last loaded expression across frames, overlays and removes the previous image', () => {
  const first = mount(AnomaFrame, { line: 'a', expression: 'normal' });
  current(first).props.onLoad(); first.draw();
  const next = mount(AnomaFrame, { line: 'b', expression: 'surprise' });
  assert.equal(next.find(n => n.props.className === 'anoma-portrait-previous').props.src, '/anoma/normal.webp');
  assert.ok(!current(next).props.className.includes('anoma-portrait-fade'));
  current(next).props.onLoad(); next.draw();
  assert.ok(current(next).props.className.includes('anoma-portrait-fade'));
  assert.ok(next.all(n => n.type === 'img').every(n => n.props.alt === ''));
  current(next).props.onAnimationEnd(); next.draw();
  assert.equal(next.all(n => n.type === 'img').length, 1);
  next.draw({ line: 'c', expression: 'laugh' });
  assert.equal(current(next).props.src, '/anoma/laugh.webp');
  assert.equal(next.find(n => n.props.className === 'anoma-portrait-previous').props.src, '/anoma/surprise.webp');
});

test('failure of either layer hides the whole portrait and keeps the accessible dialogue', () => {
  for (const layer of ['anoma-portrait-current', 'anoma-portrait-previous']) {
    const first = mount(AnomaFrame, { line: 'a', expression: 'normal' });
    current(first).props.onLoad(); first.draw();
    const ui = mount(AnomaFrame, { line: '台詞', expression: 'uncanny' });
    ui.find(n => n.type === 'img' && n.props.className.includes(layer)).props.onError(); ui.draw();
    assert.equal(ui.all(n => n.type === 'img').length, 0);
    assert.ok(ui.find(n => n.props['aria-label'] === 'アノマの台詞'));
  }
});

test('CSS provides square overlapping portraits, 900ms fade and immediate reduced motion', () => {
  const css = fs.readFileSync('frontend/src/anoma.css', 'utf8');
  assert.match(css, /aspect-ratio:\s*1/);
  assert.match(css, /250px/);
  assert.match(css, /\.anoma-portrait img\s*\{[^}]*position:\s*absolute/);
  assert.match(css, /animation:\s*anoma-expression-fade 900ms/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.anoma-portrait-current\s*\{\s*animation:\s*none;\s*opacity:\s*1/);
  assert.match(css, /\.anoma-portrait-previous\s*\{\s*display:\s*none/);
});
