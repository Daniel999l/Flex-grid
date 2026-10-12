// Reads wallet balances straight from the chain with one batched JSON-RPC call.
import { STOCKS } from './market.js';

export const CHAIN_ID = 4663;
export const USDG = { sym: 'USDG', name: 'Global Dollar', address: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168' };
export const TOKENS = [...STOCKS, USDG];
export const isAddress = (a) => /^0x[a-fA-F0-9]{40}$/.test(String(a || ''));

const RPC = () => process.env.RH_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com';
const decimalsCache = new Map();

// Batched when the provider allows it; falls back to single calls if a plan rejects batches.
async function batch(calls) {
  try {
    return await batchOnce(calls);
  } catch (err) {
    if (err.message === 'rpc busy, try again') throw err;
    return Promise.all(calls.map((c) => single(c)));
  }
}

async function single(c) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(RPC(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, ...c }),
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 400 * (attempt + 1))); continue; }
    const out = await res.json();
    if (out.error) throw new Error(out.error.message || 'rpc call failed');
    return out.result;
  }
  throw new Error('rpc busy, try again');
}

async function batchOnce(calls) {
  const body = calls.map((c, id) => ({ jsonrpc: '2.0', id, ...c }));
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(RPC(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 400 * (attempt + 1))); continue; }
    if (!res.ok) throw new Error(`rpc ${res.status}`);
    const out = await res.json();
    if (!Array.isArray(out)) throw new Error(out?.error?.message || 'rpc batch failed');
    const byId = new Map(out.map((r) => [r.id, r]));
    return calls.map((_, i) => {
      const r = byId.get(i);
      if (!r || r.error) throw new Error(r?.error?.message || 'rpc call failed');
      return r.result;
    });
  }
  throw new Error('rpc busy, try again');
}

const call = (to, data) => ({ method: 'eth_call', params: [{ to, data }, 'latest'] });
const pad = (addr) => addr.toLowerCase().replace('0x', '').padStart(64, '0');

export async function readWallet(owner) {
  const needDec = TOKENS.filter((t) => !decimalsCache.has(t.address));
  if (needDec.length) {
    const dec = await batch(needDec.map((t) => call(t.address, '0x313ce567')));
    needDec.forEach((t, i) => decimalsCache.set(t.address, Number(BigInt(dec[i]))));
  }
  const res = await batch([
    { method: 'eth_getBalance', params: [owner, 'latest'] },
    ...TOKENS.map((t) => call(t.address, '0x70a08231' + pad(owner))),
  ]);
  return {
    eth: BigInt(res[0]),
    tokens: TOKENS.map((t, i) => ({ ...t, decimals: decimalsCache.get(t.address), raw: BigInt(res[i + 1] === '0x' ? 0 : res[i + 1]) })),
  };
}

// raw bigint -> float, and float -> raw bigint string, without losing precision on large decimals
export const toFloat = (raw, decimals) => Number(raw) / 10 ** decimals;
export function toRaw(amount, decimals) {
  const fixed = Math.max(0, amount).toFixed(Math.min(decimals, 9));
  const [i, f = ''] = fixed.split('.');
  return (BigInt(i) * 10n ** BigInt(decimals) + BigInt((f + '0'.repeat(decimals)).slice(0, decimals) || '0')).toString();
}
