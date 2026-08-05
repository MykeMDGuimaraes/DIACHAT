import { getSessionManager } from "./WhatsAppSessionManager";

/**
 * Envelopa handlers de eventos de socket com fencing de geracao.
 *
 * Um socket substituido (replace/stop) tem seus listeners removidos pelo
 * teardown do manager, mas um handler JA em voo ou reemitido na fronteira
 * assincrona ainda pode disparar. Com a geracao capturada, o handler de uma
 * geracao vencida fica inerte: nao processa mensagens, nao emite Socket.IO
 * e nao fecha/reconecta a sessao nova.
 *
 * Sem geracao (chamador legado) o handler executa direto, como antes.
 */
export const fenceSessionListener = <Args extends unknown[]>(
  whatsappId: number | undefined,
  generation: string | undefined,
  handler: (...args: Args) => unknown
): ((...args: Args) => Promise<unknown>) => {
  return async (...args: Args) => {
    if (whatsappId == null || !generation) {
      return handler(...args);
    }
    return getSessionManager().runFenced(whatsappId, generation, () =>
      handler(...args)
    );
  };
};
