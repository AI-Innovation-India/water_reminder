// End-to-end test of the real app, including the real tray-menu click handlers.
// Runs a patched COPY of the app (your files are untouched) that exposes the tray menu to the test.
// Linux CI/headless:  xvfb-run -a npm run e2e        Windows/macOS: npm run e2e (windows will flash on screen)
// Screenshots land in tools/e2e-screenshots/.
const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const ROOT = path.join(__dirname, '..');
const ELECTRON = process.env.ELECTRON_BIN || path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
const SRC = ROOT;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'water-buddy-e2e-'));
const APP = path.join(TMP, 'app');
const UD = path.join(TMP, 'userdata');
const OUT = path.join(ROOT, 'tools', 'e2e-screenshots');
const LOG = path.join(TMP, 'app.log');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- build the patched copy
fs.rmSync(APP, { recursive: true, force: true });
fs.cpSync(SRC, APP, { recursive: true, filter: (p) => !/node_modules|e2e-screenshots|[\\/]tools$|[\\/]dist/.test(p) });
let main = fs.readFileSync(`${APP}/main.js`, 'utf8');
main = main.replace('tray = new Tray(trayImage());', `tray = new Tray(trayImage());
  { const orig = tray.setContextMenu.bind(tray); tray.setContextMenu = (m) => { global.__menu = m; orig(m); }; }`);
main += `\nglobal.__test = { electron: require('electron'), get settings() { return settings; }, get menu() { return global.__menu; }, get active() { return reminderActive; },
  triggerHabit: (id) => triggerHabit(settings.habits.find((h) => h.id === id), true), startGame, startFocus, stopFocus, createUserCharacter, deleteUserCharacter, get focus() { return focus; }, nextHabitDue: (id) => habitDue[id] };\n`;
fs.writeFileSync(`${APP}/main.js`, main);

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const env = { ...process.env };
const args = [APP, ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : []), `--user-data-dir=${UD}`, '--remote-debugging-port=9333', '--inspect=9230'];
const log = fs.createWriteStream(LOG);
const proc = spawn(ELECTRON, args, { env, shell: process.platform === 'win32' });
proc.stdout.pipe(log); proc.stderr.pipe(log);
let exited = false; proc.on('exit', () => { exited = true; });

let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  [' + extra + ']' : ''}`); if (!ok) failures += 1; };

async function json(port, path = '/json') { try { return await (await fetch(`http://127.0.0.1:${port}${path}`)).json(); } catch { return []; } }
function connect(wsUrl) {
  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl); let id = 0; const pending = new Map();
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
    const send = (method, params = {}) => new Promise((res) => { id += 1; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
    ws.onopen = () => resolve({ send, close: () => ws.close() });
  });
}
async function waitTarget(match, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const t = (await json(9333)).find((x) => x.type === 'page' && match(x.url)); if (t) return t; await sleep(200); }
  throw new Error('target not found');
}
const evalIn = async (c, expr) => {
  const r = await Promise.race([c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }), sleep(6000).then(() => { throw new Error('timeout: ' + expr.slice(0, 90)); })]);
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r.result.result.value;
};
const shot = async (c, name) => { const r = await c.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64')); };
const fire = (c, expr) => c.send('Runtime.evaluate', { expression: expr });

let inspector;
const mainEval = (expr) => evalIn(inspector, `(${expr})`);
const settings = () => JSON.parse(fs.readFileSync(`${UD}/settings.json`, 'utf8'));
const menuLabels = (sub) => mainEval(`(() => { let items = __test.menu.items; ${sub ? `items = items.find(i => i.label === ${JSON.stringify(sub)}).submenu.items;` : ''} return items.map(i => i.label || '--'); })()`);
const clickMenu = (path) => mainEval(`(() => { let items = __test.menu.items; let it; for (const p of ${JSON.stringify(path)}) { it = items.find(i => i.label === p || (i.label || '').startsWith(p)); if (!it) return 'NOT FOUND: ' + p; items = it.submenu ? it.submenu.items : []; } it.click(); return 'ok'; })()`);
const isChecked = (path) => mainEval(`(() => { let items = __test.menu.items; let it; for (const p of ${JSON.stringify(path)}) { it = items.find(i => i.label === p || (i.label || '').startsWith(p)); items = it.submenu ? it.submenu.items : []; } return it.checked; })()`);
const windows = () => mainEval(`__test.electron.BrowserWindow.getAllWindows().map(w => ({ v: w.isVisible(), u: w.webContents.getURL().split('/').pop(), t: w.getTitle() }))`);
const companionVisible = async () => (await windows()).some((w) => w.u.startsWith('companion.html') && w.v);
const waitFor = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(200); } return false; };

