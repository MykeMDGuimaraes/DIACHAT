import { Sequelize } from "sequelize-typescript";
import MessagingOutboxEvent from "../MessagingOutboxEvent";

describe("MessagingOutboxEvent model", () => {
  it("stores reliable domain events in the messaging schema", () => {
    const sequelize = new Sequelize({ dialect: "postgres", logging: false });
    sequelize.addModels([MessagingOutboxEvent]);

    expect(MessagingOutboxEvent.getTableName()).toEqual(
      expect.objectContaining({
        tableName: "MessagingOutboxEvents",
        schema: "messaging"
      })
    );
  });
});
