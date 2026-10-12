(() => {
  const $ = (s) => document.querySelector(s);
  const POLL = 45_000;
  const CHAIN = '0x1237'; // 4663
  const EXPLORER = 'https://robinhoodchain.blockscout.com';
  const fmt = (n, d = 2) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const qty = (n) => (n === 0 ? '0' : n >= 100 ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : n >= 1 ? n.toFixed(3) : n.toFixed(5));
  const short = (a) => a.slice(0, 6) + '…' + a.slice(-4);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- floor + log ----------
  Floor.init($('#floor-canvas'));
  const log = $('[data-log]');
  const queue = [];
  let round = null, updatedAt = 0, running = false, courses = {}, wallet = null, portfolio = null, busy = false, quietUntil = 0;

  function addLog(a) {
    const li = document.createElement('li');
    li.innerHTML = '<div class="who"><span></span><time></time></div><p></p>';
    li.querySelector('.who span').textContent = Floor.AGENTS[a.agent]?.name || a.agent;
    li.querySelector('time').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    li.querySelector('p').textContent = a.note;
    if (a.pay) {
      const pay = document.createElement('p');
      pay.className = 'pay';
      pay.textContent = `${a.pay.amount} USDG → ${Floor.AGENTS[a.pay.to]?.name}`;
      li.append(pay);
    }
    if (a.tx) {
      const p = document.createElement('p');
      p.innerHTML = `<a target="_blank" rel="noopener"></a>`;
      p.querySelector('a').href = `${EXPLORER}/tx/${a.tx}`;
      p.querySelector('a').textContent = 'View transaction ↗';
      li.append(p);
    }
    log.prepend(li);
    while (log.children.length > 40) log.lastChild.remove();
  }

  async function runQueue() {
    if (running) return;
    running = true;
    while (queue.length) {
      const a = queue.shift();
      await Floor.play(a);
      addLog(a);
      await sleep(900);
    }
    running = false;
  }
  // user actions jump ahead of the ambient crew
  const act = (a, urgent = false) => { urgent ? queue.unshift(a) : queue.push(a); runQueue(); };

  function status() {
    if (!updatedAt) return;
    const s = Math.max(0, Math.round((Date.now() - updatedAt) / 1000));
    $('[data-status]').textContent = `Live prices · updated ${s < 5 ? 'just now' : s + 's ago'}`;
  }

  async function poll() {
    try {
      const res = await fetch('/api/state', { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status);
      const d = await res.json();
      updatedAt = d.at;
      if (d.courses && !Object.keys(courses).length) { courses = d.courses; renderCourse(); }
      if (!portfolio) {
        Floor.setData(d);
        $('[data-vault]').textContent = fmt(d.vault.value);
        const pnl = d.vault.value - d.vault.start;
        $('[data-pnl]').textContent = `${pnl >= 0 ? '+' : '−'}${fmt(Math.abs(pnl))} 24h`;
      } else {
        Floor.setData({ stocks: d.stocks });
      }
      if (d.ca) setCa(d.ca);
      if (d.round !== round) {
        round = d.round;
        if (!busy && Date.now() > quietUntil) { queue.push(...d.actions); runQueue(); }
      }
    } catch {
      $('[data-status]').textContent = 'Reconnecting…';
    }
  }
  poll();
  setInterval(poll, POLL);
  setInterval(status, 1000);

  // ---------- CA ----------
  function setCa(ca) {
    $('[data-ca]').textContent = ca;
    const btn = $('[data-copy]');
    btn.disabled = false;
    btn.onclick = async () => {
      try { await navigator.clipboard.writeText(ca); } catch { return; }
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1400);
    };
    document.querySelectorAll('[data-buy]').forEach((a) => { a.href = `https://ponsfamily.com/launchpad/${ca}`; });
  }

  // ---------- courses ----------
  let course = 'steady';
  try { course = localStorage.getItem('quiver-course') || course; } catch {}
  const NOTES = {
    calm: 'Calm: anchored on the S&P 500 with a 25% cash buffer. Rebalances at 3 points of drift.',
    steady: 'Steady: the S&P plus a spread of big tech, 10% cash. Rebalances at 2 points of drift.',
    bold: 'Bold: leans into high-growth names, 5% cash. Rebalances at 1.5 points of drift.',
  };

  function renderCourse() {
    document.querySelectorAll('[data-course]').forEach((b) => {
      const on = b.dataset.course === course;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on);
    });
    $('[data-course-note]').textContent = NOTES[course];
    const t = courses[course]?.targets || {};
    $('[data-mix]').innerHTML = Object.entries(t).sort((a, b) => b[1] - a[1])
      .map(([sym, w]) => `<div class="mix-row"><span>${sym}</span><i style="width:${(w * 100 / 0.5).toFixed(1)}%"></i><span>${Math.round(w * 100)}%</span></div>`)
      .join('');
  }
  document.querySelectorAll('[data-course]').forEach((b) => b.addEventListener('click', () => {
    if (busy) return;
    course = b.dataset.course;
    try { localStorage.setItem('quiver-course', course); } catch {}
    renderCourse();
    if (wallet) loadPortfolio(true);
  }));
  $('[data-connect]').title = 'Connected wallet';
  renderCourse();

  // ---------- wallet ----------
  const eth = () => window.ethereum;
  const msg = (t) => { $('[data-msg]').textContent = t || ''; };
  const rpc = (method, params = []) => eth().request({ method, params });

  async function ensureChain() {
    if ((await rpc('eth_chainId')) === CHAIN) return;
    try {
      await rpc('wallet_switchEthereumChain', [{ chainId: CHAIN }]);
    } catch (err) {
      if (err.code !== 4902) throw err;
      await rpc('wallet_addEthereumChain', [{
        chainId: CHAIN, chainName: 'Robinhood Chain',
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: ['https://rpc.mainnet.chain.robinhood.com'], blockExplorerUrls: [EXPLORER],
      }]);
    }
  }

  async function connect() {
    if (!eth()) { msg('No wallet found. Open this page in MetaMask, Rabby or any browser wallet.'); return; }
    try {
      const [addr] = await rpc('eth_requestAccounts');
      await ensureChain();
      setWallet(addr);
    } catch (err) {
      msg(err.code === 4001 ? 'Connection cancelled.' : err.message || 'Could not connect.');
    }
  }

  function setWallet(addr) {
    wallet = addr;
    const btn = $('[data-connect]');
    btn.textContent = short(addr);
    btn.classList.replace('btn-ink', 'btn-line');
    $('[data-addr]').textContent = addr;
    $('[data-empty]').hidden = true;
    $('[data-wallet]').hidden = false;
    msg('');
    loadPortfolio(true);
  }

  $('[data-connect]').addEventListener('click', () => (wallet ? null : connect()));
  if (eth()) {
    eth().on?.('accountsChanged', (a) => (a[0] ? setWallet(a[0]) : location.reload()));
    eth().on?.('chainChanged', () => wallet && loadPortfolio());
    rpc('eth_accounts').then((a) => a[0] && rpc('eth_chainId').then((c) => c === CHAIN && setWallet(a[0]))).catch(() => {});
  }

  async function loadPortfolio(announce = false) {
    msg('Scout is reading your wallet…');
    try {
      const res = await fetch(`/api/portfolio?address=${wallet}&course=${course}`, { cache: 'no-store' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      portfolio = d;
      renderPortfolio();
      msg('');
      Floor.setData({ vault: { value: d.total }, book: d.rows.filter((r) => r.sym !== 'USDG').map((r) => ({ sym: r.sym, weight: r.weight })) });
      $('[data-vault-label]').textContent = 'Your portfolio';
      $('[data-vault]').textContent = fmt(d.total);
      $('[data-pnl]').textContent = '';
      if (announce) {
        quietUntil = Date.now() + 20000;
        queue.length = 0;
        const held = d.rows.filter((r) => r.value >= 1).length;
        act({ agent: 'scout', station: 'core', say: `Read your wallet · ${held} assets`, note: `Your portfolio: ${fmt(d.total)} across ${held} assets.` }, true);
        const cash = d.rows.find((r) => r.sym === 'USDG');
        if (cash && cash.value >= 1) act({ agent: 'yield', station: 'vault', say: `${fmt(cash.value, 0)} USDG ready`, note: `You hold ${fmt(cash.value)} in USDG, ${(cash.weight * 100).toFixed(1)}% of your portfolio.` });
        act({
          agent: 'aim', station: 'market',
          say: d.trades.length ? `Plan ready · ${d.trades.length} trades` : 'On course · nothing to do',
          note: d.trades.length ? `${d.trades.length} trades bring you to ${courses[course]?.name || course}.` : `Every position is within ${d.band} points of the ${courses[course]?.name || course} course.`,
        });
      }
    } catch (err) {
      msg(err.message || 'Could not read your wallet.');
    }
  }

  function renderPortfolio() {
    const d = portfolio;
    $('[data-total]').textContent = fmt(d.total);
    $('[data-rows]').innerHTML = d.rows
      .filter((r) => r.value >= 0.01 || r.target > 0)
      .sort((a, b) => b.value - a.value)
      .map((r) => `<tr><td>${r.sym}</td><td>${qty(r.amount)}</td><td>${fmt(r.value)}</td><td class="${Math.abs(r.drift) >= d.band ? 'off' : ''}">${(r.weight * 100).toFixed(1)}%</td><td>${Math.round(r.target * 100)}%</td></tr>`)
      .join('');
    const list = $('[data-trades]');
    list.innerHTML = '';
    if (!d.trades.length) {
      $('[data-plan-note]').textContent = d.total < 10 ? 'Add stock tokens or USDG to get started.' : 'On course. Nothing to trade.';
      $('[data-run]').hidden = true;
      return;
    }
    $('[data-plan-note]').textContent = `${d.trades.length} trades to ${courses[course]?.name || course}`;
    d.trades.forEach((t, i) => {
      const li = document.createElement('li');
      li.dataset.i = i;
      li.innerHTML = `<span><b>${t.side === 'sell' ? 'Sell' : 'Buy'} ${qty(t.qty)} ${t.sym}</b> · ${fmt(t.usd)}</span><span class="st">Ready</span>`;
      list.append(li);
    });
    $('[data-run]').hidden = false;
  }

  // ---------- execution ----------
  async function api(body) {
    const res = await fetch('/api/swap', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'Swap failed');
    return d;
  }

  const hex = (v) => (v == null ? undefined : typeof v === 'string' && v.startsWith('0x') ? v : '0x' + BigInt(v).toString(16));

  async function sendTx(tx) {
    const hash = await rpc('eth_sendTransaction', [{ from: wallet, to: tx.to, data: tx.data, value: hex(tx.value || 0), ...(tx.gasLimit && { gas: hex(tx.gasLimit) }) }]);
    for (let i = 0; i < 120; i++) {
      const r = await rpc('eth_getTransactionReceipt', [hash]).catch(() => null);
      if (r) {
        if (r.status !== '0x1') throw Object.assign(new Error('Transaction reverted'), { hash });
        return hash;
      }
      await sleep(1500);
    }
    return hash;
  }

  function typedData(p) {
    const domainTypes = [['name', 'string'], ['version', 'string'], ['chainId', 'uint256'], ['verifyingContract', 'address'], ['salt', 'bytes32']]
      .filter(([k]) => p.domain[k] !== undefined).map(([name, type]) => ({ name, type }));
    const refs = new Set(Object.values(p.types).flat().map((f) => f.type.replace('[]', '')));
    const primaryType = Object.keys(p.types).find((t) => !refs.has(t) && t !== 'EIP712Domain');
    return JSON.stringify({ types: { EIP712Domain: domainTypes, ...p.types }, domain: p.domain, primaryType, message: p.values });
  }

  async function runTrade(t, li) {
    const st = li.querySelector('.st');
    const set = (text) => { st.textContent = text; };
    const verb = t.side === 'sell' ? 'Selling' : 'Buying';
    act({ agent: 'aim', station: 'market', say: `${verb} ${qty(t.qty)} ${t.sym}`, note: `${verb} ${qty(t.qty)} ${t.sym} (${fmt(t.usd)}) to stay on course.` });

    const base = { wallet, tokenIn: t.tokenIn, tokenOut: t.tokenOut, amount: t.amount };
    set('Checking approval…');
    const { approval } = await api({ step: 'approval', ...base });
    if (approval) { set('Approve in wallet…'); await sendTx(approval); }

    set('Getting best price…');
    const q = await api({ step: 'quote', ...base });
    let signature;
    if (q.permitData) {
      set('Sign in wallet…');
      signature = await rpc('eth_signTypedData_v4', [wallet, typedData(q.permitData)]);
    }
    const { swap } = await api({ step: 'swap', quote: q.quote, permitData: q.permitData || undefined, signature });
    set('Confirm in wallet…');
    const hash = await sendTx(swap);
    li.classList.add('done');
    st.innerHTML = `Done · <a href="${EXPLORER}/tx/${hash}" target="_blank" rel="noopener">${short(hash)}</a>`;
    act({ agent: 'aim', station: 'market', say: `${t.side === 'sell' ? 'Sold' : 'Bought'} ${t.sym} ✓`, note: `${t.side === 'sell' ? 'Sold' : 'Bought'} ${qty(t.qty)} ${t.sym} through Uniswap.`, tx: hash });
  }

  $('[data-run]').addEventListener('click', async () => {
    if (busy || !portfolio?.trades.length) return;
    busy = true;
    queue.length = 0;
    const btn = $('[data-run]');
    btn.disabled = true;
    msg('');
    try {
      await ensureChain();
      act({ agent: 'scout', station: 'core', say: 'Pricing every route', note: 'Scout checked live routes for each trade.' }, true);
      const items = [...document.querySelectorAll('[data-trades] li')];
      let ok = 0;
      for (const [i, t] of portfolio.trades.entries()) {
        try {
          await runTrade(t, items[i]);
          ok++;
        } catch (err) {
          items[i].classList.add('fail');
          items[i].querySelector('.st').textContent = err.code === 4001 ? 'Skipped' : (err.message || 'Failed').slice(0, 60);
          if (err.code === 4001 && !confirm('Continue with the remaining trades?')) break;
        }
      }
      act({ agent: 'aim', station: 'market', say: ok ? 'Back on course' : 'Round paused', note: `Round complete: ${ok} of ${portfolio.trades.length} trades filled.` });
      await sleep(2500);
      const filled = $('[data-trades]').innerHTML;
      await loadPortfolio();
      $('[data-trades]').innerHTML = filled;
      $('[data-run]').hidden = true;
      msg(`Round complete: ${ok} of ${items.length} trades filled. Your balances above are updated.`);
    } finally {
      busy = false;
      btn.disabled = false;
    }
  });
})();
