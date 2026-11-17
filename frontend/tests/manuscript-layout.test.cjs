const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
require('./component-harness.cjs');
const { paperRows, paperPositions, focusFirstChange } = require('../src/Manuscript.tsx');

test('CSS owns ten fixed rows and one cell size; paper only scrolls horizontally', () => {
  const css = fs.readFileSync('frontend/src/manuscript.css', 'utf8');
  assert.deepEqual(css.match(/--paper-rows\s*:[^;]+/g), ['--paper-rows: 10']);
  assert.deepEqual(css.match(/--cell-size\s*:[^;]+/g), ['--cell-size: 32px']);
  const scroll = css.match(/\.paper-scroll\s*\{([^}]+)\}/)[1];
  assert.match(scroll, /overflow-x: auto/);
  assert.match(scroll, /overflow-y: hidden/);
  assert.doesNotMatch(scroll, /max-height/);
  const original = global.getComputedStyle;
  const originalDocument = global.document;
  global.document = { documentElement: {} };
  global.getComputedStyle = () => ({ getPropertyValue: name => name === '--paper-rows' ? '10' : '' });
  try { assert.equal(paperRows(), 10); } finally {
    if (originalDocument === undefined) delete global.document;
    else global.document = originalDocument;
    if (original === undefined) delete global.getComputedStyle;
    else global.getComputedStyle = original;
  }
});

test('all characters occupy consecutive squares, including Unicode and column-boundary punctuation', () => {
  for (const body of ['短い。', '長'.repeat(1000), 'あ'.repeat(10) + '、」小さいゃ。', '　字下げ\n\n「会話」🐈と月。'.repeat(15)]) {
    const { positions, columns } = paperPositions(body);
    const glyphs = Array.from(body);
    assert.equal(positions.size, glyphs.filter(c => c !== '\n' && c !== '\r').length);
    assert.deepEqual([...positions.values()], Array.from({ length: positions.size }, (_, i) => i));
    assert.equal([...positions.keys()].map(i => glyphs[i]).join(''), body.replace(/[\r\n]/g, ''));
    assert.equal(columns, Math.max(8, Math.ceil(positions.size / 10)));
  }
});

test('initial focus centers the FIRST change and context even if another change is visible', () => {
  for (const [left, initial] of [[-700, 0], [600, -900], [10, -500]]) {
    const scroll = { scrollLeft: initial, getBoundingClientRect: () => ({ left: 0, right: 320 }) };
    const first = { getBoundingClientRect: () => ({ left, right: left + 32 }) };
    const paper = { parentElement: scroll, querySelector: selector => {
      assert.equal(selector, '.result-change'); return first;
    } };
    focusFirstChange(paper);
    const movement = scroll.scrollLeft - initial;
    assert.equal(left - movement, 144);
    assert.equal(left + 32 - movement, 176);
  }
  focusFirstChange({ parentElement: null, querySelector: () => null });
});
