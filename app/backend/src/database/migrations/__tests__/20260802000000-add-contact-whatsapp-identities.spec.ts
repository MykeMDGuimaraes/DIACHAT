const migration = require("../20260802000000-add-contact-whatsapp-identities");

export {};

describe("contact WhatsApp identities migration", () => {
  it("adds nullable phone, addressing fields, constraint and partial LID index", async () => {
    const changeColumn = jest.fn();
    const addColumn = jest.fn();
    const query = jest.fn().mockResolvedValue([]);

    await migration.up({
      changeColumn,
      addColumn,
      describeTable: jest.fn().mockResolvedValue({ number: {} }),
      sequelize: { query }
    });

    expect(changeColumn).toHaveBeenCalledWith(
      "Contacts",
      "number",
      expect.objectContaining({ allowNull: true })
    );
    expect(addColumn).toHaveBeenCalledWith(
      "Contacts",
      "jidServer",
      expect.objectContaining({ allowNull: false, defaultValue: "phone" })
    );
    expect(addColumn).toHaveBeenCalledWith(
      "Contacts",
      "lid",
      expect.objectContaining({ allowNull: true })
    );
    expect(query.mock.calls.some(([sql]) => sql.includes("contacts_jid_server_check"))).toBe(true);
    expect(query.mock.calls.some(([sql]) => sql.includes("contacts_company_whatsapp_lid_unique"))).toBe(true);
  });

  it("removes only the additive identity objects on rollback", async () => {
    const removeIndex = jest.fn();
    const removeColumn = jest.fn();
    const query = jest.fn().mockResolvedValue([{ found: 1 }]);

    await migration.down({
      removeIndex,
      removeColumn,
      describeTable: jest.fn().mockResolvedValue({
        number: {},
        jidServer: {},
        lid: {}
      }),
      sequelize: { query }
    });

    expect(removeIndex).toHaveBeenCalledWith(
      "Contacts",
      "contacts_company_whatsapp_lid_unique"
    );
    expect(removeColumn).toHaveBeenCalledWith("Contacts", "lid");
    expect(removeColumn).toHaveBeenCalledWith("Contacts", "jidServer");
  });
});
