import { createLifecycleEventIdentity } from "../LifecycleEventIdentity";

describe("LifecycleEventIdentity", () => {
  it("does not use content hashes as ordering for equal or missing timestamps", () => {
    const first = createLifecycleEventIdentity({
      provider: "baileys",
      kind: "chat",
      content: { archived: false }
    });
    const later = createLifecycleEventIdentity({
      provider: "baileys",
      kind: "chat",
      content: { archived: true }
    });
    const equalTimestamp = createLifecycleEventIdentity({
      provider: "baileys",
      kind: "chat",
      providerTimestamp: 1722000000,
      content: { archived: true }
    });

    expect(first.revision).toBe("0");
    expect(later.revision).toBe("0");
    expect(equalTimestamp.revision).toBe("1722000000000");
    expect(first.providerEventId).not.toBe(later.providerEventId);
  });
});
