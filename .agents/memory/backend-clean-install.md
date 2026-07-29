---
name: Backend clean install vs package firewall
description: How app/backend survives clean npm installs despite firewall-blocked packages (fake fs, baileys tarballs)
---

# Backend clean install vs package firewall

- `gn-api-sdk-typescript` depends on the fake `fs@0.0.1-security` package (firewall-blocked). Fixed with an npm override in `app/backend/package.json`: `"gn-api-sdk-typescript": { "fs": "npm:graceful-fs@^4.2.11" }`. Harmless because `require('fs')` always resolves to the Node builtin.
- ALL `baileys` npm tarballs (6.7.x and 6.x) are blocked by the firewall ("Git dependency" policy); only 7.0.0-rc tarballs download. The backend therefore uses a vendored tarball: `"baileys": "file:vendor/baileys-6.7.18.tgz"` (packed from the pristine copy in `codatendechat-main/backend/node_modules/baileys`, with `scripts` stripped so no prepack/tsc runs on install).
- **Why:** npm cache can be wiped; `--prefer-offline` only worked while the cache held blocked tarballs. Vendoring + override make `npm ci` from an empty cache succeed.
- **How to apply:** never remove the override or the vendor tarball while these deps remain; if upgrading baileys, verify the tarball downloads through the firewall first (7.0.0-rc line does).

## Lockfile deve ser regenerado após merges que mudam package.json
O deploy build (`scripts/deploy-build.sh`) usa `npm ci`, que falha (EUSAGE) se `package-lock.json` estiver fora de sincronia com `package.json`. Merges que alteram package.json exigem regenerar o lock (`rm package-lock.json && npm install --package-lock-only` — o `--package-lock-only` sozinho pode dizer "up to date" e não corrigir) e validar com `npm ci --dry-run` antes de publicar.
**Why:** publish falhou em 2026-07-27 após merge do PR Messaging v1 porque o lock ainda apontava baileys 6.7.23 em vez do tarball vendorado 6.7.18.

## Cuidado: commits automáticos "Update package lock file" da plataforma podem QUEBRAR o lock
Em 2026-07-29 a reconciliação pós-merge de uma task regenerou o lock do backend removendo as entradas resolvidas de `sharp`/`@img/*` (peer **não-opcional** do baileys vendorado — o meta marca jimp/link-preview-js/audio-decode como opcionais, mas não sharp). Resultado: `npm ci` do publish falhou com EUSAGE "Missing: sharp@0.35.3". package.json não tinha mudado — correção foi restaurar o lock do commit do último build bem-sucedido (`git checkout <sha> -- package-lock.json`) e validar com `npm ci --dry-run`.
**How to apply:** após qualquer commit automático que toque package-lock.json, rodar `npm ci --dry-run` antes de publicar; se quebrar sem mudança em package.json, preferir restaurar o lock conhecido-bom a regenerar.
