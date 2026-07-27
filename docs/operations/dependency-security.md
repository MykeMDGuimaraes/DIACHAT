# Segurança das dependências de produção

## Gate automatizado

O CI executa `npm audit --omit=dev --audit-level=critical` no backend e no frontend. Vulnerabilidades críticas impedem a integração. Atualizações com `npm audit fix --force` são proibidas porque podem trocar versões principais ou até rebaixar `sequelize-cli`, `sequelize-typescript`, `exceljs` e `react-scripts`.

## Exceções temporárias registradas em 27/07/2026

O scan do backend informa 13 vulnerabilidades altas, todas ligadas às cadeias `glob`/`minimatch`/`brace-expansion` usadas por `exceljs`, `sequelize-typescript` e `sequelize-cli`. As dependências diretas já estão nas versões estáveis mais recentes disponíveis. A vulnerabilidade [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg) possui correção somente em `brace-expansion@5.0.8`, cuja API não é compatível com os consumidores legados. O código da aplicação não importa `glob`, `minimatch` ou `brace-expansion` e não encaminha padrões fornecidos por usuários para essas bibliotecas.

O scan do frontend informa 55 vulnerabilidades altas e quatro moderadas concentradas no toolchain legado do Create React App e em `react-trello`. Esses módulos executam no build; a VM serve somente os arquivos estáticos gerados. O build de produção não publica sourcemaps.

## Controles compensatórios

- Instalação somente pelos lockfiles com `npm ci`.
- Node.js 20 fixado no Replit e no GitHub Actions.
- Build interrompido quando os patches de compatibilidade não podem ser aplicados.
- Nenhuma entrada de API é usada como padrão de filesystem/glob.
- Vulnerabilidades críticas bloqueiam o PR.
- Revisão semanal até a remoção das exceções; próxima revisão: 03/08/2026.

## Remediação definitiva

1. Substituir Create React App e remover os patches em `node_modules`.
2. Substituir `react-trello` ou migrar seu uso para uma biblioteca mantida.
3. Atualizar/remover os consumidores de `glob` legados assim que houver versões compatíveis com `brace-expansion@5.0.8`.
4. Reexecutar build, testes, `npm audit` e o capacity gate antes de retirar esta exceção.
