'use strict';

(async () => {
  const $ = (id) => document.getElementById(id);
  const mode = new URLSearchParams(location.search).get('mode') || 'full';
  document.body.dataset.mode = mode;

  const el = {
    form: $('form'),
    title: $('title'),
    subtitle: $('subtitle'),
    name: $('name'),
    nameLabel: $('nameLabel'),
    nameError: $('nameError'),
    chips: $('chips'),
    custom: $('custom'),
    intervalLabel: $('intervalLabel'),
    intervalError: $('intervalError'),
    windowNote: $('windowNote'),
    chars: $('chars'),
    refresh: $('refresh'),
    login: $('login'),
    loginLabel: $('loginLabel'),
    save: $('save'),
    cancel: $('cancel'),
  };

  const state = { interval: 45, character: null };
  let data = await window.api.getSetupData();
  if (!data) return;

  // ------------------------------------------------------------ copy per mode
  document.body.dataset.firstRun = String(data.firstRun);
  if (mode === 'name') {
    el.title.textContent = 'Set your name';
    el.subtitle.textContent = 'This is what she calls you.';
    el.nameLabel.textContent = 'Your name';
    el.save.textContent = 'Save name';
  } else if (mode === 'interval') {
    el.title.textContent = 'Reminder interval';
    el.subtitle.textContent = 'How long should she wait between visits?';
    el.intervalLabel.textContent = 'Remind me every';
    el.save.textContent = 'Save interval';
  } else if (!data.firstRun) {
    el.title.textContent = 'Water Buddy setup';
    el.subtitle.textContent = 'Change anything you like, then save.';
    el.save.textContent = 'Save changes';
  }

  // ------------------------------------------------------------------ fields
  el.name.value = data.name || '';
  el.login.checked = Boolean(data.launchAtLogin);
  el.login.disabled = !data.canLaunchAtLogin;
  el.loginLabel.title = data.canLaunchAtLogin ? '' : 'Available once you install the built app (npm run dist)';
  el.windowNote.textContent = `She only visits from ${data.activeWindow}.`;

  function labelFor(minutes) {
    if (minutes % 60 === 0) return minutes === 60 ? '1 hour' : `${minutes / 60} hours`;
    return `${minutes} min`;
  }

  function renderChips() {
    el.chips.textContent = '';
    for (const minutes of data.presets) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = labelFor(minutes);
      chip.setAttribute('aria-pressed', String(state.interval === minutes && !el.custom.value));
      chip.addEventListener('click', () => {
        state.interval = minutes;
        el.custom.value = '';
        clearError('interval');
        renderChips();
      });
      el.chips.appendChild(chip);
    }
  }

  state.interval = data.intervalMinutes;
  if (!data.presets.includes(state.interval)) el.custom.value = String(state.interval);
  renderChips();

  el.custom.addEventListener('input', () => {
    const value = Number(el.custom.value);
    if (el.custom.value && Number.isFinite(value)) state.interval = value;
    else if (!el.custom.value) state.interval = data.intervalMinutes;
    clearError('interval');
    renderChips();
  });

  // --------------------------------------------------------------- characters
  function fitImage(img) {
    const h = img.naturalHeight || 40;
    const w = img.naturalWidth || 32;
    const box = 112;
    if (h <= 128) {
      const scale = Math.max(1, Math.floor(box / h));
      img.style.width = `${w * scale}px`;
      img.style.height = `${h * scale}px`;
      img.style.imageRendering = 'pixelated';
    } else {
      img.style.height = `${box}px`;
      img.style.width = 'auto';
      img.style.imageRendering = 'auto';
    }
  }

  function check() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 7 6');
    svg.setAttribute('width', '21');
    svg.setAttribute('height', '18');
    svg.setAttribute('shape-rendering', 'crispEdges');
    svg.setAttribute('aria-hidden', 'true');
    for (const [x, y] of [[0, 3], [1, 4], [2, 5], [3, 4], [4, 3], [5, 2], [6, 1]]) {
      const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      r.setAttribute('x', String(x));
      r.setAttribute('y', String(y));
      r.setAttribute('width', '1');
      r.setAttribute('height', '1');
      r.setAttribute('fill', '#fff');
      svg.appendChild(r);
    }
    return svg;
  }

  function renderCharacters() {
    el.chars.textContent = '';
    for (const c of data.characters) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'char';
      card.setAttribute('role', 'radio');
      card.setAttribute('aria-checked', String(c.id === state.character));

      const art = document.createElement('span');
      art.className = 'char-art';
      const img = document.createElement('img');
      img.alt = '';
      img.draggable = false;
      img.addEventListener('load', () => fitImage(img));
      img.src = c.standing;
      art.appendChild(img);

      // she takes a sip when you point at her
      const sip = () => {
        img.src = c.drinking;
      };
      const stand = () => {
        img.src = c.standing;
      };
      card.addEventListener('mouseenter', sip);
      card.addEventListener('focus', sip);
      card.addEventListener('mouseleave', stand);
      card.addEventListener('blur', stand);

      const name = document.createElement('span');
      name.textContent = c.source === 'user' ? `${c.name} (yours)` : c.name;

      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.appendChild(check());

      card.append(art, name, badge);
      card.addEventListener('click', () => {
        state.character = c.id;
        for (const other of el.chars.querySelectorAll('.char[role="radio"]')) {
          other.setAttribute('aria-checked', String(other === card));
        }
      });
      el.chars.appendChild(card);
    }

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'char add';
    const plus = document.createElement('span');
    plus.className = 'plus';
    plus.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = 'Add your own';
    add.append(plus, label);
    add.addEventListener('click', () => window.api.openCharactersFolder());
    el.chars.appendChild(add);
  }

  state.character = data.character;
  renderCharacters();

  el.refresh.addEventListener('click', async () => {
    const fresh = await window.api.getSetupData();
    if (!fresh) return;
    data = fresh;
    if (!data.characters.some((c) => c.id === state.character)) state.character = data.character;
    renderCharacters();
  });

  // --------------------------------------------------------------- validation
  function showError(field, message) {
    const target = field === 'name' ? el.nameError : el.intervalError;
    target.textContent = message;
    target.hidden = false;
    if (field === 'name') el.name.classList.add('invalid');
    if (field === 'interval') el.custom.classList.add('invalid');
  }

  function clearError(field) {
    if (field === 'name') {
      el.nameError.hidden = true;
      el.name.classList.remove('invalid');
    } else {
      el.intervalError.hidden = true;
      el.custom.classList.remove('invalid');
    }
  }

  el.name.addEventListener('input', () => clearError('name'));

  el.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const wantsName = mode === 'full' || mode === 'name';
    const wantsInterval = mode === 'full' || mode === 'interval';

    const name = el.name.value.trim();
    if (wantsName && !name) {
      showError('name', 'Tell her what to call you.');
      el.name.focus();
      return;
    }
    if (wantsInterval && !(state.interval >= 5 && state.interval <= 480)) {
      showError('interval', 'Pick a time between 5 and 480 minutes.');
      el.custom.focus();
      return;
    }

    el.save.disabled = true;
    const result = await window.api.saveSetup({
      name,
      intervalMinutes: state.interval,
      character: state.character,
      launchAtLogin: el.login.checked,
    });
    if (result && result.ok) return; // the window closes itself

    el.save.disabled = false;
    if (result && (result.field === 'name' || result.field === 'interval')) {
      showError(result.field, result.error);
    } else {
      showError('interval', (result && result.error) || 'Something went wrong. Please try again.');
    }
  });

  el.cancel.addEventListener('click', () => window.api.cancelSetup());

  if (mode === 'full' || mode === 'name') el.name.focus();
  else el.custom.focus();
})();
