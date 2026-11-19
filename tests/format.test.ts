import { describe, expect, it } from "vitest";
import { formatIban, formatMs, formatTenge, shortHash } from "@/lib/ui/format";

describe("форматирование данных SafeSign", () => {
  it("группирует тенге и валюту неразрывными пробелами", () => {
    expect(formatTenge(1_200_000)).toBe("1\u00a0200\u00a0000\u00a0₸");
    expect(formatTenge(-1500)).toBe("-1\u00a0500\u00a0₸");
    expect(formatTenge(0)).toBe("0\u00a0₸");
    expect(formatTenge(Number.NaN)).toBe("—");
  });

  it("группирует IBAN по четыре знака", () => {
    expect(formatIban("kz86 8560\u00a00000 0451 2890")).toBe("KZ86\u00a08560\u00a00000\u00a00451\u00a02890");
    expect(formatIban(" KZ123 ")).toBe("KZ12\u00a03");
    expect(formatIban(" ")).toBe("");
  });

  it("показывает начало и конец длинного хэша", () => {
    expect(shortHash("a3f9c81201234567897d4e91b0")).toBe("a3f9c812…7d4e91b0");
    expect(shortHash("abcd")).toBe("abcd");
    expect(shortHash("0123456789", 3)).toBe("012…789");
  });

  it("округляет миллисекунды и использует русскую десятичную запятую", () => {
    expect(formatMs(3.125)).toBe("3,13\u00a0мс");
    expect(formatMs(0)).toBe("0\u00a0мс");
    expect(formatMs(-1)).toBe("—");
    expect(formatMs(Infinity)).toBe("—");
  });
});
