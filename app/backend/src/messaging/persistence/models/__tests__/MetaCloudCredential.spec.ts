import { Sequelize } from "sequelize-typescript";
import MetaCloudCredential from "../MetaCloudCredential";

describe("MetaCloudCredential", () => {
  it("uses the messaging schema and stores only encrypted Meta secrets", () => {
    const sequelize = new Sequelize({ dialect: "postgres", logging: false });
    sequelize.addModels([MetaCloudCredential]);

    expect(MetaCloudCredential.getTableName()).toMatchObject({
      tableName: "MetaCloudCredentials",
      schema: "messaging"
    });
    expect(MetaCloudCredential.getAttributes()).toMatchObject({
      accessTokenCiphertext: expect.any(Object),
      appSecretCiphertext: expect.any(Object),
      verifyTokenHash: expect.any(Object),
      publicId: expect.any(Object)
    });
  });
});
