import {
  registerBaileysMirrorLifecycleListeners,
  WhatsAppProviderEventContext
} from "../../messaging/public/baileys";

interface BaileysLifecycleSocket {
  ev: {
    on(event: string, handler: (value: any) => Promise<void>): unknown;
  };
}

type MirrorRegistration = (
  socket: BaileysLifecycleSocket,
  context: WhatsAppProviderEventContext
) => void;

export const registerBaileysConnectionLifecycle = (
  socket: BaileysLifecycleSocket,
  context: WhatsAppProviderEventContext,
  connectionManager: (update: any) => Promise<void>,
  registerMirror: MirrorRegistration = registerBaileysMirrorLifecycleListeners
): void => {
  registerMirror(socket, context);
  socket.ev.on("connection.update", connectionManager);
};
