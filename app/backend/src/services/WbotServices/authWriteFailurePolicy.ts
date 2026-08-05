import { logger } from "../../utils/logger";
import Whatsapp from "../../models/Whatsapp";
import { getSessionManager } from "./WhatsAppSessionManager";

export interface AuthWriteFailureSignal {
  whatsapp: Whatsapp;
  generation: string;
  emit: (room: string, event: string, payload: unknown) => void;
}

/**
 * Sinalização de falha persistente de escrita de credenciais (Task 3 do
 * hardening): fecha e sinaliza a sessão SEM apagar o último snapshot
 * válido da credencial.
 *
 * Os efeitos rodam serializados na fila de lifecycle do canal
 * (runLifecycleEffect): um replace/stop não intercala com eles. Ainda
 * assim a geração é revalidada em CADA fronteira assíncrona, porque a
 * revogação síncrona de um replace não espera a fila — uma geração
 * vencida em voo não grava DISCONNECTED na sessão nova nem emite evento
 * obsoleto. A janela residual é a viagem ao banco do próprio update
 * (sem coluna de geração na tabela — condicionalidade total é Task 6).
 */
export const handleAuthWritePersistentFailure = async ({
  whatsapp,
  generation,
  emit
}: AuthWriteFailureSignal): Promise<void> => {
  const { id, companyId } = whatsapp;
  const manager = getSessionManager();

  const signalled = await manager.runLifecycleEffect(
    id,
    generation,
    async () => {
      // Revalidação imediata antes da escrita na linha compartilhada.
      if (!manager.isCurrent(id, generation)) return;
      logger.error(
        { whatsappId: id },
        "wbot: persistencia de credenciais falhando repetidamente — encerrando sessao (ultimo snapshot valido preservado)"
      );
      // Sinaliza SEM tocar na credencial: a coluna session guarda o último
      // snapshot válido e permite retomar o pareamento quando o banco voltar.
      try {
        await whatsapp.update({ status: "DISCONNECTED" });
        // Replace durante o update: o emit da geração vencida não sai.
        if (!manager.isCurrent(id, generation)) {
          logger.debug(
            { whatsappId: id },
            "wbot: emit de falha persistente suprimido (geracao substituida)"
          );
          return;
        }
        emit(
          `company-${companyId}-mainchannel`,
          `company-${companyId}-whatsappSession`,
          { action: "update", session: whatsapp }
        );
      } catch (signalError) {
        // A sinalização falha junto com o banco, mas o encerramento da
        // sessão não pode ficar refém dela.
        logger.error(
          {
            whatsappId: id,
            err: (signalError as Error)?.message ?? String(signalError)
          },
          "wbot: falha ao sinalizar encerramento por persistencia"
        );
      }
    }
  );

  if (!signalled) {
    logger.debug(
      { whatsappId: id },
      "wbot: sinalizacao de falha persistente ignorada (geracao substituida)"
    );
    return;
  }

  // Stop condicional FORA da fila do efeito: stopIfCurrent enfileira no
  // mesmo canal (dentro seria deadlock) e já é fenced por geração.
  await manager.stopIfCurrent(id, generation, "close");
};
