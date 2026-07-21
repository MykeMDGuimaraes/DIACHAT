import Invoice from "../../models/Invoices";
import AppError from "../../errors/AppError";

const ShowInvoceService = async (
  Invoiceid: string | number,
  companyId: number
): Promise<Invoice> => {
  const invoice = await Invoice.findByPk(Invoiceid);

  if (!invoice || invoice.companyId !== companyId) {
    throw new AppError("ERR_NO_PLAN_FOUND", 404);
  }

  return invoice;
};

export default ShowInvoceService;
