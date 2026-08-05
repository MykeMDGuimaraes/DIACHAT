import { QueryInterface } from "sequelize";

// Idempotente: o boot (replit-start) e o pretest do jest rodam este seed
// repetidamente no mesmo banco; sem a guarda, a segunda execucao quebra
// com unique violation em "Plano 1"/"Empresa 1".
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    const [existingPlans]: any = await queryInterface.sequelize.query(
      `SELECT id FROM "Plans" WHERE name = 'Plano 1' LIMIT 1`
    );
    let planId: number | undefined = existingPlans?.[0]?.id;
    if (!planId) {
      await queryInterface.bulkInsert("Plans", [
        {
          name: "Plano 1",
          users: 10,
          connections: 10,
          queues: 10,
          value: 30,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ]);
      const [createdPlans]: any = await queryInterface.sequelize.query(
        `SELECT id FROM "Plans" WHERE name = 'Plano 1' LIMIT 1`
      );
      planId = createdPlans?.[0]?.id;
    }

    const [existingCompanies]: any = await queryInterface.sequelize.query(
      `SELECT id FROM "Companies" WHERE name = 'Empresa 1' LIMIT 1`
    );
    if (!existingCompanies?.length) {
      await queryInterface.bulkInsert("Companies", [
        {
          name: "Empresa 1",
          planId,
          dueDate: "2093-03-14 04:00:00+01",
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ]);
    }
  },

  down: async (queryInterface: QueryInterface) => {
    return Promise.all([
      queryInterface.bulkDelete("Companies", {}),
      queryInterface.bulkDelete("Plans", {})
    ]);
  }
};
