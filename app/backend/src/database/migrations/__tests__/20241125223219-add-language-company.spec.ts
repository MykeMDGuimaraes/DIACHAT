const migration = require("../20241125223219-add-language-company");

describe("20241125223219-add-language-company", () => {
  it("reverts the language column from the same Companies table used by up", async () => {
    const queryInterface = {
      removeColumn: jest.fn().mockResolvedValue(undefined)
    };

    await migration.down(queryInterface);

    expect(queryInterface.removeColumn).toHaveBeenCalledWith(
      "Companies",
      "language"
    );
  });
});
