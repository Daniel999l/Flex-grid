import { feeStatus } from '../lib/pons.js';
import { isAddress } from '../lib/chain.js';
import { send } from '../lib/http.js';

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const token = url.searchParams.get('token') || '0xe33dc97ec74b88604a718c8f1d9dc229420c79bd';
  const wallet = url.searchParams.get('wallet');
  if (!isAddress(token) || (wallet && !isAddress(wallet))) return send(res, 400, { error: 'Bad address' });
  try {
    const status = await feeStatus(token, wallet);
    if (!status) return send(res, 404, { error: 'Not a Pons token' });
    send(res, 200, status, { 'cache-control': 'no-store' });
  } catch (err) {
    console.error('claim:', err);
    send(res, 502, { error: 'Could not read fees right now. Try again in a few seconds.' });
  }
}
