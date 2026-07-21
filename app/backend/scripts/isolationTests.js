/* eslint-disable no-console */
/**
 * Suíte de testes de isolamento multi-tenant do DIA CHAT.
 * Executar com o backend rodando: npm run test:isolation
 *
 * Cobre: REST /internal/v1, canal de eventos SSE, anexos (/public),
 * caminho por UUID, idempotência de envio e paginação por cursor,
 * além de verificações da trilha de auditoria (sem conteúdo de mensagem).
 */
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { Client } = require("pg");
const jwt = require("jsonwebtoken");

require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });

const BASE = process.env.ISOLATION_BASE_URL || "http://localhost:3001";
const JWT_SECRET = process.env.JWT_SECRET || "mysecret";
const PUBLIC_DIR = path.resolve(__dirname, "..", "public");

const sha256 = s => crypto.createHash("sha256").update(s).digest("hex");

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, extra) {
  if (cond) {
    passed += 1;
    console.log(`  ✔ ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.error(`  ✘ ${name}${extra ? ` — ${JSON.stringify(extra)}` : ""}`);
  }
}

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const q = (text, params) => db.query(text, params);

  console.log("== Setup: dois tenants de teste (ISO-A / ISO-B) ==");
  // Limpeza de execuções anteriores (idempotente)
  const old = await q(
    `SELECT id FROM "Companies" WHERE name IN ('ISO-TEST-A','ISO-TEST-B')`
  );
  for (const row of old.rows) {
    await q(`DELETE FROM "AuditLogs" WHERE "companyId" = $1`, [row.id]);
    await q(
      `DELETE FROM "V1MessageIdempotencies" WHERE "companyId" = $1`,
      [row.id]
    );
    await q(`DELETE FROM "Messages" WHERE "companyId" = $1`, [row.id]);
    await q(`DELETE FROM "Tickets" WHERE "companyId" = $1`, [row.id]);
    await q(`DELETE FROM "ContactCustomFields" WHERE "contactId" IN (SELECT id FROM "Contacts" WHERE "companyId" = $1)`, [row.id]);
    await q(`DELETE FROM "Contacts" WHERE "companyId" = $1`, [row.id]);
    await q(`DELETE FROM "ServiceCredentials" WHERE "companyId" = $1`, [row.id]);
    await q(`DELETE FROM "Whatsapps" WHERE "companyId" = $1`, [row.id]);
    await q(`DELETE FROM "Companies" WHERE id = $1`, [row.id]);
  }

  const planId = (await q(`SELECT id FROM "Plans" ORDER BY id LIMIT 1`)).rows[0].id;

  const mkCompany = async name =>
    (
      await q(
        `INSERT INTO "Companies" (name, "planId", status, "createdAt", "updatedAt")
         VALUES ($1, $2, true, now(), now()) RETURNING id`,
        [name, planId]
      )
    ).rows[0].id;

  const A = await mkCompany("ISO-TEST-A");
  const B = await mkCompany("ISO-TEST-B");

  const mkTenant = async (cid, tag) => {
    const contactId = (
      await q(
        `INSERT INTO "Contacts" (name, number, email, "isGroup", "companyId", "createdAt", "updatedAt")
         VALUES ($1, $2, '', false, $3, now(), now()) RETURNING id`,
        [`Contato ${tag}`, `55990000${cid}${Math.floor(Math.random() * 1000)}`, cid]
      )
    ).rows[0].id;
    const uuid = crypto.randomUUID();
    const ticketId = (
      await q(
        `INSERT INTO "Tickets" (status, "lastMessage", "contactId", "companyId", uuid, "isGroup", "unreadMessages", "createdAt", "updatedAt")
         VALUES ('open', 'ultima', $1, $2, $3, false, 0, now(), now()) RETURNING id`,
        [contactId, cid, uuid]
      )
    ).rows[0].id;
    const msgIds = [];
    for (let i = 1; i <= 25; i += 1) {
      const mid = `iso-${tag}-msg-${i}-${crypto.randomBytes(4).toString("hex")}`;
      msgIds.push(mid);
      // eslint-disable-next-line no-await-in-loop
      await q(
        `INSERT INTO "Messages" (id, body, ack, read, "mediaType", "ticketId", "contactId", "companyId", "fromMe", "createdAt", "updatedAt")
         VALUES ($1, $2, 0, true, 'chat', $3, $4, $5, false, now() - interval '1 minute' * $6, now())`,
        [mid, `mensagem ${i} de ${tag}`, ticketId, contactId, cid, 30 - i]
      );
    }
    const tokenId = `svc_iso_${tag.toLowerCase()}_${crypto.randomBytes(4).toString("hex")}`;
    const secret = crypto.randomBytes(16).toString("hex");
    const credId = (
      await q(
        `INSERT INTO "ServiceCredentials" (name, "tokenId", "secretHash", "companyId", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, now(), now()) RETURNING id`,
        [`iso-${tag}`, tokenId, sha256(secret), cid]
      )
    ).rows[0].id;
    const svcToken = `${tokenId}.${secret}`;
    const userJwt = jwt.sign(
      { id: 999900 + cid, username: `iso-${tag}`, profile: "admin", companyId: cid },
      JWT_SECRET,
      { expiresIn: "15m" }
    );
    return { cid, contactId, ticketId, uuid, msgIds, svcToken, userJwt, credId };
  };

  const ta = await mkTenant(A, "A");
  const tb = await mkTenant(B, "B");

  // Anexo do tenant A: arquivo físico + Message com mediaUrl
  const fileName = `iso-test-a-${crypto.randomBytes(4).toString("hex")}.txt`;
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  fs.writeFileSync(path.join(PUBLIC_DIR, fileName), "conteudo do anexo A");
  await q(
    `INSERT INTO "Messages" (id, body, ack, read, "mediaType", "mediaUrl", "ticketId", "contactId", "companyId", "fromMe", "createdAt", "updatedAt")
     VALUES ($1, 'anexo', 0, true, 'application', $2, $3, $4, $5, false, now(), now())`,
    [`iso-A-media-${crypto.randomBytes(4).toString("hex")}`, fileName, ta.ticketId, ta.contactId, A]
  );

  const svcHeaders = tok => ({ Authorization: `Bearer ${tok}` });
  const j = async (url, opts) => {
    const r = await fetch(`${BASE}${url}`, opts);
    let body = null;
    try {
      body = await r.json();
    } catch {
      /* no body */
    }
    return { status: r.status, body };
  };

  console.log("== 1. REST /internal/v1: isolamento entre tenants ==");
  {
    const r = await j(`/internal/v1/contacts?limit=100`, { headers: svcHeaders(ta.svcToken) });
    const ids = (r.body?.data || []).map(c => c.id);
    check("credencial A lista apenas contatos de A", r.status === 200 && ids.includes(ta.contactId) && !ids.includes(tb.contactId), { status: r.status });

    const r2 = await j(`/internal/v1/conversations?limit=100`, { headers: svcHeaders(tb.svcToken) });
    const tids = (r2.body?.data || []).map(c => c.id);
    check("credencial B não vê conversas de A", r2.status === 200 && !tids.includes(ta.ticketId) && tids.includes(tb.ticketId), { status: r2.status });

    const r3 = await j(`/internal/v1/conversations/${ta.ticketId}`, { headers: svcHeaders(tb.svcToken) });
    check("credencial B → conversa de A = 404", r3.status === 404, r3);

    const r4 = await j(`/internal/v1/conversations/${ta.ticketId}/messages`, { headers: svcHeaders(tb.svcToken) });
    check("credencial B → mensagens de A = 404", r4.status === 404, r4);

    const r5 = await j(`/internal/v1/conversations/${ta.ticketId}/messages`, {
      method: "POST",
      headers: { ...svcHeaders(tb.svcToken), "Content-Type": "application/json" },
      body: JSON.stringify({ clientMessageId: "iso-cross-1", body: "x" })
    });
    check("credencial B → envio na conversa de A = 404", r5.status === 404, r5);

    const r6 = await j(`/internal/v1/contacts`, { headers: svcHeaders("svc_invalido.deadbeef") });
    check("credencial inválida = 401", r6.status === 401, r6);
  }

  console.log("== 2. Caminho por UUID (REST UI) ==");
  {
    const rA = await j(`/tickets/u/${ta.uuid}`, { headers: { Authorization: `Bearer ${ta.userJwt}` } });
    check("JWT A → ticket A por UUID = 200", rA.status === 200, { status: rA.status });
    const rB = await j(`/tickets/u/${ta.uuid}`, { headers: { Authorization: `Bearer ${tb.userJwt}` } });
    check("JWT B → ticket A por UUID = 404", rB.status === 404, { status: rB.status });
  }

  console.log("== 3. Anexos (/public) ==");
  {
    const rA = await fetch(`${BASE}/public/${fileName}?token=${ta.userJwt}`);
    check("JWT A → anexo de A = 200", rA.status === 200, { status: rA.status });
    const rB = await fetch(`${BASE}/public/${fileName}?token=${tb.userJwt}`);
    check("JWT B → anexo de A = 404", rB.status === 404, { status: rB.status });
    const rN = await fetch(`${BASE}/public/${fileName}`);
    check("sem token → anexo = 401", rN.status === 401, { status: rN.status });
  }

  console.log("== 4. Canal de eventos SSE ==");
  {
    // Publica um evento no buffer do tenant A usando o mesmo protocolo Redis do backend
    const Redis = require("ioredis");
    const redis = new Redis(process.env.REDIS_URI_CONNECTION || process.env.REDIS_URI || "redis://127.0.0.1:6379");
    // Dois eventos: reconexão com cursor no primeiro deve entregar o segundo
    // (cursor=0 significa "somente ao vivo", sem backlog).
    let seq = null;
    for (let i = 0; i < 2; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      seq = await redis.incr(`v1events:${A}:seq`);
      const ev = JSON.stringify({ id: seq, type: "conversation.updated", occurredAt: new Date().toISOString(), payload: { conversation: { id: ta.ticketId } } });
      // eslint-disable-next-line no-await-in-loop
      await redis.zadd(`v1events:${A}:buf`, seq, ev);
    }
    redis.disconnect();

    const sse = async (tok, cursor, ms) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), ms);
      let text = "";
      try {
        const r = await fetch(`${BASE}/internal/v1/events?cursor=${cursor}`, {
          headers: svcHeaders(tok),
          signal: ctrl.signal
        });
        const reader = r.body.getReader();
        // eslint-disable-next-line no-constant-condition
        while (true) {
          // eslint-disable-next-line no-await-in-loop
          const { value, done } = await reader.read();
          if (done) break;
          text += Buffer.from(value).toString();
        }
      } catch {
        /* abort esperado */
      }
      clearTimeout(t);
      return text;
    };

    const streamA = await sse(ta.svcToken, seq - 1, 2500);
    check("SSE A recebe evento do próprio tenant via cursor", streamA.includes(`"id":${seq}`) && streamA.includes("conversation.updated"), { streamA: streamA.slice(0, 200) });
    check("SSE A não vaza ids de B", !streamA.includes(`"conversation":{"id":${tb.ticketId}}`));

    const streamB = await sse(tb.svcToken, seq - 1, 2500);
    check("SSE B não recebe evento de A (resync/vazio)", !streamB.includes(`iso`) && !streamB.includes(`"conversation":{"id":${ta.ticketId}}`), { streamB: streamB.slice(0, 200) });
  }

  console.log("== 5. Idempotência de envio ==");
  {
    const doneMsg = ta.msgIds[0];
    await q(
      `INSERT INTO "V1MessageIdempotencies" ("companyId", "ticketId", "clientMessageId", "messageId", "createdAt", "updatedAt")
       VALUES ($1, $2, 'iso-idem-done', $3, now(), now())`,
      [A, ta.ticketId, doneMsg]
    );
    const r1 = await j(`/internal/v1/conversations/${ta.ticketId}/messages`, {
      method: "POST",
      headers: { ...svcHeaders(ta.svcToken), "Content-Type": "application/json" },
      body: JSON.stringify({ clientMessageId: "iso-idem-done", body: "replay" })
    });
    check("replay do mesmo clientMessageId = 200 duplicate:true (não duplica)", r1.status === 200 && r1.body?.data?.duplicate === true && r1.body?.data?.id === doneMsg, r1);

    await q(
      `INSERT INTO "V1MessageIdempotencies" ("companyId", "ticketId", "clientMessageId", "createdAt", "updatedAt")
       VALUES ($1, $2, 'iso-idem-pending', now(), now())`,
      [A, ta.ticketId]
    );
    const r2 = await j(`/internal/v1/conversations/${ta.ticketId}/messages`, {
      method: "POST",
      headers: { ...svcHeaders(ta.svcToken), "Content-Type": "application/json" },
      body: JSON.stringify({ clientMessageId: "iso-idem-pending", body: "pending" })
    });
    check("clientMessageId em processamento = 409", r2.status === 409 && r2.body?.error?.code === "REQUEST_IN_PROGRESS", r2);
  }

  console.log("== 6. Paginação por cursor (sem perda/duplicação) ==");
  {
    const seen = [];
    let cursor = null;
    let pages = 0;
    do {
      const url = `/internal/v1/conversations/${ta.ticketId}/messages?limit=7${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      // eslint-disable-next-line no-await-in-loop
      const r = await j(url, { headers: svcHeaders(ta.svcToken) });
      if (r.status !== 200) {
        check("paginação retornou 200 em todas as páginas", false, r);
        break;
      }
      seen.push(...r.body.data.map(m => m.id));
      cursor = r.body.nextCursor;
      pages += 1;
    } while (cursor && pages < 20);
    const textOnly = seen.filter(id => id.startsWith("iso-A-msg"));
    const unique = new Set(seen);
    check("cursor cobre todas as 25 mensagens sem perda", textOnly.length === 25, { got: textOnly.length });
    check("cursor não duplica mensagens", unique.size === seen.length, { seen: seen.length, unique: unique.size });
  }

  console.log("== 7. Trilha de auditoria ==");
  {
    // login (sucesso e falha)
    await j(`/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "nao-existe@iso.test", password: "errada" })
    });

    await new Promise(r => setTimeout(r, 800)); // audit é fire-and-forget

    const audits = await q(
      `SELECT action, outcome, "companyId", "actorType", metadata FROM "AuditLogs"
       WHERE "companyId" IN ($1, $2) OR "companyId" IS NULL ORDER BY id DESC LIMIT 300`,
      [A, B]
    );
    const rows = audits.rows;
    const has = (action, outcome, cid) =>
      rows.some(
        r =>
          r.action === action &&
          (outcome == null || r.outcome === outcome) &&
          (cid == null || r.companyId === cid)
      );
    check("audita uso de credencial de serviço (service.auth)", has("service.auth", "success", A) && has("service.auth", "success", B));
    check("audita credencial inválida (service.auth denied)", rows.some(r => r.action === "service.auth" && r.outcome === "denied"));
    check("audita envio v1 (v1.message.send)", has("v1.message.send", "success", A));
    check("audita acesso a anexo concedido e negado", has("media.access", "success", A) && has("media.access", "denied", B));
    check("audita tentativa de login negada", rows.some(r => r.action === "auth.login" && r.outcome === "denied"));

    const leaked = rows.filter(r => {
      const m = JSON.stringify(r.metadata || {});
      return m.includes("mensagem ") || m.includes("replay") || m.includes("conteudo do anexo");
    });
    check("nenhum log de auditoria contém conteúdo de mensagem", leaked.length === 0, { leaked: leaked.length });
  }

  console.log("== Limpeza ==");
  fs.rmSync(path.join(PUBLIC_DIR, fileName), { force: true });

  await db.end();

  console.log(`\nResultado: ${passed} passaram, ${failed} falharam`);
  if (failed > 0) {
    console.error(`Falhas: ${failures.join(" | ")}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error("Erro fatal na suíte:", err);
  process.exit(1);
});
