import { canonicalJsonBytes, sha256Hex } from "../WhatsAppMirrorCanonical";

describe("WhatsApp mirror canonical serialization", () => {
  it("emits exact canonical UTF-8 bytes with recursive key ordering and null normalization", () => {
    const bytes = canonicalJsonBytes({
      z: "olá",
      arr: [3, undefined],
      a: { y: undefined, b: 2 }
    });

    expect(bytes.toString("utf8")).toBe(
      '{"a":{"b":2,"y":null},"arr":[3,null],"z":"olá"}'
    );
    expect(bytes.byteLength).toBe(48);
  });

  it("computes the lowercase SHA-256 digest of the exact canonical bytes", () => {
    const bytes = Buffer.from(
      '{"a":{"b":2,"y":null},"arr":[3,null],"z":"olá"}',
      "utf8"
    );

    expect(sha256Hex(bytes)).toBe(
      "a019123f36aced3596962cf32bafffb866b5cd5a9364486db3a42f53344ae2d4"
    );
  });
});
