---
name: CRA HMR websocket SecurityError behind https proxy
description: Why a CRA (react-scripts 5 / webpack-dev-server 4) app reports a "frontend crash" on Replit and how to stop it.
---

Symptom: Replit repeatedly reports "Frontend artifact crashed with a runtime error" even though the app renders fine. The browser console shows `SecurityError: Failed to construct 'WebSocket': An insecure WebSocket connection may not be initiated from a page loaded over HTTPS`, thrown synchronously in webpack-dev-server's `WebSocketClient` / `initSocket`.

Root cause: the CRA dev server runs over **http** on localhost behind the Replit **https** proxy. WDS computes the HMR client's socket URL from the *server's* scheme, so it bakes `protocol=ws:` into the client bundle's resource query. From an https page the browser rejects `ws://` and throws synchronously. A synchronous/unhandled throw is what Replit's error detector flags as a crash — the separate async handshake failures (`ws(s)://.../ws failed: 400`) are handled and harmless.

**Why forcing wss works:** `wss://` from an https page is allowed, so the constructor no longer throws. The handshake still fails (Replit's proxy doesn't tunnel the dev HMR socket — it never will), but that failure is an async, handled error event, so no crash flag. HMR/live-reload is non-functional through the proxy regardless; the goal is only to kill the synchronous throw.

**Fix:** set `client.webSocketURL.protocol = 'wss'` in `react-scripts/config/webpackDevServer.config.js` (next to hostname/pathname/port). Do NOT use `'auto'` — this WDS client does not normalize the literal `auto`, it reaches the WebSocket constructor as `auto:` and throws `'auto' is not allowed`. react-scripts 5 has no `WDS_SOCKET_PROTOCOL` env var, so the value must be injected into the config.

**How to apply / persist:** node_modules is wiped on reinstall, so the patch must live in `app/frontend/replit-start.sh` alongside the other post-install patches (guarded by `if [ ! -d node_modules ]`). Verify after rebuild with `curl .../static/js/bundle.js | grep -oE '[?&]protocol=[^"&]*'` — it must print `protocol=wss`.
