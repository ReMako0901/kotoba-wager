// Run: node --test frontend/tests/history.test.cjs
// Compile the real TS/TSX modules in memory; no generated files or extra dependencies.
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { mount, text } = require('./component-harness.cjs');
const { storyVersions, changedCharacters } = require('../src/storyVersions.ts');
const { StoryPaperStack, StoryHistory } = require('../src/StoryHistory.tsx');
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
  assert.equal(ui.find(n => n.props?.['data-paper-count']).props['data-paper-count'], 3);
  assert.equal(ui.all(n => n.props?.className === 'paper-underlay').length, 2);
  assert.ok(ui.find(n => n.type === 'button' && text(n) === '次の原稿へ').props.disabled);
  assert.equal(ui.all(n => n.props?.className === 'vertical-paper').length, 1);
  assert.ok(ui.find(n => n.props?.className?.includes('result-change')));
  ui.click('前の原稿へ'); assert.equal(manuscript(), '中間。');
  assert.match(ui.find(n => n.type === 'article').props.className, /page-back/);
  assert.equal(ui.all(n => n.props?.className?.includes('result-change')).length, 0);
  ui.click('前の原稿へ'); assert.equal(manuscript(), '最初。');
  assert.ok(ui.find(n => n.type === 'button' && text(n) === '前の原稿へ').props.disabled);
  ui.click('次の原稿へ'); assert.equal(manuscript(), '中間。');
  assert.match(ui.find(n => n.type === 'article').props.className, /page-forward/);
  ui.click('次の原稿へ'); assert.equal(manuscript(), '最新の本文。');
  assert.ok(text(ui.tree).includes('賭けた言葉：鍵')); assert.ok(text(ui.tree).includes('報酬：新しい出会い'));
  assert.ok(text(ui.tree).includes(outcome === 'win' ? '勝利' : '敗北'));
  assert.equal(JSON.stringify(s), snapshot);
});
test('history retains losses and generation stats, initial and legacy pages remain readable', () => {
  const s = { ...session([tx(1, '最初。', '中間。')]), lost_concepts: [{ label: '鍵の意味' }], api_calls: 3 };
  const ui = mount(StoryHistory, { session: s });
  assert.match(text(ui.tree), /鍵の意味/); assert.match(text(ui.tree), /生成 3回/);
  ui.click('前の原稿へ'); assert.match(text(ui.tree), /最初。/);
  const initial = mount(StoryPaperStack, paperProps({ ...session([]), version: 1 }));
  assert.equal(initial.all(n => n.props?.className === 'paper-underlay').length, 0);
  assert.equal(initial.all(n => n.type === 'button' && n.props.disabled).length, 2);
});
test('result and history share manuscript stack and contain no comparison view', () => {
  const app = fs.readFileSync(path.resolve(__dirname, '../src/App.tsx'), 'utf8');
  const source = fs.readFileSync(path.resolve(__dirname, '../src/StoryHistory.tsx'), 'utf8');
  assert.match(app, /<StoryPaperStack session=\{session\} dust=\{dust\} losses=\{losses\} result/);
  assert.match(source, /<StoryPaperStack key=/);
  for (const value of [app, source]) assert.doesNotMatch(value, /StoryComparison|comparison-pair|変化前|変化後|最初と最新を比べる|dangerouslySetInnerHTML/);
  const ui = mount(StoryPaperStack, paperProps(session([tx(1, '<script>危険</script>', '自分の本文。')])));
  assert.ok(!text(ui.tree).includes('危険')); ui.click('前の原稿へ');
  assert.ok(text(ui.tree).includes('<script>危険</script>'));
  assert.equal(ui.all(n => n.type === 'script').length, 0);
  assert.equal(ui.all(n => n.props?.dangerouslySetInnerHTML).length, 0);
});
