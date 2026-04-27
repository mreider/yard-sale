import de from './locales/de.json';
import en from './locales/en.json';
import es from './locales/es.json';
import fr from './locales/fr.json';
import ja from './locales/ja.json';
import pt from './locales/pt.json';
import zh from './locales/zh.json';

type Messages = typeof en;
export type MessageKey = keyof Messages;

const catalogs: Record<string, Messages> = { en, de, es, fr, ja, pt, zh };

export const SUPPORTED_LOCALES = Object.keys(catalogs);

export const LOCALE_NAMES: Record<string, string> = {
  en: 'English',
  de: 'Deutsch',
  es: 'Español',
  fr: 'Français',
  ja: '日本語',
  pt: 'Português',
  zh: '中文',
};

export function detectLocale(): string {
  if (typeof navigator === 'undefined') return 'en';
  const lang = navigator.language.split('-')[0]!;
  return lang in catalogs ? lang : 'en';
}

export function t(key: MessageKey, locale: string, vars?: Record<string, string | number>): string {
  const msgs = (catalogs[locale] ?? catalogs.en) as Record<string, string>;
  let str = msgs[key] ?? (en as Record<string, string>)[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) str = str.replaceAll(`{${k}}`, String(v));
  }
  return str;
}

export function tPlural(baseKey: string, count: number, locale: string): string {
  const rule = new Intl.PluralRules(locale).select(count);
  return t(`${baseKey}_${rule}` as MessageKey, locale, { count });
}
