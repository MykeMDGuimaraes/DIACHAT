import {
  parseBaileysContactIdentity,
  resolveContactJid
} from "../BaileysContactIdentity";

describe("BaileysContactIdentity", () => {
  it("keeps a LID out of the phone number field", () => {
    expect(
      parseBaileysContactIdentity({
        primaryJid: "198642640113823@lid",
        whatsappId: 4
      })
    ).toEqual({
      number: null,
      lid: "198642640113823",
      groupId: null,
      jidServer: "lid",
      whatsappId: 4
    });
  });

  it("correlates PN and LID by their domains, regardless of field order", () => {
    expect(
      parseBaileysContactIdentity({
        primaryJid: "198642640113823@lid",
        alternateJid: "5511999999999@s.whatsapp.net",
        whatsappId: 4
      })
    ).toMatchObject({
      number: "5511999999999",
      lid: "198642640113823",
      jidServer: "lid"
    });

    expect(
      parseBaileysContactIdentity({
        primaryJid: "5511999999999@s.whatsapp.net",
        alternateJid: "198642640113823@lid",
        whatsappId: 4
      })
    ).toMatchObject({
      number: "5511999999999",
      lid: "198642640113823",
      jidServer: "phone"
    });
  });

  it("preserves the group local part", () => {
    expect(
      parseBaileysContactIdentity({
        primaryJid: "120363000000000000@g.us",
        whatsappId: 4
      })
    ).toEqual({
      number: "120363000000000000",
      lid: null,
      groupId: "120363000000000000",
      jidServer: "group",
      whatsappId: 4
    });
  });

  it("builds the outbound JID from the stored addressing mode", () => {
    expect(
      resolveContactJid({ number: null, lid: "198642640113823", jidServer: "lid", isGroup: false })
    ).toBe("198642640113823@lid");
    expect(
      resolveContactJid({ number: "5511999999999", lid: null, jidServer: "phone", isGroup: false })
    ).toBe("5511999999999@s.whatsapp.net");
    expect(
      resolveContactJid({ number: "120363000000000000", lid: null, jidServer: "group", isGroup: true })
    ).toBe("120363000000000000@g.us");
  });

  it("refuses to invent an address when the selected identity is absent", () => {
    expect(() =>
      resolveContactJid({ number: null, lid: null, jidServer: "lid", isGroup: false })
    ).toThrow("CONTACT_WHATSAPP_IDENTITY_UNAVAILABLE");
  });
});
