import { shouldApplyMetaStatusUpdate } from "../MetaInboxProcessor";

describe("shouldApplyMetaStatusUpdate", () => {
  it.each([
    ["delivered", "sent", false],
    ["read", "sent", false],
    ["read", "delivered", false],
    ["sent", "delivered", true],
    ["delivered", "read", true],
    ["delivered", "failed", false],
    ["read", "failed", false],
    ["sent", "failed", true],
    ["unknown", "failed", true],
    ["failed", "sent", false],
    ["failed", "delivered", true],
    ["failed", "read", true]
  ])(
    "current %s with incoming %s returns %s",
    (current, incoming, expected) => {
      expect(shouldApplyMetaStatusUpdate(current, incoming)).toBe(expected);
    }
  );
});
