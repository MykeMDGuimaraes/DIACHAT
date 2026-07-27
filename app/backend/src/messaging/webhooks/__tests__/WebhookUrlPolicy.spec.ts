import { validateResolvedAddress, validateWebhookUrl } from "../WebhookUrlPolicy";

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

  it.each(["10.0.0.1", "100.64.0.1", "172.16.0.1", "192.168.1.1", "224.0.0.1", "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1"])(
    "rejects a private or special DNS resolution: %s",
    address => expect(() => validateResolvedAddress(address)).toThrow()
  );

  it.each(["8.8.8.8", "2606:4700:4700::1111"])("accepts a public DNS resolution: %s", address => {
    expect(() => validateResolvedAddress(address)).not.toThrow();
  });
});
