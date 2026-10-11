import { AMOUNT, CheckoutError, salePayload, gateway, verifyTransaction, verifySale, createdPayment } from './lib.mjs';

const limits = new Map();
function limit(key, maximum) {
  const now = Date.now();
  if (limits.size > 5000) for (const [k, v] of limits) if (v.until < now) limits.delete(k);
  const entry = limits.get(key);
  if (!entry || entry.until < now) { if (limits.size >= 10000) throw new CheckoutError(429, 'Serviço ocupado. Tente novamente em um minuto.'); limits.set(key, { count: 1, until: now + 60000 }); }
  else if (++entry.count > maximum) throw new CheckoutError(429, 'Muitas solicitações. Aguarde um minuto e tente novamente.', 'RATE_LIMIT');
}
async function jsonBody(req) {
  if (!String(req.headers['content-type']).toLowerCase().startsWith('application/json')) throw new CheckoutError(415, 'Formato de solicitação inválido.');
  if (Number(req.headers['content-length']) > 8192) throw new CheckoutError(413, 'Solicitação muito grande.');
  if (req.body !== undefined) {
    if (JSON.stringify(req.body).length > 8192) throw new CheckoutError(413, 'Solicitação muito grande.');
    try { return typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch { throw new CheckoutError(400, 'Solicitação inválida.'); }
  }
  let body = '';
  for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 8192) throw new CheckoutError(413, 'Solicitação muito grande.'); }
  try { return JSON.parse(body); } catch { throw new CheckoutError(400, 'Solicitação inválida.'); }
}
export function createHandler({ env = process.env, fetcher = fetch } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status, body) => { res.statusCode = status; res.end(JSON.stringify(body)); };
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (!['/api/pix', '/api/status'].includes(pathname)) throw new CheckoutError(404, 'Recurso não encontrado.');
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); throw new CheckoutError(405, 'Método não permitido.'); }
      const origin = env.APP_ORIGIN?.replace(/\/$/, '') || (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : 'http://localhost:3000');
      if (req.headers.origin !== origin || req.headers['sec-fetch-site'] === 'cross-site') throw new CheckoutError(403, 'Origem da solicitação não autorizada.');
      if (!env.BLACKCAT_API_KEY || !env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new CheckoutError(503, 'Pagamento temporariamente indisponível. Entre em contato com a NefroPós.', 'CONFIGURATION');
      const ip = env.VERCEL ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : req.socket?.remoteAddress || 'local';
      limit(`${pathname}:${ip}`, pathname === '/api/pix' ? 5 : 60);
      const input = await jsonBody(req);
      if (pathname === '/api/pix') {
        const data = await gateway('/sales/create-sale', { apiKey: env.BLACKCAT_API_KEY, payload: salePayload(input), fetcher });
        const payment = createdPayment(data, env.SESSION_SECRET);
        console.info(JSON.stringify({ event: 'pix_created', hasCode: Boolean(payment.copyPaste), hasImage: Boolean(payment.qrCodeBase64), hasExpiry: Boolean(payment.expiresAt), hasInvoice: Boolean(payment.invoiceUrl), amountType: typeof data.amount }));
        return send(201, payment);
      }
      const id = verifyTransaction(input?.token, env.SESSION_SECRET);
      const data = await gateway(`/sales/${encodeURIComponent(id)}/status`, { apiKey: env.BLACKCAT_API_KEY, fetcher });
      verifySale(data, id);
      if (!['PENDING', 'PAID', 'CANCELLED', 'REFUNDED'].includes(data.status)) throw new CheckoutError(502, 'O processador retornou um status desconhecido. Tente verificar novamente.', 'STATUS_UNAVAILABLE');
      const payment = data.paymentData ? createdPayment(data, env.SESSION_SECRET) : null;
      return send(200, { transactionId: id, status: data.status, amount: AMOUNT, ...(payment?.copyPaste ? { payment } : {}) });
    } catch (error) {
      const known = error instanceof CheckoutError;
      console.warn(JSON.stringify({ event: 'checkout_error', code: known ? error.code : 'INTERNAL', status: known ? error.status : 500 }));
      send(known ? error.status : 500, { error: known ? error.message : 'Ocorreu um erro inesperado. Entre em contato com a NefroPós.', code: known ? error.code : 'INTERNAL' });
    }
  };
}
export default createHandler();
