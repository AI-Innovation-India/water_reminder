'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  const el = {
    buddy: $('buddy'),
    sprite: $('sprite'),
    bubble: $('bubble'),
    text: $('bubbleText'),
    actions: $('actions'),
    primary: $('btnPrimary'),
    snooze: $('btnSnooze'),
    confetti: $('confetti'),
    accessory: $('accessory'),
    game: $('game'),
  };
  const poses = {
    standing: el.sprite.querySelector('[data-pose="standing"]'),
    drinking: el.sprite.querySelector('[data-pose="drinking"]'),
    celebrate: el.sprite.querySelector('[data-pose="celebrate"]'),
  };

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SPRITE_BOX = 200; // px tall on screen
  const CONFETTI_COLOURS = ['#4cc3ff', '#ff8fb1', '#ffd35a', '#9fdcff', '#ffffff', '#7be0a8'];

  let runId = 0;
  let busy = false;
  let ignoringMouse = true;
  let soundOn = true;
  let voice = 1; // each character has its own pitch

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, reduceMotion ? Math.min(ms, 250) : ms));
  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  function formatMl(ml) {
    return ml >= 1000 ? `${Math.round(ml / 100) / 10} L` : `${ml} ml`;
  }

  // ---------------------------------------------------------------- sound
  // Tiny synthesized chimes (no audio files). Muted from the tray or Settings.
  let audio = null;
  function tone(freq, start, length, type = 'square', volume = 0.05) {
    if (!soundOn) return;
    try {
      audio = audio || new AudioContext();
      if (audio.state === 'suspended') audio.resume();
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      const t0 = audio.currentTime + start;
      osc.type = type;
      osc.frequency.setValueAtTime(freq * voice, t0);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + length);
      osc.connect(gain).connect(audio.destination);
      osc.start(t0);
      osc.stop(t0 + length + 0.05);
    } catch (_) {
      /* no audio device: stay silent */
    }
  }

  function chime(kind) {
    if (kind === 'hello') {
      tone(659, 0, 0.14);
      tone(988, 0.12, 0.22);
    } else if (kind === 'cheer') {
      [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.2));
    } else if (kind === 'sip') {
      tone(330, 0, 0.08, 'sine', 0.08);
      tone(392, 0.2, 0.08, 'sine', 0.08);
      tone(330, 0.4, 0.08, 'sine', 0.08);
    } else if (kind === 'pop') {
      tone(880, 0, 0.07, 'triangle', 0.09);
      tone(1320, 0.05, 0.07, 'triangle', 0.07);
    }
  }

  // ------------------------------------------------------------ accessories
  // Pixel hats drawn from text grids. '.' is empty; the outline is added automatically.
  const ACCESSORIES = {
    party: {
      anchor: 'top', width: 0.32,
      colors: { p: '#ff8fb1', b: '#4cc3ff', y: '#ffd35a' },
      grid: ['....yy....', '....pp....', '...pppp...', '...bbbb...', '..pppppp..', '..bbbbbb..', '.pppppppp.', '.bbbbbbbb.'],
    },
    crown: {
      anchor: 'top', width: 0.38,
      colors: { y: '#ffd35a', o: '#e6ac1c', r: '#ff4f6d', b: '#4cc3ff' },
      grid: ['y...yy...y', 'yy.yyyy.yy', 'yyyyyyyyyy', 'yyryyyybyy', 'oooooooooo'],
    },
    halo: {
      anchor: 'float', width: 0.4,
      colors: { y: '#ffe680' },
      grid: ['..yyyyyy..', '.y......y.', '..yyyyyy..', '..........'],
    },
    bow: {
      anchor: 'side', width: 0.28,
      colors: { p: '#ff8fb1', y: '#ffd35a' },
      grid: ['pp....pp', 'pppppppp', 'pppyyppp', 'pppppppp', 'pp....pp'],
    },
    glasses: {
      anchor: 'eyes', width: 0.56,
      colors: { k: '#2b1d3a', d: '#3b3b8b', w: '#9fb4ff' },
      grid: ['kkkkkkkkkkkk', 'kwdddkkwdddk', 'kddddkkddddk', '.kddk..kddk.'],
    },
  };

  function accessorySvg(def) {
    const rows = def.grid.map((r) => r.padEnd(def.grid[0].length, '.'));
    const h = rows.length;
    const w = rows[0].length;
    const filled = (x, y) => y >= 0 && y < h && x >= 0 && x < w && rows[y][x] !== '.';
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `-1 -1 ${w + 2} ${h + 2}`);
    svg.setAttribute('shape-rendering', 'crispEdges');
    const add = (x, y, fill) => {
      const r = document.createElementNS(ns, 'rect');
      r.setAttribute('x', String(x));
      r.setAttribute('y', String(y));
      r.setAttribute('width', '1');
      r.setAttribute('height', '1');
      r.setAttribute('fill', fill);
      svg.appendChild(r);
    };
    for (let y = -1; y <= h; y += 1) {
      for (let x = -1; x <= w; x += 1) {
        if (filled(x, y)) continue;
        if (filled(x + 1, y) || filled(x - 1, y) || filled(x, y + 1) || filled(x, y - 1)) add(x, y, '#2b1d3a');
      }
    }
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        if (rows[y][x] !== '.') add(x, y, def.colors[rows[y][x]] || '#ffffff');
      }
    }
    return svg;
  }

  function applyLook(payload) {
    soundOn = payload.sound !== false;
    let hash = 0;
    for (const ch of String(payload.character.id)) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
    voice = 0.85 + (hash % 6) * 0.07;

    const hue = Number(payload.hue) || 0;
    el.sprite.style.filter = hue ? `hue-rotate(${hue}deg)` : '';

    el.accessory.textContent = '';
    el.accessory.removeAttribute('data-anchor');
    const def = ACCESSORIES[payload.accessory];
    if (def) {
      const svg = accessorySvg(def);
      svg.style.width = `${Math.round(def.width * 100)}%`;
      el.accessory.dataset.anchor = def.anchor;
      el.accessory.appendChild(svg);
    }
  }

  // ---------------------------------------------------------------- helpers
  function restart(node, className) {
    node.classList.remove(className);
    void node.offsetWidth; // let the browser notice, so the animation replays
    node.classList.add(className);
  }

  function setPose(name) {
    for (const [key, img] of Object.entries(poses)) img.classList.toggle('active', key === name);
  }

  function setMotion(name) {
    el.sprite.classList.remove('bob', 'glug', 'hop', 'hop-away');
    el.accessory.classList.remove('bob', 'glug', 'hop', 'hop-away');
    if (name) {
      restart(el.sprite, name);
      restart(el.accessory, name); // hats move with her
    }
  }

  function say(text) {
    el.text.textContent = text;
  }

  function showBubble() {
    el.bubble.classList.remove('hide');
    restart(el.bubble, 'show');
  }

  function hideBubble() {
    el.bubble.classList.remove('show');
    restart(el.bubble, 'hide');
  }

  function setButtons(primaryLabel, snoozeLabel) {
    el.actions.hidden = false;
    el.primary.textContent = primaryLabel;
    el.snooze.hidden = !snoozeLabel;
    if (snoozeLabel) el.snooze.textContent = snoozeLabel;
  }

  function hideButtons() {
    el.actions.hidden = true;
  }

  function resetStage() {
    el.buddy.classList.remove('enter', 'leave');
    el.bubble.classList.remove('show', 'hide');
    el.confetti.textContent = '';
    el.game.textContent = '';
    setMotion(null);
    hideButtons();
    ignoringMouse = true;
  }

  async function loadImages(character) {
    const images = character.images;
    const sources = {
      standing: images.standing,
      drinking: images.drinking || images.standing,
      celebrate: images.celebrate || images.standing,
    };
    const loaded = {};
    for (const [key, src] of Object.entries(sources)) {
      const img = new Image();
      img.src = src;
      try {
        await img.decode();
      } catch (_) {
        /* a broken image just stays blank */
      }
      loaded[key] = img;
    }
    return { sources, size: loaded.standing };
  }

  function sizeSprite(reference) {
    const w = reference.naturalWidth || 32;
    const h = reference.naturalHeight || 40;
    const pixelArt = h <= 128;
    let width;
    let height;
    if (pixelArt) {
      const scale = Math.max(1, Math.floor(SPRITE_BOX / h));
      width = w * scale;
      height = h * scale;
    } else {
      height = SPRITE_BOX;
      width = Math.round((w * SPRITE_BOX) / h);
    }
    el.sprite.style.imageRendering = pixelArt ? 'pixelated' : 'auto';
    el.buddy.style.width = `${width}px`;
    el.buddy.style.height = `${height}px`;
    // keep the bubble's tail pointing at her head
    el.bubble.style.setProperty('--tail-right', `${Math.max(16, Math.round(width / 2) - 4)}px`);
  }

  // --------------------------------------------------------------- confetti
  function burst() {
    if (reduceMotion) return;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < 34; i += 1) {
      const bit = document.createElement('i');
      const dir = i % 2 === 0 ? -1 : 1;
      bit.style.setProperty('--dx', `${dir * (20 + Math.random() * 150)}px`);
      bit.style.setProperty('--up', `${60 + Math.random() * 90}px`);
      bit.style.setProperty('--fall', `${40 + Math.random() * 150}px`);
      bit.style.setProperty('--rot', `${(Math.random() - 0.5) * 540}deg`);
      bit.style.setProperty('--s', `${Math.random() > 0.5 ? 8 : 12}px`);
      bit.style.setProperty('--c', pick(CONFETTI_COLOURS));
      bit.style.animationDelay = `${Math.random() * 120}ms`;
      frag.appendChild(bit);
    }
    el.confetti.appendChild(frag);
    setTimeout(() => {
      el.confetti.textContent = '';
    }, 1700);
  }

  // ---------------------------------------------------------------- copy
  function noRepeat(lines) {
    let last = '';
    try {
      last = sessionStorage.getItem('lastLine') || '';
    } catch (_) {
      /* ignore */
    }
    const fresh = lines.filter((l) => l !== last);
    const line = pick(fresh.length ? fresh : lines);
    try {
      sessionStorage.setItem('lastLine', line);
    } catch (_) {
      /* ignore */
    }
    return line;
  }

  function reminderLine(name, manual, part, mood) {
    if (manual) return `Good call, ${name}! Go grab your water.`;
    if (mood === 'worried' && Math.random() < 0.6) {
      return noRepeat([
        `${name}... I'm a little worried. We're behind on water today!`,
        `Psst, ${name}. We're falling behind on today's goal.`,
        `Your glass is lonely, ${name}. Let's catch up on water!`,
      ]);
    }
    const lines = [
      `Hey ${name}! Time for some water.`,
      `Psst, ${name}. Your water glass misses you.`,
      `Sip break, ${name}! Your body will thank you.`,
      `Hydration check, ${name}. When did you last drink?`,
      `${name}, a glass of water would be lovely right now.`,
    ];
    const byPart = {
      morning: [`Good morning, ${name}! Start the day with a glass of water.`, `Rise and sip, ${name}!`],
      afternoon: [`Afternoon slump, ${name}? Water helps!`, `Keep your energy up, ${name}. Sip time!`],
      evening: [`Evening sip, ${name}! Keep today's goal in reach.`, `Almost done with the day, ${name}. One more glass?`],
      night: [`*yawn* One last glass before bed, ${name}?`, `Sleepy sip, ${name}. Then rest!`],
    };
    return noRepeat([...lines, ...(byPart[part] || [])]);
  }

  function cheerLine(result, name) {
    const count = Number(result.count) || 1;
    if (result.goalJustMet) {
      const streak = Number(result.streak) > 1 ? ` ${result.streak}-day streak!` : '';
      return `Daily goal reached, ${name}! ${formatMl(result.ml)} today.${streak}`;
    }
    if (count === 1) return `Glass #1 of the day. Great start, ${name}!`;
    return pick([
      `Glass #${count} today. You're glowing, ${name}!`,
      `Hydrated and fabulous! That's ${count} today.`,
      `Yay! ${count} down today. Proud of you!`,
      `Glass #${count}! Keep it up, ${name}.`,
    ]);
  }

  // ------------------------------------------------------------- sequences
  async function leave(live) {
    hideBubble();
    setPose('standing');
    setMotion('hop-away');
    el.buddy.classList.remove('enter');
    restart(el.buddy, 'leave');
    await sleep(1050);
    if (!live()) return;
    window.api.done();
  }

  // Mini-game: click the falling water drops before they hit the floor.
  function dropSvg() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 7 9');
    svg.setAttribute('shape-rendering', 'crispEdges');
    const rows = ['...k...', '..kwk..', '.kwbbk.', '.kbbbk.', 'kbbbbbk', 'kbbbbbk', 'kbbbbbk', '.kbbbk.', '..kkk..'];
    const colors = { k: '#2b1d3a', b: '#4cc3ff', w: '#d9f3ff' };
    rows.forEach((row, y) => {
      [...row].forEach((c, x) => {
        if (c === '.') return;
        const r = document.createElementNS(ns, 'rect');
        r.setAttribute('x', String(x));
        r.setAttribute('y', String(y));
        r.setAttribute('width', '1');
        r.setAttribute('height', '1');
        r.setAttribute('fill', colors[c]);
        svg.appendChild(r);
      });
    });
    return svg;
  }

  async function runGame(total, name, live) {
    let caught = 0;
    let landed = 0;
    const status = () => say(`Catch the drops, ${name}! ${caught} / ${total}`);
    status();
    for (let i = 0; i < total; i += 1) {
      if (!live()) return;
      const drop = document.createElement('button');
      drop.type = 'button';
      drop.className = 'drop';
      drop.dataset.hit = '';
      drop.style.left = `${6 + Math.random() * 78}%`;
      drop.style.animationDuration = `${reduceMotion ? 4000 : 3200 + Math.random() * 1200}ms`;
      drop.setAttribute('aria-label', 'water drop');
      drop.appendChild(dropSvg());
      let settled = false;
      const settle = (wasCaught) => {
        if (settled) return;
        settled = true;
        landed += 1;
        if (wasCaught) {
          caught += 1;
          chime('pop');
        }
        drop.remove();
        status();
      };
      drop.addEventListener('click', () => settle(true));
      drop.addEventListener('animationend', () => settle(false));
      el.game.appendChild(drop);
      await sleep(550 + Math.random() * 450);
    }
    const end = Date.now() + 5000;
    while (landed < total && Date.now() < end && live()) await sleep(120);
    return caught;
  }

  async function play(payload) {
    const id = (runId += 1);
    const live = () => id === runId;
    busy = false;
    resetStage();
    window.api.setIgnoreMouse(true);

    const { sources, size } = await loadImages(payload.character);
    if (!live()) return;
    for (const [key, src] of Object.entries(sources)) poses[key].src = src;
    sizeSprite(size);
    applyLook(payload);
    setPose('standing');

    const name = payload.name;
    const isReminder = payload.mode === 'reminder';
    const habit = payload.habit || null;

    // she hops up from the bottom edge
    restart(el.buddy, 'enter');
    chime('hello');
    await sleep(720);
    if (!live()) return;
    setMotion('bob');

    // ---- mini-game
    if (payload.mode === 'game') {
      say(`Catch the drops, ${name}! 0 / ${payload.drops}`);
      showBubble();
      await sleep(900);
      const caught = await runGame(payload.drops, name, live);
      if (!live()) return;
      el.game.textContent = '';
      const total = payload.drops;
      say(
        caught === total
          ? `Perfect! ${caught} / ${total}. You're a hydration hero!`
          : `You caught ${caught} / ${total}. ${caught >= total / 2 ? 'Nice reflexes!' : 'Let’s play again soon!'}`,
      );
      setPose('celebrate');
      setMotion('hop');
      if (caught >= total / 2) {
        burst();
        chime('cheer');
      }
      setButtons('Bye for now!', null);
      el.primary.onclick = async () => {
        if (busy) return;
        busy = true;
        hideButtons();
        await window.api.answer('ok').catch(() => {});
        await leave(live);
      };
      return;
    }

    // then the bubble pops open
    if (isReminder) {
      say(habit ? habit.line : reminderLine(name, payload.manual, payload.part, payload.mood));
      setButtons(habit ? habit.button : 'Yes, I drank it!', `Snooze ${payload.snoozeMinutes} min`);
    } else {
      say(payload.message || `Hi ${name}!`);
      setButtons(payload.buttonLabel || 'Got it!', null);
    }
    showBubble();

    // ---- answer handlers
    el.primary.onclick = async () => {
      if (busy) return;
      busy = true;
      hideButtons();

      if (!isReminder) {
        await window.api.answer('ok').catch(() => {});
        say(pick(['See you soon!', 'Bye for now!', 'Yay, see you!']));
        setMotion('hop');
        await sleep(1100);
        if (live()) await leave(live);
        return;
      }

      // other habits (stretch, eyes, posture, your own): no sipping, just a cheer
      if (habit) {
        const answered = window.api.answer('done').catch(() => ({}));
        await answered;
        setPose('celebrate');
        say(habit.cheer);
        setMotion('hop');
        burst();
        chime('cheer');
        await sleep(2300);
        if (!live()) return;
        await leave(live);
        return;
      }

      // 1. she drinks
      say(pick(['Glug, glug, glug…', 'Mmm, so refreshing…', 'Sip, sip, sip…']));
      setPose('drinking');
      setMotion('glug');
      chime('sip');
      const answered = window.api.answer('drank').catch(() => ({ count: 1 }));
      await sleep(1700);
      if (!live()) return;

      // 2. she celebrates
      const result = (await answered) || {};
      setPose('celebrate');
      say(cheerLine(result, name));
      setMotion('hop');
      burst();
      chime('cheer');
      await sleep(result.goalJustMet ? 3200 : 2500);
      if (!live()) return;

      // 3. she waves goodbye and hops away
      await leave(live);
    };

    el.snooze.onclick = async () => {
      if (busy) return;
      busy = true;
      hideButtons();
      await window.api.answer('snooze').catch(() => {});
      say(`Okay! See you in ${payload.snoozeMinutes} min.`);
      setMotion('hop');
      await sleep(1400);
      if (live()) await leave(live);
    };
  }

  // ------------------------------------------- click-through everywhere else
  function setIgnore(ignore) {
    if (ignore === ignoringMouse) return;
    ignoringMouse = ignore;
    window.api.setIgnoreMouse(ignore);
  }
  document.addEventListener('mousemove', (event) => {
    setIgnore(!(event.target instanceof Element && event.target.closest('[data-hit]')));
  });
  document.documentElement.addEventListener('mouseleave', () => setIgnore(true));

  window.api.onShow(play);
})();
