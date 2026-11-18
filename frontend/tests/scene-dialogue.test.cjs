const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { text } = require('./component-harness.cjs');
const { stageMount } = require('./anoma-stage-harness.cjs');
const { ScenePublisher } = require('../src/ScenePublisher.tsx');
const { scenePools, chooseScene, gameScene } = require('../src/sceneDialogue.ts');
const stage = ui => ui.find(n => n.props.className === 'anoma-stage');
const line = ui => ui.find(n => n.type === 'p');
test('all fifteen pools and expressions match the authoritative specification', () => {
  const spec = fs.readFileSync('docs/UI_FEEDBACK3.md', 'utf8');
  const sections = [...spec.matchAll(/^### ([^\n]+)\n([\s\S]*?)(?=^### |^## |$(?![\s\S]))/gm)];
  assert.equal(Object.keys(scenePools).length, 15);
  assert.equal(sections.length, 15);
  for (const [, title, body] of sections) {
    const key = title.replace('（共通）', '');
    assert.deepEqual([...scenePools[key].lines], [...body.matchAll(/^- (.+)$/gm)].map(m => m[1]));
    assert.ok(scenePools[key].lines.length > 0);
    assert.ok(scenePools[key].expressions.length > 0);
    const rowKey = key.startsWith('gamblePlay') ? 'gamblePlay:<種目>' : key;
    const row = spec.split('\n').find(row => row.startsWith(`| ${rowKey} |`));
    assert.deepEqual([...scenePools[key].expressions], row.split('|')[3].trim().split(' / '));
  }
});
test('every pool excludes its last line and selects an expression candidate', () => {
  for (const key of Object.keys(scenePools)) {
    let previous;
    for (let i = 0; i < 20; i++) {
      const chosen = chooseScene(key, () => 0);
      assert.notEqual(chosen.lines[0], previous);
      assert.ok(scenePools[key].lines.includes(chosen.lines[0]));
      assert.ok(scenePools[key].expressions.includes(chosen.expression));
      previous = chosen.lines[0];
    }
  }
});
test('scene publisher is stable on redraw, changes on entry, and remembers across visits', () => {
  const ui = stageMount(ScenePublisher, { scene: 'title' });
  const first = text(line(ui)), expression = stage(ui).props['data-expression'];
  ui.draw(); ui.draw();
  assert.equal(text(line(ui)), first);
  assert.equal(stage(ui).props['data-expression'], expression);
  ui.draw({ scene: 'storySelect' });
  assert.ok(scenePools.storySelect.lines.includes(text(line(ui))));
  ui.draw({ scene: 'title' });
  assert.notEqual(text(line(ui)), first);
  ui.unmount();
});
test('modal > gambling > processing > word choice priority reaches the stage', () => {
  const state = { rewardModal: true, gambleModal: true, gambling: true, game: 'rps', processing: true, selectedCount: 0, stakesReady: false };
  const ui = stageMount(ScenePublisher, { scene: gameScene(state) });
  const check = key => {
    assert.equal(gameScene(state), key);
    ui.draw({ scene: gameScene(state) });
    assert.ok(scenePools[key].lines.includes(text(line(ui))), key);
    assert.ok(scenePools[key].expressions.includes(stage(ui).props['data-expression']), key);
  };
  check('rewardSelect'); state.rewardModal = false;
  check('gambleSelect'); state.gambleModal = false;
  check('gamblePlay:janken');
  for (const [game, key] of [['card_guess', 'card'], ['dice', 'dice'], ['slot', 'slot'], ['blackjack', 'blackjack'], ['baccarat', 'baccarat']]) {
    state.game = game; check(`gamblePlay:${key}`);
  }
  state.game = 'unknown'; check('gamblePlay');
  state.gambling = false; check('generating');
  state.processing = false; check('wordSelect0');
  state.selectedCount = 1; check('wordSelectPartial');
  state.stakesReady = true; check('wordSelectReady');
  state.selectedCount = 3; state.stakesReady = false; check('wordSelectPartial');
  ui.unmount();
});
