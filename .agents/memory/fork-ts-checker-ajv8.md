---
name: Fork-ts-checker ajv-keywords crash fix
description: How to fix fork-ts-checker-webpack-plugin crash when top-level ajv-keywords is v5 (for ajv@8)
---
fork-ts-checker-webpack-plugin@6 (used by react-scripts@5) bundles its own schema-utils@2.7.1. That schema-utils calls ajvKeywords(ajv, ['instanceof','formatMinimum','formatMaximum','patternRequired']) at module-load time. ajv-keywords@5 (for ajv@8) does not have formatMinimum/formatMaximum, causing a crash even when TypeScript is not used.

**Fix:** Patch the line in `fork-ts-checker-webpack-plugin/node_modules/schema-utils/dist/validate.js`:
```js
// Old (crashes):
(0, _ajvKeywords.default)(ajv, ['instanceof', 'formatMinimum', 'formatMaximum', 'patternRequired']);
// New (graceful):
['instanceof', 'formatMinimum', 'formatMaximum', 'patternRequired'].forEach(function(k){try{(0, _ajvKeywords.default)(ajv,k);}catch(e){}});
```

**Why:** The missing keywords cause the module to throw on require(), crashing webpack before it starts. Wrapping in try-catch lets 'instanceof' and 'patternRequired' register successfully while skipping the incompatible ones.

**How to apply:** In replit-start.sh post-install patches, after npm install. This is a pure patch to node_modules — no vulnerable packages installed.
