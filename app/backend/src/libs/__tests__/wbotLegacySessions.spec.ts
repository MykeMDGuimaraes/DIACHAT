import {
  getLegacySession,
  getWbotSessionIds,
  LegacySocketRef,
  removeLegacySessionIfCurrent,
  trackLegacySession
} from "../wbotLegacySessions";

const fakeSocket = (): LegacySocketRef => ({
  logout: jest.fn(),
  ws: { close: jest.fn() }
});

describe("wbotLegacySessions", () => {
  it("registra e lista sockets por canal", () => {
    const socket = fakeSocket();
    trackLegacySession(10, socket);

    expect(getWbotSessionIds()).toContain(10);
    expect(getLegacySession(10)).toBe(socket);
  });

  it("track substitui referencia defasada do mesmo canal", () => {
    const oldSocket = fakeSocket();
    const newSocket = fakeSocket();
    trackLegacySession(11, oldSocket);
    trackLegacySession(11, newSocket);

    expect(getLegacySession(11)).toBe(newSocket);
    expect(getWbotSessionIds().filter(id => id === 11)).toHaveLength(1);
  });

  it("remove apenas o socket exato esperado", () => {
    const socket = fakeSocket();
    trackLegacySession(12, socket);

    expect(removeLegacySessionIfCurrent(12, fakeSocket())).toBe(false);
    expect(getLegacySession(12)).toBe(socket);

    expect(removeLegacySessionIfCurrent(12, socket)).toBe(true);
    expect(getLegacySession(12)).toBeUndefined();
  });

  it("corrida stop->start: a remocao da geracao antiga preserva a entrada da sessao nova", () => {
    const oldSocket = fakeSocket();
    const newSocket = fakeSocket();
    trackLegacySession(13, oldSocket);

    // removeWbot captura o socket alvo ANTES do stop...
    const target = getLegacySession(13);
    // ...uma start concorrente registra a sessao nova no canal...
    trackLegacySession(13, newSocket);
    // ...e so entao a limpeza legada da geracao antiga executa.
    expect(removeLegacySessionIfCurrent(13, target)).toBe(false);

    expect(getLegacySession(13)).toBe(newSocket);
    expect(getWbotSessionIds()).toContain(13);
  });
});
