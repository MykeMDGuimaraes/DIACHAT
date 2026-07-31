export function randomString(len: number, charSet?: string) {
  charSet =
    charSet || "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < len; i++) {
    const randomPoz = Math.floor(Math.random() * charSet.length);
    result += charSet.substring(randomPoz, randomPoz + 1);
  }
  return result;
}
