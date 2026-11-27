const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mount, text } = require('./component-harness.cjs');
const { StoryInterview } = require('../src/StoryInterview.tsx');
const { interviewDialogue } = require('../src/sceneDialogue.ts');

test('名前から始まり、異なる2問を聞き、各問の深掘りは1回だけ', async () => {
  const requests = [];
  global.crypto = require('node:crypto').webcrypto;
  global.fetch = async (url, options) => {
    requests.push([url, JSON.parse(options.body)]);
    const data = { generated_story_id: 'abc', title: '青い鳥', intro: '私はソラ。', text: '本文' };
    return { ok: true, json: async () => data };
  };
  let pending;
  let accepted;
  const ui = mount(StoryInterview, { busy: false, act(fn) { return pending = fn(); },
    accept(s) { accepted = s; }, onPreset() {} });
  function answer(value) {
    ui.find(n => n.type === 'textarea').props.onChange({ target: { value } });
    ui.draw();
    ui.click('答える');
  }
  ui.click('質問へ進む');
  const label = () => ui.find(n => n.type === 'textarea').props['aria-label'];
  const questions = [];
  questions.push(label());
  answer('ソラ');
  for (const value of ['風', '海']) {
    questions.push(label());
    answer(value);
    assert.equal(label(), interviewDialogue.questions.find(q => q.question === questions.at(-1)).followup);
    answer('少し');
  }
  await pending;
  assert.equal(questions[0], interviewDialogue.name);
  assert.equal(new Set(questions).size, 3);
  assert.ok(questions.slice(1).every(q => interviewDialogue.questions.some(item => item.question === q)));
  ui.draw();
  assert.equal(requests.length, 1);
  ui.click('はい');
  await pending;
  const [[generate, payload], [start, session]] = requests;
  assert.equal(generate, '/api/stories/generate');
  assert.equal(payload.name, 'ソラ');
  assert.deepEqual(payload.answers, questions.map((question, i) => ({ question, text: ['ソラ', '風 少し', '海 少し'][i] })));
  assert.equal(start, '/api/sessions');
  assert.equal(session.custom_text, accepted.text);
  assert.equal(session.generated_story_id, accepted.generated_story_id);
});
