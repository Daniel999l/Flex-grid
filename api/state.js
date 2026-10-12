import { currentState } from '../lib/state.js';
import { send } from '../lib/http.js';
import { COURSES } from '../lib/plan.js';

export default async function handler(req, res) {
  try {
    const data = await currentState();
    send(res, 200, { ...data, courses: COURSES, ca: process.env.QUIVER_CA || '' }, {
      'cache-control': 'public, s-maxage=20, stale-while-revalidate=60',
    });
  } catch (err) {
    console.error('state:', err);
    send(res, 503, { error: 'The crew is reconnecting.' });
  }
}
