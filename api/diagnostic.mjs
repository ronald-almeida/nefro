import { createHash, timingSafeEqual } from 'node:crypto';
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const expected = process.env.PIX_DIAGNOSTIC_TOKEN;
  const provided = String(req.headers.authorization || '').replace(/^Bearer /, '');
  if (!expected || !timingSafeEqual(createHash('sha256').update(provided).digest(), createHash('sha256').update(expected).digest())) { res.statusCode = 404; return res.end(); }
  try {
    const response = await fetch('https://api.blackcatoficial.com/api/sales/TRX1791699816701UXN74/status', { headers: { 'X-API-Key': process.env.BLACKCAT_API_KEY }, signal: AbortSignal.timeout(18000) });
    const result = await response.json();
    function shape(value, depth = 0) {
      if (value === null) return 'null';
      if (depth > 4) return typeof value;
      if (Array.isArray(value)) return ['array', value.length];
      if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, shape(val, depth + 1)]));
      return typeof value;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ httpStatus: response.status, shape: shape(result), amount: result.data?.amount, paymentMethod: result.data?.paymentMethod, status: result.data?.status }));
  } catch { res.statusCode = 502; res.end('Diagnostic lookup failed'); }
}

