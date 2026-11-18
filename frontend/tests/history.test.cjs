// Run: node --test frontend/tests/history.test.cjs
// Compile the real TS/TSX modules in memory; no generated files or extra dependencies.
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { mount, text } = require('./component-harness.cjs');
const { storyVersions, changedCharacters } = require('../src/storyVersions.ts');
const { StoryPaperStack, StoryHistory, completesPaperTurn } = require('../src/StoryHistory.tsx');
function swipe(ui, direction, x = direction * 100, y = direction * 80, cancel = false) {
  const corner = ui.find(n => n.props?.className === `paper-corner corner-${direction === -1 ? 'older' : 'newer'}`);
  assert.ok(corner);
  const event = { isPrimary: true, button: 0, pointerId: 1, clientX: 0, clientY: 0,
    currentTarget: { setPointerCapture() {} } };
  corner.props.onPointerDown(event); ui.draw();
  corner.props.onPointerMove({ ...event, clientX: x, clientY: y }); ui.draw();
  const active = ui.find(n => n.props?.className === corner.props.className);
  active.props[cancel ? 'onPointerCancel' : 'onPointerUp']({ ...event, clientX: x, clientY: y });
  ui.draw(); ui.tick();
}
const tx = (source, before, after, outcome = 'win') => ({ id: `tx-${source}`, source_version: source,
  before, after, outcome, status: 'committed', stakes: ['鍵'], offer: { title: '新しい出会い' } });
const session = transactions => ({ version: 3, text: '最新の本文。', transactions,
  lost_concepts: [], api_calls: 0, model: 'test', usage: { input: 0, output: 0 } });
const paperProps = session => ({ session, dust: { grains: new Map() }, losses: [] });

test('versions use source version order and exclude uncommitted drafts without mutating data', () => {
  const s = session([tx(2, '中間。', '最新の本文。', 'loss'), tx(1, '最初。', '中間。'),
    { ...tx(3, '最新の本文。', '秘密の下書き。'), status: 'awaiting_reveal' }]);
  const original = JSON.stringify(s);
  assert.deepEqual(storyVersions(s).map(v => [v.version, v.round, v.text]),
    [[1, 0, '最初。'], [2, 1, '中間。'], [3, 2, '最新の本文。']]);
  assert.equal(JSON.stringify(s), original);
});
test('initial session and legacy transactions without source_version remain readable', () => {
  assert.deepEqual(storyVersions({ ...session([]), version: 1 }).map(v => v.text), ['最新の本文。']);
  const old = tx(1, '最初。', '中間。'); delete old.source_version;
  assert.deepEqual(storyVersions(session([old])).map(v => v.version), [1, 2]);
});
test('diff highlights additions, deletions, replacements, repeated characters and Unicode', () => {
  for (const [before, after, removed, added] of [
    ['鍵。', '金の鍵。', '', '金の'], ['金の鍵。', '鍵。', '金の', ''],
    ['猫。', '犬。', '猫', '犬'], ['ああ。', 'あ。', 'あ', ''], ['🐈。', '🌙。', '🐈', '🌙'],
  ]) {
    const diff = changedCharacters(before, after);
    const selected = (text, indices) => Array.from(text).filter((_, i) => indices.has(i)).join('');
    assert.equal(selected(before, diff.before), removed);
    assert.equal(selected(after, diff.after), added);
  }
  assert.equal(changedCharacters('同じ。', '同じ。').after.size, 0);
});
for (const outcome of ['win', 'loss']) test(`${outcome}: latest manuscript is on top and pages turn both ways`, () => {
  const s = session([tx(1, '最初。', '中間。'), tx(2, '中間。', '最新の本文。', outcome)]);
  const snapshot = JSON.stringify(s);
  const ui = mount(StoryPaperStack, paperProps(s), true);
  const manuscript = () => text(ui.find(n => n.props?.className === 'sr-only'));
  assert.equal(manuscript(), '最新の本文。');
  assert.equal(text(ui.find(n => n.props?.className === 'paper-turn-arrow')), '↖');
  assert.equal(ui.find(n => n.props?.['data-paper-count']).props['data-paper-count'], 3);
  assert.equal(ui.all(n => n.props?.className === 'paper-underlay').length, 2);
  assert.equal(ui.all(n => n.props?.className === 'paper-corner corner-newer').length, 0);
  assert.equal(ui.all(n => n.props?.className === 'vertical-paper').length, 1);
  assert.ok(ui.find(n => n.props?.className?.includes('result-change')));
  swipe(ui, -1); assert.equal(manuscript(), '中間。');
  assert.deepEqual(ui.all(n => n.props?.className === 'paper-turn-arrow').map(text), ['↖', '↘']);
  assert.equal(ui.all(n => n.props?.className?.includes('result-change')).length, 0);
  swipe(ui, -1); assert.equal(manuscript(), '最初。');
  assert.equal(ui.all(n => n.props?.className === 'paper-corner corner-older').length, 0);
  swipe(ui, 1); assert.equal(manuscript(), '中間。');
  swipe(ui, 1); assert.equal(manuscript(), '最新の本文。');
  assert.doesNotMatch(text(ui.tree), /賭けた言葉：|報酬：/);
  assert.ok(text(ui.tree).includes(outcome === 'win' ? '勝利' : '敗北'));
  assert.equal(JSON.stringify(s), snapshot);
});
test('history retains losses and counts plays instead of generation stats, initial and legacy pages remain readable', () => {
  const s = { ...session([tx(1, '最初。', '中間。')]), lost_concepts: [{ label: '鍵の意味' }], api_calls: 3 };
  const ui = mount(StoryHistory, { session: s });
  assert.match(text(ui.tree), /鍵の意味/); assert.match(text(ui.tree), /プレイ 1回/);
  swipe(ui, -1); assert.match(text(ui.tree), /最初。/);
  const initial = mount(StoryPaperStack, paperProps({ ...session([]), version: 1 }));
  assert.equal(initial.all(n => n.props?.className === 'paper-underlay').length, 0);
  assert.equal(initial.all(n => n.props?.role === 'slider').length, 0);
  assert.equal(initial.all(n => n.props?.className === 'paper-turn-arrow').length, 0);
});
test('result and history share manuscript stack and contain no comparison view', () => {
  const app = fs.readFileSync(path.resolve(__dirname, '../src/App.tsx'), 'utf8');
  const source = fs.readFileSync(path.resolve(__dirname, '../src/StoryHistory.tsx'), 'utf8');
  assert.match(app, /<StoryPaperStack session=\{session\} dust=\{dust\} losses=\{losses\} result/);
  assert.match(source, /<StoryPaperStack key=/);
  for (const value of [app, source]) assert.doesNotMatch(value, /StoryComparison|comparison-pair|変化前|変化後|最初と最新を比べる|dangerouslySetInnerHTML/);
  const ui = mount(StoryPaperStack, paperProps(session([tx(1, '<script>危険</script>', '自分の本文。')])));
  assert.ok(!text(ui.tree).includes('危険')); swipe(ui, -1);
  assert.ok(text(ui.tree).includes('<script>危険</script>'));
  assert.equal(ui.all(n => n.type === 'script').length, 0);
  assert.equal(ui.all(n => n.props?.dangerouslySetInnerHTML).length, 0);
});

