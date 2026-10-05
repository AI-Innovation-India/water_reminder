'use strict';

/**
 * Turns any picture into small pixel art in the Water Buddy style:
 * shrink, optionally drop the plain background, limit the colours, add a dark outline.
 * It can also draw the "drinking" and "celebrating" poses from the standing one.
 * Everything happens on a <canvas> in the settings window; nothing leaves your computer.
 */
window.Pixelize = (() => {
  const INK = '#2b1d3a';
  const PAD = 7; // transparent border so the outline and sparkles fit

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not read that picture.'));
      img.src = url;
    });
  }

  function distance(data, i, r, g, b) {
    return Math.abs(data[i] - r) + Math.abs(data[i + 1] - g) + Math.abs(data[i + 2] - b);
  }

  /** Make everything connected to the picture's edge, and close in colour to its corners, transparent. */
  function removeBackground(data, w, h) {
    const corners = [0, w - 1, (h - 1) * w, h * w - 1].map((p) => p * 4).filter((i) => data[i + 3] > 128);
    if (!corners.length) return;
    const avg = [0, 1, 2].map((c) => corners.reduce((sum, i) => sum + data[i + c], 0) / corners.length);
    const tolerance = 70;
    const seen = new Uint8Array(w * h);
    const stack = [];
    const push = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const p = y * w + x;
      if (seen[p]) return;
      const i = p * 4;
      if (data[i + 3] > 128 && distance(data, i, avg[0], avg[1], avg[2]) > tolerance) return;
      seen[p] = 1;
      stack.push(p);
    };
    for (let x = 0; x < w; x += 1) {
      push(x, 0);
      push(x, h - 1);
    }
    for (let y = 0; y < h; y += 1) {
      push(0, y);
      push(w - 1, y);
    }
    while (stack.length) {
      const p = stack.pop();
      data[p * 4 + 3] = 0;
      const x = p % w;
      const y = (p - x) / w;
      push(x + 1, y);
      push(x - 1, y);
      push(x, y + 1);
      push(x, y - 1);
    }
  }

  async function pixelize(url, { height = 48, levels = 6, removeBg = true } = {}) {
    const img = await loadImage(url);
    const h = Math.max(16, Math.min(96, Math.round(height)));
    const w = Math.max(8, Math.round((img.naturalWidth * h) / img.naturalHeight));

    // Cut the background out at 4x size first, then shrink: the edge pixels then carry the
    // subject's colours instead of a blend with the background (no coloured halo).
    const scale = 4;
    const mid = document.createElement('canvas');
    mid.width = w * scale;
    mid.height = h * scale;
    const mctx = mid.getContext('2d', { willReadFrequently: true });
    mctx.imageSmoothingEnabled = true;
    mctx.imageSmoothingQuality = 'high';
    mctx.drawImage(img, 0, 0, mid.width, mid.height);
    if (removeBg) {
      const big = mctx.getImageData(0, 0, mid.width, mid.height);
      removeBackground(big.data, mid.width, mid.height);
      mctx.putImageData(big, 0, 0);
    }

    const small = document.createElement('canvas');
    small.width = w;
    small.height = h;
    const sctx = small.getContext('2d', { willReadFrequently: true });
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(mid, 0, 0, w, h);

    const image = sctx.getImageData(0, 0, w, h);
    const data = image.data;

    const step = 255 / (Math.max(2, levels) - 1);
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 150) {
        data[i + 3] = 0;
        continue;
      }
      data[i + 3] = 255;
      for (let c = 0; c < 3; c += 1) data[i + c] = Math.round(Math.round(data[i + c] / step) * step);
    }

    const out = document.createElement('canvas');
    out.width = w + PAD * 2;
    out.height = h + PAD * 2;
    const octx = out.getContext('2d', { willReadFrequently: true });
    octx.putImageData(image, PAD, PAD);

    // dark outline around the whole shape, like the built-in buddies
    const full = octx.getImageData(0, 0, out.width, out.height);
    const px = full.data;
    const W = out.width;
    const H = out.height;
    const opaque = (x, y) => x >= 0 && y >= 0 && x < W && y < H && px[(y * W + x) * 4 + 3] > 0;
    const edge = [];
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        if (!opaque(x, y) && (opaque(x + 1, y) || opaque(x - 1, y) || opaque(x, y + 1) || opaque(x, y - 1))) edge.push([x, y]);
      }
    }
    octx.fillStyle = INK;
    for (const [x, y] of edge) octx.fillRect(x, y, 1, 1);
    return out;
  }

  function copy(canvas) {
    const c = document.createElement('canvas');
    c.width = canvas.width;
    c.height = canvas.height;
    c.getContext('2d').drawImage(canvas, 0, 0);
    return c;
  }

  function drawGlass(ctx, x, y) {
    ctx.fillStyle = INK;
    ctx.fillRect(x - 1, y - 1, 7, 9);
    ctx.fillStyle = '#e6f6ff';
    ctx.fillRect(x, y, 5, 7);
    ctx.fillStyle = '#58c2ff';
    ctx.fillRect(x + 1, y + 2, 3, 4);
    ctx.fillStyle = '#a8e4ff';
    ctx.fillRect(x + 1, y + 2, 2, 1);
  }

  function drawSparkle(ctx, x, y, colour) {
    ctx.fillStyle = colour;
    for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) ctx.fillRect(x + dx, y + dy, 1, 1);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, 1, 1);
  }

  /** The standing picture plus a glass held up at the face. */
  function drinkingFrom(standing) {
    const c = copy(standing);
    const ctx = c.getContext('2d');
    drawGlass(ctx, Math.round(c.width / 2) - 2, Math.round(c.height * 0.52));
    return c;
  }

  /** The standing picture plus sparkles around it. */
  function celebrateFrom(standing) {
    const c = copy(standing);
    const ctx = c.getContext('2d');
    const w = c.width;
    const h = c.height;
    drawSparkle(ctx, 3, 4, '#ffe066');
    drawSparkle(ctx, w - 4, 6, '#ff9ec7');
    drawSparkle(ctx, 3, Math.round(h * 0.55), '#8fe3ff');
    drawSparkle(ctx, w - 4, Math.round(h * 0.6), '#ffe066');
    drawSparkle(ctx, Math.round(w / 2), 3, '#ffffff');
    return c;
  }

  return { pixelize, drinkingFrom, celebrateFrom, loadImage };
})();
