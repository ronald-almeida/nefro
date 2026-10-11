const $ = id => document.getElementById(id);
const form = $('checkout-form');
const storageKey = 'nefropos-pix-v1';
let payment = null, busy = false, timer = null, checks = 0, creating = false;
function save(value) { try { sessionStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* Checkout still works with storage disabled. */ } }
function showError(message) { for (const id of ['error', 'payment-error']) { $(id).textContent = message || ''; $(id).hidden = !message; } }
function locked(message) { $('generate').disabled = true; showError(message); }
async function request(path, body) {
  let response;
  try { response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(path === '/api/pix' ? 75000 : 25000) }); }
  catch { const error = new Error('Não foi possível obter a resposta. Verifique sua conexão.'); error.code = 'NETWORK'; throw error; }
  let data;
  try { data = await response.json(); } catch { const error = new Error('Resposta inesperada do serviço.'); error.code = 'NETWORK'; throw error; }
  if (!response.ok) { const error = new Error(data.error || 'Serviço indisponível.'); error.code = data.code; throw error; }
  return data;
}
function stopPolling() { clearTimeout(timer); timer = null; }
function schedule() {
  stopPolling();
  if (payment && !payment.final && !document.hidden && checks < 120) timer = setTimeout(checkStatus, 10000);
}
function showPayment(data) {
  payment = data;
  form.hidden = true;
  $('pix-result').hidden = false;
  if (!$('pix-result').open) $('pix-result').showModal();
  $('pix-result').focus();
  $('pix-code').value = data.copyPaste || '';
  $('qr-code').hidden = !data.qrCodeBase64;
  if (data.qrCodeBase64) $('qr-code').src = data.qrCodeBase64;
  $('payment-instructions').hidden = !data.copyPaste;
  $('payment-data-message').hidden = Boolean(data.copyPaste);
  $('payment-data-message').textContent = 'Sua cobrança foi criada. Os dados do Pix ainda não foram disponibilizados. Não gere outra cobrança; entre em contato com a NefroPós.';
  $('gateway-invoice').hidden = !data.invoiceUrl;
  if (data.invoiceUrl) $('gateway-invoice').href = data.invoiceUrl;
  $('check-status').hidden = false;
  $('new-payment').hidden = true;
  $('payment-status').className = '';
  $('payment-status').textContent = 'Aguardando confirmação do pagamento';
  $('expiry').textContent = data.expiresAt ? `Válido até ${new Date(data.expiresAt).toLocaleString('pt-BR')}.` : '';
  if (data.expiresAt && Date.parse(data.expiresAt) <= Date.now()) {
    $('payment-instructions').hidden = true;
    $('payment-status').textContent = 'Prazo do Pix encerrado. Verifique o status antes de realizar outro pagamento.';
  }
  checkStatus();
}
async function checkStatus() {
  if (!payment || busy) return;
  busy = true; checks++;
  $('check-status').disabled = true;
  showError('');
  try {
    const data = await request('/api/status', { token: payment.token });
    if (data.payment?.copyPaste && !payment.copyPaste) {
      Object.assign(payment, data.payment); save(payment);
      $('pix-code').value = payment.copyPaste;
      $('qr-code').hidden = !payment.qrCodeBase64;
      if (payment.qrCodeBase64) $('qr-code').src = payment.qrCodeBase64;
      $('expiry').textContent = payment.expiresAt ? `Válido até ${new Date(payment.expiresAt).toLocaleString('pt-BR')}.` : '';
    }
    const messages = { PENDING: 'Aguardando pagamento', PAID: 'Pagamento confirmado pela BlackCat', CANCELLED: 'Pix cancelado ou expirado', REFUNDED: 'Pagamento estornado' };
    $('payment-status').textContent = messages[data.status];
    payment.final = data.status !== 'PENDING';
    $('payment-status').className = data.status === 'PAID' ? 'paid' : '';
    const expired = Boolean(payment.expiresAt) && Date.parse(payment.expiresAt) <= Date.now();
    $('payment-instructions').hidden = payment.final || expired || !payment.copyPaste;
    $('payment-data-message').hidden = payment.final || Boolean(payment.copyPaste);
    $('gateway-invoice').hidden = payment.final || expired || !payment.invoiceUrl;
    if (expired && data.status === 'PENDING') $('payment-status').textContent = 'Prazo do Pix encerrado; o processador ainda informa pagamento pendente. Consulte a NefroPós antes de pagar novamente.';
    $('new-payment').hidden = data.status !== 'CANCELLED';
    $('check-status').hidden = data.status === 'CANCELLED';
    if (payment.final || expired) stopPolling();
    else schedule();
  } catch (error) {
    showError(error.message);
    if (error.code !== 'SESSION_EXPIRED') schedule();
  } finally { busy = false; $('check-status').disabled = false; }
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (creating || payment || !form.reportValidity()) return;
  creating = true;
  showError('');
  $('generate').disabled = true;
  $('generate').textContent = 'Gerando seu Pix…';
  save({ uncertain: true });
  let created = null;
  try {
    created = await request('/api/pix', Object.fromEntries(new FormData(form)));
    save(created); creating = false;
  } catch (error) {
    if (['NETWORK', 'CREATION_UNCERTAIN', 'INTERNAL'].includes(error.code)) {
      locked('Não foi possível determinar se o Pix foi gerado. Para evitar uma cobrança duplicada, entre em contato com a NefroPós: (17) 99705-4009.');
    } else { creating = false; save(null); $('generate').disabled = false; showError(error.message); }
  } finally { $('generate').textContent = 'Gerar Pix'; }
  // Rendering failures must never overwrite a successful gateway response.
  if (created) {
    try { showPayment(created); }
    catch { payment = created; form.hidden = true; $('reopen-payment').hidden = false; showError('Sua cobrança foi criada. Clique em Ver meu Pix para exibi-la novamente.'); }
  }
});
$('copy-pix').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('pix-code').value); $('copy-feedback').textContent = 'Código Pix copiado! Cole no aplicativo do seu banco.'; }
  catch { $('pix-code').focus(); $('pix-code').select(); $('copy-feedback').textContent = 'Selecione e copie o código acima para usar no aplicativo do seu banco.'; }
});
$('check-status').addEventListener('click', () => { checks = 0; checkStatus(); });
$('close-payment').addEventListener('click', () => $('pix-result').close());
$('pix-result').addEventListener('close', () => { $('reopen-payment').hidden = !payment; });
$('reopen-payment').addEventListener('click', () => { if (payment) showPayment(payment); });
$('new-payment').addEventListener('click', () => { stopPolling(); payment = null; save(null); form.hidden = false; $('pix-result').close(); $('pix-result').hidden = true; $('reopen-payment').hidden = true; $('generate').disabled = false; showError(''); $('generate').focus(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) stopPolling(); else schedule(); });
const digitMask = (name, mask) => form.elements[name].addEventListener('input', event => { event.target.value = mask(event.target.value.replace(/\D/g, '')); });
digitMask('cpf', value => value.slice(0, 11).replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2'));
digitMask('zipCode', value => value.slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2'));
digitMask('phone', value => value.slice(0, 11).replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{4,5})(\d{4})$/, '$1-$2'));
try {
  const saved = JSON.parse(sessionStorage.getItem(storageKey));
  if (saved?.uncertain) { creating = true; locked('Uma solicitação anterior não foi concluída neste navegador. Consulte a NefroPós antes de gerar outro Pix: (17) 99705-4009.'); }
  else if (saved?.token && saved?.transactionId) showPayment(saved);
} catch { /* Ignore unavailable storage. Never infer a payment status from stored data. */ }