test('diagonal release threshold, wrong direction, cancellation and reduced motion', () => {
  assert.equal(completesPaperTurn(-1, -64, -48), true);
  for (const [x, y] of [[-63, -48], [-64, -47], [-100, 0], [100, 80]])
    assert.equal(completesPaperTurn(-1, x, y), false);
  assert.equal(completesPaperTurn(1, 64, 48), true);
  for (const reduced of [false, true]) {
    const ui = mount(StoryPaperStack, paperProps(session([tx(1, '最初。', '最新。')])), reduced);
    swipe(ui, -1, -63, -80);
    assert.match(text(ui.tree), /第2版/);
    swipe(ui, -1, -100, -80, true);
    assert.match(text(ui.tree), /第2版/);
    const corner = ui.find(n => n.props?.className === 'paper-corner corner-older');
    const e = { isPrimary: true, button: 0, pointerId: 4, clientX: 0, clientY: 0, currentTarget: { setPointerCapture() {} } };
    corner.props.onPointerDown(e); ui.draw();
    corner.props.onPointerMove({ ...e, clientX: -90, clientY: -70 }); ui.draw();
    assert.ok(ui.find(n => n.props?.className === 'paper-preview'));
    const article = ui.find(n => n.type === 'article');
    assert.equal(Boolean(article.props.style?.transform), !reduced);
    corner.props.onPointerUp({ ...e, clientX: -90, clientY: -70 }); ui.draw(); ui.tick();
    assert.match(text(ui.tree), /第1版/);
    assert.equal(ui.all(n => n.type === 'button' && /原稿へ/.test(text(n))).length, 0);
  }
});
test('one fixed cell definition serves every manuscript state and skeleton', () => {
  const dir = path.resolve(__dirname, '../src');
  const css = fs.readdirSync(dir).filter(f => f.endsWith('.css')).map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  assert.deepEqual(css.match(/--cell-size\s*:[^;]+/g), ['--cell-size: 32px']);
  assert.match(css, /grid-template-rows: repeat\(var\(--paper-rows\), var\(--cell-size\)\)/);
  assert.doesNotMatch(css, /100cqh|transparent 0 23px/);
  const paper = fs.readFileSync(path.join(dir, 'Manuscript.tsx'), 'utf8');
  assert.doesNotMatch(paper, /setRows|ResizeObserver/);
});
