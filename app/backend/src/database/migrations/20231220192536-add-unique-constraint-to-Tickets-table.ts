import { QueryInterface } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    // O removeConstraint PRECISA ser awaited antes do addConstraint: a versao
    // anterior usava o operador virgula, disparando as duas operacoes em
    // paralelo — race que derrubava bancos frescos com "constraint already
    // exists". A guarda de existencia cobre bancos com drift (meta fora de
    // sincronia com o schema real).
    const [rows] = await queryInterface.sequelize.query(
      `SELECT 1 FROM pg_constraint WHERE conname = 'contactid_companyid_unique' LIMIT 1`
    );
    if (rows.length > 0) {
      await queryInterface.removeConstraint(
        "Tickets",
        "contactid_companyid_unique"
      );
    }
    return queryInterface.addConstraint("Tickets", {
      fields: ["contactId", "companyId", "whatsappId"],
      type: "unique",
      name: "contactid_companyid_unique"
    } as any);
  },

  down: (queryInterface: QueryInterface) => {
    return queryInterface.removeConstraint(
      "Tickets",
      "contactid_companyid_unique"
    );
  }
};
