import { Sequelize } from "sequelize-typescript";
import ApiCredential from "../ApiCredential";

describe("ApiCredential model", () => {
  it("keeps public API credentials in the messaging schema", () => {
    const sequelize = new Sequelize({ dialect: "postgres", logging: false });
    sequelize.addModels([ApiCredential]);

    expect(ApiCredential.getTableName()).toEqual(
      expect.objectContaining({
        tableName: "ApiCredentials",
        schema: "messaging",
        delimiter: "."
      })
    );
  });
});
