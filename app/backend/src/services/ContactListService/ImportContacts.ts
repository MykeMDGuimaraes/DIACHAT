import { head, has } from "lodash";
import ExcelJS from "exceljs";
import ContactListItem from "../../models/ContactListItem";
import CheckContactNumber from "../WbotServices/CheckNumber";
import { logger } from "../../utils/logger";

export async function ImportContacts(
  contactListId: number,
  companyId: number,
  file: Express.Multer.File | undefined
) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file?.path as string);
  const worksheet = workbook.worksheets[0];

  const rows: any[] = [];
  let headers: string[] = [];

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      headers = (row.values as any[]).slice(1).map(h => String(h ?? ""));
    } else {
      const obj: Record<string, any> = {};
      (row.values as any[]).slice(1).forEach((val, idx) => {
        obj[headers[idx]] = val;
      });
      rows.push(obj);
    }
  });

  const contacts = rows.map(row => {
    let name = "";
    let number = "";
    let email = "";

    if (has(row, "nome") || has(row, "Nome")) {
      name = row.nome || row.Nome;
    }

    if (
      has(row, "numero") ||
      has(row, "número") ||
      has(row, "Numero") ||
      has(row, "Número")
    ) {
      number = row.numero || row["número"] || row.Numero || row["Número"];
      number = `${number}`.replace(/\D/g, "");
    }

    if (
      has(row, "email") ||
      has(row, "e-mail") ||
      has(row, "Email") ||
      has(row, "E-mail")
    ) {
      email = row.email || row["e-mail"] || row.Email || row["E-mail"];
    }

    return { name, number, email, contactListId, companyId };
  });

  const contactList: ContactListItem[] = [];

  for (const contact of contacts) {
    const [newContact, created] = await ContactListItem.findOrCreate({
      where: {
        number: `${contact.number}`,
        contactListId: contact.contactListId,
        companyId: contact.companyId
      },
      defaults: contact
    });
    if (created) {
      contactList.push(newContact);
    }
  }

  if (contactList) {
    for (const newContact of contactList) {
      try {
        const response = await CheckContactNumber(newContact.number, companyId);
        newContact.isWhatsappValid = response.exists;
        const number = response.jid.replace(/\D/g, "");
        newContact.number = number;
        await newContact.save();
      } catch (e) {
        logger.error(`Número de contato inválido: ${newContact.number}`);
      }
    }
  }

  return contactList;
}
