# Subir o Únific+ no domínio próprio (VPS Hostinger + registro.br)

Guia para publicar em `unificrastreios.com.br` usando a VPS da Hostinger.

> **Antes de tudo:** rode a migration `20260818120000_notificacoes_completas.sql`
> no SQL Editor do Supabase. Sem ela, as notificações novas chegam mas não têm
> onde ser gravadas.

---

## 1. Descobrir o IP da VPS

No painel da Hostinger: **VPS → Visão geral**. Anote o **endereço IPv4**
(algo como `123.45.67.89`). É o único dado que você precisa de lá por enquanto.

---

## 2. Apontar o domínio (registro.br)

Entre em [registro.br](https://registro.br) → seu domínio → **Editar zona DNS**.

Crie dois registros do tipo **A**:

| Tipo | Nome (host) | Valor            | TTL  |
|------|-------------|------------------|------|
| A    | `@`         | IP da VPS        | 3600 |
| A    | `www`       | IP da VPS        | 3600 |

Salve. A propagação costuma levar de 15 minutos a algumas horas. Para conferir:

```bash
nslookup unificrastreios.com.br
```

Quando responder com o IP da VPS, siga adiante. **Não continue antes disso** — o
certificado HTTPS do passo 6 falha se o DNS ainda não tiver propagado.

---

## 3. Preparar a VPS

Conecte por SSH (Ubuntu 22.04 ou 24.04):

```bash
ssh root@SEU_IP_AQUI
```

Instale o que a aplicação precisa:

```bash
apt update && apt upgrade -y
```

Node.js 22 (a versão que o projeto usa):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs git nginx
```

Confira:

```bash
node -v
```

---

## 4. Instalar a aplicação

```bash
mkdir -p /var/www && cd /var/www
```

Envie o projeto para a VPS. Se ele estiver num repositório Git:

```bash
git clone SEU_REPOSITORIO_AQUI unific
```

Sem repositório, use `scp` a partir do seu Windows (rodando no PowerShell da sua
máquina, **não** na VPS):

```bash
scp -r C:\Users\Cliente\Downloads\Unify-Tracker root@SEU_IP_AQUI:/var/www/unific
```

Na VPS, instale as dependências:

```bash
cd /var/www/unific && npm install
```

### O arquivo `.env`

Crie `/var/www/unific/.env` com os mesmos valores do seu `.env` local, **mudando
estas três linhas** para o domínio real:

```
APP_URL=https://unificrastreios.com.br
ML_REDIRECT_URI=https://unificrastreios.com.br/api/public/ml/callback
```

> O `.env` **não pode ter BOM**. Se você copiar do Windows, salve como UTF-8
> simples — com BOM, a primeira variável é lida errada e o OAuth quebra sem
> mensagem de erro.

Proteja o arquivo (ele tem o `SUPABASE_SERVICE_ROLE_KEY` e o `ML_CLIENT_SECRET`):

```bash
chmod 600 /var/www/unific/.env
```

### Compilar

O projeto é configurado por padrão para Cloudflare Workers. Numa VPS ele precisa
do preset **node-server**, que gera um servidor Node comum:

```bash
cd /var/www/unific && NITRO_PRESET=node-server npm run build
```

Isso cria `.output/server/index.mjs`. Teste na mão antes de seguir:

```bash
cd /var/www/unific && PORT=3000 node .output/server/index.mjs
```

Se subir sem erro, encerre com `Ctrl+C`.

---

## 5. Deixar rodando sozinho (systemd)

Crie o serviço:

```bash
nano /etc/systemd/system/unific.service
```

Conteúdo:

```ini
[Unit]
Description=Unific+ (TanStack Start)
After=network.target

[Service]
Type=simple
WorkingDirectory=/var/www/unific
EnvironmentFile=/var/www/unific/.env
Environment=NODE_ENV=production
Environment=PORT=3000
ExecStart=/usr/bin/node /var/www/unific/.output/server/index.mjs
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
```

Ative:

```bash
systemctl daemon-reload && systemctl enable --now unific && systemctl status unific
```

Para ver os logs depois:

```bash
journalctl -u unific -f
```

---

## 6. Nginx + HTTPS

Crie a configuração do site:

```bash
nano /etc/nginx/sites-available/unific
```

Conteúdo:

```nginx
server {
    listen 80;
    server_name unificrastreios.com.br www.unificrastreios.com.br;

    # O webhook do Mercado Livre manda POST com corpo pequeno, mas as
    # sincronizações podem demorar — daí os timeouts folgados.
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }
}
```

Habilite e recarregue:

```bash
ln -sf /etc/nginx/sites-available/unific /etc/nginx/sites-enabled/unific && rm -f /etc/nginx/sites-enabled/default && nginx -t && systemctl reload nginx
```

Certificado HTTPS gratuito (Let's Encrypt):

```bash
apt install -y certbot python3-certbot-nginx && certbot --nginx -d unificrastreios.com.br -d www.unificrastreios.com.br
```

O certbot já configura a renovação automática e o redirecionamento de HTTP para
HTTPS. Abra `https://unificrastreios.com.br` para conferir.

### Firewall

```bash
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw --force enable
```

---

## 7. Atualizar o aplicativo no Mercado Livre

No painel de desenvolvedores do ML, no seu aplicativo:

| Campo | Valor |
|---|---|
| **Redirect URI** | `https://unificrastreios.com.br/api/public/ml/callback` |
| **URL de notificações (webhook)** | `https://unificrastreios.com.br/api/public/ml/webhook` |

A Redirect URI precisa ser **idêntica** à do `.env` — um `/` a mais e o ML
recusa a autorização.

Depois de salvar, marque os tópicos de notificação. Com esta versão, **todos**
os tópicos do painel já têm tratamento — pode marcar à vontade.

Teste o webhook:

```bash
curl -i https://unificrastreios.com.br/api/public/ml/webhook
```

Deve responder `200 ok`.

> As contas já conectadas continuam funcionando: o `refresh_token` não depende
> do domínio. Mas quem for conectar **depois** da troca precisa passar pela nova
> Redirect URI — por isso ela tem que estar cadastrada antes de anunciar o site.

---

## 8. Atualizar a aplicação no futuro

```bash
cd /var/www/unific && git pull && npm install && NITRO_PRESET=node-server npm run build && systemctl restart unific
```

---

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| `502 Bad Gateway` | O serviço caiu. Veja `journalctl -u unific -n 50`. |
| OAuth volta com erro `invalid_redirect_uri` | A URI do `.env` e a do painel do ML estão diferentes. |
| Variáveis do `.env` "vazias" | O arquivo foi salvo com BOM. Regrave como UTF-8 simples. |
| Certbot falha | O DNS ainda não propagou. Confira com `nslookup` e tente de novo. |
| Webhook responde 200 mas nada é gravado | A migration nova não foi rodada no Supabase. |
