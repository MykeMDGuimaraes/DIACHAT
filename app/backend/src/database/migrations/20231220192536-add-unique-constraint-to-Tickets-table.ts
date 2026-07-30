import { QueryInterface } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface) => {
    return (
      queryInterface.removeConstraint("Tickets", "contactid_companyid_unique"),
      queryInterface.addConstraint("Tickets", {
        fields: ["contactId", "companyId", "whatsappId"],
        type: "unique",
        name: "contactid_companyid_unique"
      } as any)
    );
  },

  down: (queryInterface: QueryInterface) => {
    return queryInterface.removeConstraint(
      "Tickets",
      "contactid_companyid_unique"
    );
  }
};
