import { Sequelize } from "sequelize-typescript";
import MessageCommand from "../MessageCommand";

describe("MessageCommand model", () => {
  it("keeps durable command state in the messaging schema", () => {
    const sequelize = new Sequelize({ dialect: "postgres", logging: false });
    sequelize.addModels([MessageCommand]);

    expect(MessageCommand.getTableName()).toEqual(
      expect.objectContaining({
      tableName: "MessageCommands",
      schema: "messaging",
      delimiter: "."
      })
    );
  });
});
