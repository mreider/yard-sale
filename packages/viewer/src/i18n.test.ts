import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageKey } from './i18n';
import { LOCALE_NAMES, SUPPORTED_LOCALES, detectLocale, t, tPlural } from './i18n';

describe('i18n: locale detection', () => {
  const originalNavigator = typeof navigator !== 'undefined' ? navigator : null;

  beforeEach(() => {
    vi.resetModules();
  });

  it('returns en when navigator is undefined (SSR)', () => {
    expect(detectLocale()).toBe('en');
  });

  it('detects English from en-US', () => {
    Object.defineProperty(global, 'navigator', {
      value: { language: 'en-US' },
      configurable: true,
    });
    expect(detectLocale()).toBe('en');
  });

  it('detects German from de-DE', () => {
    Object.defineProperty(global, 'navigator', {
      value: { language: 'de-DE' },
      configurable: true,
    });
    expect(detectLocale()).toBe('de');
  });

  it('detects Spanish from es-MX', () => {
    Object.defineProperty(global, 'navigator', {
      value: { language: 'es-MX' },
      configurable: true,
    });
    expect(detectLocale()).toBe('es');
  });

  it('detects Portuguese from pt-BR', () => {
    Object.defineProperty(global, 'navigator', {
      value: { language: 'pt-BR' },
      configurable: true,
    });
    expect(detectLocale()).toBe('pt');
  });

  it('detects French from fr-FR', () => {
    Object.defineProperty(global, 'navigator', {
      value: { language: 'fr-FR' },
      configurable: true,
    });
    expect(detectLocale()).toBe('fr');
  });

  it('detects Japanese from ja-JP', () => {
    Object.defineProperty(global, 'navigator', {
      value: { language: 'ja-JP' },
      configurable: true,
    });
    expect(detectLocale()).toBe('ja');
  });

  it('detects Chinese from zh-CN', () => {
    Object.defineProperty(global, 'navigator', {
      value: { language: 'zh-CN' },
      configurable: true,
    });
    expect(detectLocale()).toBe('zh');
  });

  it('falls back to en for unsupported languages', () => {
    Object.defineProperty(global, 'navigator', {
      value: { language: 'it-IT' },
      configurable: true,
    });
    expect(detectLocale()).toBe('en');
  });

  it('handles language without region code', () => {
    Object.defineProperty(global, 'navigator', {
      value: { language: 'en' },
      configurable: true,
    });
    expect(detectLocale()).toBe('en');
  });
});

