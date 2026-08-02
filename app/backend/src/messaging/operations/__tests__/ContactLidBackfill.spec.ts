import { planContactLidBackfill } from "../ContactLidBackfill";

describe("planContactLidBackfill", () => {
  it("moves a number only when persisted message evidence proves it is a LID", () => {
    expect(
      planContactLidBackfill({
        contact: {
          id: 12,
          number: "198642640113823",
          lid: null,
          jidServer: "phone"
        },
        messageJids: ["198642640113823@lid"]
      })
    ).toEqual({
      contactId: 12,
      changes: {
        number: null,
        lid: "198642640113823",
        jidServer: "lid"
      },
      status: "ready"
    });
  });

  it("keeps ambiguous numeric identifiers untouched", () => {
    expect(
      planContactLidBackfill({
        contact: {
          id: 13,
          number: "198642640113823",
          lid: null,
          jidServer: "phone"
        },
        messageJids: []
      })
    ).toEqual({ contactId: 13, changes: {}, status: "ambiguous" });
  });

  it("keeps the phone and adds the LID when both domains are proven", () => {
    expect(
      planContactLidBackfill({
        contact: {
          id: 14,
          number: "5511999999999",
          lid: null,
          jidServer: "phone"
        },
        messageJids: [
          "5511999999999@s.whatsapp.net",
          "198642640113823@lid"
        ]
      })
    ).toEqual({
      contactId: 14,
      changes: { lid: "198642640113823" },
      status: "ready"
    });
  });
});
