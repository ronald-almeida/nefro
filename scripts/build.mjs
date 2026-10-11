import { cp, mkdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
for (const file of ['server.mjs', 'lib.mjs', 'checkout-api.mjs', 'api/pix.mjs', 'api/status.mjs', 'public/app.js']) execFileSync(process.execPath, ['--check', file]);
await readFile('public/nunito.woff2');
await readFile('public/logo.png');
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });
console.log('Build concluído: recursos públicos em dist; execute server.mjs para servir o checkout e a API.');
