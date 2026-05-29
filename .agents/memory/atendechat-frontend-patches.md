---
name: Atendechat frontend post-install patches
description: Patches that must exist in app/frontend/node_modules for the CRA build to succeed; how they get destroyed and how to restore them.
---

`app/frontend/replit-start.sh` applies four patches AFTER `npm install`, but ONLY when `node_modules` does not already exist. Any later `npm install` (e.g. an auto-update of a single dep, a `--force` reinstall, or deleting node_modules halfway) leaves node_modules present without the patches and the build crashes.

**The patches that must be present:**
1. uuid `./v1` and `./v4` `exports` map entries pointed at `./dist/esm-browser/v1.js` / `v4.js` (all conditions) — react-trello does `require('uuid/v1')` and uuid@11 doesn't expose those subpaths. Do NOT use `.cjs` shim files and do NOT point at `dist/cjs/*` — see uuid-subpath-cra-pitfalls.md for why both break under CRA5/webpack5.
2. `node_modules/eslint-scope/package.json` with the `exports` field removed — react-scripts imports internal paths like `eslint-scope/lib/referencer`.
3. `node_modules/fork-ts-checker-webpack-plugin/node_modules/schema-utils/dist/validate.js` wrapped so unknown ajv keywords (`formatMinimum`, `formatMaximum`) degrade gracefully under ajv-keywords@5 / ajv@8.
4. `node_modules/react-scripts/config/webpackDevServer.config.js` with `client.webSocketURL.protocol = 'wss'` added — stops the synchronous HMR WebSocket SecurityError that Replit flags as a crash. See cra-hmr-websocket-https-proxy.md.

**Why:** none of these are upstream bugs in the patched packages — they are mismatches between Atendechat's pinned tree (react-scripts 4.x era) and modern transitive deps. Without the patches, webpack either fails at `require('uuid/v1')` or the dev server crashes at boot from schema validation.

**How to apply (after any npm install that wiped them):**
- Easiest: `rm -rf app/frontend/node_modules && bash app/frontend/replit-start.sh` — the script's `if [ ! -d node_modules ]` branch re-runs and re-applies all three patches.
- If you must keep node_modules: re-run the three `node -e` blocks from `replit-start.sh` manually.
- NEVER delete `app/frontend/package-lock.json` — a lockless `npm install --force --legacy-peer-deps` resolves a different tree (loses uuid shims, breaks react-scripts). If lockfile is lost, restore via `git show HEAD:app/frontend/package-lock.json > app/frontend/package-lock.json` then reinstall without `--force`.
