import en from "../../shared/locales/en.json" with { type: "json" };
import zh from "../../shared/locales/zh-CN.json" with { type: "json" };

export type Locale = "en" | "zh-CN";
export type Message = { code: string; params?: Record<string, unknown> };
export const LANGUAGE_KEY = "sheet-merger.language";
export const LEGACY_LANGUAGE_KEY = "sales-sheet-merger.language";
const catalogs: Record<Locale, Record<string, string>> = { en, "zh-CN": zh };

export function readLocale(): Locale {
  try {
    const saved =
      localStorage.getItem(LANGUAGE_KEY) ??
      localStorage.getItem(LEGACY_LANGUAGE_KEY);
    if (saved !== null && localStorage.getItem(LANGUAGE_KEY) === null)
      localStorage.setItem(LANGUAGE_KEY, saved);
    return saved === "zh-CN" ? "zh-CN" : "en";
  } catch {
    return "en";
  }
}
let currentLocale: Locale = typeof window === "undefined" ? "en" : readLocale();
export const getLocale = () => currentLocale;
export const msg = (
  code: string,
  params?: Record<string, unknown>,
): Message => ({ code, params });
export function translate(
  code: string,
  params: Record<string, unknown> = {},
  locale = currentLocale,
): string {
  const value =
    catalogs[locale][code] ?? en[code as keyof typeof en] ?? en.invalid_config;
  return value.replace(/\{(\w+)\}/g, (_, key) =>
    String(params[key] ?? `{${key}}`),
  );
}
export const renderMessage = (message: Message | null) =>
  message ? translate(message.code, message.params) : "";
export class LocalizedError extends Error {
  code: string;
  params: Record<string, unknown>;
  constructor(code: string, params: Record<string, unknown> = {}) {
    super(translate(code, params));
    this.code = code;
    this.params = params;
  }
}
export const messageFromError = (error: unknown): Message =>
  error instanceof LocalizedError
    ? msg(error.code, error.params)
    : msg(error instanceof TypeError ? "network_error" : "invalid_config");
export function errorMessage(value: {
  error?: string;
  error_code?: string;
  error_params?: Record<string, unknown>;
}) {
  return value.error_code
    ? translate(value.error_code, value.error_params)
    : value.error || "";
}

export function setCurrentLocale(next: Locale) {
  currentLocale = next;
  try {
    localStorage.setItem(LANGUAGE_KEY, next);
  } catch {
    /* In-memory switching still works. */
  }
}
