import sequelize from "../../../database";
import MessageCommand from "../models/MessageCommand";

describe("messaging persistence registration", () => {
  it("registers MessageCommand in the shared Sequelize instance", () => {
    expect(sequelize.isDefined(MessageCommand.name)).toBe(true);
  });
});
