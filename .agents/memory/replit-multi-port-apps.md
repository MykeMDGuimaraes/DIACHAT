---
name: Replit multi-port apps (frontend + backend on same domain)
description: How to wire a separate backend port so the browser can reach it from the frontend served on the bare REPLIT_DEV_DOMAIN.
---

When an app has two long-running servers (e.g. CRA on :5000 and Express on :3001) and `.replit` maps `localPort=5000` to `externalPort=80` while exposing the backend on `externalPort=3001`, the bare `https://${REPLIT_DEV_DOMAIN}/` only reaches the frontend. The backend is reachable at `https://${REPLIT_DEV_DOMAIN}:3001/` over HTTPS (Replit terminates TLS for any declared externalPort on the same hostname).

**Rule:** any browser-side env var that points at the backend (`REACT_APP_BACKEND_URL`, `VITE_API_URL`, etc.) MUST include the `:PORT` suffix matching the backend's `externalPort`. Pointing it at the bare domain silently routes API calls into the frontend dev server, which returns HTML and surfaces as `AxiosError: Network Error` / "unexpected token <".

**Why:** the dev proxy only binds one service to 443 at the root host; additional services live at `:externalPort` on the same hostname. The frontend bundle runs in the browser, so localhost paths and internal hostnames are unreachable — only the public dev domain works.

**How to apply:**
- Set CORS `origin` on the backend to the bare frontend URL (no port).
- Set the frontend backend URL env to the same hostname **with** `:BACKEND_EXTERNAL_PORT`.
- After editing `.env`, restart the frontend workflow — CRA/Vite snapshot env at boot.
- Sanity-check with `curl -ki https://${REPLIT_DEV_DOMAIN}:PORT/<known-route>` — a 2xx/3xx with `access-control-allow-origin` proves the port is reachable.
- Do NOT use `localhost:PORT` from the browser, and do not try `https://PORT-HASH.replit.dev` style subdomains — only `:PORT` on the bare host works on this cluster.
