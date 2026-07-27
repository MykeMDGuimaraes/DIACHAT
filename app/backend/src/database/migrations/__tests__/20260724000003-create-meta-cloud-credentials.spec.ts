export {};

const migration = require("../20260724000003-create-meta-cloud-credentials");

describe("20260724000003-create-meta-cloud-credentials", () => {
  it("adds provider identity to channels and stores Meta credentials in messaging", async () => {
    const queryInterface = {
      addColumn: jest.fn(),
      sequelize: { query: jest.fn() },
      createTable: jest.fn(),
      addIndex: jest.fn()
    };

    await migration.up(queryInterface);

    expect(queryInterface.addColumn).toHaveBeenCalledWith(
      "Whatsapps",
      "channelType",
      expect.objectContaining({ defaultValue: "baileys" })
    );
    expect(queryInterface.createTable).toHaveBeenCalledWith(
      { tableName: "MetaCloudCredentials", schema: "messaging" },
      expect.objectContaining({
        appId: expect.any(Object),
        accessTokenCiphertext: expect.any(Object),
        appSecretCiphertext: expect.any(Object),
        verifyTokenHash: expect.any(Object)
      })
    );
    expect(queryInterface.addIndex).toHaveBeenCalledWith(
      { tableName: "MetaCloudCredentials", schema: "messaging" },
      ["publicId"],
      expect.objectContaining({ unique: true })
    );
  });
});
