'use strict';

/**
 * Pure helpers for water history, streaks, habits and unlockables.
 * No Electron in here, so `npm test` can cover it with plain Node.
 */

const HISTORY_DAYS = 120;

// Other things the buddy can nag you about. Water has its own settings.
const DEFAULT_HABITS = [
  {
    id: 'stretch',
    label: 'Stretch break',
    enabled: false,
    intervalMinutes: 60,
    lines: ['Time to stretch, {name}! Roll those shoulders.', 'Stand up and stretch for a minute, {name}.'],
    button: 'Stretched!',
    cheer: 'Ahh, much better, {name}!',
  },
  {
    id: 'eyes',
    label: 'Eye rest (20-20-20)',
    enabled: false,
    intervalMinutes: 20,
    lines: ['Look at something 20 feet away for 20 seconds, {name}.', 'Eye break, {name}! Look far away for a bit.'],
    button: 'Rested!',
    cheer: 'Fresh eyes! Nice, {name}.',
  },
  {
    id: 'posture',
    label: 'Posture check',
    enabled: false,
    intervalMinutes: 30,
    lines: ['Posture check, {name}! Back straight, shoulders down.', 'Sit tall, {name}. Unclench that jaw too.'],
    button: 'Sitting tall!',
    cheer: 'Look at that posture, {name}!',
  },
];

const ACCESSORIES = [
  { id: 'none', label: 'None', need: null },
  { id: 'party', label: 'Party hat', need: { glasses: 10 }, hint: 'drink 10 glasses' },
  { id: 'glasses', label: 'Cool shades', need: { glasses: 50 }, hint: 'drink 50 glasses' },
  { id: 'bow', label: 'Big bow', need: { streak: 3 }, hint: 'reach a 3-day streak' },
  { id: 'crown', label: 'Gold crown', need: { streak: 7 }, hint: 'reach a 7-day streak' },
  { id: 'halo', label: 'Shiny halo', need: { glasses: 200 }, hint: 'drink 200 glasses' },
];

function pad(n) {
  return String(n).padStart(2, '0');
}

/** 'YYYY-MM-DD' shifted by `delta` days (pure calendar maths, no timezone involved). */
function shiftKey(key, delta) {
  const [y, m, d] = String(key).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function cleanHistory(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, v] of Object.entries(raw)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !v || typeof v !== 'object') continue;
    const glasses = Math.max(0, Math.min(9999, Math.round(Number(v.glasses) || 0)));
    const ml = Math.max(0, Math.min(99999, Math.round(Number(v.ml) || 0)));
    out[key] = { glasses, ml };
  }
  return out;
}

function pruneHistory(history, todayKey, keep = HISTORY_DAYS) {
  const oldest = shiftKey(todayKey, -keep);
  const out = {};
  for (const [key, v] of Object.entries(history)) if (key >= oldest) out[key] = v;
  return out;
}

function addDrink(history, key, ml) {
  const day = history[key] || { glasses: 0, ml: 0 };
  return { ...history, [key]: { glasses: day.glasses + 1, ml: day.ml + ml } };
}

/** Consecutive days that met the goal. Today counts once met; until then the streak runs up to yesterday. */
function currentStreak(history, goalMl, todayKey) {
  const met = (key) => (history[key] ? history[key].ml >= goalMl : false);
  let key = met(todayKey) ? todayKey : shiftKey(todayKey, -1);
  let n = 0;
  while (met(key)) {
    n += 1;
    key = shiftKey(key, -1);
  }
  return n;
}

function bestStreak(history, goalMl) {
  const keys = Object.keys(history).sort();
  let best = 0;
  let run = 0;
  let prev = null;
  for (const key of keys) {
    if (history[key].ml >= goalMl) {
      run = prev && shiftKey(prev, 1) === key ? run + 1 : 1;
      best = Math.max(best, run);
      prev = key;
    } else {
      run = 0;
      prev = null;
    }
  }
  return best;
}

function totalGlasses(history) {
  return Object.values(history).reduce((sum, d) => sum + d.glasses, 0);
}

/** Oldest to newest, always `n` entries (missing days are zero). */
function lastDays(history, todayKey, n = 7) {
  const out = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const key = shiftKey(todayKey, -i);
    out.push({ key, glasses: history[key]?.glasses || 0, ml: history[key]?.ml || 0 });
  }
  return out;
}

function isUnlocked(accessory, totals) {
  if (!accessory.need) return true;
  if (accessory.need.glasses && totals.glasses < accessory.need.glasses) return false;
  if (accessory.need.streak && totals.bestStreak < accessory.need.streak) return false;
  return true;
}

function formatMl(ml) {
  if (ml >= 1000) return `${Math.round(ml / 100) / 10} L`;
  return `${ml} ml`;
}

/** 'morning' | 'afternoon' | 'evening' | 'night' */
function partOfDay(hour) {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

/** 'worried' when you are well behind pace for the time of day, else 'happy'. */
function moodFor(hour, ml, goalMl) {
  if (hour >= 17 && hour < 23 && ml < goalMl * 0.4) return 'worried';
  if (hour >= 13 && hour < 17 && ml < goalMl * 0.15) return 'worried';
  return 'happy';
}

function cleanHabits(raw) {
  const saved = Array.isArray(raw) ? raw : [];
  const byId = new Map(saved.filter((h) => h && typeof h.id === 'string').map((h) => [h.id, h]));
  const out = DEFAULT_HABITS.map((d) => {
    const s = byId.get(d.id) || {};
    return {
      ...d,
      enabled: Boolean(s.enabled),
      intervalMinutes: Math.max(5, Math.min(480, Math.round(Number(s.intervalMinutes)) || d.intervalMinutes)),
    };
  });
  for (const h of saved) {
    if (!h || typeof h.id !== 'string' || !h.id.startsWith('custom-')) continue;
    const label = String(h.label || '').trim().slice(0, 40);
    if (!label) continue;
    out.push({
      id: h.id.slice(0, 40),
      label,
      enabled: h.enabled !== false,
      intervalMinutes: Math.max(5, Math.min(480, Math.round(Number(h.intervalMinutes)) || 60)),
      lines: [String(h.line || '').trim().slice(0, 90) || `Time for: ${label}, {name}!`],
      line: String(h.line || '').trim().slice(0, 90),
      button: 'Done!',
      cheer: 'Nice work, {name}!',
      custom: true,
    });
  }
  return out;
}

module.exports = {
  DEFAULT_HABITS,
  ACCESSORIES,
  shiftKey,
  cleanHistory,
  pruneHistory,
  addDrink,
  currentStreak,
  bestStreak,
  totalGlasses,
  lastDays,
  isUnlocked,
  formatMl,
  partOfDay,
  moodFor,
  cleanHabits,
};
