/**
 * Array legado de sockets (existe ate a Task 2 migrar os ultimos leitores).
 *
 * Regra de ouro: toda REMOCAO e por identidade de socket, nunca so por
 * whatsappId. Entre o stop de uma sessao e a limpeza do array, uma start
 * concorrente pode registrar um socket novo no mesmo canal — remover por ID
 * apagaria a entrada da sessao nova (corrida apontada em code review).
 */

/** Forma minima de um socket Baileys para o array legado. */
export interface LegacySocketRef {
  id?: number;
  user?: unknown;
  logout(): unknown;
  ws: { close(): unknown };
}

const sessions: LegacySocketRef[] = [];

export const getWbotSessionIds = (): number[] =>
  sessions
    .map(session => session.id)
    .filter((id): id is number => typeof id === "number");

export const getLegacySession = <T extends LegacySocketRef>(
  whatsappId: number
): T | undefined => sessions.find(s => s.id === whatsappId) as T | undefined;

/** Registra o socket, substituindo referencias defasadas do mesmo canal. */
export const trackLegacySession = <T extends LegacySocketRef>(
  whatsappId: number,
  socket: T
): void => {
  socket.id = whatsappId;
  const sessionIndex = sessions.findIndex(s => s.id === whatsappId);
  if (sessionIndex === -1) {
    sessions.push(socket);
  } else if (sessions[sessionIndex] !== socket) {
    sessions[sessionIndex] = socket;
  }
};

/**
 * Remove a entrada SOMENTE se for exatamente o socket esperado. Retorna
 * false — preservando a entrada — quando uma geracao mais nova ocupou o
 * lugar (a entrada passa a pertencer a ela).
 */
export const removeLegacySessionIfCurrent = (
  whatsappId: number,
  expected: LegacySocketRef
): boolean => {
  const sessionIndex = sessions.findIndex(s => s.id === whatsappId);
  if (sessionIndex === -1 || sessions[sessionIndex] !== expected) {
    return false;
  }
  sessions.splice(sessionIndex, 1);
  return true;
};
