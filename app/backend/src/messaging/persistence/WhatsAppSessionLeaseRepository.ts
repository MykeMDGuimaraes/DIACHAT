import { QueryTypes } from "sequelize";
import WhatsAppSessionLease from "./models/WhatsAppSessionLease";

export interface SessionLease {
  whatsappId: number;
  ownerId: string;
  fencingToken: string;
  expiresAt: Date;
  heartbeatAt: Date;
}

export interface AcquireLeaseInput {
  whatsappId: number;
  ownerId: string;
  ttlMs: number;
}

interface LeaseRow {
  whatsappId: number;
  ownerId: string;
  fencingToken: string;
  expiresAt: Date;
  heartbeatAt: Date;
}

const TABLE = 'messaging."WhatsAppSessionLeases"';

const toLease = (row: LeaseRow): SessionLease => ({
  whatsappId: row.whatsappId,
  ownerId: row.ownerId,
  fencingToken: String(row.fencingToken),
  expiresAt: row.expiresAt,
  heartbeatAt: row.heartbeatAt
});

const query = async <T = unknown>(
  sql: string,
  replacements: Record<string, unknown>
): Promise<T[]> => {
  const sequelize = WhatsAppSessionLease.sequelize;
  if (!sequelize) {
    throw new Error("WhatsAppSessionLease model is not bound to sequelize");
  }
  return sequelize.query(sql, {
    replacements,
    type: QueryTypes.SELECT
  }) as Promise<T[]>;
};

/**
 * Aquisicao atomica da lease do canal. Uma unica instrucao INSERT ... ON
 * CONFLICT garante exclusividade entre processos/replicas: so obtem a lease
 * quem cria a row, ja e o dono, ou encontra a lease expirada (NOW() do
 * PostgreSQL e o relogio de referencia). Retorna null quando outro owner
 * detem uma lease vigente — o chamador deve falhar fechado (nao abrir socket).
 *
 * O fencingToken e SEMPRE incrementado numa aquisicao por conflito: como a
 * row sobrevive a liberacao (ver releaseSessionLease), as geracoes sao
 * estritamente monotonicas e um token antigo nunca volta a ser vigente.
 */
export const acquireSessionLease = async ({
  whatsappId,
  ownerId,
  ttlMs
}: AcquireLeaseInput): Promise<SessionLease | null> => {
  const rows = await query<LeaseRow>(
    `INSERT INTO ${TABLE}
       ("whatsappId", "ownerId", "fencingToken", "expiresAt", "heartbeatAt", "createdAt", "updatedAt")
     VALUES
       (:whatsappId, :ownerId, 1, NOW() + (:ttlMs * interval '1 millisecond'), NOW(), NOW(), NOW())
     ON CONFLICT ("whatsappId") DO UPDATE
       SET "ownerId" = :ownerId,
           "fencingToken" = ${TABLE}."fencingToken" + 1,
           "expiresAt" = NOW() + (:ttlMs * interval '1 millisecond'),
           "heartbeatAt" = NOW(),
           "updatedAt" = NOW()
     WHERE ${TABLE}."expiresAt" < NOW() OR ${TABLE}."ownerId" = :ownerId
     RETURNING "whatsappId", "ownerId", "fencingToken", "expiresAt", "heartbeatAt"`,
    { whatsappId, ownerId, ttlMs }
  );
  return rows.length > 0 ? toLease(rows[0]) : null;
};

/**
 * Renovacao condicional: so renova se ownerId E fencingToken ainda forem os
 * vigentes. Retorna false quando a lease foi tomada por outro owner — o
 * chamador deve fechar o socket imediatamente.
 */
export const renewSessionLease = async ({
  whatsappId,
  ownerId,
  fencingToken,
  ttlMs
}: {
  whatsappId: number;
  ownerId: string;
  fencingToken: string;
  ttlMs: number;
}): Promise<boolean> => {
  const rows = await query<{ whatsappId: number }>(
    `UPDATE ${TABLE}
       SET "expiresAt" = NOW() + (:ttlMs * interval '1 millisecond'),
           "heartbeatAt" = NOW(),
           "updatedAt" = NOW()
     WHERE "whatsappId" = :whatsappId
       AND "ownerId" = :ownerId
       AND "fencingToken" = :fencingToken
     RETURNING "whatsappId"`,
    { whatsappId, ownerId, fencingToken, ttlMs }
  );
  return rows.length > 0;
};

/**
 * Liberacao explicita no stop: a row NAO e removida, apenas expirada — ela
 * preserva a linhagem do fencingToken, garantindo geracoes monotonicas entre
 * ciclos de stop/start. So expira se ownerId e fencingToken forem os
 * vigentes, impedindo que um processo pausado derrube a lease de um sucessor.
 * Retorna true quando a row foi expirada.
 */
export const releaseSessionLease = async ({
  whatsappId,
  ownerId,
  fencingToken
}: {
  whatsappId: number;
  ownerId: string;
  fencingToken: string;
}): Promise<boolean> => {
  const rows = await query<{ whatsappId: number }>(
    `UPDATE ${TABLE}
       SET "expiresAt" = NOW() - interval '1 millisecond',
           "updatedAt" = NOW()
     WHERE "whatsappId" = :whatsappId
       AND "ownerId" = :ownerId
       AND "fencingToken" = :fencingToken
     RETURNING "whatsappId"`,
    { whatsappId, ownerId, fencingToken }
  );
  return rows.length > 0;
};
