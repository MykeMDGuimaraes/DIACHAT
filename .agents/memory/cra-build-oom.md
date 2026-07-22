---
name: Build CRA de produção sem OOM
description: Como compilar o frontend CRA deste projeto sem estourar memória e como rodar tarefas longas no agente.
---

Regra: o build de produção do frontend (`react-scripts build`) só conclui neste ambiente com `GENERATE_SOURCEMAP=false`, `NODE_OPTIONS="--openssl-legacy-provider --max-old-space-size=2560"` e, idealmente, com o dev server do frontend parado.

**Why:** com sourcemaps ou heap de 4096MB o processo morre com "The build failed because the process exited too early" (OOM do container ~8GB, dividido com dev servers e tsserver). Validado em 22/07/2026.

**How to apply:** `scripts/deploy-build.sh` já usa a combinação correta — não "melhorar" aumentando heap ou reativando sourcemaps. Para rodar builds longos (>2min) pelo agente, processos em background do bash (nohup/setsid) são mortos ao fim da chamada; crie um workflow temporário (console) que grava log em /tmp e remova-o depois.
