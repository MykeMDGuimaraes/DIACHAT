/**
 * Modo de armazenamento do auth-state: json (legado, padrao), dual_write ou
 * postgres. Valor desconhecido cai no modo legado — nunca quebra o boot.
 *
 * Modulo minimo, sem dependencias de adaptadores (T9): o resolver de coorte
 * (e specs) o importa sem arrastar o vendor Baileys, que nao e transpilado
 * pelo jest.
 */
export type SessionKeyStoreMode = "json" | "dual_write" | "postgres";

export const resolveAuthStoreMode = (
  environment: Record<string, string | undefined> = process.env
): SessionKeyStoreMode => {
  const raw = (environment.MESSAGING_AUTH_STORE_MODE ?? "json").trim();
  return raw === "dual_write" || raw === "postgres" ? raw : "json";
};
