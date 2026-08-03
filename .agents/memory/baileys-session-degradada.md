---
name: Sessão Baileys degradada
description: Como reconhecer uma sessão WhatsApp/Baileys degradada no lado do servidor e o que fazer
---

Padrão observado (03/08/2026, sessão "testemvp" no dev): o socket abre rápido e parece saudável, mas (1) a cada boot, ~60s após o `Connection Update open`, as init queries do Baileys (`executeInitQueries` → `fetchProps`) estouram "Timed Out", e (2) envios são aceitos pelo socket (comando vira `sent`) mas o servidor do WhatsApp não devolve nem o ack de servidor — `Messages.ack` fica 0 para sempre.

**Why:** a conta/sessão fica nesse estado depois de abusos de conexão (no caso, dezenas de sockets simultâneos por boot com canais fixture gerando tempestade de QR). Não é bug de código — o envio local "funciona", mas o WhatsApp não processa. Horas antes a mesma sessão recebia ack=2 normalmente.

**How to apply:** se envios ficam com ack=0 e o log mostra o timeout de init queries a cada boot, não caçar bug no fluxo de envio — mandar re-parear o canal (desconectar, limpar credencial em `Whatsapps.session`, escanear QR de novo pela tela de conexões). O watchdog de confirmação de entrega (DELIVERY_UNCONFIRMED, 5min) é o safety net que denuncia esse estado em vez de deixar "enviado" falso.
