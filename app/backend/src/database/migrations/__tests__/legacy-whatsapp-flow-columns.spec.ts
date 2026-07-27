const flowIdNotPhraseMigration = require("../20250111132300-add-column-flowIdNotPhrase-to-whatsapp");
const flowIdWelcomeMigration = require("../20250111132330-add-column-flowIdWelcome-to-whatsapp");

describe.each([
  ["flowIdNotPhrase", flowIdNotPhraseMigration],
  ["flowIdWelcome", flowIdWelcomeMigration]
])("legacy Whatsapp migration for %s", (column, migration) => {
  it("returns the Sequelize promise when reverting", async () => {
    const operation = Promise.resolve();
    const queryInterface = {
      removeColumn: jest.fn(() => operation)
    };

    const result = migration.down(queryInterface);

    expect(result).toBe(operation);
    await expect(result).resolves.toBeUndefined();
    expect(queryInterface.removeColumn).toHaveBeenCalledWith(
      "Whatsapps",
      column
    );
  });
});
