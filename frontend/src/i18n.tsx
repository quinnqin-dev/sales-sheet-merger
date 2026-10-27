import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
export * from "./i18n-core";
import {
  getLocale,
  setCurrentLocale,
  translate,
  type Locale,
} from "./i18n-core";

type LanguageContext = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: typeof translate;
};
const Context = createContext<LanguageContext | null>(null);
export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLanguage] = useState<Locale>(getLocale);
  function setLocale(next: Locale) {
    setCurrentLocale(next);
    setLanguage(next);
  }
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title =
      locale === "en" ? "Sales Sheet Merger" : "归表 · 销售表合并工具";
  }, [locale]);
  return (
    <Context.Provider
      value={{
        locale,
        setLocale,
        t: (code, params) => translate(code, params, locale),
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useI18n() {
  const value = useContext(Context);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}
