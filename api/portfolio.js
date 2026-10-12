import { currentState } from '../lib/state.js';
import { readWallet, isAddress } from '../lib/chain.js';
import { buildPlan } from '../lib/plan.js';
import { send } from '../lib/http.js';

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const address = url.searchParams.get('address');
  const course = url.searchParams.get('course') || 'steady';
  if (!isAddress(address)) return send(res, 400, { error: 'Connect a wallet first.' });
  try {
    const [state, wallet] = await Promise.all([currentState(), readWallet(address)]);
    const plan = buildPlan(wallet, state.stocks, course);
    send(res, 200, { address, eth: Number(wallet.eth) / 1e18, ...plan }, { 'cache-control': 'no-store' });
  } catch (err) {
    console.error('portfolio:', err);
    send(res, 502, { error: 'Could not read your wallet just now. Try again in a few seconds.' });
  }
}
