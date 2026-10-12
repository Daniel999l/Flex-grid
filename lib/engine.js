// The crew's decisions, computed from live prices against a $10,000 paper vault.
// Nothing here moves real funds: every number is real market data, every trade is on paper.

const VAULT_USD = 10_000;
const DRIFT_BAND = 0.25; // percentage points before Aim rebalances
const YIELD_APY = 0.07; // Morpho USDG supply, estimate
const LP_USD = 1_000; // Depth's paper position size
const LP_FEE = 0.0005; // conservative 0.05% fee tier
const SIGNAL_PRICE = 0.02; // what Aim and Depth pay Scout per read, in USDG
const TAKE_RATE = 0.002; // protocol fee on paper volume, routed to buybacks

export const TARGETS = {
  SPY: 0.28, NVDA: 0.12, AAPL: 0.10, MSFT: 0.10,
  AMZN: 0.08, GOOGL: 0.08, META: 0.07, TSLA: 0.07,
};
const CASH = 1 - Object.values(TARGETS).reduce((a, b) => a + b, 0);

const usd = (n, d = 2) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (n) => (n > 0 ? '+' : '') + n.toFixed(2) + '%';
const units = (n) => (n >= 1 ? n.toFixed(2) : n.toFixed(4));

export function runCrew(stocks, now = Date.now()) {
  const held = stocks.filter((s) => TARGETS[s.sym]);

  // Vault was balanced to target 24h ago at the then-price; where does it sit now?
  const book = held.map((s) => {
    const then = s.price / (1 + s.ch24 / 100);
    const qty = (TARGETS[s.sym] * VAULT_USD) / then;
    return { ...s, then, qty, value: qty * s.price };
  });
  const cash = CASH * VAULT_USD;
  const total = cash + book.reduce((a, b) => a + b.value, 0);
  for (const b of book) {
    b.weight = b.value / total;
    b.drift = (b.weight - TARGETS[b.sym]) * 100;
  }
  const pnl = total - VAULT_USD;

  const byDrift = [...book].sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift));
  const movers = [...held].sort((a, b) => Math.abs(b.ch1) - Math.abs(a.ch1));
  const deepest = [...held].sort((a, b) => b.vol24 / (b.liq || 1) - a.vol24 / (a.liq || 1))[0];
  const weakest = [...held].sort((a, b) => a.ch24 - b.ch24)[0];
  const strongest = [...held].sort((a, b) => b.ch24 - a.ch24)[0];

  const actions = [];
  let paperVolume = 0;
  let signalFees = 0;

  // Scout reads every pool and sells the read.
  actions.push({
    agent: 'scout', station: 'core',
    say: `Read ${held.length} stock pools`,
    note: `Strongest 24h: ${strongest.sym} ${pct(strongest.ch24)}. Weakest: ${weakest.sym} ${pct(weakest.ch24)}.`,
    facts: { strongest: strongest.sym, weakest: weakest.sym },
  });

  actions.push({
    agent: 'aim', station: 'core',
    say: `Bought a drift read · ${SIGNAL_PRICE} USDG`,
    note: `Paid Scout over x402 for the vault's drift check.`,
    pay: { from: 'aim', to: 'scout', amount: SIGNAL_PRICE },
  });
  signalFees += SIGNAL_PRICE;

  // Aim rebalances anything outside the band, otherwise holds.
  const out = byDrift.filter((b) => Math.abs(b.drift) >= DRIFT_BAND).slice(0, 3);
  if (out.length) {
    for (const b of out) {
      const tradeUsd = Math.abs(b.drift / 100) * total;
      const qty = tradeUsd / b.price;
      paperVolume += tradeUsd;
      actions.push({
        agent: 'aim', station: 'market',
        say: `${b.drift > 0 ? 'Trim' : 'Add'} ${units(qty)} ${b.sym}`,
        note: `${b.sym} at ${(b.weight * 100).toFixed(1)}% vs ${(TARGETS[b.sym] * 100).toFixed(0)}% target (${pct(b.ch24)} 24h). ${b.drift > 0 ? 'Sold' : 'Bought'} ${usd(tradeUsd)} at ${usd(b.price)}.`,
      });
    }
  } else {
    const top = byDrift[0];
    actions.push({
      agent: 'aim', station: 'market',
      say: `Holding · max drift ${Math.abs(top.drift).toFixed(2)} pts`,
      note: `Every position is inside the ${DRIFT_BAND} pt band. Closest to the edge: ${top.sym} at ${(top.weight * 100).toFixed(2)}%.`,
    });
  }

  // Yield puts the cash buffer to work.
  const daily = (cash * YIELD_APY) / 365;
  actions.push({
    agent: 'yield', station: 'vault',
    say: `${usd(cash, 0)} idle USDG → Morpho`,
    note: `Supplying the cash buffer at ~${(YIELD_APY * 100).toFixed(0)}% APY (est.), about ${usd(daily)} a day.`,
  });

  // Depth buys a volatility read, then picks the busiest pool for liquidity.
  actions.push({
    agent: 'depth', station: 'core',
    say: `Bought a pool read · ${SIGNAL_PRICE} USDG`,
    note: `Paid Scout over x402 for volume and volatility on every stock pool.`,
    pay: { from: 'depth', to: 'scout', amount: SIGNAL_PRICE },
  });
  signalFees += SIGNAL_PRICE;

  const lpDay = (LP_USD / (deepest.liq || 1)) * deepest.vol24 * LP_FEE;
  actions.push({
    agent: 'depth', station: 'pool',
    say: `LP ${deepest.sym}/${deepest.quote} · ${usd(deepest.vol24 / 1e6, 1)}M vol`,
    note: `Busiest pool for its size: ${usd(deepest.vol24, 0)} traded on ${usd(deepest.liq, 0)} liquidity. ${usd(LP_USD, 0)} here earns ~${usd(lpDay)}/day at a 0.05% fee (est.).`,
  });

  // A short-term mover: Scout flags it, Aim reacts only if it pushes drift.
  const mover = movers[0];
  if (mover && Math.abs(mover.ch1) >= 0.15) {
    actions.push({
      agent: 'scout', station: 'market',
      say: `${mover.sym} ${pct(mover.ch1)} in 1h`,
      note: `Flagged ${mover.sym} for the crew. Price ${usd(mover.price)}.`,
    });
  }

  const buyback = paperVolume * TAKE_RATE + signalFees * 0.5;
  actions.push({
    agent: 'scout', station: 'core',
    say: `Fees → $QUIVER buyback`,
    note: `This round: ${usd(paperVolume, 0)} traded, ${signalFees.toFixed(2)} USDG in reads. ${usd(buyback, 4)} queued for buyback and burn.`,
  });

  return {
    at: now,
    mode: 'paper',
    vault: { start: VAULT_USD, value: total, pnl, cash },
    stocks: held.map(({ sym, name, price, ch1, ch24, vol24, liq }) => ({ sym, name, price, ch1, ch24, vol24, liq })),
    book: book.map((b) => ({ sym: b.sym, weight: b.weight, target: TARGETS[b.sym], drift: b.drift })),
    actions,
    totals: { paperVolume, signalFees, buyback },
  };
}
