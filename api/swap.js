// Proxies Uniswap's Trading API so the key stays server-side. The wallet signs everything; we never touch keys or funds.
import { send, readJson } from '../lib/http.js';
import { CHAIN_ID, TOKENS, isAddress } from '../lib/chain.js';

const API = 'https://trade-api.gateway.uniswap.org/v1';
const ALLOWED = new Set(TOKENS.map((t) => t.address.toLowerCase()));

async function uni(path, body) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', 'x-api-key': process.env.UNISWAP_API_KEY },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.detail || data.errorCode || `uniswap ${res.status}`), { status: res.status });
  return data;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  if (!process.env.UNISWAP_API_KEY) return send(res, 503, { error: 'Swaps are not configured yet.' });
  try {
    const b = await readJson(req);
    const { step, wallet, tokenIn, tokenOut, amount } = b;

    if (step === 'swap') {
      if (!b.quote) return send(res, 400, { error: 'Missing quote' });
      const body = { quote: b.quote };
      if (b.permitData) { body.permitData = b.permitData; body.signature = b.signature; }
      const out = await uni('/swap', body);
      return send(res, 200, { swap: out.swap });
    }

    if (!isAddress(wallet) || !ALLOWED.has(String(tokenIn).toLowerCase()) || !ALLOWED.has(String(tokenOut).toLowerCase())) {
      return send(res, 400, { error: 'That trade is not on the crew\'s list.' });
    }
    if (!/^\d{1,40}$/.test(String(amount)) || amount === '0') return send(res, 400, { error: 'Bad amount' });

    if (step === 'approval') {
      const out = await uni('/check_approval', { walletAddress: wallet, token: tokenIn, amount, chainId: CHAIN_ID, tokenOut, tokenOutChainId: CHAIN_ID });
      return send(res, 200, { approval: out.approval || null });
    }

    if (step === 'quote') {
      const out = await uni('/quote', {
        type: 'EXACT_INPUT', swapper: wallet, tokenIn, tokenOut,
        tokenInChainId: CHAIN_ID, tokenOutChainId: CHAIN_ID, amount,
        protocols: ['V2', 'V3', 'V4'], routingPreference: 'BEST_PRICE', slippageTolerance: 1,
      });
      if (out.routing && out.routing !== 'CLASSIC') return send(res, 409, { error: 'No direct route for this trade right now.' });
      return send(res, 200, { quote: out.quote, permitData: out.permitData || null, routing: out.routing });
    }

    send(res, 400, { error: 'Unknown step' });
  } catch (err) {
    console.error('swap:', err.message);
    send(res, err.status && err.status < 500 ? 400 : 502, { error: err.message || 'Swap service failed' });
  }
}
