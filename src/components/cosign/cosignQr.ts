// QR Code Model 2, byte mode, error correction L. These versions cover short
// demo links and longer deployment hostnames without a remote image service.
const symbols = [
  { version: 3, data: 55, ecc: 15, blocks: 1, alignment: [6, 22] },
  { version: 4, data: 80, ecc: 20, blocks: 1, alignment: [6, 26] },
  { version: 5, data: 108, ecc: 26, blocks: 1, alignment: [6, 30] },
  { version: 6, data: 136, ecc: 18, blocks: 2, alignment: [6, 34] },
  { version: 10, data: 274, ecc: 18, blocks: 4, alignment: [6, 28, 50] },
  { version: 15, data: 523, ecc: 22, blocks: 6, alignment: [6, 26, 48, 70] },
];

const bit = (value: number, shift: number) => ((value >>> shift) & 1) !== 0;

function multiply(left: number, right: number) {
  let result = 0;
  for (; right > 0; right >>>= 1) {
    if (right & 1) result ^= left;
    left = (left << 1) ^ (left & 0x80 ? 0x11d : 0);
  }
  return result;
}

function errorCorrection(data: number[], degree: number) {
  let polynomial = [1];
  let root = 1;
  for (let i = 0; i < degree; i++) {
    polynomial = [...polynomial, 0].map((coefficient, index) =>
      coefficient ^ multiply(polynomial[index - 1] ?? 0, root));
    root = multiply(root, 2);
  }
  const remainder = new Array<number>(degree).fill(0);
  for (const codeword of data) {
    const factor = codeword ^ remainder.shift()!;
    remainder.push(0);
    for (let i = 0; i < degree; i++) remainder[i] ^= multiply(polynomial[i + 1], factor);
  }
  return remainder;
}

function encodeCodewords(bytes: Uint8Array, symbol: typeof symbols[number], countBits: number) {
  const data: number[] = [];
  let cursor = 0;
  function append(value: number, count: number) {
    for (let i = count - 1; i >= 0; i--) {
      const index = cursor >>> 3;
      data[index] = (data[index] ?? 0) | (Number(bit(value, i)) << (7 - (cursor & 7)));
      cursor++;
    }
  }
  append(0b0100, 4);
  append(bytes.length, countBits);
  for (const byte of bytes) append(byte, 8);
  append(0, 4);
  for (let pad = 0; data.length < symbol.data; pad++) data.push(pad % 2 === 0 ? 0xec : 0x11);

  const blocks: number[][] = [];
  const parity: number[][] = [];
  const shortLength = Math.floor(symbol.data / symbol.blocks);
  const shortCount = symbol.blocks - symbol.data % symbol.blocks;
  for (let index = 0, start = 0; index < symbol.blocks; index++) {
    const end = start + shortLength + Number(index >= shortCount);
    const block = data.slice(start, end);
    blocks.push(block);
    parity.push(errorCorrection(block, symbol.ecc));
    start = end;
  }
  const codewords: number[] = [];
  for (let index = 0; index < blocks[blocks.length - 1].length; index++) {
    for (const block of blocks) if (index < block.length) codewords.push(block[index]);
  }
  for (let index = 0; index < symbol.ecc; index++) {
    for (const check of parity) codewords.push(check[index]);
  }
  return codewords;
}

export function cosignQrModules(url: string) {
  const bytes = new TextEncoder().encode(url);
  const symbol = symbols.find(item => bytes.length <= item.data - (item.version < 10 ? 2 : 3));
  if (!symbol) return null;
  const { version, alignment } = symbol;
  const codewords = encodeCodewords(bytes, symbol, version < 10 ? 8 : 16);
  const size = version * 4 + 17;
  const matrix = Array.from({ length: size }, () => new Array<boolean | undefined>(size));
  const put = (x: number, y: number, dark: boolean) => { matrix[y][x] = dark; };
  const last = alignment.at(-1);
  for (let i = 0; i < size; i++) {
    put(6, i, i % 2 === 0);
    put(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let y = Math.max(0, cy - 4); y <= Math.min(size - 1, cy + 4); y++) {
      for (let x = Math.max(0, cx - 4); x <= Math.min(size - 1, cx + 4); x++) {
        const ring = Math.max(Math.abs(x - cx), Math.abs(y - cy));
        put(x, y, ring !== 2 && ring !== 4);
      }
    }
  }
  for (const cy of alignment) for (const cx of alignment) {
    if ((cy === 6 && (cx === 6 || cx === last)) || (cx === 6 && cy === last)) continue;
    for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) {
      put(cx + x, cy + y, Math.max(Math.abs(x), Math.abs(y)) !== 1);
    }
  }

  const format = 0x77c4; // Level L with mask 0, including BCH parity and format mask.
  for (let i = 0; i < 6; i++) put(8, i, bit(format, i));
  put(8, 7, bit(format, 6));
  put(8, 8, bit(format, 7));
  put(7, 8, bit(format, 8));
  for (let i = 9; i < 15; i++) put(14 - i, 8, bit(format, i));
  for (let i = 0; i < 8; i++) put(size - 1 - i, 8, bit(format, i));
  for (let i = 8; i < 15; i++) put(8, size - 15 + i, bit(format, i));
  put(8, size - 8, true);

  if (version >= 7) {
    let remainder = version;
    for (let i = 0; i < 12; i++) remainder = (remainder << 1) ^ (bit(remainder, 11) ? 0x1f25 : 0);
    const versionBits = (version << 12) | remainder;
    for (let i = 0; i < 18; i++) {
      const x = size - 11 + i % 3;
      const y = Math.floor(i / 3);
      put(x, y, bit(versionBits, i));
      put(y, x, bit(versionBits, i));
    }
  }

  let index = 0;
  for (let right = size - 1, upwards = true; right > 0; right -= 2, upwards = !upwards) {
    if (right === 6) right--;
    for (let offset = 0; offset < size; offset++) {
      const y = upwards ? size - 1 - offset : offset;
      for (let x = right; x >= right - 1; x--) {
        if (matrix[y][x] !== undefined) continue;
        const dark = bit(codewords[index >>> 3] ?? 0, 7 - (index & 7));
        put(x, y, dark !== ((x + y) % 2 === 0));
        index++;
      }
    }
  }
  return matrix;
}
