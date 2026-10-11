# Checkout NefroPós — Pix

Checkout responsivo baseado nas referências fornecidas, logo original e fonte Nunito servida localmente. Pagamento único de **R$ 497,70**, exclusivamente Pix. Sem banco de dados e sem dependências de execução externas ao Node.js.

## Executar e verificar

Node.js 24 recomendado (mínimo 22).

```sh
npm test
npm run build
npm run dev
```

Abra http://localhost:3000. Sem credenciais o formulário aparece, mas a geração retorna indisponibilidade. Para integração local, copie `.env.example` para `.env` e preencha os valores apenas no seu computador. Não envie segredos por chat e não faça commit do arquivo.

## Deploy na Vercel

1. Importe `ronald-almeida/nefro` na equipe desejada. Framework: **Other**. Diretório raiz: raiz do repositório. Node.js: **24.x**.
2. `vercel.json` já define o build (`npm run build`), saída estática (`dist`) e funções Node nas rotas `/api/pix` e `/api/status`.
3. Em Settings → Environment Variables, cadastre:

| Nome | Tipo | Valor |
| --- | --- | --- |
| `BLACKCAT_API_KEY` | Secret | Chave obtida no painel BlackCat |
| `SESSION_SECRET` | Secret | Valor aleatório de pelo menos 32 caracteres |
| `APP_ORIGIN` | Config | URL HTTPS exata do checkout, sem barra final |

Gere `SESSION_SECRET` no seu computador com `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` e cadastre diretamente na Vercel. Mantenha o valor estável entre deploys para não invalidar as consultas de Pix existentes. Não use prefixos públicos nas credenciais.

Em Preview, não copie a chave de produção sem intenção explícita de gerar cobranças reais. Sem `APP_ORIGIN`, a API aceita a URL única `https://${VERCEL_URL}` do deployment. Para domínio próprio/alias estável, configure `APP_ORIGIN` naquele ambiente e faça novo deploy. Use a URL configurada ao testar.

4. Faça o deploy. Abra o checkout no domínio configurado e confira as rotas e os recursos.
5. Com a chave configurada e dados de um comprador autorizado, gere uma cobrança e confira R$ 497,70, recebedor, QR e copia-e-cola no banco. Efetue pagamento somente se autorizado. Aguarde a consulta retornar `PAID`. Não simule confirmação em produção.

Não foi realizado deploy nem pagamento real na implementação inicial: faltam a chave BlackCat e a configuração do projeto Vercel.

## Integração

Documentação: https://docs.blackcatoficial.com/

- O servidor usa `X-API-Key` e `POST /sales/create-sale` com `amount: 49770`, `paymentMethod: "pix"`, item digital, dados do aluno e endereço.
- O valor e o item são definidos no servidor; alterações enviadas pelo navegador são ignoradas.
- QR PNG e copia-e-cola vêm de `paymentData`. Se o gateway omitir uma imagem PNG válida, permanece disponível o copia-e-cola. O sistema não envia os dados do Pix a serviços externos para gerar imagem.
- A criação nunca confirma pagamento. Somente `GET /sales/{transactionId}/status`, chamado pelo servidor e validado quanto a ID, método, valor e status, pode confirmar `PAID`.
- O navegador consulta a cada 10 segundos enquanto a aba está visível, por até 120 consultas. Também há botão para consulta manual. Expiração local oculta o código, mas não é tratada como confirmação/cancelamento do gateway.
- `PENDING`, `PAID`, `CANCELLED` e `REFUNDED` têm apresentação própria. Um novo Pix só é oferecido após cancelamento confirmado.
- A consulta exige um token HMAC válido por sete dias; conhecer apenas o ID não permite consultar pela API deste checkout.

## Sem banco de dados

Os dados pessoais são enviados ao processador e não são persistidos nem registrados em logs pela aplicação. O código Pix e o token de consulta ficam no `sessionStorage` da aba para permitir recarregamento. Nenhum status salvo localmente é usado como comprovação de pagamento. Fechar a aba/limpar o armazenamento pode perder essa retomada; a NefroPós pode consultar a transação no painel BlackCat. O gateway mantém seus próprios registros.

Timeouts e respostas ambíguas na criação bloqueiam nova tentativa automática nessa aba, inclusive após recarregar, e orientam contato com a NefroPós. A documentação consultada não especifica garantia de idempotência para `externalRef`; portanto não se promete deduplicação entre abas, dispositivos ou funções concorrentes. Não há entrega automática de curso nem webhook de matrícula neste escopo.

O limite de requisições em memória é uma proteção local por instância, não um limite global. Configure a proteção/rate limit da Vercel para `/api/pix` antes de divulgar o checkout em campanhas. Não use memória de função como registro de pagamentos.

## Verificação

`npm test` cobre validação, valor fixo, autenticação/assinatura de consultas, erros, timeout, status incompatíveis e fluxo HTTP usando um gateway simulado. Nenhuma cobrança é feita pelos testes. O build verifica sintaxe e copia somente recursos públicos para `dist`; segredos e arquivos do servidor não entram no diretório público.

Verificação adicional de navegador realizada em larguras de 320, 390, 560, 768 e 1366 px: fonte, formulário, indisponibilidade sem credenciais, geração simulada, proteção contra duplo clique, cópia, retomada, estados de pagamento e bloqueio após resposta ambígua.

Antes da divulgação, confirme os contatos comerciais reproduzidos das imagens. As referências não forneceram URLs de termos ou privacidade, por isso não foram inventados links nem reproduzida a afirmação de processamento pela plataforma antiga (Voomp).

Fonte Nunito: Google Fonts, licença SIL OFL em `public/NUNITO-LICENSE.txt`. Logo fornecido pelo usuário.
