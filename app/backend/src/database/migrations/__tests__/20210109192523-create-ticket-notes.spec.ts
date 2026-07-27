export {};

const migration = require("../20210109192523-create-ticket-notes");

describe("20210109192523-create-ticket-notes", () => {
  it("drops TicketNotes without touching the Plans table", async () => {
    const queryInterface = {
      dropTable: jest.fn().mockResolvedValue(undefined)
    };

    await migration.down(queryInterface);

    expect(queryInterface.dropTable).toHaveBeenCalledWith("TicketNotes");
    expect(queryInterface.dropTable).not.toHaveBeenCalledWith("Plans");
  });
});
