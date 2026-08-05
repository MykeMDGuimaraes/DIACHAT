import { registerBaileysMirrorLifecycleListeners } from "../../../messaging/public/baileys";
import { registerBaileysConnectionLifecycle } from "../BaileysConnectionLifecycle";

jest.mock("../../../messaging/adapters/baileys/BaileysExports", () => ({
  __esModule: true,
  default: {}
}));
jest.mock("../../../messaging/adapters/baileys/BaileysSocketPort", () => ({
  sendBaileysSocketMessage: jest.fn()
}));
jest.mock("../../../messaging/adapters/baileys/BaileysLogger", () => ({
  __esModule: true,
  default: {}
}));

describe("BaileysConnectionLifecycle", () => {
  it("registers the mirror before the connection manager so the initial open is published before resolve", async () => {
    const handlers: Array<(value: any) => Promise<void>> = [];
    const order: string[] = [];
    const socket = {
      ev: {
        on: (
          event: string,
          handler: (value: any) => Promise<void>
        ): unknown => {
          if (event === "connection.update") handlers.push(handler);
          return undefined;
        }
      }
    };
    const publish = jest.fn(async events => {
      order.push(`mirror:${events[0].eventType}`);
    });
    const manager = jest.fn(async update => {
      order.push(`manager:${update.connection}`);
    });

    registerBaileysConnectionLifecycle(
      socket,
      { companyId: 7, whatsappId: 42 },
      manager,
      (target, context) =>
        registerBaileysMirrorLifecycleListeners(
          target,
          context,
          publish,
          () => new Date("2024-07-26T13:20:04.000Z")
        )
    );
    for (const handler of handlers) {
      await handler({ connection: "open" });
    }

    expect(handlers).toHaveLength(2);
    expect(order).toEqual([
      "mirror:connection.updated",
      "manager:open"
    ]);
  });

  it("com fence, os listeners do mirror sao envelopados (geracao substituida fica inerte)", async () => {
    const handlers: Array<(value: any) => Promise<void>> = [];
    const socket = {
      ev: {
        on: (
          event: string,
          handler: (value: any) => Promise<void>
        ): unknown => {
          if (event === "connection.update") handlers.push(handler);
          return undefined;
        }
      }
    };
    const publish = jest.fn(async () => undefined);
    const manager = jest.fn(async () => undefined);
    // Fence que suprime tudo: simula geracao substituida.
    const fence = jest.fn(
      () => async (): Promise<void> => undefined
    );

    registerBaileysConnectionLifecycle(
      socket,
      { companyId: 7, whatsappId: 42 },
      manager,
      (target, context) =>
        registerBaileysMirrorLifecycleListeners(target, context, publish),
      fence
    );
    for (const handler of handlers) {
      await handler({ connection: "open" });
    }

    // O mirror registrou seu connection.update via facade (envelopado);
    // o connection manager segue direto no socket.
    expect(fence).toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(manager).toHaveBeenCalledWith({ connection: "open" });
  });
});