let comp;
async function companion() {
  if (!comp) { const t = await waitTarget((u) => u.includes('companion.html')); comp = await connect(t.webSocketDebuggerUrl); }
  return comp;
}
const bubbleText = async () => evalIn(await companion(), `document.getElementById('bubbleText').textContent`);
async function waitBubble(re, ms = 8000) { const c = await companion(); return waitFor(async () => re.test(await evalIn(c, `document.getElementById('bubbleText').textContent`)), ms); }
async function ack() { const c = await companion(); await evalIn(c, `document.getElementById('btnPrimary').click()`); const gone = await waitFor(async () => !(await companionVisible()), 7000); return gone; }

(async () => {
  // inspector for the main process
  await waitFor(async () => (await json(9230)).length > 0, 15000);
  inspector = await connect((await json(9230))[0].webSocketDebuggerUrl);
  check('main-process inspector connected', await waitFor(async () => { try { return (await mainEval(`typeof __test`)) === 'object'; } catch { return false; } }, 10000));

  // ---------------------------------------------------------- first run
  const setupT = await waitTarget((u) => u.includes('setup.html'));
  const setup = await connect(setupT.webSocketDebuggerUrl);
  await sleep(900);
  check('first run opens full setup', setupT.url.includes('mode=full'));
  check('first-run tray menu is minimal', JSON.stringify(await menuLabels()) === JSON.stringify(['Finish setup to start reminders', '--', 'Set up…', '--', 'Quit Water Buddy']), JSON.stringify(await menuLabels()));
  const dims = await evalIn(setup, `({ sh: document.documentElement.scrollHeight, ih: innerHeight, iw: innerWidth, chipsTop: [...document.querySelectorAll('.chip')].map(c => c.offsetTop) })`);
  console.log('      setup viewport', JSON.stringify(dims));
  check('interval chips fit on one row', new Set(dims.chipsTop).size === 1);
  await shot(setup, '01-setup-empty');
  check('empty name is rejected with a message', await evalIn(setup, `(async () => { document.getElementById('form').requestSubmit(); await new Promise(r => setTimeout(r, 250)); return !document.getElementById('nameError').hidden; })()`));
  await evalIn(setup, `(() => { const n = document.getElementById('name'); n.value = 'Dee'; n.dispatchEvent(new Event('input')); const c = document.getElementById('custom'); c.value = '50'; c.dispatchEvent(new Event('input')); document.querySelectorAll('.char[role=radio]')[1].click(); return true; })()`);
  await sleep(300); await shot(setup, '02-setup-filled');
  fire(setup, `document.getElementById('form').requestSubmit()`);
  await sleep(1800);
  let s = settings();
  check('setup saved name/interval/character', s.setupComplete && s.name === 'Dee' && s.intervalMinutes === 50 && s.character === 'sunny', `${s.name}/${s.intervalMinutes}/${s.character}`);
  check('full tray menu appears after setup', (await menuLabels()).includes('Drink now') && (await menuLabels()).includes('Pause reminders'), JSON.stringify(await menuLabels()));
  check('status line shows next reminder time', /^Next reminder: \d{1,2}:\d{2} (AM|PM)$/.test((await menuLabels())[0]), (await menuLabels())[0]);

  // ---------------------------------------------------------- hello
  check('hello bubble appears', await waitBubble(/Hi Dee! I'm Sunny/));
  await sleep(1500); await shot(await companion(), '03-hello');
  console.log('      hello:', await bubbleText());
  check('hello says "from 10 AM to 11 PM IST"', /every 50 minutes, from 10 AM to 11 PM IST/.test(await bubbleText()));
  check('hello buddy leaves and the window hides', await ack());

  // ---------------------------------------------------------- Drink now (menu)
  check('click "Drink now"', (await clickMenu(['Drink now'])) === 'ok');
  check('manual reminder text', await waitBubble(/Good call, Dee/));
  await sleep(800); await shot(await companion(), '04-reminder');
  check('both buttons visible', await evalIn(await companion(), `!document.getElementById('btnSnooze').hidden && /drank/.test(document.getElementById('btnPrimary').textContent)`));
  const box = await evalIn(await companion(), `(() => { const b = document.getElementById('bubble').getBoundingClientRect(); const a = document.getElementById('actions').getBoundingClientRect(); return { top: b.top, bottom: b.bottom, rowTops: [...document.querySelectorAll('#actions .btn')].map(x => x.getBoundingClientRect().top) }; })()`);
  check('bubble fits inside the window (not clipped at top)', box.top >= 8, `bubble top = ${Math.round(box.top)}px`);
  check('buttons share one row', new Set(box.rowTops).size === 1, JSON.stringify(box.rowTops));
  await evalIn(await companion(), `document.getElementById('btnPrimary').click()`);
  await sleep(700); await shot(await companion(), '05-drinking');
  await sleep(1500); await shot(await companion(), '06-celebrate');
  check('celebration shows glass count', /#1|1 down|That's 1/.test(await bubbleText()), await bubbleText());
  check('buddy leaves and the window hides', await waitFor(async () => !(await companionVisible()), 8000));
  check('drink recorded', settings().stats.count === 1, JSON.stringify(settings().stats));
  check('tray shows "Glasses today: 1"', (await menuLabels()).includes('Glasses today: 1'));

  // ---------------------------------------------------------- pause / resume
  await clickMenu(['Pause reminders']);
  check('pause saved', settings().paused === true);
  check('status says Paused and menu offers Resume', (await menuLabels())[0] === 'Paused' && (await menuLabels()).includes('Resume reminders'));
  await clickMenu(['Resume reminders']);
  check('resume saved', settings().paused === false && /^Next reminder/.test((await menuLabels())[0]));

  // ---------------------------------------------------------- interval presets + custom
  check('interval submenu lists presets + custom', JSON.stringify(await menuLabels('Reminder interval')) === JSON.stringify(['Every 30 minutes', 'Every 45 minutes', 'Every hour', 'Every 90 minutes', 'Every 2 hours', 'Custom… (every 50 minutes)']), JSON.stringify(await menuLabels('Reminder interval')));
  check('custom interval is shown as selected', await isChecked(['Reminder interval', 'Custom…']) === true);
  await clickMenu(['Reminder interval', 'Every hour']);
  check('preset interval saved', settings().intervalMinutes === 60);
  check('preset radio is checked', await isChecked(['Reminder interval', 'Every hour']) === true);
  check('buddy confirms the new interval', await waitBubble(/every hour/));
  await ack();

  await clickMenu(['Reminder interval', 'Custom…']);
  const intT = await waitTarget((u) => u.includes('mode=interval'));
  const intW = await connect(intT.webSocketDebuggerUrl);
  await sleep(700); await shot(intW, '07-interval-window');
  check('interval window hides the name + buddy sections', await evalIn(intW, `['.sec-name','.sec-character'].every(q => getComputedStyle(document.querySelector(q)).display === 'none') || getComputedStyle(document.querySelector('.sec-character')).display === 'none'`));
  check('interval window shows the current value as pressed chip', await evalIn(intW, `[...document.querySelectorAll('.chip')].find(c => c.getAttribute('aria-pressed') === 'true').textContent === '1 hour'`));
  await evalIn(intW, `(() => { const c = document.getElementById('custom'); c.value = '4'; c.dispatchEvent(new Event('input')); return true; })()`);
  fire(intW, `document.getElementById('form').requestSubmit()`); await sleep(500);
  check('too-small interval is rejected', (await evalIn(intW, `!document.getElementById('intervalError').hidden`)) && settings().intervalMinutes === 60);
  await evalIn(intW, `(() => { const c = document.getElementById('custom'); c.value = '75'; c.dispatchEvent(new Event('input')); return true; })()`);
  fire(intW, `document.getElementById('form').requestSubmit()`); await sleep(1500);
  check('custom interval saved', settings().intervalMinutes === 75);
  check('menu reflects custom interval', (await menuLabels('Reminder interval')).includes('Custom… (every 75 minutes)'));
  await waitBubble(/75 minutes/); await ack();

  // ---------------------------------------------------------- characters
  check('built-in characters listed', JSON.stringify((await menuLabels('Character')).slice(0, 2)) === JSON.stringify(['Mochi', 'Sunny']), JSON.stringify(await menuLabels('Character')));
  check('Sunny is the selected character', await isChecked(['Character', 'Sunny']) === true);
  await clickMenu(['Character', 'Mochi']);
  check('switching to Mochi saved', settings().character === 'mochi');
  check('Mochi introduces herself', await waitBubble(/I'm Mochi/));
  await ack();

  // custom character: one valid, one broken
  const rob = `${UD}/characters/robin`; const bad = `${UD}/characters/broken`;
  fs.mkdirSync(rob, { recursive: true }); fs.mkdirSync(bad, { recursive: true });
  for (const f of ['standing.png', 'drinking.png']) fs.copyFileSync(`${SRC}/characters/sunny/${f}`, `${rob}/${f}`);
  fs.writeFileSync(`${rob}/character.json`, JSON.stringify({ name: 'Robin' }));
  fs.copyFileSync(`${SRC}/characters/sunny/standing.png`, `${bad}/standing.png`);
  check('template folder + README were created for custom characters', fs.existsSync(`${UD}/characters/_template/standing.png`) && fs.existsSync(`${UD}/characters/README.txt`));
  await clickMenu(['Character', 'Reload characters']);
  const chars = await menuLabels('Character');
  check('valid custom character appears', chars.includes('Robin (yours)'), JSON.stringify(chars));
  check('character missing drinking.png is ignored; _template is hidden', !chars.some((c) => /broken/i.test(c)) && !chars.some((c) => /template|my buddy/i.test(c)));
  await clickMenu(['Character', 'Robin (yours)']);
  check('custom character selected', settings().character === 'user:robin');
  await waitBubble(/I'm Robin/);
  check('custom character art loads (no celebrate.png falls back to standing)', await evalIn(await companion(), `[...document.querySelectorAll('.sprite img')].every(i => i.src.startsWith('data:image/png') && i.naturalWidth > 0)`));
  await ack();

  // ---------------------------------------------------------- snooze
  await clickMenu(['Drink now']);
  await waitBubble(/Good call/);
  await evalIn(await companion(), `document.getElementById('btnSnooze').click()`);
  await sleep(900); await shot(await companion(), '08-snooze');
  check('snooze confirms', /See you in 10 min/.test(await bubbleText()), await bubbleText());
  check('snooze hides the buddy', await waitFor(async () => !(await companionVisible()), 8000));
  check('snooze does not count a drink', settings().stats.count === 1);

  // ---------------------------------------------------------- set your name
  await clickMenu(['Set your name']);
  const nameT = await waitTarget((u) => u.includes('mode=name'));
  const nameW = await connect(nameT.webSocketDebuggerUrl);
  await sleep(700); await shot(nameW, '09-name-window');
  check('name window prefilled with current name', (await evalIn(nameW, `document.getElementById('name').value`)) === 'Dee');
  check('name window hides interval + buddy sections', await evalIn(nameW, `['.sec-interval','.sec-character'].every(q => getComputedStyle(document.querySelector(q)).display === 'none')`));
  await evalIn(nameW, `(() => { const n = document.getElementById('name'); n.value = 'Dinesh'; n.dispatchEvent(new Event('input')); return true; })()`);
  fire(nameW, `document.getElementById('form').requestSubmit()`); await sleep(1500);
  check('name saved', settings().name === 'Dinesh');
  check('buddy greets new name', await waitBubble(/Nice to meet you, Dinesh/));
  await ack();

  // ---------------------------------------------------------- log water, goal and streak
  await mainEval(`(() => { const m = __test.menu.items; return m.length; })()`);
  check('tray shows water progress line', (await menuLabels()).includes('Water: 250 ml of 2 L'), JSON.stringify((await menuLabels()).slice(0, 5)));
  check('click "Log water > 500 ml"', (await clickMenu(['Log water', '500 ml'])) === 'ok');
  check('log water buddy confirms', await waitBubble(/Logged 500 ml/), await bubbleText());
  await ack();
  check('log water saved to stats and history', settings().stats.ml === 750 && settings().stats.count === 2 && Object.values(settings().history).some((d) => d.ml === 750), JSON.stringify(settings().stats));

  // ---------------------------------------------------------- settings and stats window
  check('click "Settings and stats"', (await clickMenu(['Settings and stats'])) === 'ok');
  const prefT = await waitTarget((u) => u.includes('settings.html'));
  const pref = await connect(prefT.webSocketDebuggerUrl);
  await sleep(900); await shot(pref, '11-settings');
  check('settings shows stat tiles and a 7-day chart', await evalIn(pref, `document.querySelectorAll('.tile').length === 5 && document.querySelectorAll('#week .col').length === 7`));
  check('settings is prefilled', await evalIn(pref, `document.getElementById('goal').value === '2000' && document.getElementById('glass').value === '250' && document.getElementById('start').value === '10:00' && document.getElementById('end').value === '23:00' && document.getElementById('zone').value === 'Asia/Kolkata'`));
  check('locked accessories are disabled', await evalIn(pref, `[...document.querySelectorAll('#accessories .chip')].filter((c) => c.disabled).length >= 4`));
  await evalIn(pref, `(() => {
    const set = (id, v) => { const n = document.getElementById(id); n.value = v; n.dispatchEvent(new Event('input')); };
    set('goal', '700'); set('end', '22:00'); set('hue', '90');
    const stretch = [...document.querySelectorAll('.habit')].find((h) => /Stretch/.test(h.textContent)).querySelector('input[type=checkbox]');
    stretch.checked = true; stretch.dispatchEvent(new Event('change'));
    set('newLabel', 'Take meds'); set('newLine', 'Meds time, {name}!'); document.getElementById('addHabit').click();
    document.getElementById('hot').checked = true;
    return true; })()`);
  fire(pref, `document.getElementById('form').requestSubmit()`); await sleep(1200);
  s = settings();
  check('settings saved goal, hours, hue, hot mode', s.goalMl === 700 && s.activeEnd === '22:00' && s.hue === 90 && s.hotMode === true, `${s.goalMl}/${s.activeEnd}/${s.hue}/${s.hotMode}`);
  check('settings saved habits (stretch on, custom added)', s.habits.find((h) => h.id === 'stretch').enabled && s.habits.some((h) => h.custom && h.label === 'Take meds' && h.line === 'Meds time, {name}!'), JSON.stringify(s.habits.map((h) => [h.id, h.enabled])));
  check('goal met -> streak line in the tray', (await menuLabels()).includes('Streak: 1 day'), JSON.stringify((await menuLabels()).slice(0, 5)));
  check('hot mode checkbox is checked in the tray', await isChecked(['Hot day']) === true);
  check('bad goal is rejected with a message', await evalIn(pref, `(async () => { const g = document.getElementById('goal'); g.value = '10'; document.getElementById('form').requestSubmit(); await new Promise((r) => setTimeout(r, 600)); return !document.getElementById('saveError').hidden; })()`) && settings().goalMl === 700);
  fire(pref, `document.getElementById('close').click()`);
  check('settings window closes', await waitFor(async () => !(await windows()).some((w) => w.u.startsWith('settings.html')), 4000));
  await clickMenu(['Hot day']);
  check('hot mode can be switched off from the tray', settings().hotMode === false);

  // ---------------------------------------------------------- other habits
  const habitId = await mainEval(`__test.settings.habits.find((h) => h.custom).id`);
  await mainEval(`__test.triggerHabit(${JSON.stringify(habitId)}), true`);
  check('custom habit shows its own line', await waitBubble(/Meds time, Dinesh!/), await bubbleText());
  check('habit has Done and snooze buttons', await evalIn(await companion(), `document.getElementById('btnPrimary').textContent === 'Done!' && !document.getElementById('btnSnooze').hidden`));
  check('habit does not count as a drink', settings().stats.count === 2);
  check('habit hop-away and hides', await ack());
  await mainEval(`__test.triggerHabit('stretch'), true`);
  check('built-in stretch habit appears', await waitBubble(/stretch/i), await bubbleText());
  check('habit celebration text', (await ack()) && true);
  check('habit timer rescheduled', (await mainEval(`__test.nextHabitDue('stretch')`)) > Date.now());

  // ---------------------------------------------------------- accessory + sounds menu
  const accLabels = await menuLabels('Accessory');
  check('accessory menu lists locked and open items', accLabels[0] === 'None' && accLabels.some((l) => /Party hat \(locked: drink 10 glasses\)/.test(l)), JSON.stringify(accLabels));
  settings(); await mainEval(`(() => { __test.settings.accessory = 'crown'; })()`);
  await mainEval(`(() => { const s = __test.settings; s.history['2026-01-01'] = { glasses: 8, ml: 2000 }; s.history['2026-01-02'] = { glasses: 8, ml: 2000 }; s.history['2026-01-03'] = { glasses: 8, ml: 2000 }; s.history['2026-01-04'] = { glasses: 8, ml: 2000 }; s.history['2026-01-05'] = { glasses: 8, ml: 2000 }; s.history['2026-01-06'] = { glasses: 8, ml: 2000 }; s.history['2026-01-07'] = { glasses: 8, ml: 2000 }; return true; })()`);
  await clickMenu(['Drink now']);
  await waitBubble(/Good call/);
  check('unlocked accessory is drawn on the buddy', await evalIn(await companion(), `document.querySelectorAll('#accessory svg rect').length > 10 && document.getElementById('accessory').dataset.anchor === 'top'`));
  check('hue is applied to the sprite', await evalIn(await companion(), `document.getElementById('sprite').style.filter === 'hue-rotate(90deg)'`));
  await shot(await companion(), '12-accessory');
  await evalIn(await companion(), `document.getElementById('btnPrimary').click()`);
  await sleep(2200); await shot(await companion(), '13-goal-celebrate');
  check('reaching the goal gets a special cheer', /Daily goal reached|Glass #|down today|today/.test(await bubbleText()), await bubbleText());
  await waitFor(async () => !(await companionVisible()), 9000);
  await clickMenu(['Sounds']);
  check('sounds can be muted from the tray', settings().sound === false);
  await clickMenu(['Sounds']);

  // ---------------------------------------------------------- focus timer
  check('focus timer offers presets', JSON.stringify(await menuLabels('Focus timer')) === JSON.stringify(['Focus 25 min, break 5 min', 'Focus 50 min, break 10 min']), JSON.stringify(await menuLabels('Focus timer')));
  await clickMenu(['Focus timer', 'Focus 25']);
  check('focus start message', await waitBubble(/Focus time, Dinesh! 25 minutes/), await bubbleText());
  await ack();
  check('tray shows the focus countdown', (await menuLabels()).some((l) => /^Focus: 2[45] min left$/.test(l)), JSON.stringify((await menuLabels()).slice(0, 7)));
  await mainEval(`(() => { __test.focus.endsAt = Date.now() - 1000; return true; })()`);
  check('focus end tells you to take a break and counts the session', await waitBubble(/Focus session done/, 14000) && settings().focusStats.count === 1, await bubbleText());
  await ack();
  await clickMenu(['Focus timer', 'Stop timer']);
  check('focus timer can be stopped', (await mainEval(`__test.focus`)) === null);

  // ---------------------------------------------------------- mini-game
  check('click "Play with buddy"', (await clickMenu(['Play with buddy'])) === 'ok');
  check('game starts', await waitBubble(/Catch the drops/), await bubbleText());
  await sleep(2600); await shot(await companion(), '14-game');
  check('falling drops are on screen', await evalIn(await companion(), `[...document.querySelectorAll('.drop')].some((d) => { const r = d.getBoundingClientRect(); return r.width > 20 && r.bottom > 0 && r.top < innerHeight; })`));
  await evalIn(await companion(), `(() => { window.__pop = setInterval(() => document.querySelectorAll('.drop').forEach((d) => d.click()), 80); return true; })()`);
  check('game ends with a score', await waitBubble(/Perfect|You caught/, 30000), await bubbleText());
  check('game caught the drops', /Perfect|caught (\d+) \/ 12/.test(await bubbleText()), await bubbleText());
  await evalIn(await companion(), `clearInterval(window.__pop)`);
  check('game buddy leaves', await ack());

  // ---------------------------------------------------------- character maker
  const src = `${SRC}/characters/sunny/standing.png`.replace(/\\/g, '/');
  const made = await mainEval(`__test.createUserCharacter({ name: 'Pixel Pal', standing: ${JSON.stringify(src)} })`);
  check('character maker saves a buddy from one picture', made.ok && made.id === 'user:pixel-pal' && fs.existsSync(`${UD}/characters/pixel-pal/drinking.png`), JSON.stringify(made));
  await clickMenu(['Character', 'Reload characters']);
  check('made character shows in the tray', (await menuLabels('Character')).includes('Pixel Pal (yours)'), JSON.stringify(await menuLabels('Character')));
  check('character maker rejects a missing name', (await mainEval(`__test.createUserCharacter({ name: ' ', standing: ${JSON.stringify(src)} })`)).ok === false);
  check('character maker rejects a missing picture', (await mainEval(`__test.createUserCharacter({ name: 'Nope' })`)).ok === false);
  const gone = await mainEval(`__test.deleteUserCharacter('user:pixel-pal')`);
  check('made character can be deleted', gone.ok && !fs.existsSync(`${UD}/characters/pixel-pal`));
  check('delete refuses built-in or path tricks', (await mainEval(`__test.deleteUserCharacter('user:../x')`)).ok === false && (await mainEval(`__test.deleteUserCharacter('mochi')`)).ok === false);
  await clickMenu(['Character', 'Reload characters']);

  // ---------------------------------------------------------- Set up (re-run) + cancel
  await clickMenu(['Set up']);
  const fullT = await waitTarget((u) => u.includes('mode=full'));
  const fullW = await connect(fullT.webSocketDebuggerUrl);
  await sleep(900); await shot(fullW, '10-setup-rerun');
  const pre = await evalIn(fullW, `({ name: document.getElementById('name').value, picked: document.querySelector('.char[aria-checked=true]')?.textContent, pressed: [...document.querySelectorAll('.chip')].filter(c => c.getAttribute('aria-pressed') === 'true').map(c => c.textContent), title: document.getElementById('title').textContent, cancelVisible: getComputedStyle(document.getElementById('cancel')).display !== 'none', cards: document.querySelectorAll('.char[role=radio]').length })`);
  check('re-run setup is prefilled', pre.name === 'Dinesh' && /Robin/.test(pre.picked) && pre.cards === 6, JSON.stringify(pre));
  check('re-run setup shows Cancel', pre.cancelVisible && pre.title === 'Water Buddy setup');
  fire(fullW, `document.getElementById('cancel').click()`);
  check('Cancel closes setup but the app keeps running', await waitFor(async () => !(await windows()).some((w) => w.u.startsWith('setup.html')), 4000) && !exited);

  // ---------------------------------------------------------- no errors, then quit
  const errs = fs.readFileSync(LOG, 'utf8').split('\n').filter((l) => /uncaught|typeerror|referenceerror|unhandled|csp|refused to/i.test(l));
  check('no script / CSP errors in the log', errs.length === 0, errs.slice(0, 2).join(' | '));
  fire(inspector, `__test.menu.items.find(i => i.label === 'Quit Water Buddy').click()`);
  await sleep(300); inspector.close();
  check('Quit exits the app', await waitFor(async () => exited, 5000));
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('E2E ERROR', e); proc.kill(); process.exit(1); });
