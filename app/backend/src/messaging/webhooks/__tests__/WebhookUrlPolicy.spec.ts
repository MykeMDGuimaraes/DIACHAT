import { validateWebhookUrl } from "../WebhookUrlPolicy";

describe("validateWebhookUrl", () => {
  it("accepts an HTTPS public endpoint", () => {
    expect(() => validateWebhookUrl("https://hooks.example.com/diachat")).not.toThrow();
  });

  it.each([
    "http://hooks.example.com/diachat",
    "https://127.0.0.1/hook",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/hook",
    "https://user:password@hooks.example.com/hook"
  ])("rejects an unsafe webhook URL: %s", url => {
    expect(() => validateWebhookUrl(url)).toThrow();
  });
});
