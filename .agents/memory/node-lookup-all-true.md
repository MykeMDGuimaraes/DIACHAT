---
name: Custom DNS lookup no Node >=18 (all:true)
description: https.request invoca lookup customizado com all=true esperando array; retornar endereço único quebra com "Invalid IP address: undefined"
---

Em Node >=18, `net`/`https.request` chama a função `lookup` customizada com `options.all = true` e espera **array** de `{address, family}` no callback. Se o callback devolve o formato antigo de endereço único `(null, address, family)`, o Node interpreta o resultado errado e a conexão falha com `Invalid IP address: undefined` — erro que não indica a causa real.

**Why:** o dispatcher de webhooks fixava o IP resolvido (anti-SSRF) com lookup customizado de endereço único; testes unitários com mocks passavam, mas toda entrega real falhava. Só apareceu no primeiro disparo E2E.

**How to apply:** ao escrever `lookup` customizado (ex.: pinning de IP validado), tratar `options.all`: se true, devolver o array completo de endereços validados; senão, o formato único. A tipagem TS do `LookupFunction` só cobre o formato único — o branch de array precisa de cast. Sempre validar integrações de rede com um disparo real, não só mocks.
