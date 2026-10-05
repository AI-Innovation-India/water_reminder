'use strict';

/**
 * Pure time helpers. Nothing in here touches Electron, so it can be unit tested
 * with plain Node (npm test). All "wall clock" maths happens in cfg.timeZone,
 * so reminders follow IST no matter what timezone the computer is set to.
 */

const formatterCache = new Map();

function formatterFor(timeZone) {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

function zonedParts(ms, timeZone) {
  const out = {};
  for (const p of formatterFor(timeZone).formatToParts(new Date(ms))) {
    if (p.type !== 'literal') out[p.type] = p.value;
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
  };
}

function parseClock(text) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(text || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function minutesIntoDay(ms, timeZone) {
  const p = zonedParts(ms, timeZone);
  return p.hour * 60 + p.minute;
}

/** Is `ms` inside the daily reminder window? Both ends are inclusive. */
function isActive(ms, cfg) {
  const start = parseClock(cfg.activeStart);
  const end = parseClock(cfg.activeEnd);
  if (start === null || end === null || start === end) return true;
  const now = minutesIntoDay(ms, cfg.timeZone);
  return start < end ? now >= start && now <= end : now >= start || now <= end;
}

/** `ms` itself if it is inside the window, otherwise the first active minute after it. */
function nextActiveAtOrAfter(ms, cfg) {
  if (isActive(ms, cfg)) return ms;
  let t = Math.floor(ms / 60000) * 60000 + 60000;
  for (let i = 0; i < 48 * 60; i += 1, t += 60000) {
    if (isActive(t, cfg)) return t;
  }
  return ms;
}

/** When should the next reminder fire if we start counting at `fromMs`? */
function scheduleAfter(fromMs, delayMinutes, cfg) {
  return nextActiveAtOrAfter(fromMs + delayMinutes * 60000, cfg);
}

/** YYYY-MM-DD in the configured timezone (used for the "glasses today" counter). */
function dateKey(ms, timeZone) {
  const p = zonedParts(ms, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

function formatClock(ms, timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
    .format(new Date(ms))
    .replace(/[\u202f\u00a0]/g, ' ');
}

/** "10:00" -> "10 AM", "23:00" -> "11 PM", "10:30" -> "10:30 AM" */
function formatHour(clock) {
  const mins = parseClock(clock);
  if (mins === null) return String(clock);
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const suffix = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

function timeZoneLabel(timeZone) {
  if (timeZone === 'Asia/Kolkata' || timeZone === 'Asia/Calcutta') return 'IST';
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName');
    return part ? part.value : timeZone;
  } catch (_) {
    return timeZone;
  }
}

/** 45 -> "every 45 minutes", 60 -> "every hour", 120 -> "every 2 hours" */
function describeInterval(minutes) {
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return h === 1 ? 'every hour' : `every ${h} hours`;
  }
  return `every ${minutes} minutes`;
}

/** "10 AM to 11 PM IST" */
function describeWindow(cfg) {
  return `${formatHour(cfg.activeStart)} to ${formatHour(cfg.activeEnd)} ${timeZoneLabel(cfg.timeZone)}`;
}

module.exports = {
  zonedParts,
  parseClock,
  isActive,
  nextActiveAtOrAfter,
  scheduleAfter,
  dateKey,
  formatClock,
  formatHour,
  timeZoneLabel,
  describeInterval,
  describeWindow,
};
