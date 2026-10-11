import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';

export const AMOUNT = 49770;
export const API_BASE = 'https://api.blackcatoficial.com/api';
export class CheckoutError extends Error {
  constructor(status, message, code = 'ERROR') { super(message); this.status = status; this.code = code; }
}
const digits = value => String(value ?? '').replace(/\D/g, '');
export function validCPF(value) {
  const cpf = digits(value);
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  for (let size = 9; size < 11; size++) {
    const sum = [...cpf.slice(0, size)].reduce((sum, n, i) => sum + Number(n) * (size + 1 - i), 0);
    const check = (sum * 10) % 11;
    if (Number(cpf[size]) !== (check === 10 ? 0 : check)) return false;
  }
  return true;
}
export function salePayload(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CheckoutError(400, 'Confira os dados do formulário.');
  const take = (key, max, optional = false) => {
    const value = typeof input[key] === 'string' ? input[key].trim() : '';
    if ((!optional && !value) || value.length > max) throw new CheckoutError(400, 'Preencha corretamente todos os campos obrigatórios.');
    return value;
  };
  const name = take('name', 120), email = take('email', 160);
  const phone = digits(take('phone', 20)), cpf = digits(take('cpf', 14)), zipCode = digits(take('zipCode', 9));
  if (name.split(/\s+/).length < 2 || name.length < 5) throw new CheckoutError(400, 'Informe o nome completo do aluno.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new CheckoutError(400, 'Informe um e-mail válido.');
  if (!/^\d{10,11}$/.test(phone)) throw new CheckoutError(400, 'Informe o telefone com DDD.');
  if (!validCPF(cpf)) throw new CheckoutError(400, 'Informe um CPF válido.');
  if (!/^\d{8}$/.test(zipCode)) throw new CheckoutError(400, 'Informe um CEP com 8 dígitos.');
  const state = take('state', 2);
  if (!'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ').includes(state)) throw new CheckoutError(400, 'Selecione um estado válido.');
  return {
    amount: AMOUNT, currency: 'BRL', paymentMethod: 'pix',
    items: [{ title: 'NefroPós', unitPrice: AMOUNT, quantity: 1, tangible: false }],
    customer: { name, email, phone, document: { number: cpf, type: 'cpf' } },
    shipping: { name, zipCode, street: take('street', 160), number: take('number', 20), city: take('city', 100), neighborhood: take('neighborhood', 100), complement: take('complement', 100, true), state },
    pix: { expiresInDays: 1 }, externalRef: `NEFRO-${randomUUID()}`
  };
}
export function signTransaction(transactionId, secret, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ id: transactionId, exp: now + 7 * 86400000 })).toString('base64url');
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}
export function verifyTransaction(token, secret, now = Date.now()) {
  try {
    if (typeof token !== 'string' || token.length > 1500) throw new Error();
    const [body, signature, extra] = token.split('.');
    if (!body || !signature || extra) throw new Error();
    const expected = createHmac('sha256', secret).update(body).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error();
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (typeof payload.id !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(payload.id) || !Number.isFinite(payload.exp) || payload.exp < now) throw new Error();
    return payload.id;
  } catch { throw new CheckoutError(401, 'Esta sessão de consulta expirou. Entre em contato com a NefroPós para verificar o pagamento.', 'SESSION_EXPIRED'); }
}
export async function gateway(path, { apiKey, payload, fetcher = fetch }) {
  let response;
  try {
    response = await fetcher(`${API_BASE}${path}`, {
      method: payload ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      ...(payload ? { body: JSON.stringify(payload) } : {}), signal: AbortSignal.timeout(18000), redirect: 'error'
    });
  } catch { throw new CheckoutError(502, payload ? 'Não foi possível obter a resposta da cobrança. Não gere outro Pix: consulte a NefroPós antes de tentar novamente.' : 'Não foi possível consultar o pagamento. Tente verificar novamente.', payload ? 'CREATION_UNCERTAIN' : 'STATUS_UNAVAILABLE'); }
  if (!response.ok) {
    if (payload && [400, 422].includes(response.status)) throw new CheckoutError(400, 'O processador recusou os dados. Confira o formulário e tente novamente.', 'VALIDATION');
    if ([401, 403].includes(response.status)) throw new CheckoutError(503, 'Pagamento temporariamente indisponível. Entre em contato com a NefroPós.', 'CONFIGURATION');
    if (response.status === 429) throw new CheckoutError(429, 'Muitas solicitações. Aguarde um minuto antes de tentar novamente.', 'RATE_LIMIT');
    throw new CheckoutError(502, payload ? 'O resultado da cobrança não pôde ser verificado. Consulte a NefroPós antes de gerar outro Pix.' : 'Não foi possível consultar o pagamento. Tente novamente.', payload ? 'CREATION_UNCERTAIN' : 'STATUS_UNAVAILABLE');
  }
  let result;
  try { result = await response.json(); } catch { /* Handle malformed success responses as uncertain, never retry a charge. */ }
  if (!result?.success || !result.data) throw new CheckoutError(502, 'O processador retornou uma resposta inesperada. Entre em contato com a NefroPós.', payload ? 'CREATION_UNCERTAIN' : 'STATUS_UNAVAILABLE');
  return result.data;
}
export function verifySale(data, expectedId) {
  if (!data || typeof data.transactionId !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(data.transactionId) || (expectedId && data.transactionId !== expectedId) || data.amount !== AMOUNT || String(data.paymentMethod).toLowerCase() !== 'pix') {
    throw new CheckoutError(502, 'Não foi possível validar os dados da transação. Entre em contato com a NefroPós.', expectedId ? 'STATUS_UNAVAILABLE' : 'CREATION_UNCERTAIN');
  }
}
