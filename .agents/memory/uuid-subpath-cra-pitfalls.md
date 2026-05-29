---
name: uuid v1/v4 subpath resolution under CRA5
description: Two traps when exposing uuid@11 ./v1 and ./v4 subpaths for react-trello in a Create-React-App (webpack5) build.
---

react-trello does `require('uuid/v1')` (and v4), but uuid@11's `exports` map has no `./v1`/`./v4` subpaths. You must add them. Two non-obvious traps make the obvious fixes fail at runtime, not build time:

**Trap 1 — never use a `.cjs` shim file.** CRA5's webpack file-loader `oneOf` rule excludes only `/\.(js|mjs|jsx|ts|tsx)$/` (plus html/json). A `.cjs` module therefore falls through to the asset/file-loader and is emitted to `static/media/*.cjs`; `require('uuid/v1')` then returns the asset **URL string**, not the function. react-trello's `(0, _v.default)()` blows up with `TypeError: (0 , _v.default) is not a function` inside `new Board`. Symptom only appears once the Board actually mounts (e.g. after login was fixed).

**Trap 2 — never point the browser build at `dist/cjs/*`.** The CJS build's `rng.js` does `require('crypto')` (node). webpack5/CRA5 dropped automatic node core polyfills, so the build fails with `Module not found: Can't resolve 'crypto'`. Use `dist/esm-browser/v1.js` / `v4.js`, which use the global Web Crypto API.

**The working fix:** in uuid's `package.json` `exports`, set `./v1` and `./v4` to `{ import, require, default }` all pointing at `./dist/esm-browser/vX.js`. Those ESM modules expose a real `default`, so react-trello's `_interopRequireDefault` yields the function. **Why all three conditions:** webpack may resolve via any of import/require/default depending on the request context; pointing them all at the browser ESM build avoids accidentally hitting the node CJS path.

**Also:** changing the uuid exports map does not invalidate CRA's persistent webpack cache. After editing, `rm -rf node_modules/.cache` then restart the Frontend workflow, or the bundle keeps the stale `static/media/*.cjs` resolution. Verify with `curl .../static/js/bundle.js | grep -o 'uuid/dist/esm-browser/v1.js'` (good) and confirm `static/media/v1` is absent (bad).
