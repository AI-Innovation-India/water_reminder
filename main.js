'use strict';

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  screen,
  ipcMain,
  shell,
  powerMonitor,
  dialog,
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const schedule = require('./src/schedule');
const stats = require('./src/stats');

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------
const APP_NAME = 'Water Buddy';
const PRESET_INTERVALS = [30, 45, 60, 90, 120];
const COMPANION_SIZE = { width: 420, height: 480 };
const TICK_MS = 10 * 1000;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const BUILTIN_ORDER = ['mochi', 'sunny', 'kai', 'luna', 'droppy'];
const HOT_MODE_FACTOR = 0.6; // "hot day / workout" mode reminds this much more often
const FOCUS_PRESETS = [
  { focus: 25, rest: 5 },
  { focus: 50, rest: 10 },
];
const LOG_AMOUNTS = [250, 500, 750];
const GAME_DROPS = 12;

const DEFAULTS = {
  setupComplete: false,
  name: '',
  intervalMinutes: 45,
  snoozeMinutes: 10,
  character: 'mochi',
  // Reminders only happen inside this window, measured in this timezone.
  activeStart: '10:00',
  activeEnd: '23:00',
  timeZone: 'Asia/Kolkata',
  paused: false,
  launchAtLogin: false,
  stats: { date: '', count: 0, ml: 0 },
  // daily goal and bottle size
  goalMl: 2000,
  glassMl: 250,
  history: {}, // { 'YYYY-MM-DD': { glasses, ml } }
  // extras
  sound: true,
  hotMode: false,
  habits: [],
  accessory: 'none',
  hue: 0,
  focusStats: { date: '', count: 0 },
};

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------
let settings = sanitizeSettings(null);
let tray = null;
let companion = null;
let setupWin = null;
let setupMode = 'full';
let setupFirstRun = false;
let reminderActive = false; // true while the buddy is on screen
let hideTimer = null;
let nextDueAt = 0;
let characterCache = null;
let prefsWin = null;
let currentHabit = null; // the habit reminder on screen right now (null = water)
const habitDue = {}; // habit id -> ms
let focus = null; // { phase: 'focus' | 'rest', endsAt, focusMin, restMin }
const pendingImages = {}; // character-maker picks: { standing, drinking, celebrate } -> file path

// ---------------------------------------------------------------------------
// settings (a small JSON file in the OS user-data folder)
// ---------------------------------------------------------------------------
function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function validZone(zone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch (_) {
    return false;
  }
}

function sanitizeSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const s = { ...DEFAULTS, ...src };
  s.name = typeof s.name === 'string' ? s.name.trim().slice(0, 30) : '';
  s.intervalMinutes = clampInt(s.intervalMinutes, 5, 480, DEFAULTS.intervalMinutes);
  s.snoozeMinutes = clampInt(s.snoozeMinutes, 1, 120, DEFAULTS.snoozeMinutes);
  s.character = typeof s.character === 'string' && s.character ? s.character : DEFAULTS.character;
  s.activeStart = schedule.parseClock(s.activeStart) === null ? DEFAULTS.activeStart : s.activeStart;
  s.activeEnd = schedule.parseClock(s.activeEnd) === null ? DEFAULTS.activeEnd : s.activeEnd;
  s.timeZone = typeof s.timeZone === 'string' && validZone(s.timeZone) ? s.timeZone : DEFAULTS.timeZone;
  s.paused = Boolean(s.paused);
  s.launchAtLogin = Boolean(s.launchAtLogin);
  const st = src.stats && typeof src.stats === 'object' ? src.stats : {};
  s.stats = {
    date: String(st.date || ''),
    count: clampInt(st.count, 0, 9999, 0),
    ml: clampInt(st.ml, 0, 99999, clampInt(st.count, 0, 9999, 0) * s.glassMl),
  };
  s.goalMl = clampInt(s.goalMl, 500, 6000, DEFAULTS.goalMl);
  s.glassMl = clampInt(s.glassMl, 50, 1000, DEFAULTS.glassMl);
  s.history = stats.cleanHistory(s.history);
  if (s.stats.date && !s.history[s.stats.date] && s.stats.count > 0) {
    s.history[s.stats.date] = { glasses: s.stats.count, ml: s.stats.ml }; // older settings files
  }
  s.sound = s.sound !== false;
  s.hotMode = Boolean(s.hotMode);
  s.habits = stats.cleanHabits(s.habits);
  s.accessory = stats.ACCESSORIES.some((a) => a.id === s.accessory) ? s.accessory : 'none';
  s.hue = clampInt(s.hue, 0, 359, 0);
  const fs2 = src.focusStats && typeof src.focusStats === 'object' ? src.focusStats : {};
  s.focusStats = { date: String(fs2.date || ''), count: clampInt(fs2.count, 0, 999, 0) };
  s.setupComplete = Boolean(s.setupComplete) && s.name.length > 0;
  return s;
}

function loadSettings() {
  try {
    settings = sanitizeSettings(JSON.parse(fs.readFileSync(settingsFile(), 'utf8')));
  } catch (_) {
    settings = sanitizeSettings(null);
  }
}

