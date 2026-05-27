---
name: React-trello uuid compatibility shims
description: How to make react-trello work with uuid@11 without installing vulnerable uuid@3
---
react-trello@2.x uses `require('uuid/v1')` (old API removed in uuid@7+). uuid@11 has "type":"module" so you cannot create plain .js shims. Solution:

1. Create `node_modules/uuid/v1.cjs` and `v4.cjs` as CJS files:
   `module.exports = require('./dist/cjs/v1.js').default;`
2. Add `"./v1": {"require": "./v1.cjs"}` to uuid's package.json exports map.
3. Put this in replit-start.sh (runs when node_modules is freshly created).

**Why:** uuid@11 dist/cjs/v1.js exports `default` as the v1 function. The .cjs extension bypasses the parent package's "type":"module" restriction. The exports map entry makes `require('uuid/v1')` resolve to the shim.

**How to apply:** In replit-start.sh post-install patches, after npm install completes.
