export interface ContactIdentitySnapshot {
  id: number;
  number: string | null;
  lid: string | null;
  jidServer: "phone" | "lid" | "group";
}

interface PlanInput {
  contact: ContactIdentitySnapshot;
  messageJids: Array<string | null | undefined>;
}

export interface ContactLidBackfillPlan {
  contactId: number;
  changes: {
    number?: null;
    lid?: string;
    jidServer?: "lid";
  };
  status: "ready" | "ambiguous";
}

const localPart = (jid: string, domain: string): string | null => {
  const suffix = `@${domain}`;
  if (!jid.toLowerCase().endsWith(suffix)) return null;
  const value = jid.slice(0, -suffix.length).split(":")[0].replace(/\D/g, "");
  return value || null;
};

export const planContactLidBackfill = ({
  contact,
  messageJids
}: PlanInput): ContactLidBackfillPlan => {
  const lids = new Set<string>();
  const phones = new Set<string>();
  for (const raw of messageJids) {
    if (!raw) continue;
    const lid = localPart(raw, "lid");
    const phone = localPart(raw, "s.whatsapp.net");
    if (lid) lids.add(lid);
    if (phone) phones.add(phone);
  }
  if (!lids.size) {
    return { contactId: contact.id, changes: {}, status: "ambiguous" };
  }

  const lid = [...lids][0];
  const changes: ContactLidBackfillPlan["changes"] = {};
  if (!contact.lid) changes.lid = lid;
  const numberWasLid = contact.number === lid && !phones.has(lid);
  if (numberWasLid) {
    changes.number = null;
    changes.jidServer = "lid";
  }
  return { contactId: contact.id, changes, status: "ready" };
};

