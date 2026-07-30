---
name: Backend ESLint vs ajv override
description: Why the global ajv override must stay at v6 in app/backend and how the fs firewall block is avoided
---
- ESLint 8's `@eslint/eslintrc` needs ajv 6 APIs. A global npm override forcing `ajv: ^8` crashes eslint at startup ("Cannot set properties of undefined (setting 'defaultMeta')"). Keep the backend override at `ajv: ^6.12.6` (only the eslint tree uses ajv there).
- **Why:** ajv 8 removed `missingRefs`/meta-schema behavior eslintrc's compat shim relies on.
- `npm install --prefer-offline` in app/backend succeeds despite the package firewall blocking `fs-0.0.1-security` (dep of gn-api-sdk-typescript) because it's already in cache/node_modules — avoid deleting node_modules or the npm cache.
- `.eslintrc.json` must not extend `prettier/@typescript-eslint` (merged into `prettier` since eslint-config-prettier 8).
