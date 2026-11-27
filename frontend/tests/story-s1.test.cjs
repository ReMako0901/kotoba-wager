const { drawStories, startStory } = require('./app-flow-harness.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { mount, text } = require('./component-harness.cjs');
const { scenario, openingNarration, chooseLine, reactionTrigger } = require('../src/scenario.ts');
const { resultReaction, Opening } = require('../src/Anoma.tsx');
const App = require('../src/App.tsx').default;
const flush = () => new Promise(resolve => setImmediate(resolve));
const tx = (outcome, extra = {}) => ({ id: 'round', status: 'committed', outcome, lost: [], ...extra });

test('all S1 dialogue matches confirmed design; opening narration and seven lines are complete', () => {
  const design = fs.readFileSync('docs/STORY_DESIGN.md', 'utf8');
  assert.equal(scenario.opening.length, 7);
  assert.equal(openingNarration.length, 3);
  assert.deepEqual(Object.keys(scenario), ['opening', 'gain', 'loss', 'change', 'winStreak', 'lossStreak']);
  for (const line of [...openingNarration, ...Object.values(scenario).flat()]) assert.ok(design.includes(line), line);
});
test('multiple candidates never repeat immediately; one confirmed candidate remains usable', () => {
  for (const random of [() => 0, () => 0.999]) {
    let previous;
    for (let i = 0; i < 20; i++) {
      const next = chooseLine(['a', 'b', 'c'], previous, random);
      assert.notEqual(next, previous); previous = next;
    }
  }
  assert.equal(chooseLine(scenario.gain, scenario.gain[0]), scenario.gain[0]);
});
test('priority uses current-round loss count and strength, then consecutive committed outcomes', () => {
  assert.equal(reactionTrigger([]), undefined);
  assert.equal(reactionTrigger([tx('win')]), 'gain');
  assert.equal(reactionTrigger([tx('loss')]), 'loss');
  assert.equal(reactionTrigger([tx('win'), tx('win')]), 'winStreak');
  assert.equal(reactionTrigger([tx('loss'), tx('loss')]), 'lossStreak');
  assert.equal(reactionTrigger([tx('win'), tx('loss')]), 'loss');
  assert.equal(reactionTrigger([tx('loss'), tx('win')]), 'gain');
  assert.equal(reactionTrigger([tx('loss'), tx('loss', { lost: [{}, {}] })]), 'change');
  assert.equal(reactionTrigger([tx('win'), tx('win', { gamble: { strength: 6 } })]), 'change');
  assert.equal(reactionTrigger([tx('win', { gamble: { strength: 5 }, lost: [{}] })]), 'gain');
  assert.equal(reactionTrigger([tx('loss', { lost: [{}, {}] }), tx('win'), tx('loss', { status: 'generating' })]), 'gain');
});
test('opening separates narration, arrival, tapped dialogue and docking', () => {
  let done = 0;
  const props = { busy: false, onDark() {}, onComplete: () => done++ };
  const ui = mount(Opening, props);
  assert.equal(ui.tree.props['data-phase'], 'blackout');
  for (let i = 0; i < openingNarration.length; i++) {
    if (i === 0) ui.tick();
    else ui.click('地の文を送る');
    assert.deepEqual(ui.all(n => n.type === 'p').map(text), openingNarration.slice(0, i + 1));
    assert.ok(!text(ui.tree).includes(scenario.opening[0]));
  }
  ui.click('地の文を送る');
  assert.equal(ui.tree.props['data-phase'], 'arrival');
  assert.ok(!text(ui.tree).includes(openingNarration[0]));
  ui.tick();
  for (const line of scenario.opening) {
    assert.equal(text(ui.find(n => n.props.className === 'sr-only')), line);
    ui.tick();
    ui.click('▼');
    assert.equal(text(ui.find(n => n.type === 'span' && n.props['aria-hidden'] === 'true')), line);
    ui.click('▼');
  }
  assert.equal(ui.tree.props['data-phase'], 'docking');
  assert.equal(done, 0);
  ui.tick(); assert.equal(done, 1);
  const skipped = mount(Opening, props);
  skipped.click('スキップ'); skipped.tick();
  assert.equal(done, 2);
});
function environment(session) {
  const requests = [];
  global.fetch = async url => { requests.push(url); return { ok: true, json: async () => url.endsWith('/games') ? { games: [] } : drawStories(url) ?? session }; };
  return requests;
}
test('new start opens before drawing stories; results publish reactions for all games', async () => {
  let requests = environment();
  let ui = mount(App, {}); await flush(); ui.draw();
  ui.click('はじめる'); assert.ok(!text(ui.tree).includes(scenario.opening[0]));
  assert.equal(requests.some(url => url.endsWith('/stories/draw')), false);
  ui.click('スキップ'); await flush(); ui.draw();
  assert.ok(text(ui.tree).includes('まず、あなたのことを教えてくれる？'));
  ui.click('質問へ進む'); ui.draw();
  ui.find(n => n.type === 'textarea').props.onChange({ target: { value: 'ソラ' } });
  ui.draw(); ui.click('答える');
  assert.ok(!text(ui.tree).includes('もう少しだけ、教えてくれる？'));
  assert.equal(requests.some(url => url.endsWith('/stories/draw')), false);
  ui.click('プリセットの文で始める'); await flush(); ui.draw();
  assert.ok(text(ui.tree).includes('物語を選ぶ'));
  assert.equal(requests.filter(url => url.endsWith('/stories/draw')).length, 1);
  for (const kind of ['rps', 'card_guess', 'chinchiro', 'slot', 'blackjack', 'baccarat']) {
    const transaction = tx('win', { gamble: { kind, strength: 1 }, before: '猫が来た。', after: '犬が来た。', stakes: ['猫'], offer: { title: '報酬' } });
    const session = { id: 'saved', betting_mode: 'count-v1', status: 'ready', view: 'result', version: 2, text: transaction.after, transactions: [transaction], offers: [], lost_concepts: [], title: '物語', usage: {} };
    environment(session);
    ui = mount(App, {}); await flush(); ui.draw(); ui.draw();
    await startStory(ui);
    assert.equal(ui.all(n => n.props['aria-label'] === 'アノマ').length, 1, kind);
    assert.ok(text(ui.tree).includes(scenario.gain[0]), kind);
    assert.ok(!text(ui.tree).includes(scenario.opening[0]), kind);
  }
});
test('result reaction is pure and repeated histories keep the same line and expression', () => {
  const transactions = [tx('loss', { lost: [{}, {}] })];
  const before = JSON.stringify(transactions);
  const reaction = resultReaction(transactions);
  assert.equal(reaction.reaction, 'change');
  assert.ok(['smile', 'giggle'].includes(reaction.expression));
  assert.equal(reaction.line, scenario.change[0]);
  assert.deepEqual(resultReaction([...transactions]), reaction);
  assert.deepEqual(resultReaction(JSON.parse(before)), reaction);
  assert.equal(JSON.stringify(transactions), before);
  assert.equal(resultReaction([]), undefined);
});
