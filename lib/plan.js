// Aim's plan: compare a wallet's holdings to a course and list the swaps that bring it back on target.
import { USDG, toFloat, toRaw } from './chain.js';

export const COURSES = {
  calm: { name: 'Calm', band: 3, targets: { SPY: 0.45, AAPL: 0.10, MSFT: 0.10, GOOGL: 0.10, USDG: 0.25 } },
  steady: { name: 'Steady', band: 2, targets: { SPY: 0.28, NVDA: 0.12, AAPL: 0.10, MSFT: 0.10, AMZN: 0.08, GOOGL: 0.08, META: 0.07, TSLA: 0.07, USDG: 0.10 } },
  bold: { name: 'Bold', band: 1.5, targets: { NVDA: 0.25, TSLA: 0.18, META: 0.15, AMZN: 0.10, GOOGL: 0.10, SPY: 0.17, USDG: 0.05 } },
};

const minRaw = (a, b) => (BigInt(a) < b ? a : b.toString());
const MIN_TRADE = 5; // USD, skip dust
const SLIP = 0.99; // keep 1% back on buys for price movement

export function buildPlan(wallet, prices, courseKey) {
  const course = COURSES[courseKey] || COURSES.steady;
  const price = Object.fromEntries(prices.map((p) => [p.sym, p.price]));
  price.USDG = 1;

  const rows = wallet.tokens
    .filter((t) => price[t.sym])
    .map((t) => {
      const amount = toFloat(t.raw, t.decimals);
      return { sym: t.sym, name: t.name, address: t.address, decimals: t.decimals, raw: t.raw, amount, price: price[t.sym], value: amount * price[t.sym] };
    });
  const total = rows.reduce((a, r) => a + r.value, 0);
  for (const r of rows) {
    r.weight = total ? r.value / total : 0;
    r.target = course.targets[r.sym] || 0;
    r.drift = (r.weight - r.target) * 100;
  }

  const trades = [];
  if (total >= MIN_TRADE * 2) {
    const off = rows.filter((r) => r.sym !== 'USDG' && Math.abs(r.drift) >= course.band);
    const sells = off.filter((r) => r.drift > 0);
    const buys = off.filter((r) => r.drift < 0);

    const cashRow = rows.find((r) => r.sym === 'USDG');
    const usdgDec = cashRow?.decimals ?? 6;
    let usdg = cashRow?.value || 0;
    for (const r of sells) {
      const usd = (r.drift / 100) * total;
      if (usd < MIN_TRADE) continue;
      const qty = usd / r.price;
      trades.push({ side: 'sell', sym: r.sym, usd, qty, tokenIn: r.address, tokenOut: USDG.address, amount: minRaw(toRaw(qty, r.decimals), r.raw) });
      usdg += usd;
    }
    const reserve = (course.targets.USDG || 0) * total;
    let spendable = Math.max(0, (usdg - reserve) * SLIP);
    const want = buys.map((r) => (-r.drift / 100) * total);
    const need = want.reduce((a, b) => a + b, 0);
    const scale = need > spendable && need > 0 ? spendable / need : 1;
    buys.forEach((r, i) => {
      const usd = want[i] * scale;
      if (usd < MIN_TRADE) return;
      spendable -= usd;
      trades.push({ side: 'buy', sym: r.sym, usd, qty: usd / r.price, tokenIn: USDG.address, tokenOut: r.address, amount: toRaw(usd, usdgDec) });
    });
  }

  for (const r of rows) delete r.raw;
  return { course: courseKey in COURSES ? courseKey : 'steady', band: course.band, total, rows, trades };
}
