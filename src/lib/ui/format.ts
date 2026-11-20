const separator = "\u00a0";
const integerFormat = new Intl.NumberFormat("ru-KZ", { maximumFractionDigits: 0 });
const latencyFormat = new Intl.NumberFormat("ru-KZ", { maximumFractionDigits: 2 });

export function formatTenge(amount: number) {
  if (!Number.isFinite(amount)) return "—";
  const number = integerFormat.formatToParts(amount)
    .map(part => part.type === "group" ? separator : part.value)
    .join("");
  return number + separator + "₸";
}

export function formatIban(iban: string) {
  return iban.replace(/\s/g, "").toUpperCase().match(/.{1,4}/g)?.join(separator) ?? "";
}

export function shortHash(hash: string, visible = 8) {
  const length = Number.isFinite(visible) ? Math.max(1, Math.trunc(visible)) : 8;
  return hash.length <= length * 2 + 1 ? hash : `${hash.slice(0, length)}…${hash.slice(-length)}`;
}

/** Hash fingerprint: the head and tail of a digest in groups of four, like `7f3a 91c0 … 2b7e c4e2`. */
export function fingerprint(hash: string, groups = 2) {
  const count = Number.isFinite(groups) ? Math.max(1, Math.trunc(groups)) : 2;
  const visible = count * 4;
  const group = (part: string) => part.match(/.{1,4}/g)?.join(separator) ?? part;
  if (hash.length <= visible * 2 + 1) return group(hash);
  return `${group(hash.slice(0, visible))}${separator}…${separator}${group(hash.slice(-visible))}`;
}

export function formatMs(ms: number) {
  return Number.isFinite(ms) && ms >= 0 ? latencyFormat.format(ms) + separator + "мс" : "—";
}
