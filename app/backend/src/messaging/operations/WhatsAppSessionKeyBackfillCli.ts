import { Op } from "sequelize";
import Whatsapp from "../../models/Whatsapp";
import sequelize from "../../database";
import { setSessionKeyEntries } from "../persistence/WhatsAppSessionKeyRepository";
import {
  BACKFILL_FENCE,
  planSessionKeyBackfill
} from "./WhatsAppSessionKeyBackfill";

/**
 * CLI de backfill do auth-state por chave (Hardening T6). Idempotente:
 * reexecução produz o mesmo resultado (fence (0,0) + mesmo conteúdo).
 * Saída SOMENTE de contagens — nunca chaves, credenciais ou payloads.
 *
 * Uso: npm run backfill:whatsapp-session-keys -- --apply [--batch-size=50] [--after-id=0]
 * Sem --apply roda em dry-run (só valida e conta).
 */

interface BackfillSummary {
  scanned: number;
  empty: number;
  invalid: number;
  ready: number;
  upserted: number;
  lastWhatsappId: number;
}

const numberArg = (name: string, fallback: number): number => {
  const prefix = `--${name}=`;
  const value = process.argv.find(item => item.startsWith(prefix));
  const parsed = value ? Number(value.slice(prefix.length)) : fallback;
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
};

export const runWhatsAppSessionKeyBackfill =
  async (): Promise<BackfillSummary> => {
    const apply = process.argv.includes("--apply");
    const batchSize = Math.min(1000, Math.max(1, numberArg("batch-size", 50)));
    let cursor = numberArg("after-id", 0);
    const summary: BackfillSummary = {
      scanned: 0,
      empty: 0,
      invalid: 0,
      ready: 0,
      upserted: 0,
      lastWhatsappId: cursor
    };

    for (;;) {
      const whatsapps = await Whatsapp.findAll({
        attributes: ["id", "session"],
        where: { id: { [Op.gt]: cursor } },
        order: [["id", "ASC"]],
        limit: batchSize
      });
      if (!whatsapps.length) break;

      for (const whatsapp of whatsapps) {
        cursor = whatsapp.id;
        summary.lastWhatsappId = cursor;
        summary.scanned += 1;
        const plan = planSessionKeyBackfill(whatsapp.session);
        if (plan.status === "empty") summary.empty += 1;
        if (plan.status === "invalid") summary.invalid += 1;
        if (plan.status === "ready") {
          summary.ready += 1;
          if (apply) {
            // eslint-disable-next-line no-await-in-loop
            await setSessionKeyEntries({
              whatsappId: whatsapp.id,
              entries: plan.entries,
              fence: BACKFILL_FENCE
            });
            summary.upserted += 1;
          }
        }
      }
      // Checkpoint de retomada sem PII: apenas contagens e cursor.
      process.stdout.write(`${JSON.stringify({ apply, ...summary })}\n`);
    }
    return summary;
  };

if (require.main === module) {
  runWhatsAppSessionKeyBackfill()
    .then(async summary => {
      process.stdout.write(
        `${JSON.stringify({ completed: true, ...summary })}\n`
      );
      await sequelize.close();
    })
    .catch(async error => {
      process.stderr.write(
        `${JSON.stringify({
          completed: false,
          error: error?.name || "BackfillError"
        })}\n`
      );
      await sequelize.close();
      process.exitCode = 1;
    });
}
