import Invoices from "../../models/Invoices";

const FindAllPlanService = async (companyId: number): Promise<Invoices[]> => {
  const invoice = await Invoices.findAll({
    where: {
      companyId
    },
    order: [["id", "ASC"]]
  });
  return invoice;
};

export default FindAllPlanService;
