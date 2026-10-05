'use strict';

(async () => {
  const $ = (id) => document.getElementById(id);
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const formatMl = (ml) => (ml >= 1000 ? `${Math.round(ml / 100) / 10} L` : `${ml} ml`);

  let data = await window.api.getPrefs();
  if (!data) return;

  const state = {
    habits: data.habits.map((h) => ({ ...h })),
    accessory: data.accessory,
    character: data.character,
    nextCustom: Date.now(),
  };

  // ------------------------------------------------------------------ stats
  function renderStats() {
    $('hello').textContent = `Hi ${data.name}! Here is how you're doing.`;
    const s = data.stats;
    const tiles = [
      [formatMl(s.today.ml), `today of ${formatMl(data.goalMl)}`],
      [`${s.streak}`, s.streak === 1 ? 'day streak' : 'day streak'],
      [`${s.bestStreak}`, 'best streak'],
      [`${s.totalGlasses}`, 'glasses in total'],
      [`${s.focusToday}`, 'focus sessions today'],
    ];
    $('tiles').textContent = '';
    for (const [big, small] of tiles) {
      const tile = make('div', 'tile');
      tile.append(make('b', '', big), make('span', '', small));
      $('tiles').appendChild(tile);
    }

    const week = $('week');
    week.textContent = '';
    const top = Math.max(data.goalMl * 1.25, ...s.days.map((d) => d.ml));
    for (const d of s.days) {
      const col = make('div', d.ml >= data.goalMl ? 'col met' : 'col');
      const fill = make('div', 'bar-fill');
      fill.style.height = `${Math.max(2, Math.round((d.ml / top) * 100))}%`;
      fill.title = `${formatMl(d.ml)} (${d.glasses} glasses)`;
      const label = new Date(`${d.key}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
      col.append(fill, make('span', 'day', label));
      week.appendChild(col);
    }
    const line = make('div', 'goal-line');
    line.style.bottom = `calc(30px + (100% - 30px) * ${data.goalMl / top})`;
    week.appendChild(line);
    const met = s.days.filter((d) => d.ml >= data.goalMl).length;
    $('weekNote').textContent = `Goal met on ${met} of the last 7 days. Pink bars hit the goal.`;
  }

  // ------------------------------------------------------------ simple fields
  $('goal').value = data.goalMl;
  $('glass').value = data.glassMl;
  $('snooze').value = data.snoozeMinutes;
  $('hot').checked = data.hotMode;
  $('sound').checked = data.sound;
  $('start').value = data.activeStart.padStart(5, '0');
  $('end').value = data.activeEnd.padStart(5, '0');

  const zoneSelect = $('zone');
  let zones = [];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch (_) {
    zones = ['Asia/Kolkata', 'UTC'];
  }
  if (!zones.includes(data.timeZone)) zones.unshift(data.timeZone);
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
  for (const zone of zones) {
    const option = make('option', '', zone === 'Asia/Kolkata' ? 'Asia/Kolkata (IST)' : zone);
    option.value = zone;
    zoneSelect.appendChild(option);
  }
  zoneSelect.value = data.timeZone;
  if (local && local !== data.timeZone) {
    const hint = make('p', 'muted', `Your computer is set to ${local}.`);
    zoneSelect.closest('.row').after(hint);
  }

  // ----------------------------------------------------------------- habits
  function renderHabits() {
    const list = $('habitList');
    list.textContent = '';
    for (const h of state.habits) {
      const row = make('div', 'habit');
      const label = make('label', 'check');
      const box = make('input');
      box.type = 'checkbox';
      box.checked = h.enabled;
      box.addEventListener('change', () => {
        h.enabled = box.checked;
      });
      label.append(box, make('span', 'box'), make('span', '', h.label));
      label.querySelector('.box').setAttribute('aria-hidden', 'true');

      const every = make('div', 'every');
      const minutes = make('input', 'px-input small');
      minutes.type = 'number';
      minutes.min = '5';
      minutes.max = '480';
      minutes.value = h.intervalMinutes;
      minutes.setAttribute('aria-label', `${h.label} every how many minutes`);
      minutes.addEventListener('input', () => {
        h.intervalMinutes = Number(minutes.value) || h.intervalMinutes;
      });
      every.append(make('span', 'muted', 'every'), minutes, make('span', 'muted', 'min'));

      row.append(label, every);
      if (h.custom) {
        const remove = make('button', 'link remove', 'Remove');
        remove.type = 'button';
        remove.addEventListener('click', () => {
          state.habits = state.habits.filter((x) => x !== h);
          renderHabits();
        });
        row.appendChild(remove);
      }
      list.appendChild(row);
    }
  }

  $('addHabit').addEventListener('click', () => {
    const label = $('newLabel').value.trim();
    if (!label) {
      $('newLabel').focus();
      return;
    }
    state.nextCustom += 1;
    state.habits.push({
      id: `custom-${state.nextCustom}`,
      label,
      line: $('newLine').value.trim(),
      enabled: true,
      intervalMinutes: Math.min(480, Math.max(5, Number($('newEvery').value) || 60)),
      custom: true,
    });
    $('newLabel').value = '';
    $('newLine').value = '';
    renderHabits();
  });

  // ------------------------------------------------------------------- look
  function fitPreview() {
    const img = $('previewImg');
    const h = img.naturalHeight || 40;
    const w = img.naturalWidth || 32;
    if (h <= 128) {
      const scale = Math.max(1, Math.floor(120 / h));
      img.style.width = `${w * scale}px`;
      img.style.height = `${h * scale}px`;
    } else {
      img.style.height = '120px';
      img.style.width = 'auto';
      img.style.imageRendering = 'auto';
    }
  }

  function renderPreview() {
    const current = data.characters.find((c) => c.id === state.character) || data.characters[0];
    const img = $('previewImg');
    img.onload = fitPreview;
    if (current) img.src = current.standing;
    img.style.filter = Number($('hue').value) ? `hue-rotate(${$('hue').value}deg)` : '';
  }

  $('hue').value = data.hue;
  $('hue').addEventListener('input', renderPreview);
  $('resetHue').addEventListener('click', () => {
    $('hue').value = 0;
    renderPreview();
  });

  function renderAccessories() {
    const wrap = $('accessories');
    wrap.textContent = '';
    for (const a of data.accessories) {
      const chip = make('button', 'chip', a.unlocked ? a.label : `${a.label} (${a.hint})`);
      chip.type = 'button';
      chip.setAttribute('role', 'radio');
      chip.setAttribute('aria-pressed', String(state.accessory === a.id));
      chip.disabled = !a.unlocked;
      chip.addEventListener('click', () => {
        state.accessory = a.id;
        renderAccessories();
      });
      wrap.appendChild(chip);
    }
  }

  // ------------------------------------------------------------- characters
  async function refresh() {
    data = (await window.api.getPrefs()) || data;
    if (!data.characters.some((c) => c.id === state.character)) state.character = data.character;
    renderCharacters();
    renderPreview();
  }

  function fitImage(img) {
    const h = img.naturalHeight || 40;
    const w = img.naturalWidth || 32;
    if (h <= 128) {
      const scale = Math.max(1, Math.floor(112 / h));
      img.style.width = `${w * scale}px`;
      img.style.height = `${h * scale}px`;
      img.style.imageRendering = 'pixelated';
    } else {
      img.style.height = '112px';
      img.style.width = 'auto';
      img.style.imageRendering = 'auto';
    }
  }

  function renderCharacters() {
    const wrap = $('chars');
    wrap.textContent = '';
    for (const c of data.characters) {
      const card = make('div', 'char');
      card.setAttribute('role', 'radio');
      card.tabIndex = 0;
      card.setAttribute('aria-checked', String(c.id === state.character));
      const art = make('span', 'char-art');
      const img = make('img');
      img.alt = '';
      img.draggable = false;
      img.addEventListener('load', () => fitImage(img));
      img.src = c.standing;
      art.appendChild(img);
      card.append(art, make('span', '', c.source === 'user' ? `${c.name} (yours)` : c.name));

      const choose = async () => {
        state.character = c.id;
        await window.api.useCharacter(c.id);
        renderCharacters();
        renderPreview();
      };
      card.addEventListener('click', choose);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          choose();
        }
      });

      if (c.source === 'user') {
        const del = make('button', 'link remove-char', 'Delete');
        del.type = 'button';
        del.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (del.dataset.sure !== '1') {
            del.dataset.sure = '1';
            del.textContent = 'Click again to delete';
            return;
          }
          await window.api.deleteCharacter(c.id);
          refresh();
        });
        card.appendChild(del);
      }
      wrap.appendChild(card);
    }
  }

  // ---- character maker
  const POSES = [
    ['standing', 'Standing (required)'],
    ['drinking', 'Drinking (optional)'],
    ['celebrate', 'Celebrating (optional)'],
  ];
  const picked = {}; // pose -> data URL of the picture you chose

  /** What will actually be saved for each pose (pixel art and auto poses applied). */
  async function buildImages() {
    const out = { standing: null, drinking: null, celebrate: null };
    if (!picked.standing) return out;
    const pixel = $('doPixel').checked;
    const opts = { height: Number($('detail').value), removeBg: $('doBg').checked };
    const process = async (url) => (pixel ? (await window.Pixelize.pixelize(url, opts)).toDataURL('image/png') : url);

    let standingCanvas = null;
    if (pixel) {
      standingCanvas = await window.Pixelize.pixelize(picked.standing, opts);
      out.standing = standingCanvas.toDataURL('image/png');
    } else {
      out.standing = picked.standing;
    }
    const auto = $('doPoses').checked && pixel;
    for (const pose of ['drinking', 'celebrate']) {
      if (picked[pose]) out[pose] = await process(picked[pose]);
      else if (auto) {
        const made = pose === 'drinking' ? window.Pixelize.drinkingFrom(standingCanvas) : window.Pixelize.celebrateFrom(standingCanvas);
        out[pose] = made.toDataURL('image/png');
      }
    }
    return out;
  }

  let renderToken = 0;
  async function renderPicks() {
    const token = (renderToken += 1);
    let built = { standing: null, drinking: null, celebrate: null };
    try {
      built = await buildImages();
    } catch (err) {
      $('charError').textContent = err.message;
      $('charError').hidden = false;
    }
    if (token !== renderToken) return;
    const wrap = $('picks');
    wrap.textContent = '';
    for (const [pose, title] of POSES) {
      const box = make('div', 'pick');
      const thumb = make('div', 'thumb');
      if (built[pose]) {
        const img = make('img');
        img.alt = '';
        img.src = built[pose];
        thumb.appendChild(img);
      } else {
        thumb.textContent = picked.standing ? 'same as standing' : 'no picture yet';
      }
      const button = make('button', 'btn btn-ghost', picked[pose] ? `Change ${pose}` : `Choose ${pose}…`);
      button.type = 'button';
      button.title = title;
      button.addEventListener('click', async () => {
        $('charError').hidden = true;
        const result = await window.api.pickImage(pose);
        if (result && result.ok) {
          picked[pose] = result.preview;
          renderPicks();
        } else if (result && result.error) {
          $('charError').textContent = result.error;
          $('charError').hidden = false;
        }
      });
      box.append(thumb, make('div', 'muted', title), button);
      wrap.appendChild(box);
    }
  }

  $('createChar').addEventListener('click', async () => {
    const error = $('charError');
    error.hidden = true;
    let images;
    try {
      images = await buildImages();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      return;
    }
    const result = await window.api.createCharacter({ name: $('charName').value, use: $('useNow').checked, images });
    if (!result || !result.ok) {
      error.textContent = (result && result.error) || 'Could not save that buddy.';
      error.hidden = false;
      return;
    }
    for (const key of Object.keys(picked)) delete picked[key];
    $('charName').value = '';
    if ($('useNow').checked) state.character = result.id;
    renderPicks();
    await refresh();
  });

  for (const id of ['doPixel', 'doBg', 'doPoses']) $(id).addEventListener('change', renderPicks);
  $('detail').addEventListener('change', renderPicks);

  $('openFolder').addEventListener('click', () => window.api.openCharactersFolder());

  // ------------------------------------------------------------------- save
  $('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = $('saveError');
    error.hidden = true;
    $('save').disabled = true;
    const result = await window.api.savePrefs({
      goalMl: Number($('goal').value),
      glassMl: Number($('glass').value),
      snoozeMinutes: Number($('snooze').value),
      hotMode: $('hot').checked,
      sound: $('sound').checked,
      activeStart: $('start').value,
      activeEnd: $('end').value,
      timeZone: $('zone').value,
      hue: Number($('hue').value),
      accessory: state.accessory,
      habits: state.habits.map((h) => ({
        id: h.id,
        label: h.label,
        line: h.line,
        enabled: h.enabled,
        intervalMinutes: h.intervalMinutes,
      })),
    });
    $('save').disabled = false;
    if (!result || !result.ok) {
      error.textContent = (result && result.error) || 'Could not save.';
      error.hidden = false;
      return;
    }
    $('saved').textContent = 'Saved!';
    setTimeout(() => {
      $('saved').textContent = '';
    }, 2500);
    data = (await window.api.getPrefs()) || data;
    renderStats();
  });

  $('close').addEventListener('click', () => window.api.closePrefs());

  window.api.onGoto((section) => {
    const target = document.getElementById(section);
    if (target) target.scrollIntoView();
  });

  renderStats();
  renderHabits();
  renderAccessories();
  renderCharacters();
  renderPreview();
  renderPicks();
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
})();
