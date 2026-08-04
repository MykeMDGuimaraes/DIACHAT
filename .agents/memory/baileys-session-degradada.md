---
name: Sessão Baileys degradada
description: Como reconhecer uma sessão WhatsApp/Baileys degradada no lado do servidor e o que fazer
---

Padrão observado (03/08/2026, sessão "testemvp" no dev): o socket abre rápido e parece saudável, envios são aceitos pelo socket (comando vira `sent`) mas o servidor do WhatsApp não devolve nem o ack de servidor — `Messages.ack` fica 0 para sempre. Confirmado em 04/08: re-parear o canal resolveu (acks 3/4 voltaram imediatamente) — era a sessão vinculada corrompida, não limitação da conta.

**Why:** a conta/sessão fica nesse estado depois de abusos de conexão (no caso, dezenas de sockets simultâneos por boot com canais fixture gerando tempestade de QR). Não é bug de código — o envio local "funciona", mas o WhatsApp não processa. Horas antes a mesma sessão recebia ack=2 normalmente.

**How to apply:** o sinal decisivo é **ack=0 persistente** — não o timeout de init queries: `executeInitQueries` → `fetchProps` estoura "Timed Out" ~60s após cada `open` MESMO com sessão saudável recém-pareada (ruído benigno desta versão do Baileys). Se ack=0 persiste por vários envios, não caçar bug no fluxo de envio — mandar re-parear o canal (desconectar, limpar credencial em `Whatsapps.session`, escanear QR de novo pela tela de conexões). O watchdog de confirmação de entrega (DELIVERY_UNCONFIRMED, 5min) é o safety net que denuncia esse estado em vez de deixar "enviado" falso. Cuidado operacional: cada clique em "conectar" inicia um socket NOVO sem derrubar o anterior — clicar de novo com a sessão viva gera QR desnecessário, limpa a credencial e deixa `Whatsapps.status` desatualizado (DISCONNECTED) enquanto um socket fantasma continua enviando; após mexer no canal, reiniciar o backend para normalizar para um único socket.
