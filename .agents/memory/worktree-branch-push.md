---
name: Push de branch em worktree
description: Como publicar no GitHub uma branch que está checked out num git worktree separado
---

Shell `git push` falha ("Invalid username or token") — o askpass do agente não fornece senha. O callback `gitPush` funciona, mas só publica a **branch atual do checkout principal** (`/home/runner/workspace`).

**How to apply:** para publicar uma branch presa num worktree: (1) `git switch --detach` no worktree para liberar a branch; (2) `git switch <branch>` no workspace (precisa estar limpo); (3) `gitPush({ branch })` via CodeExecution; (4) `git switch main` no workspace e `git switch <branch>` de volta no worktree. Verificar `git status --porcelain` vazio antes e depois.