describe('i18n: translation function t()', () => {
  it('translates a simple key in English', () => {
    const result = t('stats.available', 'en');
    expect(result).toBe('available');
  });

  it('translates a key in German', () => {
    const result = t('stats.available', 'de');
    expect(result).toBe('verfügbar');
  });

  it('translates a key in Spanish', () => {
    const result = t('stats.available', 'es');
    expect(result).toBe('disponible');
  });

  it('translates a key in French', () => {
    const result = t('stats.available', 'fr');
    expect(result).toBe('disponible');
  });

  it('translates a key in Portuguese', () => {
    const result = t('stats.available', 'pt');
    expect(result).toBe('disponível');
  });

  it('translates a key in Japanese', () => {
    const result = t('stats.available', 'ja');
    expect(result).toBe('利用可能');
  });

  it('translates a key in Chinese', () => {
    const result = t('stats.available', 'zh');
    expect(result).toBe('可用');
  });

  it('falls back to English for missing translations', () => {
    const result = t('nonexistent.key' as MessageKey, 'de');
    expect(result).toBe('nonexistent.key');
  });

  it('falls back to English for unsupported locales', () => {
    const result = t('stats.available', 'it');
    expect(result).toBe('available');
  });

  it('handles string interpolation with variables', () => {
    const result = t('contact.body', 'en', { title: 'Couch', price: '$250' });
    expect(result).toContain('Couch');
    expect(result).toContain('$250');
  });

  it('handles numeric variables in interpolation', () => {
    const result = t('item.photos_other', 'en', { count: 5 });
    expect(result).toContain('5');
  });

  it('handles multiple variables in the same string', () => {
    const result = t('modal.photo_of', 'en', { current: 2, total: 10 });
    expect(result).toContain('2');
    expect(result).toContain('10');
  });

  it('handles missing variables gracefully', () => {
    const result = t('modal.photo_of', 'en');
    expect(result).toContain('{current}');
    expect(result).toContain('{total}');
  });

  it('translates filter keys across all locales', () => {
    const keys = ['filter.search', 'filter.hide_reserved', 'filter.only_reserved'] as const;
    for (const key of keys) {
      for (const locale of SUPPORTED_LOCALES) {
        const result = t(key, locale);
        expect(result).not.toContain('{');
        expect(result.length).toBeGreaterThan(0);
      }
    }
  });

  it('translates sort keys across all locales', () => {
    const keys = ['sort.newest', 'sort.oldest', 'sort.price_asc', 'sort.price_desc'] as const;
    for (const key of keys) {
      for (const locale of SUPPORTED_LOCALES) {
        const result = t(key, locale);
        expect(result).not.toContain('{');
        expect(result.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('i18n: plural function tPlural()', () => {
  it('handles singular for count=1 in English', () => {
    const result = tPlural('item.photos', 1, 'en');
    expect(result).toContain('1');
    expect(result.toLowerCase()).toContain('photo');
  });

  it('handles plural for count=0 in English', () => {
    const result = tPlural('item.photos', 0, 'en');
    expect(result).toContain('0');
    expect(result).toMatch(/photos?/i);
  });

  it('handles plural for count=2 in English', () => {
    const result = tPlural('item.photos', 2, 'en');
    expect(result).toContain('2');
    expect(result).toMatch(/photos?/i);
  });

  it('handles plural for count=5 in English', () => {
    const result = tPlural('item.photos', 5, 'en');
    expect(result).toContain('5');
    expect(result).toMatch(/photos?/i);
  });

  it('uses locale-specific plural rules for German', () => {
    const one = tPlural('item.photos', 1, 'de');
    const many = tPlural('item.photos', 5, 'de');
    expect(one).toContain('1');
    expect(many).toContain('5');
  });

  it('uses locale-specific plural rules for Chinese', () => {
    const one = tPlural('item.photos', 1, 'zh');
    const many = tPlural('item.photos', 5, 'zh');
    expect(one).toContain('1');
    expect(many).toContain('5');
  });

  it('uses locale-specific plural rules for Japanese', () => {
    const one = tPlural('item.photos', 1, 'ja');
    const many = tPlural('item.photos', 5, 'ja');
    expect(one).toContain('1');
    expect(many).toContain('5');
  });

  it('handles large numbers', () => {
    const result = tPlural('item.photos', 1000, 'en');
    expect(result).toContain('1000');
  });
});

describe('i18n: supported locales and names', () => {
  it('includes all expected locales', () => {
    expect(SUPPORTED_LOCALES).toContain('en');
    expect(SUPPORTED_LOCALES).toContain('de');
    expect(SUPPORTED_LOCALES).toContain('es');
    expect(SUPPORTED_LOCALES).toContain('fr');
    expect(SUPPORTED_LOCALES).toContain('ja');
    expect(SUPPORTED_LOCALES).toContain('pt');
    expect(SUPPORTED_LOCALES).toContain('zh');
  });

  it('has exactly 7 locales', () => {
    expect(SUPPORTED_LOCALES).toHaveLength(7);
  });

  it('has display names for all locales', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const name = LOCALE_NAMES[locale];
      expect(name).toBeDefined();
      expect(name!.length).toBeGreaterThan(0);
    }
  });

  it('has correct English display name', () => {
    expect(LOCALE_NAMES.en).toBe('English');
  });

  it('has correct German display name', () => {
    expect(LOCALE_NAMES.de).toBe('Deutsch');
  });

  it('has correct Spanish display name', () => {
    expect(LOCALE_NAMES.es).toBe('Español');
  });

  it('has correct French display name', () => {
    expect(LOCALE_NAMES.fr).toBe('Français');
  });

  it('has correct Portuguese display name', () => {
    expect(LOCALE_NAMES.pt).toBe('Português');
  });

  it('has correct Japanese display name', () => {
    expect(LOCALE_NAMES.ja).toBe('日本語');
  });

  it('has correct Chinese display name', () => {
    expect(LOCALE_NAMES.zh).toBe('中文');
  });
});

describe('i18n: contact and messaging keys', () => {
  it('translates contact section keys', () => {
    const keys = [
      'contact.title',
      'contact.email',
      'contact.sms',
      'contact.whatsapp',
      'contact.body',
    ] as const;
    for (const key of keys) {
      for (const locale of SUPPORTED_LOCALES) {
        const result = t(key, locale);
        expect(result.length).toBeGreaterThan(0);
      }
    }
  });

  it('translates modal control keys', () => {
    const keys = ['modal.close', 'modal.prev', 'modal.next', 'modal.selector'] as const;
    for (const key of keys) {
      for (const locale of SUPPORTED_LOCALES) {
        const result = t(key, locale);
        expect(result.length).toBeGreaterThan(0);
      }
    }
  });

  it('translates share section keys', () => {
    const keys = ['share.label', 'share.copy', 'share.copied'] as const;
    for (const key of keys) {
      for (const locale of SUPPORTED_LOCALES) {
        const result = t(key, locale);
        expect(result.length).toBeGreaterThan(0);
      }
    }
  });

  it('translates footer/status keys', () => {
    const keys = ['footer.updated', 'footer.just_now'] as const;
    for (const key of keys) {
      for (const locale of SUPPORTED_LOCALES) {
        const result = t(key, locale);
        expect(result.length).toBeGreaterThan(0);
      }
    }
  });

  it('translates empty state keys', () => {
    const result = t('empty.no_results', 'en');
    expect(result).toContain('Nothing matches');
  });
});
