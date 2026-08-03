/**
 * Números móveis brasileiros circulam em duas formas: com e sem o nono
 * dígito (55 + DDD + 9 + 8 dígitos = 13 dígitos; sem o 9 = 12 dígitos).
 * O WhatsApp entrega o senderPn em uma forma (sem o 9 em algumas regiões)
 * e quem disca/importa informa a outra — sem tratar a variante, o mesmo
 * contato acaba cadastrado duas vezes, uma para cada forma do número.
 *
 * Retorna o número informado mais a variante do nono dígito quando o
 * formato é de celular brasileiro; para qualquer outro formato retorna
 * apenas o próprio número.
 */
const brazilianNinthDigitVariants = (number: string): string[] => {
  if (!/^55\d{10,11}$/.test(number)) {
    return [number];
  }
  if (number.length === 13 && number[4] === "9") {
    return [number, number.slice(0, 4) + number.slice(5)];
  }
  if (number.length === 12) {
    return [number, `${number.slice(0, 4)}9${number.slice(4)}`];
  }
  return [number];
};

export default brazilianNinthDigitVariants;
