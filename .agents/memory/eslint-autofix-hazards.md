---
name: ESLint --fix hazards no backend
description: Armadilhas conhecidas ao rodar eslint --fix em massa no backend TypeScript
---

Regras cujo auto-fix quebrou compilação/runtime neste backend:

- **import/no-duplicates** mesclou `import { Op } from "sequelize"` com `import { FindOptions } from "sequelize/types"` → runtime crash `ERR_PACKAGE_PATH_NOT_EXPORTED` (o subpath `/types` não é exportado). Imports de `sequelize/types` só são seguros quando 100% type-only (elididos pelo tsc).
- **dot-notation** converteu `obj["prop"]` → `obj.prop` em objetos tipados como `{}`/`object` (ex.: `flow.flow["nodes"]`) → erros TS2339. Regra desligada no `.eslintrc.json`; manter off.
- **prefer-destructuring** removeu anotações de tipo (`const nodes: INodes[] = ...` → `const { nodes } = ...`). Também off.
- **prettier** reordenou condições multilinhas e deslocou `// @ts-ignore` da linha que protegia (wbotClosedTickets) → TS2367.
- Linha com emoji em `logger.info` (queues.ts) foi mutilada pelo fix de prefer-template, deixando um `);` órfão → parsing error.

**Como aplicar:** depois de qualquer `eslint --fix` em massa, rodar `npx tsc --noEmit` E reiniciar o workflow Backend (o tsc não pega o problema do sequelize/types em imports mistos já existentes). Regras legadas de alto volume estão rebaixadas para "warn" no `.eslintrc.json` para o lint servir de portão (0 errors, warnings tolerados).
