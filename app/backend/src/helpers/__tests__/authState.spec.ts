import authState from "../authState";

jest.mock("../../messaging/public/baileys", () => ({
  BufferJSON: { replacer: undefined, reviver: undefined },
  initAuthCreds: jest.fn(() => ({ noiseKey: {}, signedIdentityKey: {} })),
  proto: {
    Message: { AppStateSyncKeyData: { fromObject: (value: unknown) => value } }
  }
}));

const makeWhatsapp = () =>
  ({
    session: "",
    update: jest.fn().mockResolvedValue([1])
  } as any);

describe("authState", () => {
  it("persiste credenciais enquanto a geracao e vigente", async () => {
    const whatsapp = makeWhatsapp();
    const { saveState } = await authState(whatsapp, () => true);

    await saveState();

    expect(whatsapp.update).toHaveBeenCalledWith({
      session: expect.any(String)
    });
  });

  it("para de persistir quando a geracao e substituida — inclusive via keys.set", async () => {
    const whatsapp = makeWhatsapp();
    let current = true;
    const { state, saveState } = await authState(whatsapp, () => current);

    await saveState();
    expect(whatsapp.update).toHaveBeenCalledTimes(1);

    // Geracao substituida: nem creds.update nem keys.set gravam mais nada.
    current = false;
    state.keys.set({ session: { "1:abc": {} } } as any);
    await saveState();

    expect(whatsapp.update).toHaveBeenCalledTimes(1);
  });

  it("sem guarda (padrao) persiste sempre — compatibilidade legada", async () => {
    const whatsapp = makeWhatsapp();
    const { state } = await authState(whatsapp);

    state.keys.set({ session: { "1:abc": {} } } as any);

    expect(whatsapp.update).toHaveBeenCalled();
  });
});
