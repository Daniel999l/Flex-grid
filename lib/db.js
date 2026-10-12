// MongoDB when MONGODB_URI is set, an in-memory stand-in otherwise (local dev only).

let clientPromise;

export async function getDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri) return null;
  if (!clientPromise) {
    clientPromise = import('mongodb').then(async ({ MongoClient }) => {
      const client = new MongoClient(uri, { maxPoolSize: 5, serverSelectionTimeoutMS: 6000 });
      await client.connect();
      const db = client.db(process.env.MONGODB_DB || 'quiver');
      await Promise.all([
        db.collection('waitlist').createIndex({ handle: 1 }, { unique: true }),
        db.collection('waitlist').createIndex({ score: 1 }),
      ]);
      return db;
    }).catch((err) => {
      clientPromise = undefined;
      throw err;
    });
  }
  return clientPromise;
}

// Minimal in-memory version of the few collection calls we use.
const mem = { waitlist: new Map(), cache: new Map() };

export const memory = {
  waitlist: {
    async findOne(handle) { return mem.waitlist.get(handle) || null; },
    async insert(doc) { mem.waitlist.set(doc.handle, doc); },
    async update(handle, set, inc = {}) {
      const d = mem.waitlist.get(handle);
      if (!d) return;
      Object.assign(d, set);
      for (const [k, v] of Object.entries(inc)) d[k] = (d[k] || 0) + v;
    },
    async countBelow(score) { return [...mem.waitlist.values()].filter((d) => d.score < score).length; },
    async count() { return mem.waitlist.size; },
  },
  cache: mem.cache,
};