function saveSettings() {
  try {
    const file = settingsFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`);
    fs.renameSync(tmp, file);
  } catch (err) {
    console.error('Could not save settings:', err);
  }
}

function todayKey() {
  return schedule.dateKey(Date.now(), settings.timeZone);
}

function todayCount() {
  return settings.stats.date === todayKey() ? settings.stats.count : 0;
}

function todayMl() {
  return settings.stats.date === todayKey() ? settings.stats.ml : 0;
}

function streakNow() {
  return stats.currentStreak(settings.history, settings.goalMl, todayKey());
}

function unlockTotals() {
  return { glasses: stats.totalGlasses(settings.history), bestStreak: stats.bestStreak(settings.history, settings.goalMl) };
}

function localHour() {
  return schedule.zonedParts(Date.now(), settings.timeZone).hour;
}

/** Log one drink. Returns what the buddy needs to cheer about it. */
function recordDrink(ml = settings.glassMl) {
  const key = todayKey();
  const before = todayMl();
  if (settings.stats.date !== key) settings.stats = { date: key, count: 0, ml: 0 };
  settings.stats.count += 1;
  settings.stats.ml += ml;
  settings.history = stats.pruneHistory(stats.addDrink(settings.history, key, ml), key);
  saveSettings();
  return {
    count: settings.stats.count,
    ml: settings.stats.ml,
    goalMl: settings.goalMl,
    goalJustMet: before < settings.goalMl && settings.stats.ml >= settings.goalMl,
    streak: streakNow(),
  };
}

function focusCountToday() {
  return settings.focusStats.date === todayKey() ? settings.focusStats.count : 0;
}

function applyLoginItem() {
  // Only register the installed app. In dev this would register the bare
  // Electron binary, which launches an empty Electron window at login.
  if (!app.isPackaged) return;
  try {
    app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin });
  } catch (err) {
    console.error('Could not update login item:', err);
  }
}

// ---------------------------------------------------------------------------
// characters: built-in ones ship in ./characters, yours live in userData
// ---------------------------------------------------------------------------
function builtinCharactersDir() {
  return path.join(__dirname, 'characters');
}

function userCharactersDir() {
  return path.join(app.getPath('userData'), 'characters');
}

function isGoodImage(file) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > MAX_IMAGE_BYTES) return false;
    return !nativeImage.createFromPath(file).isEmpty();
  } catch (_) {
    return false;
  }
}

function prettify(folder) {
  return folder
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .slice(0, 24);
}

function readCharacterFolder(root, folder, source) {
  const dir = path.join(root, folder);
  try {
    if (!fs.statSync(dir).isDirectory()) return null;
  } catch (_) {
    return null;
  }
  const files = {
    standing: path.join(dir, 'standing.png'),
    drinking: path.join(dir, 'drinking.png'),
    celebrate: path.join(dir, 'celebrate.png'),
  };
  if (!isGoodImage(files.standing) || !isGoodImage(files.drinking)) return null;
  if (!isGoodImage(files.celebrate)) files.celebrate = null;

  let name = prettify(folder);
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'character.json'), 'utf8'));
    if (meta && typeof meta.name === 'string' && meta.name.trim()) name = meta.name.trim().slice(0, 24);
  } catch (_) {
    /* character.json is optional */
  }
  return { id: source === 'user' ? `user:${folder}` : folder, name, source, files };
}

function scanCharacters(root, source) {
  let folders = [];
  try {
    folders = fs.readdirSync(root).filter((n) => !n.startsWith('.') && !n.startsWith('_'));
  } catch (_) {
    return [];
  }
  return folders.map((f) => readCharacterFolder(root, f, source)).filter(Boolean);
}

function listCharacters(force = false) {
  if (characterCache && !force) return characterCache;
  const builtin = scanCharacters(builtinCharactersDir(), 'builtin').sort((a, b) => {
    const ia = BUILTIN_ORDER.indexOf(a.id);
    const ib = BUILTIN_ORDER.indexOf(b.id);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.name.localeCompare(b.name);
  });
  const user = scanCharacters(userCharactersDir(), 'user').sort((a, b) => a.name.localeCompare(b.name));
  characterCache = [...builtin, ...user];
  return characterCache;
}

function dataUrl(file) {
  return file ? `data:image/png;base64,${fs.readFileSync(file).toString('base64')}` : null;
}

function findCharacter(id) {
  const all = listCharacters();
  return all.find((c) => c.id === id) || all[0];
}

function characterPayload(id) {
  const c = findCharacter(id);
  return {
    id: c.id,
    name: c.name,
    images: {
      standing: dataUrl(c.files.standing),
      drinking: dataUrl(c.files.drinking),
      celebrate: dataUrl(c.files.celebrate),
    },
  };
}

function ensureUserCharactersDir() {
  const dir = userCharactersDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
    const readme = path.join(dir, 'README.txt');
    if (!fs.existsSync(readme)) {
      fs.writeFileSync(
        readme,
        [
          'Add your own Water Buddy character',
          '',
          '1. Copy the "_template" folder and give the copy any name, e.g. "robin".',
          '2. Replace standing.png and drinking.png with your own pictures.',
          '   (celebrate.png is optional. Without it, she just hops in her standing pose.)',
          '3. Optional: edit character.json to change the name shown in the menu.',
          '4. In Water Buddy choose Character > Reload characters.',
          '',
          'Tips',
          '- PNG with a transparent background. Pixel art around 32 to 64 px tall looks best.',
          '- All three images should be the same size.',
          '- Each file must be under 2 MB.',
          '- Folders starting with "_" or "." are ignored.',
          '',
        ].join('\n'),
      );
    }
    const template = path.join(dir, '_template');
    const source = path.join(builtinCharactersDir(), 'mochi');
    if (!fs.existsSync(template) && fs.existsSync(source)) {
      fs.mkdirSync(template, { recursive: true });
      for (const f of ['standing.png', 'drinking.png', 'celebrate.png']) {
        fs.copyFileSync(path.join(source, f), path.join(template, f));
      }
      fs.writeFileSync(path.join(template, 'character.json'), `${JSON.stringify({ name: 'My buddy' })}\n`);
    }
  } catch (err) {
    console.error('Could not prepare the characters folder:', err);
  }
  return dir;
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
}

/** Turn any picture (png/jpg/gif/bmp...) into a PNG the character system accepts. */
function toPngBuffer(file) {
  const img = nativeImage.createFromPath(file);
  if (img.isEmpty()) return null;
  let out = img;
  const { width, height } = img.getSize();
  if (height > 512) out = img.resize({ height: 512, quality: 'best' }); // keep files small
  else if (width > 512) out = img.resize({ width: 512, quality: 'best' });
  const png = out.toPNG();
  return png.length <= MAX_IMAGE_BYTES ? png : null;
}

function createUserCharacter({ name, standing, drinking, celebrate }) {
  const cleanName = String(name || '').trim().slice(0, 24);
  if (!cleanName) return { ok: false, error: 'Give your buddy a name.' };
  if (!standing) return { ok: false, error: 'Choose a standing picture first.' };
  const slug = slugify(cleanName) || 'buddy';
  const root = ensureUserCharactersDir();
  let folder = slug;
  for (let i = 2; fs.existsSync(path.join(root, folder)); i += 1) folder = `${slug}-${i}`;

  const stand = toPngBuffer(standing);
  if (!stand) return { ok: false, error: 'That standing picture could not be read (or is over 2 MB).' };
  const drink = drinking ? toPngBuffer(drinking) : stand;
  if (!drink) return { ok: false, error: 'That drinking picture could not be read (or is over 2 MB).' };
  const cele = celebrate ? toPngBuffer(celebrate) : null;
  if (celebrate && !cele) return { ok: false, error: 'That celebrate picture could not be read (or is over 2 MB).' };

  try {
    const dir = path.join(root, folder);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'standing.png'), stand);
    fs.writeFileSync(path.join(dir, 'drinking.png'), drink);
    if (cele) fs.writeFileSync(path.join(dir, 'celebrate.png'), cele);
    fs.writeFileSync(path.join(dir, 'character.json'), `${JSON.stringify({ name: cleanName })}\n`);
  } catch (err) {
    return { ok: false, error: `Could not save: ${err.message}` };
  }
  characterCache = null;
  return { ok: true, id: `user:${folder}` };
}

function deleteUserCharacter(id) {
  if (typeof id !== 'string' || !id.startsWith('user:')) return { ok: false, error: 'Only your own characters can be removed.' };
  const folder = id.slice(5);
  if (!folder || folder.includes('/') || folder.includes('\\') || folder.startsWith('.')) return { ok: false, error: 'Bad character.' };
  const dir = path.join(userCharactersDir(), folder);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    return { ok: false, error: err.message };
  }
  characterCache = null;
  if (settings.character === id) {
    settings.character = listCharacters(true)[0].id;
    saveSettings();
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// scheduling
// ---------------------------------------------------------------------------
function scheduleFrom(delayMinutes) {
  nextDueAt = schedule.scheduleAfter(Date.now(), delayMinutes, settings);
}

function effectiveInterval() {
  return settings.hotMode ? Math.max(5, Math.round(settings.intervalMinutes * HOT_MODE_FACTOR)) : settings.intervalMinutes;
}

function scheduleInterval() {
  scheduleFrom(effectiveInterval());
}

function scheduleHabit(habit, delayMinutes = habit.intervalMinutes) {
  habitDue[habit.id] = schedule.scheduleAfter(Date.now(), delayMinutes, settings);
}

function resetHabitTimers() {
  for (const key of Object.keys(habitDue)) delete habitDue[key];
  for (const h of settings.habits) if (h.enabled) scheduleHabit(h);
}

function focusLeftMinutes() {
  return focus ? Math.max(1, Math.ceil((focus.endsAt - Date.now()) / 60000)) : 0;
}

function startFocus(focusMin, restMin) {
  focus = { phase: 'focus', endsAt: Date.now() + focusMin * 60000, focusMin, restMin };
  refreshTray();
  showNotice(`Focus time, ${settings.name}! ${focusMin} minutes. I'll tap you when it's up.`, "Let's go!");
}

function stopFocus() {
  focus = null;
  refreshTray();
}

function advanceFocus() {
  if (!focus) return;
  if (focus.phase === 'focus') {
    const key = todayKey();
    settings.focusStats = { date: key, count: focusCountToday() + 1 };
    saveSettings();
    focus = { ...focus, phase: 'rest', endsAt: Date.now() + focus.restMin * 60000 };
    refreshTray();
    showNotice(
      `Focus session done! Take ${focus.restMin} min: stretch and sip some water, ${settings.name}.`,
      'Break time!',
    );
  } else {
    focus = null;
    refreshTray();
    showNotice(`Break's over, ${settings.name}. Ready for another round?`, 'Ready!');
  }
}

