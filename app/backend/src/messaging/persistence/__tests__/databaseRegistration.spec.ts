import sequelize from "../../../database";
import MessageCommand from "../models/MessageCommand";
import ConversationAutomationState from "../models/ConversationAutomationState";
import ConversationCommand from "../models/ConversationCommand";

describe("messaging persistence registration", () => {
  it("registers MessageCommand in the shared Sequelize instance", () => {
    expect(sequelize.isDefined(MessageCommand.name)).toBe(true);
    expect(sequelize.isDefined(ConversationAutomationState.name)).toBe(true);
    expect(sequelize.isDefined(ConversationCommand.name)).toBe(true);
  });
});
