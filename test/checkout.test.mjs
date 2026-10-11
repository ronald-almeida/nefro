import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { AMOUNT, salePayload, validCPF, signTransaction, verifyTransaction, gateway } from '../lib.mjs';
import { createHandler } from '../checkout-api.mjs';

const input = { name: 'Aluno de Teste', email: 'aluno@example.com', phone: '(11) 99999-9999', cpf: '529.982.247-25', zipCode: '01001-000', street: 'Praça da Sé', number: '1', city: 'São Paulo', neighborhood: 'Sé', complement: '', state: 'SP' };
const secret = 'test-only-secret-with-at-least-32-characters';
const env = { BLACKCAT_API_KEY: 'test-only-key', SESSION_SECRET: secret, APP_ORIGIN: 'https://checkout.example.com', VERCEL: '1' };
const transaction = { transactionId: 'TXN-TEST-001', amount: AMOUNT, paymentMethod: 'pix', status: 'PENDING', paymentData: { copyPaste: '000201TEST-ONLY-NOT-PAYABLE', qrCodeBase64: 'data:image/png;base64,aGVsbG8=', expiresAt: new Date(Date.now() + 86400000).toISOString() } };
const reply = data => new Response(JSON.stringify({ success: true, data }), { status: 200 });
async function api(path, body, options = {}) {
  const req = { url: path, method: options.method || 'POST', headers: { origin: env.APP_ORIGIN, 'content-type': 'application/json', 'x-forwarded-for': randomUUID(), ...options.headers }, body };
  let result;
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(text) { result = { status: this.statusCode, body: JSON.parse(text), headers: this.headers }; } };
  await createHandler({ env: options.env || env, fetcher: options.fetcher || (() => reply(transaction)) })(req, res);
  return result;
}
test('CPF: validates check digits and rejects repeated/invalid values', () => {
  assert.equal(validCPF(input.cpf), true);
  for (const value of ['11111111111', '52998224724', '', '123']) assert.equal(validCPF(value), false);
});
test('server fixes amount, payment method and line item despite manipulated input', () => {
  const sale = salePayload({ ...input, amount: 1, paymentMethod: 'credit_card', items: [] });
  assert.equal(sale.amount, 49770); assert.equal(sale.items[0].unitPrice, 49770);
  assert.equal(sale.paymentMethod, 'pix'); assert.equal(sale.items[0].tangible, false);
  assert.equal(sale.customer.document.number, '52998224725'); assert.equal(sale.shipping.zipCode, '01001000');
});
test('invalid form fields are rejected before calling gateway', async () => {
  for (const patch of [{ cpf: '123' }, { email: 'bad' }, { state: 'XX' }, { name: 'A' }, { phone: '123' }, { zipCode: '123' }, { street: '' }]) {
    const result = await api('/api/pix', { ...input, ...patch }, { fetcher: () => { throw new Error('Must not call'); } });
    assert.equal(result.status, 400);
  }
});
test('signed transaction token rejects modifications and expiration', () => {
  const token = signTransaction('TXN-1', secret, 1000);
  assert.equal(verifyTransaction(token, secret, 2000), 'TXN-1');
  assert.throws(() => verifyTransaction(token + 'bad', secret, 2000));
  assert.throws(() => verifyTransaction(token, 'wrong-secret', 2000));
  assert.throws(() => verifyTransaction(token, secret, 8 * 86400000));
});
test('creation returns QR and copy code, never confirms even if creation says PAID', async () => {
  const result = await api('/api/pix', input, { fetcher: (url, options) => {
    assert.equal(url, 'https://api.blackcatoficial.com/api/sales/create-sale');
    assert.equal(options.headers['X-API-Key'], env.BLACKCAT_API_KEY);
    assert.equal(JSON.parse(options.body).amount, AMOUNT);
    return reply({ ...transaction, status: 'PAID' });
  } });
  assert.equal(result.status, 201); assert.equal(result.body.status, 'PENDING');
  assert.ok(result.body.qrCodeBase64); assert.equal(result.body.copyPaste, transaction.paymentData.copyPaste);
  assert.equal(JSON.stringify(result.body).includes(env.BLACKCAT_API_KEY), false);
  assert.equal(result.headers['Cache-Control'], 'no-store, private');
});
test('all payment statuses come from authenticated gateway lookup', async () => {
  for (const status of ['PENDING', 'PAID', 'CANCELLED', 'REFUNDED']) {
    const result = await api('/api/status', { token: signTransaction(transaction.transactionId, secret) }, { fetcher: (url, options) => {
      assert.ok(url.endsWith('/sales/TXN-TEST-001/status')); assert.equal(options.method, 'GET');
      return reply({ ...transaction, status });
    } });
    assert.equal(result.body.status, status);
  }
});
test('mismatched amount, method, transaction or unknown status never confirms payment', async () => {
  for (const patch of [{ amount: 1 }, { paymentMethod: 'card' }, { transactionId: 'TXN-OTHER' }, { status: 'APPROVED' }]) {
    const result = await api('/api/status', { token: signTransaction(transaction.transactionId, secret) }, { fetcher: () => reply({ ...transaction, status: 'PAID', ...patch }) });
    assert.equal(result.status, 502); assert.equal(result.body.status, undefined);
  }
});
test('missing credentials, cross origin, wrong method and invalid token fail closed', async () => {
  assert.equal((await api('/api/pix', input, { env: { ...env, BLACKCAT_API_KEY: '' } })).status, 503);
  assert.equal((await api('/api/pix', input, { headers: { origin: 'https://other.example.com' } })).status, 403);
  assert.equal((await api('/api/pix', input, { method: 'GET' })).status, 405);
  assert.equal((await api('/api/status', { token: 'forged' })).status, 401);
});
test('timeouts, upstream 500 and malformed success are uncertain and never retried', async () => {
  for (const response of [() => { throw new Error('timeout'); }, () => new Response('{}', { status: 500 }), () => new Response('not json'), () => reply({ ...transaction, paymentData: {} })]) {
    let count = 0;
    const result = await api('/api/pix', input, { fetcher: () => { count++; return response(); } });
    assert.equal(result.status, 502); assert.equal(result.body.code, 'CREATION_UNCERTAIN'); assert.equal(count, 1);
  }
});
test('upstream errors are sanitized without leaking provider response or secrets', async () => {
  for (const [status, expected] of [[400, 400], [422, 400], [401, 503], [403, 503], [429, 429]]) {
    const result = await api('/api/pix', input, { fetcher: () => new Response('sensitive provider response', { status }) });
    assert.equal(result.status, expected); assert.ok(!JSON.stringify(result).includes('sensitive provider'));
  }
});
test('missing QR image still offers provider copy code; arbitrary image URLs are not forwarded', async () => {
  const result = await api('/api/pix', input, { fetcher: () => reply({ ...transaction, paymentData: { ...transaction.paymentData, qrCodeBase64: 'https://untrusted.example/image' } }) });
  assert.equal(result.status, 201); assert.equal(result.body.qrCodeBase64, null); assert.ok(result.body.copyPaste);
});
test('HTTP flow: form JSON -> handler -> mock gateway -> signed status lookup', async t => {
  let calls = 0;
  const server = createServer(createHandler({ env: { ...env, VERCEL: '' }, fetcher: () => { calls++; return reply({ ...transaction, status: calls === 1 ? 'PENDING' : 'PAID' }); } }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (path, data) => fetch(origin + path, { method: 'POST', headers: { origin: env.APP_ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify(data) });
  const created = await post('/api/pix', input); assert.equal(created.status, 201);
  const payment = await created.json();
  const response = await post('/api/status', { token: payment.token });
  assert.equal((await response.json()).status, 'PAID'); assert.equal(calls, 2);
});
