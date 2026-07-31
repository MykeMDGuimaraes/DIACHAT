import AppError from "../../../errors/AppError";
import CapabilityResolver from "../CapabilityResolver";

describe("CapabilityResolver", () => {
  const resolver = new CapabilityResolver();
  it("declares the Phase 1 Baileys capabilities centrally", () => {
    expect(resolver.resolve("baileys").capabilities).toMatchObject({ text: true, media: true, presence: true, buttons: true, reactions: true, messageEdit: true, messageDelete: true, internalTemplate: true, officialTemplate: false });
  });
  it("rejects a Phase 1-only capability on Meta", () => {
    expect(() => resolver.require("meta_cloud", "presence")).toThrow(AppError);
  });
});
