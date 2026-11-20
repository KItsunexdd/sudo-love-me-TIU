import { kk } from "./kk";
import { ru } from "./ru";

export type Locale = "ru" | "kk";
export type MessageKey = keyof typeof ru;
type Params = Record<string, string | number>;
export type Translate = (key: MessageKey, params?: Params) => string;

export const regions = { ru: "ru-RU", kk: "kk-KZ" } as const;
const messages = { ru, kk };
const plurals = { ru: new Intl.PluralRules(regions.ru), kk: new Intl.PluralRules(regions.kk) };

export function isMessageKey(key: string): key is MessageKey {
  return Object.hasOwn(ru, key);
}

export function t(locale: Locale, key: MessageKey, params?: Params): string {
  let selected = key;
  // A plural message is requested by its .other key in both languages.
  if (typeof params?.count === "number" && key.endsWith(".other")) {
    const variant = key.slice(0, -5) + plurals[locale].select(params.count);
    if (isMessageKey(variant)) selected = variant;
  }
  const template = messages[locale][selected];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match);
}

export const russian: Translate = (key, params) => t("ru", key, params);
