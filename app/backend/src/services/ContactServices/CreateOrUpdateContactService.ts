import { getIO } from "../../libs/socket";
import { publishTenantEvent } from "../../libs/tenantEvents";
import { toContactDTO } from "../InternalV1Services/Dtos";
import Contact from "../../models/Contact";
import ContactCustomField from "../../models/ContactCustomField";

interface ExtraInfo extends ContactCustomField {
  name: string;
  value: string;
}

interface Request {
  name: string;
  number?: string | null;
  lid?: string | null;
  jidServer?: "phone" | "lid" | "group";
  isGroup: boolean;
  email?: string;
  profilePicUrl?: string;
  companyId: number;
  extraInfo?: ExtraInfo[];
  whatsappId?: number;
}

const CreateOrUpdateContactService = async ({
  name,
  number: rawNumber = null,
  lid: rawLid = null,
  jidServer,
  profilePicUrl,
  isGroup,
  email = "",
  companyId,
  extraInfo = [],
  whatsappId
}: Request): Promise<Contact> => {
  const number = rawNumber
    ? isGroup
      ? rawNumber
      : rawNumber.replace(/[^0-9]/g, "") || null
    : null;
  const lid = rawLid ? rawLid.replace(/[^0-9]/g, "") || null : null;
  const effectiveJidServer = isGroup
    ? "group"
    : jidServer || (lid && !number ? "lid" : "phone");

  if (!number && !lid) {
    throw new Error("CONTACT_WHATSAPP_IDENTITY_UNAVAILABLE");
  }

  const io = getIO();
  let contact: Contact | null;

  contact =
    lid && whatsappId
      ? await Contact.findOne({ where: { companyId, whatsappId, lid } })
      : null;
  if (!contact && number) {
    contact = await Contact.findOne({ where: { companyId, number } });
  }

  if (contact) {
    const changes: Record<string, unknown> = {
      profilePicUrl,
      jidServer: effectiveJidServer
    };
    if (!contact.whatsappId && whatsappId) changes.whatsappId = whatsappId;
    if (!contact.lid && lid) changes.lid = lid;
    if (!contact.number && number) {
      const numberOwner = await Contact.findOne({
        where: { companyId, number }
      });
      if (!numberOwner || numberOwner.id === contact.id) {
        changes.number = number;
      } else {
        // Do not auto-merge distinct historical contacts. Keep the address
        // that is already usable by the ticket attached to this contact.
        changes.jidServer = contact.jidServer || (contact.lid ? "lid" : "phone");
      }
    }
    await contact.update(changes);
    io.to(`company-${companyId}-mainchannel`).emit(
      `company-${companyId}-contact`,
      {
        action: "update",
        contact
      }
    );
  } else {
    contact = await Contact.create({
      name,
      number,
      lid,
      jidServer: effectiveJidServer,
      profilePicUrl,
      email,
      isGroup,
      extraInfo,
      companyId,
      whatsappId
    });

    io.to(`company-${companyId}-mainchannel`).emit(
      `company-${companyId}-contact`,
      {
        action: "create",
        contact
      }
    );
  }

  publishTenantEvent(companyId, "contact.updated", {
    contact: toContactDTO(contact)
  });

  return contact;
};

export default CreateOrUpdateContactService;
