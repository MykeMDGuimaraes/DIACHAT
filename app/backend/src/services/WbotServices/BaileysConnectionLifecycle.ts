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

type ListenerFence = (
  handler: (value: any) => Promise<void>
) => (value: any) => Promise<void>;

export const registerBaileysConnectionLifecycle = (
  socket: BaileysLifecycleSocket,
  context: WhatsAppProviderEventContext,
  connectionManager: (update: any) => Promise<void>,
  registerMirror: MirrorRegistration = registerBaileysMirrorLifecycleListeners,
  fenceListener?: ListenerFence
): void => {
  // Com fence, os listeners do mirror (connection.update, messages.upsert,
  // messages.update) sao registrados via facade: callbacks de geracao
  // substituida ficam inertes e nao publicam eventos do provedor.
  const mirrorTarget: BaileysLifecycleSocket = fenceListener
    ? {
        ev: {
          on: (event, handler) => socket.ev.on(event, fenceListener(handler))
        }
      }
    : socket;
  registerMirror(mirrorTarget, context);
  socket.ev.on("connection.update", connectionManager);
};
