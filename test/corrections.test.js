'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  defaultGlossary,
  normalizeGlossary,
  applyCorrections
} = require('../public/lib/corrections.js');

function withRules(replacements) {
  return normalizeGlossary({
    schemaVersion: 1,
    activeProfile: 'work',
    profiles: { work: { replacements } }
  });
}

test('seeded Work rule corrects fun control in common casings', () => {
  const glossary = defaultGlossary();
  assert.equal(applyCorrections('fun control', glossary), 'fund control');
  assert.equal(applyCorrections('FUN control', glossary), 'fund control');
  assert.equal(applyCorrections('Fun Control', glossary), 'fund control');
  assert.equal(applyCorrections('send it to fund control', glossary), 'send it to fund control');
});

test('whole-phrase matching leaves longer words and substrings alone', () => {
  const glossary = defaultGlossary();
  assert.equal(applyCorrections('fun controller', glossary), 'fun controller');
  assert.equal(applyCorrections('a fun control room', glossary), 'a fund control room');
  assert.equal(applyCorrections('funcontrols', glossary), 'funcontrols');
});

test('corrected output is idempotent', () => {
  const glossary = defaultGlossary();
  const once = applyCorrections('FUN control and fun control', glossary);
  assert.equal(once, 'fund control and fund control');
  assert.equal(applyCorrections(once, glossary), once);
});

test('longer aliases win and replacements do not cascade', () => {
  const glossary = withRules([
    { canonical: 'fund control', aliases: ['fund control'] },
    { canonical: 'fund', aliases: ['fun'] },
    { canonical: 'control', aliases: ['control'] }
  ]);
  assert.equal(applyCorrections('fun control', glossary), 'fund control');
  assert.equal(applyCorrections('a fun idea', glossary), 'a fund idea');
});

test('regex metacharacters and Unicode boundaries are literal', () => {
  const glossary = withRules([
    { canonical: 'C++', aliases: ['c++'] },
    { canonical: 'café', aliases: ['cafe\u0301'] }
  ]);
  assert.equal(applyCorrections('I write C++ code', glossary), 'I write C++ code');
  assert.equal(applyCorrections('I write c++ code', glossary), 'I write C++ code');
  assert.equal(applyCorrections('un café noir', glossary), 'un café noir');
  assert.equal(applyCorrections('un cafés noir', glossary), 'un cafés noir');
});

test('whitespace in an alias matches any whitespace run', () => {
  const glossary = withRules([{ canonical: 'fund control', aliases: ['fun   control'] }]);
  assert.equal(applyCorrections('fun\ncontrol', glossary), 'fund control');
});

test('disabled rules are ignored', () => {
  const glossary = withRules([{ canonical: 'fund control', aliases: ['fun control'], enabled: false }]);
  assert.equal(applyCorrections('fun control', glossary), 'fun control');
});

test('multiple aliases on one rule all map to the same canonical', () => {
  const glossary = withRules([
    { canonical: 'fund control', aliases: ['fun control', 'fun controls', 'funds control'] }
  ]);
  assert.equal(applyCorrections('fun control, fun controls, funds control', glossary), 'fund control, fund control, fund control');
});

test('invalid and duplicate rules are rejected clearly', () => {
  assert.throws(() => withRules([{ canonical: '', aliases: ['x'] }]), /replace-with is required/);
  assert.throws(() => withRules([{ canonical: 'x', aliases: [] }]), /heard-as is required/);
  assert.throws(() => withRules([
    { canonical: 'a', aliases: ['same'] },
    { canonical: 'b', aliases: ['same'] }
  ]), /used by more than one enabled rule/);
  assert.throws(() => withRules([
    { canonical: 'fund control', aliases: ['fun control'] },
    { canonical: 'approval', aliases: ['fund control'] }
  ]), /also heard-as/);
  assert.throws(() => withRules([
    { canonical: 'fund control', aliases: ['fun control'] },
    { canonical: 'control', aliases: ['ctrl'] },
    { canonical: 'other', aliases: ['control'] }
  ]), /would cascade/);
});

test('empty rule list is valid (user deleted every rule)', () => {
  const glossary = withRules([]);
  assert.equal(glossary.profiles.work.replacements.length, 0);
  assert.equal(applyCorrections('fun control', glossary), 'fun control');
});

test('missing profile falls back to the default glossary only when absent', () => {
  assert.equal(normalizeGlossary(null).profiles.work.replacements.length, 1);
  assert.throws(() => normalizeGlossary({ profiles: {} }), /Work profile/);
});
