import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { VerificationStepsList } from "@/components/crypto/VerificationStepsList";
import { LocaleProvider } from "@/components/shell/LocaleProvider";
import { describe, expect, it } from "vitest";
import { failureMessages } from "@/lib/db/types";
import { isMessageKey, t, type MessageKey } from "@/lib/i18n";
import { ru } from "@/lib/i18n/ru";
import { kk } from "@/lib/i18n/kk";
import { failureText, riskReason } from "@/lib/i18n/server-text";

describe("Словари интерфейса", () => {
  it("содержат одинаковые ключи, непустые строки и одинаковые параметры", () => {
    expect(Object.keys(kk).sort()).toEqual(Object.keys(ru).sort());
    const placeholders = (value: string) => (value.match(/\{\w+\}/g) ?? []).sort();
    for (const key of Object.keys(ru) as MessageKey[]) {
      expect(ru[key].trim(), key).not.toBe("");
      expect(kk[key].trim(), key).not.toBe("");
      expect(placeholders(kk[key]), key).toEqual(placeholders(ru[key]));
    }
  });

  it("переводят все коды ошибок сервера и клиента, сохраняя незнакомые сообщения", () => {
    const codes = new Set([...Object.keys(failureMessages), "ERR_CLIENT_RENDER"]);
    for (const clientModule of ["signer", "api"]) {
      const source = readFileSync(new URL(`../src/lib/client/${clientModule}.ts`, import.meta.url), "utf8");
      for (const code of source.match(/\bERR_[A-Z_]+\b/g) ?? []) codes.add(code);
    }
    for (const code of codes) {
      expect(isMessageKey(code), code).toBe(true);
      expect(failureText("kk", code, "server message")).toBe(kk[code as MessageKey]);
    }
    expect(failureText("kk", "ERR_NEW", "Исходное сообщение")).toBe("Исходное сообщение");
  });

  it("подставляют значения буквально и выбирают форму по количеству", () => {
    expect(t("kk", "topbar.deviceSettings", { deviceName: "$& {name}" })).toBe("$& {name} құрылғысының баптаулары");
    expect([1, 2, 11, 21].map(count => t("ru", "soc.samples.other", { count })))
      .toEqual(["замер", "замера", "замеров", "замер"]);
    expect(t("kk", "soc.samples.other", { count: 11 })).toBe("өлшем");
  });

  it("показывают причину по коду правила и читают старые записи без кодов", () => {
    expect(riskReason("kk", "NEW_RECIPIENT", "Изменившийся текст сервера")).toBe(kk["risk.NEW_RECIPIENT"]);
    expect(riskReason("kk", undefined, ru["risk.BANK_COSIGN"])).toBe(kk["risk.BANK_COSIGN"]);
    expect(riskReason("kk", "NEW_RULE", "Новое правило")).toBe("Новое правило");
  });

  it("выбирает название шага по коду из серверной трассы", () => {
    const trace = [{
      step: 1, code: "WEBAUTHN_SIGNATURE", label: "Серверное название", passed: true,
      outcome: "PASS" as const, durationMs: 2, details: "Проверка пройдена",
    }];
    const steps = createElement(VerificationStepsList, { trace });
    const html = renderToStaticMarkup(createElement(LocaleProvider, { initialLocale: "kk", standalone: true }, steps));
    expect(html).toContain(kk["step.WEBAUTHN_SIGNATURE"]);
    expect(html).not.toContain(kk["step.TX_EXISTENCE_AND_TTL"]);
    expect(html).toContain(kk["detail.passed"]);
  });
});
