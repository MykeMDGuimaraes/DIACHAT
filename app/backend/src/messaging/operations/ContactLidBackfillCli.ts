import { Op } from "sequelize";
import Contact from "../../models/Contact";
import Message from "../../models/Message";
import sequelize from "../../database";
import { planContactLidBackfill } from "./ContactLidBackfill";

interface BackfillSummary {
  scanned: number;
  ready: number;
  updated: number;
  ambiguous: number;
  collisions: number;
  lastContactId: number;
}

const numberArg = (name: string, fallback: number): number => {
  const prefix = `--${name}=`;
  const value = process.argv.find(item => item.startsWith(prefix));
  const parsed = value ? Number(value.slice(prefix.length)) : fallback;
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
};

export const runContactLidBackfill = async (): Promise<BackfillSummary> => {
  const apply = process.argv.includes("--apply");
  const batchSize = Math.min(1000, Math.max(1, numberArg("batch-size", 200)));
  let cursor = numberArg("after-id", 0);
  const summary: BackfillSummary = {
    scanned: 0,
    ready: 0,
    updated: 0,
    ambiguous: 0,
    collisions: 0,
    lastContactId: cursor
  };

  for (;;) {
    const contacts = await Contact.findAll({
      where: { id: { [Op.gt]: cursor } },
      order: [["id", "ASC"]],
      limit: batchSize
    });
    if (!contacts.length) break;

    for (const contact of contacts) {
      cursor = contact.id;
      summary.lastContactId = cursor;
      summary.scanned += 1;
      const messages = await Message.findAll({
        attributes: ["remoteJid", "participant"],
        where: { contactId: contact.id },
        order: [["createdAt", "ASC"]]
      });
      const plan = planContactLidBackfill({
        contact: {
          id: contact.id,
          number: contact.number,
          lid: contact.lid,
          jidServer: contact.jidServer
        },
        messageJids: messages.flatMap(message => [
          message.remoteJid,
          message.participant
        ])
      });
      if (plan.status === "ambiguous") {
        summary.ambiguous += 1;
        continue;
      }
      summary.ready += 1;
      if (!Object.keys(plan.changes).length) continue;
      if (plan.changes.lid && contact.whatsappId) {
        const collision = await Contact.findOne({
          where: {
            companyId: contact.companyId,
            whatsappId: contact.whatsappId,
            lid: plan.changes.lid,
            id: { [Op.ne]: contact.id }
          },
          attributes: ["id"]
        });
        if (collision) {
          summary.collisions += 1;
          continue;
        }
      }
      if (apply) {
        await contact.update(plan.changes);
        summary.updated += 1;
      }
    }
    // PII-safe resumability checkpoint.
    process.stdout.write(`${JSON.stringify({ apply, ...summary })}\n`);
  }
  return summary;
};

if (require.main === module) {
  runContactLidBackfill()
    .then(async summary => {
      process.stdout.write(`${JSON.stringify({ completed: true, ...summary })}\n`);
      await sequelize.close();
    })
    .catch(async error => {
      process.stderr.write(
        `${JSON.stringify({ completed: false, error: error?.name || "BackfillError" })}\n`
      );
      await sequelize.close();
      process.exitCode = 1;
    });
}

