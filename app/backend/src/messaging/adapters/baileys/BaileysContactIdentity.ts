export type ContactJidServer = "phone" | "lid" | "group";

export interface BaileysContactIdentity {
  number: string | null;
  lid: string | null;
  groupId: string | null;
  jidServer: ContactJidServer;
  whatsappId: number;
}

interface ParseIdentityInput {
  primaryJid?: string | null;
  alternateJid?: string | null;
  whatsappId: number;
}

interface ContactAddress {
  number?: string | null;
  lid?: string | null;
  jidServer?: ContactJidServer | null;
  isGroup?: boolean | null;
}

const splitJid = (jid?: string | null): { local: string; server: string } | null => {
  if (!jid) return null;
  const separator = jid.lastIndexOf("@");
  if (separator <= 0 || separator === jid.length - 1) return null;
  return {
    local: jid.slice(0, separator).split(":")[0],
    server: jid.slice(separator + 1).toLowerCase()
  };
};

export const parseBaileysContactIdentity = ({
  primaryJid,
  alternateJid,
  whatsappId
}: ParseIdentityInput): BaileysContactIdentity => {
  const primary = splitJid(primaryJid);
  const alternate = splitJid(alternateJid);
  const parts = [primary, alternate].filter(Boolean) as Array<{
    local: string;
    server: string;
  }>;
  const phone = parts.find(item => item.server === "s.whatsapp.net");
  const lid = parts.find(item => item.server === "lid");
  const group = parts.find(item => item.server === "g.us");

  let jidServer: ContactJidServer;
  if (primary?.server === "lid") jidServer = "lid";
  else if (primary?.server === "g.us") jidServer = "group";
  else if (primary?.server === "s.whatsapp.net") jidServer = "phone";
  else if (group) jidServer = "group";
  else if (lid) jidServer = "lid";
  else jidServer = "phone";

  return {
    number: group?.local || phone?.local || null,
    lid: lid?.local || null,
    groupId: group?.local || null,
    jidServer,
    whatsappId
  };
};

export const resolveContactJid = (contact: ContactAddress): string => {
  const server: ContactJidServer = contact.isGroup
    ? "group"
    : contact.jidServer || (contact.lid && !contact.number ? "lid" : "phone");

  if (server === "lid" && contact.lid) return `${contact.lid}@lid`;
  if (server === "group" && contact.number) return `${contact.number}@g.us`;
  if (server === "phone" && contact.number)
    return `${contact.number}@s.whatsapp.net`;

  throw new Error("CONTACT_WHATSAPP_IDENTITY_UNAVAILABLE");
};

