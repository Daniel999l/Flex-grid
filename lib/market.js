// Live prices for Robinhood stock tokens, read from DexScreener (no key needed).

export const STOCKS = [
  { sym: 'SPY', name: 'S&P 500', address: '0x117cc2133c37B721F49dE2A7a74833232B3B4C0C' },
  { sym: 'NVDA', name: 'NVIDIA', address: '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC' },
  { sym: 'AAPL', name: 'Apple', address: '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9' },
  { sym: 'MSFT', name: 'Microsoft', address: '0xe93237C50D904957Cf27E7B1133b510C669c2e74' },
  { sym: 'AMZN', name: 'Amazon', address: '0x12f190a9F9d7D37a250758b26824B97CE941bF54' },
  { sym: 'GOOGL', name: 'Alphabet', address: '0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3' },
  { sym: 'META', name: 'Meta', address: '0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35' },
  { sym: 'TSLA', name: 'Tesla', address: '0x322F0929c4625eD5bAd873c95208D54E1c003b2d' },
];

const ENDPOINT = 'https://api.dexscreener.com/tokens/v1/robinhood/';

export async function fetchStocks() {
  const url = ENDPOINT + STOCKS.map((s) => s.address).join(',');
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`dexscreener ${res.status}`);
  const pairs = await res.json();

  return STOCKS.map((s) => {
    const own = pairs.filter((p) => p.baseToken?.address?.toLowerCase() === s.address.toLowerCase());
    const usdg = own.filter((p) => p.quoteToken?.symbol === 'USDG');
    const pool = (usdg.length ? usdg : own).sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
    if (!pool) return null;
    return {
      sym: s.sym,
      name: s.name,
      address: s.address,
      price: Number(pool.priceUsd),
      ch1: pool.priceChange?.h1 ?? 0,
      ch24: pool.priceChange?.h24 ?? 0,
      vol24: pool.volume?.h24 ?? 0,
      liq: pool.liquidity?.usd ?? 0,
      pair: pool.pairAddress,
      quote: pool.quoteToken?.symbol,
      dex: pool.dexId,
    };
  }).filter((t) => t && Number.isFinite(t.price) && t.price > 0);
}
