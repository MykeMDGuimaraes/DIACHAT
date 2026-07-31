import {
  signTranscriptAttachment,
  signTranscriptAttachmentDetails,
  verifyTranscriptAttachment
} from "../TranscriptAttachmentSigner";

describe("TranscriptAttachmentSigner", () => {
  const originalSessionSecret = process.env.SESSION_SECRET;

  beforeEach(() => {
    process.env.SESSION_SECRET = "transcript-signing-secret";
  });

  afterAll(() => {
    process.env.SESSION_SECRET = originalSessionSecret;
  });

  it("issues a five-minute company-bound URL", () => {
    const now = new Date("2026-07-28T20:00:00.000Z");
    expect(signTranscriptAttachmentDetails("msg:id", 7, now).expiresAt).toBe(
      "2026-07-28T20:05:00.000Z"
    );
    const url = new URL(
      signTranscriptAttachment("msg:id", 7, now),
      "https://diachat.example"
    );

    expect(url.pathname).toBe("/api/v1/transcript/media/msg%3Aid");
    expect(
      verifyTranscriptAttachment({
        messageId: "msg:id",
        companyId: 7,
        expires: Number(url.searchParams.get("expires")),
        signature: String(url.searchParams.get("signature")),
        now
      })
    ).toBe(true);
  });

  it("rejects tampering and expiration", () => {
    const now = new Date("2026-07-28T20:00:00.000Z");
    const url = new URL(
      signTranscriptAttachment("msg-1", 7, now),
      "https://diachat.example"
    );
    const signature = String(url.searchParams.get("signature"));
    const expires = Number(url.searchParams.get("expires"));

    expect(
      verifyTranscriptAttachment({
        messageId: "msg-1",
        companyId: 8,
        expires,
        signature,
        now
      })
    ).toBe(false);
    expect(
      verifyTranscriptAttachment({
        messageId: "msg-1",
        companyId: 7,
        expires,
        signature,
        now: new Date("2026-07-28T20:05:01.000Z")
      })
    ).toBe(false);
  });
});
