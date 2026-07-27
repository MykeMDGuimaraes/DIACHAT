import { execFileSync } from "child_process";
import path from "path";

describe("Baileys public facades", () => {
  const backendRoot = path.resolve(__dirname, "../../../..");

  const importFacade = (modulePath: string): void => {
    execFileSync(
      process.execPath,
      [
        "-r",
        "ts-node/register/transpile-only",
        "-e",
        `require(${JSON.stringify(modulePath)})`
      ],
      {
        cwd: backendRoot,
        encoding: "utf8",
        stdio: "pipe"
      }
    );
  };

  it("loads the SDK facade without evaluating the ticket provider cycle", () => {
    expect(() => importFacade("./src/messaging/public/baileys")).not.toThrow();
  });

  it("loads the ticket messaging facade without a circular initialization", () => {
    expect(() =>
      importFacade("./src/messaging/public/baileysTicketMessaging")
    ).not.toThrow();
  });
});
