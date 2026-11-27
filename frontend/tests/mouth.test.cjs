const test = require('node:test');
const assert = require('node:assert/strict');
require('./component-harness.cjs');
const { mouthVowelFor, mouthFor } = require('../src/Anoma.tsx');

test('kana map to their vowel row', () => {
  assert.equal(mouthVowelFor('あ', 0), 'a');
  assert.equal(mouthVowelFor('か', 0), 'a');
  assert.equal(mouthVowelFor('し', 0), 'i');
  assert.equal(mouthVowelFor('つ', 0), 'u');
  assert.equal(mouthVowelFor('せ', 0), 'e');
  assert.equal(mouthVowelFor('も', 0), 'o');
  assert.equal(mouthVowelFor('を', 0), 'o');
});

test('katakana fold to hiragana vowels', () => {
  assert.equal(mouthVowelFor('ア', 0), 'a');
  assert.equal(mouthVowelFor('キ', 0), 'i');
  assert.equal(mouthVowelFor('ス', 0), 'u');
  assert.equal(mouthVowelFor('テ', 0), 'e');
  assert.equal(mouthVowelFor('ホ', 0), 'o');
});

test('small kana and ん are handled', () => {
  assert.equal(mouthVowelFor('ゃ', 0), 'a');
  assert.equal(mouthVowelFor('ゅ', 0), 'u');
  assert.equal(mouthVowelFor('ょ', 0), 'o');
  assert.equal(mouthVowelFor('ん', 0), 'u');
});

test('unknown characters cycle deterministically', () => {
  const seq = [0, 1, 2, 3, 4, 5].map(i => mouthVowelFor('語', i));
  assert.deepEqual(seq, ['a', 'u', 'o', 'e', 'i', 'a']);
});

test('mouth frame swaps every three characters', () => {
  assert.equal(mouthFor('あ', 0).frame, 1);
  assert.equal(mouthFor('あ', 2).frame, 1);
  assert.equal(mouthFor('あ', 3).frame, 2);
  assert.equal(mouthFor('あ', 6).frame, 1);
  assert.deepEqual(mouthFor('き', 0), { vowel: 'i', frame: 1 });
});
