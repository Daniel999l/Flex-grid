export function send(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

export async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) throw new Error('body too large');
  }
  return raw ? JSON.parse(raw) : {};
}

export function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
}
