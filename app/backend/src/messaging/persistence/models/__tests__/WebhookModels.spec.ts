import { Sequelize } from "sequelize-typescript";
import WebhookDelivery from "../WebhookDelivery";
import WebhookSubscription from "../WebhookSubscription";

describe("external webhook models", () => {
  it("use dedicated messaging tables instead of the legacy FlowBuilder Webhooks table", () => {
    const sequelize = new Sequelize({ dialect: "postgres", logging: false });
    sequelize.addModels([WebhookSubscription, WebhookDelivery]);

    expect(WebhookSubscription.getTableName()).toMatchObject({
      tableName: "WebhookSubscriptions",
      schema: "messaging"
    });
    expect(WebhookDelivery.getTableName()).toMatchObject({
      tableName: "WebhookDeliveries",
      schema: "messaging"
    });
  });
});
