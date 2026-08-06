import sequelize from "../../../database";
import MessagingRolloutCohort from "../models/MessagingRolloutCohort";
import {
  AUTH_STORE_COHORT_CAPABILITY,
  flushAuthStoreCohortCache,
  resolveAuthStoreModeForCompany
} from "../AuthStoreCohortResolver";

// Banco real (diachat_test): a coorte é um mecanismo persistido — mocks não
// provariam a resolução nem o fallback operacional.
describe("AuthStoreCohortResolver (banco real, T9)", () => {
  beforeEach(async () => {
    flushAuthStoreCohortCache();
    await MessagingRolloutCohort.destroy({ where: {}, force: true });
  });

  afterAll(async () => {
    await MessagingRolloutCohort.destroy({ where: {}, force: true });
    await sequelize.close();
  });

  const upsertCohort = async (companyId: number, mode: string) =>
    MessagingRolloutCohort.create({
      capability: AUTH_STORE_COHORT_CAPABILITY,
      companyId,
      mode
    });

  it("empresa em coorte usa o modo dela; empresa fora usa o default global", async () => {
    await upsertCohort(9001, "postgres");
    await upsertCohort(9002, "dual_write");

    expect(await resolveAuthStoreModeForCompany(9001, {})).toBe("postgres");
    expect(await resolveAuthStoreModeForCompany(9002, {})).toBe("dual_write");
    // Sem coorte: default global (env vazio -> json).
    expect(await resolveAuthStoreModeForCompany(9003, {})).toBe("json");
    // Empresa distinta: o cache de 60s por empresa reteria o fallback da
    // chamada anterior (env e estatico por processo; o cache so muda via
    // coorte persistida ou flush/TTL).
    expect(
      await resolveAuthStoreModeForCompany(9004, {
        MESSAGING_AUTH_STORE_MODE: "dual_write"
      })
    ).toBe("dual_write");
  });

  it("modo desconhecido na coorte cai no default global", async () => {
    await upsertCohort(9001, "modo-invalido");
    expect(
      await resolveAuthStoreModeForCompany(9001, {
        MESSAGING_AUTH_STORE_MODE: "dual_write"
      })
    ).toBe("dual_write");
  });

  it("companyId ausente cai no default global", async () => {
    expect(
      await resolveAuthStoreModeForCompany(null, {
        MESSAGING_AUTH_STORE_MODE: "postgres"
      })
    ).toBe("postgres");
  });

  it("cache de 60s segura leituras repetidas e flush reflete a troca", async () => {
    await upsertCohort(9001, "dual_write");
    expect(await resolveAuthStoreModeForCompany(9001, {})).toBe("dual_write");

    // Troca operacional: dentro do TTL o modo antigo permanece em cache...
    await MessagingRolloutCohort.update(
      { mode: "postgres" },
      { where: { capability: AUTH_STORE_COHORT_CAPABILITY, companyId: 9001 } }
    );
    expect(await resolveAuthStoreModeForCompany(9001, {})).toBe("dual_write");

    // ...e após o flush (ou o TTL) o modo novo passa a valer.
    flushAuthStoreCohortCache();
    expect(await resolveAuthStoreModeForCompany(9001, {})).toBe("postgres");
  });

  it("duas capacidades independentes não interferem entre si", async () => {
    await MessagingRolloutCohort.create({
      capability: "outra_capacidade",
      companyId: 9001,
      mode: "postgres"
    });
    // auth_store sem row para a empresa: default global mesmo com outra
    // capacidade presente.
    expect(await resolveAuthStoreModeForCompany(9001, {})).toBe("json");
  });
});
