// Pons launchpad fee reads, straight from the contracts (no indexer, so no lag).
import { rpcCall } from './chain.js';

export const PONS_LAUNCHPAD = '0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e';

const SEL = {
  getLaunchedToken: '0x3cf28b5a', // (address) -> (token, curve, creator, feeRecipient, ...)
  feeEscrow: '0xc4b7de97',
  quoteFeeBalance: '0xed479c47',
  creatorTaxBalance: '0xdb2bd533',
  isNativeQuote: '0xdc08e094',
  pairToken: '0x3de35b79',
  graduated: '0xe7c2b772',
  sweepFees: '0x3729bb9a', // (uint256) creator-only: moves pending curve fees into the escrow
  balanceOf: '0x70a08231',
  balanceOfToken: '0xf59e38b7', // (owner, token)
  claim: '0x4e71d92d',
  claimToken: '0x32f289cf', // (token)
};

const pad = (a) => a.toLowerCase().replace('0x', '').padStart(64, '0');
const word = (hex, i) => '0x' + hex.slice(2 + 64 * i, 2 + 64 * (i + 1));
const addr = (w) => '0x' + w.slice(-40);
const num = (w) => BigInt(w === '0x' ? 0 : w);

const read = (to, data, from) => rpcCall('eth_call', [{ to, data, ...(from && { from }) }, 'latest']);
async function simulate(from, to, data) {
  try { await read(to, data, from); return true; } catch { return false; }
}

export async function feeStatus(token, wallet) {
  const launched = await read(PONS_LAUNCHPAD, SEL.getLaunchedToken + pad(token));
  const curve = addr(word(launched, 1));
  if (/^0x0+$/.test(curve)) return null;
  const creator = addr(word(launched, 2));
  const feeRecipient = addr(word(launched, 3));

  const [escrowW, pendingQuote, pendingTax, native, pairW, gradW] = await Promise.all([
    read(curve, SEL.feeEscrow), read(curve, SEL.quoteFeeBalance), read(curve, SEL.creatorTaxBalance),
    read(curve, SEL.isNativeQuote), read(curve, SEL.pairToken), read(curve, SEL.graduated),
  ]);
  const escrow = addr(escrowW);
  const isNative = num(native) === 1n;
  const pair = addr(pairW);
  const pending = num(pendingQuote) + num(pendingTax);

  const out = {
    token, curve, creator, feeRecipient, escrow,
    graduated: num(gradW) === 1n, quote: isNative ? 'ETH' : pair,
    pending: pending.toString(), claimable: '0', actions: {},
  };
  if (!wallet) return out;

  const claimable = num(await read(escrow, isNative ? SEL.balanceOf + pad(wallet) : SEL.balanceOfToken + pad(wallet) + pad(pair)));
  out.claimable = claimable.toString();
  out.isCreator = [creator, feeRecipient].some((a) => a.toLowerCase() === wallet.toLowerCase());

  if (pending > 0n) {
    const data = SEL.sweepFees + pending.toString(16).padStart(64, '0');
    if (await simulate(wallet, curve, data)) out.actions.collect = { to: curve, data };
  }
  if (claimable > 0n) {
    const data = isNative ? SEL.claim : SEL.claimToken + pad(pair);
    if (await simulate(wallet, escrow, data)) out.actions.claim = { to: escrow, data };
  }
  return out;
}
