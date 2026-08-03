import brazilianNinthDigitVariants from "../../helpers/brazilianNinthDigitVariants";

describe("brazilianNinthDigitVariants", () => {
  it("remove o nono dígito de celular brasileiro com 13 dígitos", () => {
    expect(brazilianNinthDigitVariants("5531990610568")).toEqual([
      "5531990610568",
      "553190610568"
    ]);
  });

  it("adiciona o nono dígito a celular brasileiro com 12 dígitos", () => {
    expect(brazilianNinthDigitVariants("553190610568")).toEqual([
      "553190610568",
      "5531990610568"
    ]);
  });

  it("gera variante para formato ambíguo (fixo ou celular sem o 9)", () => {
    // 55 + DDD + 8 dígitos pode ser fixo ou celular sem o 9; a variante é
    // gerada e a busca no banco (IN) decide qual forma existe de fato.
    expect(brazilianNinthDigitVariants("553132105566")).toEqual([
      "553132105566",
      "5531932105566"
    ]);
  });

  it("ignora número que não é brasileiro", () => {
    expect(brazilianNinthDigitVariants("14155552671")).toEqual(["14155552671"]);
  });

  it("ignora número brasileiro fora do formato de celular", () => {
    expect(brazilianNinthDigitVariants("08003335566")).toEqual([
      "08003335566"
    ]);
    expect(brazilianNinthDigitVariants("55119876")).toEqual(["55119876"]);
  });

  it("ignora identificadores de grupo", () => {
    expect(brazilianNinthDigitVariants("120363025241234567")).toEqual([
      "120363025241234567"
    ]);
  });
});
