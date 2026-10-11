import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import handler from './checkout-api.mjs';
const types = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/styles.css': ['styles.css', 'text/css; charset=utf-8'], '/logo.png': ['logo.png', 'image/png'], '/pix-icon.png': ['pix-icon.png', 'image/png'], '/nunito.woff2': ['nunito.woff2', 'font/woff2'] };
createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path.startsWith('/api/')) return handler(req, res);
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'; connect-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (!types[path] || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(404); return res.end('Não encontrado'); }
  try { const [file, type] = types[path]; const bytes = await readFile(new URL(`public/${file}`, import.meta.url)); res.setHeader('Content-Type', type); res.end(req.method === 'HEAD' ? undefined : bytes); }
  catch { res.writeHead(500); res.end('Recurso indisponível'); }
}).listen(Number(process.env.PORT || 3000), '127.0.0.1', () => console.log('Checkout disponível em http://localhost:' + (process.env.PORT || 3000)));
