// One shared crew round per TTL window, cached in memory and Mongo, so every visitor sees the same floor.
import { fetchStocks } from './market.js';
import { runCrew } from './engine.js';
import { narrate } from './narrate.js';
import { getDb, memory } from './db.js';

const TTL = 45_000;
let inflight;

async function build() {
  const stocks = await fetchStocks();
  if (!stocks.length) throw new Error('no prices');
  const crew = runCrew(stocks);
  crew.actions = await narrate(crew.actions);
  crew.round = Math.floor(crew.at / TTL);
  return crew;
}

export async function currentState() {
  const now = Date.now();
  const hot = memory.cache.get('state');
  if (hot && now - hot.at < TTL) return hot;

  let db = null;
  try { db = await getDb(); } catch (err) { console.warn('db:', err.message); }
  if (db) {
    const doc = await db.collection('cache').findOne({ _id: 'state' });
    if (doc && now - doc.data.at < TTL) {
      memory.cache.set('state', doc.data);
      return doc.data;
    }
  }

  inflight ||= build().finally(() => { inflight = undefined; });
  try {
    const data = await inflight;
    memory.cache.set('state', data);
    if (db) await db.collection('cache').updateOne({ _id: 'state' }, { $set: { data } }, { upsert: true });
    return data;
  } catch (err) {
    if (hot) return { ...hot, stale: true };
    throw err;
  }
}
