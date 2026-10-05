'use strict';
// Plain-Node tests for src/stats.js.  Run with:  npm test
const assert = require('node:assert/strict');
const s = require('../src/stats');

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

const day = (ml) => ({ glasses: Math.round(ml / 250), ml });

test('shiftKey crosses month and year edges', () => {
  assert.equal(s.shiftKey('2026-03-01', -1), '2026-02-28');
  assert.equal(s.shiftKey('2026-01-01', -1), '2025-12-31');
  assert.equal(s.shiftKey('2026-12-31', 1), '2027-01-01');
});

test('addDrink accumulates per day without mutating', () => {
  const a = {};
  const b = s.addDrink(a, '2026-10-05', 250);
  const c = s.addDrink(b, '2026-10-05', 500);
  assert.deepEqual(a, {});
  assert.deepEqual(c['2026-10-05'], { glasses: 2, ml: 750 });
});

test('streak counts consecutive goal days, today counts once met', () => {
  const h = { '2026-10-03': day(2000), '2026-10-04': day(2250), '2026-10-05': day(500) };
  assert.equal(s.currentStreak(h, 2000, '2026-10-05'), 2); // today not met yet
  h['2026-10-05'] = day(2000);
  assert.equal(s.currentStreak(h, 2000, '2026-10-05'), 3);
});

test('a missed day breaks the streak', () => {
  const h = { '2026-10-02': day(2000), '2026-10-03': day(100), '2026-10-04': day(2000) };
  assert.equal(s.currentStreak(h, 2000, '2026-10-05'), 1);
  assert.equal(s.bestStreak(h, 2000), 1);
});

test('bestStreak finds the longest run', () => {
  const h = {
    '2026-09-01': day(2000), '2026-09-02': day(2000), '2026-09-03': day(2000),
    '2026-09-05': day(2000), '2026-09-06': day(2000),
  };
  assert.equal(s.bestStreak(h, 2000), 3);
});

test('lastDays always returns n entries oldest first', () => {
  const out = s.lastDays({ '2026-10-05': day(500) }, '2026-10-05', 7);
  assert.equal(out.length, 7);
  assert.equal(out[0].key, '2026-09-29');
  assert.equal(out[6].ml, 500);
  assert.equal(out[3].ml, 0);
});

test('cleanHistory drops junk and prune drops old days', () => {
  const clean = s.cleanHistory({ bad: { ml: 1 }, '2026-10-05': { ml: '300', glasses: 'x' }, '2026-10-04': 5 });
  assert.deepEqual(Object.keys(clean), ['2026-10-05']);
  assert.equal(clean['2026-10-05'].ml, 300);
  const pruned = s.pruneHistory({ '2020-01-01': day(1), '2026-10-04': day(1) }, '2026-10-05', 120);
  assert.deepEqual(Object.keys(pruned), ['2026-10-04']);
});

test('accessories unlock by glasses or best streak', () => {
  const party = s.ACCESSORIES.find((a) => a.id === 'party');
  const crown = s.ACCESSORIES.find((a) => a.id === 'crown');
  assert.equal(s.isUnlocked(party, { glasses: 9, bestStreak: 0 }), false);
  assert.equal(s.isUnlocked(party, { glasses: 10, bestStreak: 0 }), true);
  assert.equal(s.isUnlocked(crown, { glasses: 500, bestStreak: 6 }), false);
  assert.equal(s.isUnlocked(crown, { glasses: 0, bestStreak: 7 }), true);
  assert.equal(s.isUnlocked(s.ACCESSORIES[0], { glasses: 0, bestStreak: 0 }), true);
});

test('formatMl, partOfDay and moodFor', () => {
  assert.equal(s.formatMl(250), '250 ml');
  assert.equal(s.formatMl(1250), '1.3 L');
  assert.equal(s.formatMl(2000), '2 L');
  assert.equal(s.partOfDay(8), 'morning');
  assert.equal(s.partOfDay(14), 'afternoon');
  assert.equal(s.partOfDay(19), 'evening');
  assert.equal(s.partOfDay(2), 'night');
  assert.equal(s.moodFor(19, 200, 2000), 'worried');
  assert.equal(s.moodFor(19, 1500, 2000), 'happy');
  assert.equal(s.moodFor(10, 0, 2000), 'happy');
});

test('cleanHabits keeps built-ins, clamps intervals and accepts custom habits', () => {
  const h = s.cleanHabits([
    { id: 'stretch', enabled: true, intervalMinutes: 2 },
    { id: 'custom-1', label: 'Take meds', intervalMinutes: 90, line: 'Meds time, {name}!' },
    { id: 'custom-2', label: '   ' },
    { id: 'nope', label: 'ignored' },
  ]);
  assert.equal(h.find((x) => x.id === 'stretch').enabled, true);
  assert.equal(h.find((x) => x.id === 'stretch').intervalMinutes, 5);
  assert.equal(h.find((x) => x.id === 'eyes').enabled, false);
  assert.equal(h.filter((x) => x.custom).length, 1);
  assert.equal(h.find((x) => x.id === 'custom-1').lines[0], 'Meds time, {name}!');
  assert.equal(s.cleanHabits(null).length, s.DEFAULT_HABITS.length);
});

console.log(`\n${passed} tests passed`);
