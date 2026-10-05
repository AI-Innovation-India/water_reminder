'use strict';
// Plain-Node tests for src/schedule.js.  Run with:  npm test
const assert = require('node:assert/strict');
const s = require('../src/schedule');

const IST = { activeStart: '10:00', activeEnd: '23:00', timeZone: 'Asia/Kolkata' };
const at = (iso) => Date.parse(iso); // iso strings below carry the +05:30 offset explicitly

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

test('active window is inclusive of 10:00 and 23:00 IST', () => {
  assert.equal(s.isActive(at('2026-10-04T09:59:00+05:30'), IST), false);
  assert.equal(s.isActive(at('2026-10-04T10:00:00+05:30'), IST), true);
  assert.equal(s.isActive(at('2026-10-04T23:00:00+05:30'), IST), true);
  assert.equal(s.isActive(at('2026-10-04T23:01:00+05:30'), IST), false);
});

test('a normal reminder lands interval minutes later', () => {
  const next = s.scheduleAfter(at('2026-10-04T10:00:00+05:30'), 45, IST);
  assert.equal(next, at('2026-10-04T10:45:00+05:30'));
});

test('a reminder that would land after 11 PM rolls to 10 AM the next morning', () => {
  const next = s.scheduleAfter(at('2026-10-04T22:30:00+05:30'), 45, IST);
  assert.equal(next, at('2026-10-05T10:00:00+05:30'));
});

test('snooze at 22:55 also rolls over to the morning', () => {
  const next = s.scheduleAfter(at('2026-10-04T22:55:00+05:30'), 10, IST);
  assert.equal(next, at('2026-10-05T10:00:00+05:30'));
});

test('early-morning times wait for 10 AM the same day', () => {
  const next = s.nextActiveAtOrAfter(at('2026-10-04T03:12:30+05:30'), IST);
  assert.equal(next, at('2026-10-04T10:00:00+05:30'));
});

test('the active window uses IST even when the computer is in another timezone', () => {
  // 04:30 UTC is 10:00 IST
  assert.equal(s.isActive(Date.parse('2026-10-04T04:30:00Z'), IST), true);
  assert.equal(s.isActive(Date.parse('2026-10-04T04:29:00Z'), IST), false);
});

test('overnight windows (22:00 to 02:00) work', () => {
  const night = { activeStart: '22:00', activeEnd: '02:00', timeZone: 'Asia/Kolkata' };
  assert.equal(s.isActive(at('2026-10-04T23:00:00+05:30'), night), true);
  assert.equal(s.isActive(at('2026-10-05T01:30:00+05:30'), night), true);
  assert.equal(s.isActive(at('2026-10-05T12:00:00+05:30'), night), false);
});

test('bad or equal window settings fall back to "always active"', () => {
  assert.equal(s.isActive(Date.now(), { ...IST, activeStart: 'nope' }), true);
  assert.equal(s.isActive(Date.now(), { ...IST, activeStart: '10:00', activeEnd: '10:00' }), true);
});

test('dateKey follows the configured timezone', () => {
  // 18:30 UTC on the 4th is already 00:00 on the 5th in IST
  assert.equal(s.dateKey(Date.parse('2026-10-04T18:30:00Z'), 'Asia/Kolkata'), '2026-10-05');
  assert.equal(s.dateKey(Date.parse('2026-10-04T18:29:00Z'), 'Asia/Kolkata'), '2026-10-04');
});

test('formatting helpers', () => {
  assert.equal(s.formatHour('10:00'), '10 AM');
  assert.equal(s.formatHour('23:00'), '11 PM');
  assert.equal(s.formatHour('00:00'), '12 AM');
  assert.equal(s.formatHour('12:00'), '12 PM');
  assert.equal(s.formatHour('10:30'), '10:30 AM');
  assert.equal(s.describeInterval(45), 'every 45 minutes');
  assert.equal(s.describeInterval(60), 'every hour');
  assert.equal(s.describeInterval(120), 'every 2 hours');
  assert.equal(s.describeWindow(IST), '10 AM to 11 PM IST');
  assert.equal(s.formatClock(at('2026-10-04T15:45:00+05:30'), 'Asia/Kolkata'), '3:45 PM');
});

console.log(`\n${passed} tests passed`);
