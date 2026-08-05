import { logger } from "../utils/logger";

/**
 * Escritor serializado de auth-state por canal (Task 3 do hardening).
 *
 * Antes: cada keys.set/creds.update disparava um Whatsapp.update solto —
 * escritas concorrentes se embaralhavam (last-write-wins com snapshot
 * defasado) e falhas caíam em console.log silencioso.
 *
 * Agora: toda escrita entra numa fila de Promises POR CANAL e executa em
 * ordem de enfileiramento (revisão monotônica). O snapshot é obtido dentro
 * da fila, então mutações concorrentes nunca se perdem. O fence de geração
 * é avaliado na EXECUÇÃO (não no enqueue): um replace entre enfileirar e
 * rodar torna a escrita inerte. Falha de banco rejeita a operação com log
 * estruturado; falhas consecutivas além do limite sinalizam a sessão (uma
 * única vez até que um sucesso zere o contador) sem apagar o último
 * snapshot válido.
 */

export const AUTH_WRITE_FAILURE_LIMIT = 3;

export interface AuthWriteJob {
  whatsappId: number;
  /** Fence avaliado na execução: retornar false torna a escrita inerte. */
  shouldWrite: () => boolean;
  /**
   * Persiste o snapshot obtido NO MOMENTO da execução. Recebe a revisão
   * monotônica da fila do canal — usada como fencing na persistência por
   * chave (Hardening T6).
   */
  persist: (revision: number) => Promise<unknown>;
  /** Chamado uma única vez ao atingir o limite de falhas consecutivas. */
  onPersistentFailure?: (whatsappId: number) => void | Promise<void>;
}

const queues = new Map<number, Promise<void>>();
const nextRevision = new Map<number, number>();
const consecutiveFailures = new Map<number, number>();

const execute = async (job: AuthWriteJob, revision: number): Promise<void> => {
  // Fence na execução: entre enfileirar e rodar, um replace pode ter
  // publicado geração nova — a escrita vencida não toca o banco.
  if (!job.shouldWrite()) {
    logger.debug(
      { whatsappId: job.whatsappId, revision },
      "auth-state: escrita ignorada (geracao substituida)"
    );
    return;
  }

  try {
    await job.persist(revision);
    consecutiveFailures.set(job.whatsappId, 0);
  } catch (error) {
    // Fence reavaliado na FALHA: se um replace publicou geração nova
    // enquanto a escrita estava em voo, esta falha pertence à geração
    // vencida — não entra no contador do canal nem sinaliza a sessão
    // (um socket obsoleto não pode derrubar o status da sessão nova).
    if (!job.shouldWrite()) {
      logger.debug(
        { whatsappId: job.whatsappId, revision },
        "auth-state: falha de escrita em geracao substituida (ignorada)"
      );
      throw error;
    }
    const failures = (consecutiveFailures.get(job.whatsappId) ?? 0) + 1;
    consecutiveFailures.set(job.whatsappId, failures);
    // Estruturado e sem conteúdo sensível: ids, revisão e mensagem do erro.
    logger.error(
      {
        whatsappId: job.whatsappId,
        revision,
        failures,
        err: (error as Error)?.message ?? String(error)
      },
      "auth-state: falha ao persistir credenciais"
    );
    if (failures === AUTH_WRITE_FAILURE_LIMIT && job.onPersistentFailure) {
      Promise.resolve(job.onPersistentFailure(job.whatsappId)).catch(
        callbackError =>
          logger.error(
            {
              whatsappId: job.whatsappId,
              err: (callbackError as Error)?.message ?? String(callbackError)
            },
            "auth-state: callback de falha persistente falhou"
          )
      );
    }
    throw error;
  }
};

export const enqueueAuthStateWrite = (job: AuthWriteJob): Promise<void> => {
  // Revisão monotônica por canal: sobrevive a períodos ociosos da fila,
  // preservando a ordenação observável nos logs entre gerações.
  const revision = (nextRevision.get(job.whatsappId) ?? 0) + 1;
  nextRevision.set(job.whatsappId, revision);

  const previous = queues.get(job.whatsappId) ?? Promise.resolve();
  // A fila sobrevive à falha de um item: a próxima escrita não fica refém
  // da rejeição anterior.
  const run = previous
    .catch(() => undefined)
    .then(() => execute(job, revision));
  queues.set(job.whatsappId, run);

  const cleanup = (): void => {
    if (queues.get(job.whatsappId) === run) {
      queues.delete(job.whatsappId);
      // O contador de falhas NÃO zera no ocioso: creds.update chega em
      // eventos esparsos (fila ociosa entre eles) e falhas consecutivas
      // precisam se acumular entre os eventos. Zera só no sucesso.
    }
  };
  run.then(cleanup, cleanup);

  // Nem todo chamador aguarda a escrita (ex.: removePreKey do libsignal
  // chama keys.set sem await): o guard evita rejeição não tratada sem
  // esconder o erro de quem aguarda a Promise retornada.
  run.catch(() => undefined);
  return run;
};