function tick() {
  if (!settings.setupComplete || reminderActive) return;
  const now = Date.now();
  if (focus && now >= focus.endsAt) {
    advanceFocus();
    return;
  }
  if (settings.paused) return;
  if (!nextDueAt) scheduleInterval();
  if (!schedule.isActive(now, settings)) {
    // Woke up (or the timer fired) outside the daily window: wait for morning.
    if (now >= nextDueAt) {
      nextDueAt = schedule.nextActiveAtOrAfter(now, settings);
      refreshTray();
    }
    return;
  }
  if (now >= nextDueAt) {
    triggerReminder(false);
    return;
  }
  if (focus && focus.phase === 'focus') return; // no habit nagging while you focus
  for (const habit of settings.habits) {
    if (!habit.enabled) continue;
    if (!habitDue[habit.id]) {
      scheduleHabit(habit);
      continue;
    }
    if (now >= habitDue[habit.id]) {
      triggerHabit(habit);
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// the companion window (the little buddy in the corner)
// ---------------------------------------------------------------------------
function ensureCompanion() {
  if (companion && !companion.isDestroyed()) return companion;

  const win = new BrowserWindow({
    ...COMPANION_SIZE,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: APP_NAME,
    ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required', // the chime plays without a click
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  lockDownNavigation(win);
  win.loadFile(path.join(__dirname, 'src', 'companion.html'));
  win.on('closed', () => {
    companion = null;
    reminderActive = false;
  });
  companion = win;
  return win;
}

function placeCompanion(win, big = false) {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const area = display.workArea;
  // the mini-game needs room for the drops to fall, so it gets a tall window
  const width = big ? Math.min(720, area.width) : COMPANION_SIZE.width;
  const height = big ? Math.min(820, area.height) : COMPANION_SIZE.height;
  win.setBounds({
    x: area.x + area.width - width,
    y: area.y + area.height - height,
    width,
    height,
  });
}

function showCompanion(payload) {
  clearTimeout(hideTimer);
  reminderActive = true;
  const win = ensureCompanion();
  placeCompanion(win, payload.mode === 'game');
  // Click-through everywhere except the buddy and her bubble (renderer toggles this).
  // Linux can't forward mouse moves while ignoring them, so it stays clickable.
  if (process.platform !== 'linux') win.setIgnoreMouseEvents(true, { forward: true });

  const send = () => {
    if (win.isDestroyed()) return;
    win.webContents.send('companion:show', payload);
    win.showInactive();
    refreshTray();
  };
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send);
  else send();
}

function finishCompanion() {
  clearTimeout(hideTimer);
  if (companion && !companion.isDestroyed()) companion.hide();
  reminderActive = false;
  currentHabit = null;
  refreshTray();
}

function greeting(kind, extra = {}) {
  const hour = localHour();
  return {
    mode: kind,
    name: settings.name,
    character: characterPayload(settings.character),
    snoozeMinutes: settings.snoozeMinutes,
    count: todayCount(),
    sound: settings.sound,
    hue: settings.hue,
    accessory: stats.isUnlocked(stats.ACCESSORIES.find((a) => a.id === settings.accessory) || stats.ACCESSORIES[0], unlockTotals())
      ? settings.accessory
      : 'none',
    part: stats.partOfDay(hour),
    mood: stats.moodFor(hour, todayMl(), settings.goalMl),
    ...extra,
  };
}

function triggerReminder(manual) {
  if (!settings.setupComplete) {
    openSetup('full');
    return;
  }
  if (reminderActive) return;
  currentHabit = null;
  showCompanion(greeting('reminder', { manual }));
}

function triggerHabit(habit, manual = false) {
  if (!settings.setupComplete || reminderActive) return;
  currentHabit = habit;
  const fill = (text) => text.replace(/\{name\}/g, settings.name);
  const lines = habit.lines && habit.lines.length ? habit.lines : [`Time for: ${habit.label}, {name}!`];
  showCompanion(
    greeting('reminder', {
      manual,
      habit: {
        id: habit.id,
        label: habit.label,
        line: fill(lines[Math.floor(Math.random() * lines.length)]),
        button: habit.button || 'Done!',
        cheer: fill(habit.cheer || 'Nice work, {name}!'),
      },
    }),
  );
}

function startGame() {
  if (!settings.setupComplete || reminderActive) return;
  showCompanion(greeting('game', { drops: GAME_DROPS }));
}

function showNotice(message, buttonLabel = 'Got it!', kind = 'notice') {
  if (reminderActive) return;
  showCompanion(greeting(kind, { message, buttonLabel }));
}

function helloMessage() {
  const c = findCharacter(settings.character);
  return (
    `Hi ${settings.name}! I'm ${c.name}. I'll pop in ` +
    `${schedule.describeInterval(settings.intervalMinutes)}, ` +
    `from ${schedule.describeWindow(settings)}.`
  );
}

// ---------------------------------------------------------------------------
// setup window (first run, "Set up", "Set your name", custom interval)
// ---------------------------------------------------------------------------
const SETUP_SIZES = {
  full: { width: 620, height: 980 },
  name: { width: 460, height: 330 },
  interval: { width: 500, height: 430 },
};

function lockDownNavigation(win) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

function openSetup(mode = 'full') {
  const wanted = SETUP_SIZES[mode] ? mode : 'full';
  if (setupWin && !setupWin.isDestroyed()) {
    if (setupMode === wanted) {
      if (setupWin.isMinimized()) setupWin.restore();
      setupWin.show();
      setupWin.focus();
      return;
    }
    const old = setupWin;
    setupWin = null;
    old.removeAllListeners('closed'); // switching modes is not "closing setup"
    old.destroy();
  }

  setupMode = wanted;
  setupFirstRun = !settings.setupComplete;
  characterCache = null; // pick up any characters added since last time

  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const size = SETUP_SIZES[wanted];
  const win = new BrowserWindow({
    width: Math.min(size.width, area.width - 20),
    height: Math.min(size.height, area.height - 20),
    title: APP_NAME,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#e4f6ff',
    autoHideMenuBar: true,
    maximizable: false,
    fullscreenable: false,
    resizable: wanted === 'full',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.removeMenu();
  lockDownNavigation(win);
  win.loadFile(path.join(__dirname, 'src', 'setup.html'), { query: { mode: wanted } });
  win.once('ready-to-show', () => {
    win.show();
    win.focus();
  });
  win.on('closed', () => {
    if (setupWin === win) setupWin = null;
    // Closing the very first setup without saving means nothing is configured yet.
    if (setupFirstRun && !settings.setupComplete && !setupWin) app.quit();
  });
  setupWin = win;
}

// ---------------------------------------------------------------------------
// settings and stats window (goal, hours, habits, character maker, weekly chart)
// ---------------------------------------------------------------------------
function openPrefs(section = '') {
  if (prefsWin && !prefsWin.isDestroyed()) {
    if (prefsWin.isMinimized()) prefsWin.restore();
    prefsWin.show();
    prefsWin.focus();
    if (section) prefsWin.webContents.send('prefs:goto', section);
    return;
  }
  characterCache = null;
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const win = new BrowserWindow({
    width: Math.min(820, area.width - 20),
    height: Math.min(920, area.height - 20),
    title: `${APP_NAME} settings`,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#e4f6ff',
    autoHideMenuBar: true,
    maximizable: false,
    fullscreenable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.removeMenu();
  lockDownNavigation(win);
  win.loadFile(path.join(__dirname, 'src', 'settings.html'), section ? { hash: section } : {});
  win.once('ready-to-show', () => {
    win.show();
    win.focus();
  });
  win.on('closed', () => {
    if (prefsWin === win) prefsWin = null;
    for (const key of Object.keys(pendingImages)) delete pendingImages[key];
  });
  prefsWin = win;
}

function prefsPayload() {
  const key = todayKey();
  const totals = unlockTotals();
  return {
    name: settings.name,
    goalMl: settings.goalMl,
    glassMl: settings.glassMl,
    activeStart: settings.activeStart,
    activeEnd: settings.activeEnd,
    timeZone: settings.timeZone,
    snoozeMinutes: settings.snoozeMinutes,
    sound: settings.sound,
    hotMode: settings.hotMode,
    hue: settings.hue,
    accessory: settings.accessory,
    accessories: stats.ACCESSORIES.map((a) => ({
      id: a.id,
      label: a.label,
      hint: a.hint || '',
      unlocked: stats.isUnlocked(a, totals),
    })),
    habits: settings.habits.map((h) => ({
      id: h.id,
      label: h.label,
      enabled: h.enabled,
      intervalMinutes: h.intervalMinutes,
      custom: Boolean(h.custom),
      line: h.line || '',
    })),
    character: settings.character,
    characters: listCharacters(true).map((c) => ({
      id: c.id,
      name: c.name,
      source: c.source,
      standing: dataUrl(c.files.standing),
    })),
    stats: {
      today: { glasses: todayCount(), ml: todayMl() },
      days: stats.lastDays(settings.history, key, 7),
      streak: streakNow(),
      bestStreak: totals.bestStreak,
      totalGlasses: totals.glasses,
      focusToday: focusCountToday(),
    },
  };
}

function applyPrefs(data) {
  const next = {};
  const goal = Number(data.goalMl);
  if (!Number.isFinite(goal) || goal < 500 || goal > 6000) return { ok: false, error: 'Daily goal must be between 500 and 6000 ml.' };
  next.goalMl = Math.round(goal);
  const glass = Number(data.glassMl);
  if (!Number.isFinite(glass) || glass < 50 || glass > 1000) return { ok: false, error: 'Glass size must be between 50 and 1000 ml.' };
  next.glassMl = Math.round(glass);
  if (schedule.parseClock(data.activeStart) === null || schedule.parseClock(data.activeEnd) === null) {
    return { ok: false, error: 'Active hours must look like 10:00 and 23:00.' };
  }
  next.activeStart = data.activeStart;
  next.activeEnd = data.activeEnd;
  if (typeof data.timeZone !== 'string' || !validZone(data.timeZone)) return { ok: false, error: 'Unknown timezone.' };
  next.timeZone = data.timeZone;
  next.snoozeMinutes = clampInt(data.snoozeMinutes, 1, 120, settings.snoozeMinutes);
  next.sound = Boolean(data.sound);
  next.hotMode = Boolean(data.hotMode);
  next.hue = clampInt(data.hue, 0, 359, 0);
  const acc = stats.ACCESSORIES.find((a) => a.id === data.accessory);
  next.accessory = acc && stats.isUnlocked(acc, unlockTotals()) ? acc.id : settings.accessory;
  next.habits = Array.isArray(data.habits) ? data.habits : settings.habits;

  const before = JSON.stringify([settings.habits, settings.activeStart, settings.activeEnd, settings.timeZone, settings.hotMode]);
  settings = sanitizeSettings({ ...settings, ...next });
  saveSettings();
  const after = JSON.stringify([settings.habits, settings.activeStart, settings.activeEnd, settings.timeZone, settings.hotMode]);
  if (before !== after) {
    scheduleInterval();
    resetHabitTimers();
  }
  applyLoginItem();
  refreshTray();
  return { ok: true };
}

function applySetup(data) {
  const prev = { ...settings };
  const mode = setupMode;
  const next = {};

  if (mode === 'full' || mode === 'name') {
    const name = typeof data.name === 'string' ? data.name.trim().slice(0, 30) : '';
    if (!name) return { ok: false, field: 'name', error: 'Tell her what to call you.' };
    next.name = name;
  }
  if (mode === 'full' || mode === 'interval') {
    const minutes = Number(data.intervalMinutes);
    if (!Number.isFinite(minutes) || minutes < 5 || minutes > 480) {
      return { ok: false, field: 'interval', error: 'Pick a time between 5 and 480 minutes.' };
    }
    next.intervalMinutes = Math.round(minutes);
  }
  if (mode === 'full') {
    if (!listCharacters().some((c) => c.id === data.character)) {
      return { ok: false, field: 'character', error: 'Pick one of the characters.' };
    }
    next.character = data.character;
    next.launchAtLogin = Boolean(data.launchAtLogin);
  }

  settings = sanitizeSettings({ ...settings, ...next, setupComplete: true });
  saveSettings();
  applyLoginItem();

  const firstRun = !prev.setupComplete;
  if (firstRun || settings.intervalMinutes !== prev.intervalMinutes) {
    scheduleInterval();
  }
  if (firstRun) resetHabitTimers();
  refreshTray();

  // A little feedback from the buddy once the setup window has closed.
  setTimeout(() => {
    if (firstRun) {
      showNotice(helloMessage(), 'Sounds good!', 'hello');
    } else if (settings.character !== prev.character) {
      const c = findCharacter(settings.character);
      showNotice(`Hi ${settings.name}! I'm ${c.name}. I'll be your water buddy now.`, 'Nice to meet you!');
    } else if (settings.intervalMinutes !== prev.intervalMinutes) {
      showNotice(`Got it! I'll check in ${schedule.describeInterval(settings.intervalMinutes)}.`);
    } else if (settings.name !== prev.name) {
      showNotice(`Nice to meet you, ${settings.name}!`, 'Hi!');
    }
  }, 350);

  return { ok: true };
}

// ---------------------------------------------------------------------------
// tray
// ---------------------------------------------------------------------------
function trayImage() {
  const dir = path.join(__dirname, 'assets');
  if (process.platform === 'darwin') {
    const img = nativeImage.createFromPath(path.join(dir, 'trayTemplate.png'));
    img.setTemplateImage(true);
    return img;
  }
  return nativeImage.createFromPath(path.join(dir, 'tray.png'));
}

function statusLine() {
  if (!settings.setupComplete) return 'Finish setup to start reminders';
  if (settings.paused) return 'Paused';
  if (!nextDueAt) return 'Getting ready…';
  return `Next reminder: ${schedule.formatClock(nextDueAt, settings.timeZone)}`;
}

function intervalMenu() {
  const isPreset = PRESET_INTERVALS.includes(settings.intervalMinutes);
  const items = PRESET_INTERVALS.map((minutes) => ({
    label: schedule.describeInterval(minutes).replace('every ', 'Every '),
    type: 'radio',
    checked: settings.intervalMinutes === minutes,
    click: () => {
      settings.intervalMinutes = minutes;
      saveSettings();
      scheduleInterval();
      refreshTray();
      showNotice(`Got it! I'll check in ${schedule.describeInterval(minutes)}.`);
    },
  }));
  items.push({
    label: isPreset ? 'Custom…' : `Custom… (${schedule.describeInterval(settings.intervalMinutes)})`,
    type: 'radio',
    checked: !isPreset,
    click: () => openSetup('interval'),
  });
  return items;
}

function characterMenu() {
  const items = listCharacters().map((c) => ({
    label: c.source === 'user' ? `${c.name} (yours)` : c.name,
    type: 'radio',
    checked: c.id === settings.character,
    click: () => {
      settings.character = c.id;
      saveSettings();
      refreshTray();
      showNotice(`Hi ${settings.name}! I'm ${c.name}. I'll be your water buddy now.`, 'Nice to meet you!');
    },
  }));
  items.push(
    { type: 'separator' },
    {
      label: 'Create your own…',
      click: () => openPrefs('characters'),
    },
    {
      label: 'Add your own…',
      click: () => shell.openPath(ensureUserCharactersDir()),
    },
    {
      label: 'Reload characters',
      click: () => {
        listCharacters(true);
        refreshTray();
      },
    },
  );
  return items;
}

function accessoryMenu() {
  const totals = unlockTotals();
  return stats.ACCESSORIES.map((a) => {
    const open = stats.isUnlocked(a, totals);
    return {
      label: open ? a.label : `${a.label} (locked: ${a.hint})`,
      type: 'radio',
      checked: settings.accessory === a.id,
      enabled: open,
      click: () => {
        settings.accessory = a.id;
        saveSettings();
        refreshTray();
        showNotice(a.id === 'none' ? 'Back to my plain look!' : `Ooh, a ${a.label.toLowerCase()}! How do I look?`);
      },
    };
  });
}

function logWaterMenu() {
  const amounts = [...new Set([settings.glassMl, ...LOG_AMOUNTS])].sort((a, b) => a - b);
  return amounts.map((ml) => ({
    label: `${stats.formatMl(ml)}${ml === settings.glassMl ? ' (a glass)' : ''}`,
    click: () => logWater(ml),
  }));
}

function logWater(ml) {
  const result = recordDrink(ml);
  scheduleInterval();
  refreshTray();
  const left = Math.max(0, result.goalMl - result.ml);
  const message = result.goalJustMet
    ? `Daily goal reached, ${settings.name}! ${stats.formatMl(result.ml)} today.${result.streak > 1 ? ` ${result.streak}-day streak!` : ''}`
    : `Logged ${stats.formatMl(ml)}. ${stats.formatMl(result.ml)} so far, ${stats.formatMl(left)} to go!`;
  showNotice(message, 'Thanks!');
}

function focusMenu() {
  if (focus) {
    return [
      {
        label: `${focus.phase === 'focus' ? 'Focusing' : 'On break'}: ${focusLeftMinutes()} min left`,
        enabled: false,
      },
      { label: 'Stop timer', click: stopFocus },
    ];
  }
  return FOCUS_PRESETS.map((p) => ({
    label: `Focus ${p.focus} min, break ${p.rest} min`,
    click: () => startFocus(p.focus, p.rest),
  }));
}

function buildTrayMenu() {
  if (!settings.setupComplete) {
    return Menu.buildFromTemplate([
      { label: statusLine(), enabled: false },
      { type: 'separator' },
      { label: 'Set up…', click: () => openSetup('full') },
      { type: 'separator' },
      { label: `Quit ${APP_NAME}`, click: () => app.quit() },
    ]);
  }
  const glasses = todayCount();
  const streak = streakNow();
  return Menu.buildFromTemplate([
    { label: statusLine(), enabled: false },
    { label: `Glasses today: ${glasses}`, enabled: false },
    { label: `Water: ${stats.formatMl(todayMl())} of ${stats.formatMl(settings.goalMl)}`, enabled: false },
    ...(streak > 0 ? [{ label: `Streak: ${streak} day${streak === 1 ? '' : 's'}`, enabled: false }] : []),
    ...(focus
      ? [{ label: `${focus.phase === 'focus' ? 'Focus' : 'Break'}: ${focusLeftMinutes()} min left`, enabled: false }]
      : []),
    { type: 'separator' },
    { label: 'Drink now', click: () => triggerReminder(true) },
    { label: 'Log water', submenu: logWaterMenu() },
    { label: 'Focus timer', submenu: focusMenu() },
    { label: 'Play with buddy', click: startGame },
    { type: 'separator' },
    { label: 'Set up…', click: () => openSetup('full') },
    { label: 'Set your name…', click: () => openSetup('name') },
    { label: 'Reminder interval', submenu: intervalMenu() },
    { label: 'Character', submenu: characterMenu() },
    { label: 'Accessory', submenu: accessoryMenu() },
    { label: 'Settings and stats…', click: () => openPrefs() },
    { type: 'separator' },
    {
      label: 'Hot day / workout mode (remind more often)',
      type: 'checkbox',
      checked: settings.hotMode,
      click: (item) => {
        settings.hotMode = item.checked;
        saveSettings();
        scheduleInterval();
        refreshTray();
      },
    },
    {
      label: 'Sounds',
      type: 'checkbox',
      checked: settings.sound,
      click: (item) => {
        settings.sound = item.checked;
        saveSettings();
      },
    },
    {
      label: settings.paused ? 'Resume reminders' : 'Pause reminders',
      click: () => {
        settings.paused = !settings.paused;
        saveSettings();
        if (!settings.paused) {
          scheduleInterval();
          resetHabitTimers();
        }
        refreshTray();
      },
    },
    {
      label: app.isPackaged ? 'Launch at login' : 'Launch at login (installed app only)',
      type: 'checkbox',
      checked: settings.launchAtLogin,
      enabled: app.isPackaged,
      click: (item) => {
        settings.launchAtLogin = item.checked;
        saveSettings();
        applyLoginItem();
      },
    },
    { type: 'separator' },
    { label: `Quit ${APP_NAME}`, click: () => app.quit() },
  ]);
}

function refreshTray() {
  if (!tray || tray.isDestroyed()) return;
  tray.setContextMenu(buildTrayMenu());
  tray.setToolTip(`${APP_NAME}\n${statusLine()}`);
}

function createTray() {
  tray = new Tray(trayImage());
  if (process.platform !== 'darwin') {
    tray.on('click', () => tray.popUpContextMenu());
  }
  refreshTray();
}

// ---------------------------------------------------------------------------
// IPC (everything the two web pages are allowed to ask for)
// ---------------------------------------------------------------------------
function fromCompanion(event) {
  return companion && !companion.isDestroyed() && event.sender === companion.webContents;
}

function fromSetup(event) {
  return setupWin && !setupWin.isDestroyed() && event.sender === setupWin.webContents;
}

function fromPrefs(event) {
  return prefsWin && !prefsWin.isDestroyed() && event.sender === prefsWin.webContents;
}

function registerIpc() {
  ipcMain.handle('companion:answer', (event, action) => {
    if (!fromCompanion(event)) return {};
    clearTimeout(hideTimer);
    // Safety net in case the page never reports that she has left.
    hideTimer = setTimeout(finishCompanion, 15000);

    if (action === 'drank') {
      const result = recordDrink();
      scheduleInterval();
      refreshTray();
      return result;
    }
    if (action === 'done' && currentHabit) {
      scheduleHabit(currentHabit);
      return {};
    }
    if (action === 'snooze') {
      if (currentHabit) scheduleHabit(currentHabit, settings.snoozeMinutes);
      else scheduleFrom(settings.snoozeMinutes);
      refreshTray();
      return {};
    }
    return {};
  });

  ipcMain.on('companion:done', (event) => {
    if (fromCompanion(event)) finishCompanion();
  });

  ipcMain.on('companion:ignore-mouse', (event, ignore) => {
    if (!fromCompanion(event) || process.platform === 'linux') return;
    companion.setIgnoreMouseEvents(Boolean(ignore), { forward: true });
  });

  ipcMain.handle('setup:get', (event) => {
    if (!fromSetup(event)) return null;
    const characters = listCharacters(true).map((c) => ({
      id: c.id,
      name: c.name,
      source: c.source,
      standing: dataUrl(c.files.standing),
      drinking: dataUrl(c.files.drinking),
    }));
    const selected = characters.some((c) => c.id === settings.character) ? settings.character : characters[0]?.id;
    return {
      mode: setupMode,
      firstRun: setupFirstRun,
      name: settings.name,
      intervalMinutes: settings.intervalMinutes,
      presets: PRESET_INTERVALS,
      character: selected,
      characters,
      launchAtLogin: settings.launchAtLogin,
      canLaunchAtLogin: app.isPackaged,
      activeWindow: schedule.describeWindow(settings),
    };
  });

  ipcMain.handle('setup:save', (event, data) => {
    if (!fromSetup(event) || !data || typeof data !== 'object') return { ok: false, error: 'Unexpected request.' };
    const result = applySetup(data);
    if (result.ok) setImmediate(() => setupWin && !setupWin.isDestroyed() && setupWin.close());
    return result;
  });

  ipcMain.on('setup:cancel', (event) => {
    if (fromSetup(event)) setupWin.close();
  });

  ipcMain.handle('setup:open-characters-folder', (event) => {
    if (!fromSetup(event) && !fromPrefs(event)) return;
    return shell.openPath(ensureUserCharactersDir());
  });

  // ---- settings and stats window
  ipcMain.handle('prefs:get', (event) => (fromPrefs(event) ? prefsPayload() : null));

  ipcMain.handle('prefs:save', (event, data) => {
    if (!fromPrefs(event) || !data || typeof data !== 'object') return { ok: false, error: 'Unexpected request.' };
    return applyPrefs(data);
  });

  ipcMain.on('prefs:close', (event) => {
    if (fromPrefs(event)) prefsWin.close();
  });

  ipcMain.handle('character:pick-image', async (event, pose) => {
    if (!fromPrefs(event) || !['standing', 'drinking', 'celebrate'].includes(pose)) return { ok: false };
    const result = await dialog.showOpenDialog(prefsWin, {
      title: `Choose the ${pose} picture`,
      properties: ['openFile'],
      filters: [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'] }],
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
    const file = result.filePaths[0];
    const png = toPngBuffer(file);
    if (!png) return { ok: false, error: 'That picture could not be read (or is over 2 MB).' };
    pendingImages[pose] = file;
    return { ok: true, preview: `data:image/png;base64,${png.toString('base64')}` };
  });

  ipcMain.handle('character:create', (event, data) => {
    if (!fromPrefs(event) || !data || typeof data !== 'object') return { ok: false, error: 'Unexpected request.' };
    const result = createUserCharacter({
      name: data.name,
      standing: pendingImages.standing,
      drinking: pendingImages.drinking,
      celebrate: pendingImages.celebrate,
    });
    if (result.ok) {
      for (const key of Object.keys(pendingImages)) delete pendingImages[key];
      if (data.use) {
        settings.character = result.id;
        saveSettings();
      }
      refreshTray();
    }
    return result;
  });

  ipcMain.handle('character:delete', (event, id) => {
    if (!fromPrefs(event)) return { ok: false };
    const result = deleteUserCharacter(id);
    refreshTray();
    return result;
  });

  ipcMain.handle('character:use', (event, id) => {
    if (!fromPrefs(event) || !listCharacters().some((c) => c.id === id)) return { ok: false };
    settings.character = id;
    saveSettings();
    refreshTray();
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// app lifecycle
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (!settings.setupComplete) {
      openSetup('full');
    } else if (argv.includes('--remind-now')) {
      triggerReminder(true);
    } else {
      showNotice(`I'm already here, ${settings.name}! Look for me in your system tray.`, 'Got it!');
    }
  });

  // The buddy lives in the tray, so closing every window must not quit.
  app.on('window-all-closed', () => {});

  app.whenReady().then(() => {
    app.setAppUserModelId('com.waterbuddy.app');
    if (process.platform === 'darwin') {
      app.dock?.hide();
      Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }]));
    } else {
      Menu.setApplicationMenu(null);
    }

    loadSettings();
    ensureUserCharactersDir();
    const characters = listCharacters(true);
    if (characters.length && !characters.some((c) => c.id === settings.character)) {
      settings.character = characters[0].id;
      saveSettings();
    }

    registerIpc();
    createTray();

    if (settings.setupComplete) {
      scheduleInterval();
      resetHabitTimers();
    } else openSetup('full');

    setInterval(tick, TICK_MS);
    setInterval(refreshTray, 60 * 1000); // keeps "next reminder" and the day counter fresh
    powerMonitor.on('resume', tick);
    powerMonitor.on('unlock-screen', tick);

    // `npm start -- --remind-now` pops her up straight away (handy for testing).
    if (settings.setupComplete && process.argv.includes('--remind-now')) {
      setTimeout(() => triggerReminder(true), 600);
    }
  });
}
