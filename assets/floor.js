// The floor: four stations, four tiny agents walking between them doing the crew's work.
(() => {
  const INK = '#111111';
  const PAPER = '#F7F2E8';
  const PAPER_2 = '#EFE8DA';
  const MUTED = '#6B675F';
  const GREEN = '#3E9B5F';
  const GREEN_DARK = '#2A6E42';
  const RED = '#9E2B20';
  const SIZE = 1.7;

  const AGENTS = {
    aim: { name: 'Aim', home: 'market', look: 'solid' },
    yield: { name: 'Yield', home: 'vault', look: 'stripes' },
    depth: { name: 'Depth', home: 'pool', look: 'vest' },
    scout: { name: 'Scout', home: 'core', look: 'visor' },
  };

  const LAYOUTS = {
    wide: {
      W: 960, H: 700, box: [250, 130],
      stations: { market: [215, 120], pool: [745, 120], vault: [215, 435], core: [745, 435] },
    },
    tall: {
      W: 540, H: 880, box: [236, 130],
      stations: { market: [138, 120], pool: [402, 120], vault: [138, 520], core: [402, 520] },
    },
  };

  const LABELS = {
    market: ['MARKET', 'stock tokens'],
    pool: ['POOL', 'liquidity'],
    vault: ['VAULT', 'portfolio'],
    core: ['CORE', 'x402 · USDG'],
  };

  const state = {
    stocks: [], book: [], vault: { value: 10000 },
    agents: {}, coins: [], floats: [], t: 0,
  };
  let canvas, ctx, layout, scale = 1, dpr = 1, last = 0;
  const portraits = [];

  // ---------- geometry ----------
  const station = (k) => layout.stations[k];
  const spot = (k, i = 0) => {
    const [x, y] = station(k);
    return [x - 54 + i * 54, y + layout.box[1] / 2 + 92];
  };

  function resize() {
    const w = canvas.clientWidth || canvas.parentElement.clientWidth;
    const next = w < 620 ? LAYOUTS.tall : LAYOUTS.wide;
    const changed = next !== layout;
    layout = next;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    scale = w / layout.W;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(layout.H * scale * dpr);
    canvas.style.height = layout.H * scale + 'px';
    if (changed) placeAgents();
  }

  function placeAgents() {
    Object.entries(AGENTS).forEach(([id, a], i) => {
      const [x, y] = spot(a.home, 1);
      const prev = state.agents[id];
      state.agents[id] = {
        id, ...a, x, y, tx: x, ty: y, dir: i % 2 ? -1 : 1,
        phase: 0, busy: false, bubble: null, idleAt: performance.now() + 800 + i * 600, onArrive: null,
        ...(prev && { bubble: prev.bubble }),
      };
    });
  }

  // ---------- drawing primitives ----------
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function text(str, x, y, { size = 12, weight = 500, color = INK, align = 'left', font = 'Inter', spacing = 0 } = {}) {
    ctx.font = `${weight} ${size}px ${font === 'serif' ? 'Corm, Georgia, serif' : 'Inter, system-ui, sans-serif'}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    if (spacing && 'letterSpacing' in ctx) ctx.letterSpacing = spacing + 'px';
    ctx.fillText(str, x, y);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }

  function floorGrid() {
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, layout.W, layout.H);
    ctx.fillStyle = 'rgba(17,17,17,.10)';
    for (let x = 14; x < layout.W; x += 28) for (let y = 14; y < layout.H; y += 28) ctx.fillRect(x, y, 1.5, 1.5);

    // walkways between stations
    const s = layout.stations;
    ctx.save();
    ctx.setLineDash([3, 7]);
    ctx.strokeStyle = 'rgba(17,17,17,.28)';
    ctx.lineWidth = 1.5;
    const pairs = [['market', 'pool'], ['vault', 'core'], ['market', 'vault'], ['pool', 'core'], ['market', 'core'], ['pool', 'vault']];
    for (const [a, b] of pairs) {
      const [ax, ay] = spot(a, 1), [bx, by] = spot(b, 1);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
    ctx.restore();
  }

  function stationBox(key, t) {
    const [cx, cy] = station(key);
    const [w, h] = layout.box;
    const x = cx - w / 2, y = cy - h / 2;

    ctx.fillStyle = PAPER;
    ctx.fillRect(x, y, w, h);
    ctx.lineWidth = 2;
    ctx.strokeStyle = INK;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = INK;
    ctx.fillRect(x, y, w, 24);
    text(LABELS[key][0], x + 12, y + 16, { size: 11, color: PAPER, spacing: 3 });
    text(LABELS[key][1], x + w - 12, y + 16, { size: 10, weight: 400, color: 'rgba(247,242,232,.7)', align: 'right' });

    const bx = x + 12, by = y + 34, bw = w - 24, bh = h - 44;
    if (key === 'market') drawMarket(bx, by, bw, bh, t);
    if (key === 'pool') drawPool(bx, by, bw, bh, t);
    if (key === 'vault') drawVault(bx, by, bw, bh, t);
    if (key === 'core') drawCore(bx, by, bw, bh, t);

    // floor mat where agents stand
    const [mx, my] = spot(key, 1);
    ctx.fillStyle = 'rgba(17,17,17,.06)';
    ctx.beginPath();
    ctx.ellipse(mx, my + 2, 92, 14, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawMarket(x, y, w, h, t) {
    const list = state.stocks;
    if (!list.length) return text('loading prices…', x, y + 16, { size: 12, color: MUTED });
    const rows = 4;
    const start = Math.floor(t / 3.2) % list.length;
    for (let i = 0; i < rows; i++) {
      const s = list[(start + i) % list.length];
      const ry = y + 14 + i * 21;
      text(s.sym, x, ry, { size: 12, spacing: 1 });
      text('$' + s.price.toFixed(2), x + w * 0.52, ry, { size: 12, weight: 400, align: 'right' });
      const ch = s.ch24;
      text((ch > 0 ? '+' : '') + ch.toFixed(2) + '%', x + w, ry, { size: 12, color: ch >= 0 ? GREEN_DARK : RED, align: 'right' });
    }
  }

  function drawPool(x, y, w, h, t) {
    // scanline water: bars whose length breathes, the logo's motif
    const lines = 8;
    for (let i = 0; i < lines; i++) {
      const ly = y + 4 + i * 10;
      const k = 0.55 + 0.35 * Math.sin(t * 1.6 + i * 0.7);
      const len = w * k;
      const off = (w - len) / 2 + Math.sin(t * 0.9 + i) * 10;
      ctx.fillStyle = INK;
      ctx.fillRect(x + off, ly, len, 4);
    }
  }

  function drawVault(x, y, w, h) {
    const v = state.vault.value || 10000;
    text('$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), x, y + 26, { size: 30, weight: 600, font: 'serif' });
    const book = state.book.length ? state.book : [];
    let bx = x;
    const by = y + 42, bh = 10;
    for (const b of book) {
      const bw = w * b.weight;
      ctx.fillStyle = INK;
      ctx.fillRect(bx, by, Math.max(bw - 2, 1), bh);
      bx += bw;
    }
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1;
    ctx.strokeRect(x, by, w, bh);
    text('allocation · cash at right', x, by + 28, { size: 10, weight: 400, color: MUTED });
  }

  function drawCore(x, y, w, h, t) {
    const cols = 16, rows = 4, cw = w / cols, ch = 14;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const on = Math.sin(i * 12.9898 + j * 78.233 + Math.floor(t * 3) * 0.37) > 0.25;
      ctx.fillStyle = on ? INK : 'rgba(17,17,17,.1)';
      ctx.fillRect(x + i * cw + 1, y + j * ch + 2, cw - 3, ch - 4);
    }
    text('agents paying agents', x, y + rows * ch + 16, { size: 10, weight: 400, color: MUTED });
  }

  // ---------- the people ----------
  function person(c, x, y, { dir = 1, phase = 0, moving = false, look = 'solid', t = 0, s = 1 }) {
    c.save();
    c.translate(x, y);
    c.scale(s, s);
    const swing = moving ? Math.sin(phase) : 0;
    const bob = moving ? Math.abs(Math.sin(phase)) * 1.5 : Math.sin(t * 2) * 0.4;

    c.fillStyle = 'rgba(17,17,17,.16)';
    c.beginPath();
    c.ellipse(0, 1, 10, 3.2, 0, 0, Math.PI * 2);
    c.fill();

    c.strokeStyle = INK;
    c.lineCap = 'round';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(-3, -12 - bob); c.lineTo(-3 + swing * 4, 0);
    c.moveTo(3, -12 - bob); c.lineTo(3 - swing * 4, 0);
    c.stroke();

    // arms
    c.lineWidth = 2.6;
    c.beginPath();
    c.moveTo(-6.5, -24 - bob); c.lineTo(-8 - swing * 3, -15 - bob);
    c.moveTo(6.5, -24 - bob); c.lineTo(8 + swing * 3, -15 - bob);
    c.stroke();

    // body
    c.fillStyle = INK;
    c.beginPath();
    c.moveTo(-6.5, -11 - bob);
    c.lineTo(-6.5, -23 - bob);
    c.quadraticCurveTo(-6.5, -27 - bob, -2.5, -27 - bob);
    c.lineTo(2.5, -27 - bob);
    c.quadraticCurveTo(6.5, -27 - bob, 6.5, -23 - bob);
    c.lineTo(6.5, -11 - bob);
    c.closePath();
    c.fill();
    c.fillStyle = PAPER;
    if (look === 'stripes') for (let i = 0; i < 3; i++) c.fillRect(-6.5, -23 - bob + i * 4, 13, 1.6);
    if (look === 'vest') { c.fillRect(-1, -27 - bob, 2, 16); }
    if (look === 'solid') { c.beginPath(); c.moveTo(0, -26 - bob); c.lineTo(-1.6, -22 - bob); c.lineTo(0, -15 - bob); c.lineTo(1.6, -22 - bob); c.fill(); }

    // head
    c.fillStyle = PAPER;
    c.strokeStyle = INK;
    c.lineWidth = 2;
    c.beginPath();
    c.arc(0, -33.5 - bob, 6.5, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.fillStyle = INK;
    c.beginPath();
    c.arc(dir * 2.6, -34 - bob, 1.1, 0, Math.PI * 2);
    c.fill();
    if (look === 'visor') c.fillRect(dir > 0 ? -1 : -8, -40.5 - bob, 9, 2.6);
    if (look === 'stripes') { c.beginPath(); c.arc(0, -35 - bob, 6.8, Math.PI * 1.05, Math.PI * 1.95); c.lineWidth = 2.6; c.stroke(); }

    // plumbob
    const py = -50 + Math.sin(t * 2.2) * 1.8;
    const spin = Math.max(0.3, Math.abs(Math.cos(t * 1.4)));
    c.fillStyle = GREEN;
    c.strokeStyle = GREEN_DARK;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(0, py - 7);
    c.lineTo(4 * spin, py);
    c.lineTo(0, py + 7);
    c.lineTo(-4 * spin, py);
    c.closePath();
    c.fill();
    c.stroke();
    c.fillStyle = 'rgba(255,255,255,.45)';
    c.beginPath();
    c.moveTo(0, py - 7);
    c.lineTo(-4 * spin, py);
    c.lineTo(0, py);
    c.closePath();
    c.fill();
    c.restore();
  }

  function bubble(a) {
    const b = a.bubble;
    if (!b) return;
    const life = (performance.now() - b.at) / b.dur;
    if (life >= 1) { a.bubble = null; return; }
    const alpha = Math.min(1, life * 8, (1 - life) * 6);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = '500 12px Inter, system-ui, sans-serif';
    const w = Math.min(ctx.measureText(b.text).width + 20, layout.W - 20);
    const h = 26;
    let x = a.x - w / 2;
    x = Math.max(10, Math.min(layout.W - w - 10, x));
    const y = a.y - 128;
    ctx.fillStyle = '#FFFDF8';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.5;
    roundRect(x, y, w, h, 6);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(a.x - 6, y + h - 0.5);
    ctx.lineTo(a.x, y + h + 8);
    ctx.lineTo(a.x + 6, y + h - 0.5);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(a.x - 6, y + h);
    ctx.lineTo(a.x, y + h + 8);
    ctx.lineTo(a.x + 6, y + h);
    ctx.stroke();
    text(b.text, x + 10, y + 17, { size: 12 });
    ctx.restore();
  }

  function nameTag(a) {
    text(a.name.toUpperCase(), a.x, a.y + 20, { size: 10, color: MUTED, align: 'center', spacing: 2 });
  }

  function coins(now) {
    state.coins = state.coins.filter((c) => {
      const to = state.agents[c.to];
      const k = Math.min(1, (now - c.at) / c.dur);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const x = c.x0 + (to.x - c.x0) * e;
      const y = c.y0 + (to.y - 50 - c.y0) * e - Math.sin(Math.PI * e) * 70;
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fill();
      text('$', x, y + 4, { size: 10, color: PAPER, align: 'center' });
      if (k >= 1) {
        state.floats.push({ x: to.x, y: to.y - 104, text: `+${c.amount} USDG`, at: now, color: GREEN_DARK });
        return false;
      }
      return true;
    });
  }

  function floats(now) {
    state.floats = state.floats.filter((f) => {
      const k = (now - f.at) / 1600;
      if (k >= 1) return false;
      ctx.globalAlpha = 1 - k;
      text(f.text, f.x, f.y - k * 26, { size: 12, color: f.color, align: 'center' });
      ctx.globalAlpha = 1;
      return true;
    });
  }

  // ---------- motion ----------
  function step(a, dt, now) {
    const dx = a.tx - a.x, dy = a.ty - a.y;
    const d = Math.hypot(dx, dy);
    if (d > 1) {
      const sp = (a.busy ? 150 : 40) * dt;
      a.x += (dx / d) * Math.min(sp, d);
      a.y += (dy / d) * Math.min(sp, d);
      a.dir = dx >= 0 ? 1 : -1;
      a.phase += dt * (a.busy ? 13 : 8);
      a.moving = true;
    } else {
      a.moving = false;
      if (a.onArrive) { const cb = a.onArrive; a.onArrive = null; cb(); }
      else if (!a.busy && now > a.idleAt) {
        const [hx, hy] = spot(a.home, 1);
        a.tx = hx + (Math.random() - 0.5) * 130;
        a.ty = hy + (Math.random() - 0.4) * 34;
        a.idleAt = now + 2500 + Math.random() * 3500;
      }
    }
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    state.t += dt;

    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    floorGrid();
    for (const k of Object.keys(layout.stations)) stationBox(k, state.t);

    const list = Object.values(state.agents);
    list.forEach((a) => step(a, dt, now));
    list.sort((p, q) => p.y - q.y).forEach((a) => {
      person(ctx, a.x, a.y, { dir: a.dir, phase: a.phase, moving: a.moving, look: a.look, t: state.t + a.x * 0.01, s: SIZE });
      nameTag(a);
    });
    coins(now);
    list.forEach(bubble);
    floats(now);

    for (const p of portraits) {
      p.ctx.setTransform(p.dpr, 0, 0, p.dpr, 0, 0);
      p.ctx.fillStyle = PAPER_2;
      p.ctx.fillRect(0, 0, 96, 96);
      person(p.ctx, 48, 84, { look: AGENTS[p.id].look, t: state.t, s: 1.45, dir: 1 });
    }
    requestAnimationFrame(frame);
  }

  // ---------- public ----------
  function play(action) {
    return new Promise((resolve) => {
      const a = state.agents[action.agent];
      if (!a) return resolve();
      const slot = { market: 0, pool: 2, vault: 0, core: 0 }[action.station] ?? 1;
      const others = Object.values(state.agents).filter((o) => o !== a && o.busy && Math.hypot(o.tx - spot(action.station, slot)[0], o.ty - spot(action.station, slot)[1]) < 20);
      const [x, y] = spot(action.station, others.length ? 2 - slot : slot);
      a.busy = true;
      a.tx = x;
      a.ty = y;
      a.onArrive = () => {
        a.bubble = { text: action.say, at: performance.now(), dur: 3600 };
        if (action.pay) {
          const to = state.agents[action.pay.to];
          if (to) state.coins.push({ x0: a.x, y0: a.y - 50, to: action.pay.to, amount: action.pay.amount, at: performance.now() + 300, dur: 1100 });
        }
        resolve('arrived');
        setTimeout(() => {
          a.busy = false;
          a.idleAt = performance.now() + 400;
          const [hx, hy] = spot(a.home, 1);
          a.tx = hx + (Math.random() - 0.5) * 60;
          a.ty = hy;
        }, 3800);
      };
    });
  }

  function setData(d) {
    if (d.stocks) state.stocks = d.stocks;
    if (d.book) state.book = d.book;
    if (d.vault) state.vault = d.vault;
  }

  function init(el) {
    canvas = el;
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    document.querySelectorAll('[data-portrait]').forEach((c) => {
      const pdpr = Math.min(window.devicePixelRatio || 1, 2);
      c.width = 96 * pdpr;
      c.height = 96 * pdpr;
      portraits.push({ id: c.dataset.portrait, ctx: c.getContext('2d'), dpr: pdpr });
    });
    requestAnimationFrame(frame);
  }

  window.Floor = { init, play, setData, AGENTS };
})();
