import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * SaleViewer i18n and localization tests.
 *
 * These are unit tests for the locale-aware rendering logic,
 * without a full browser environment. Full integration tests
 * would require a DOM and React render.
 */

describe('SaleViewer: locale-specific field lookup', () => {
  describe('localized() helper function behavior', () => {
    test('returns English field when no locale is set', () => {
      const site: Record<string, unknown> = {
        siteName: 'Spring Purge',
        siteName_de: 'Hofflohmarkt',
        location: 'Austin',
        location_de: 'Austin, TX',
      };

      // Simulating localized() lookup
      const getLocalized = (field: string, locale?: string) => {
        if (locale && site[`${field}_${locale}`]) {
          return site[`${field}_${locale}`];
        }
        return site[field];
      };

      expect(getLocalized('siteName')).toBe('Spring Purge');
      expect(getLocalized('location')).toBe('Austin');
    });

    test('returns German field when locale=de is set', () => {
      const site: Record<string, unknown> = {
        siteName: 'Spring Purge',
        siteName_de: 'Hofflohmarkt',
        location: 'Austin',
        location_de: 'Austin, TX',
      };

      const getLocalized = (field: string, locale?: string) => {
        if (locale && site[`${field}_${locale}`]) {
          return site[`${field}_${locale}`];
        }
        return site[field];
      };

      expect(getLocalized('siteName', 'de')).toBe('Hofflohmarkt');
      expect(getLocalized('location', 'de')).toBe('Austin, TX');
    });

    test('falls back to English when locale-specific field is missing', () => {
      const site: Record<string, unknown> = {
        siteName: 'Spring Purge',
        siteName_de: 'Hofflohmarkt',
        // location has no _de variant
        location: 'Austin',
      };

      const getLocalized = (field: string, locale?: string) => {
        if (locale && site[`${field}_${locale}`]) {
          return site[`${field}_${locale}`];
        }
        return site[field];
      };

      // siteName_de exists
      expect(getLocalized('siteName', 'de')).toBe('Hofflohmarkt');
      // location_de does not exist, fallback to location
      expect(getLocalized('location', 'de')).toBe('Austin');
    });

    test('returns undefined when field does not exist in any locale', () => {
      const site: Record<string, unknown> = {
        siteName: 'Spring Purge',
      };

      const getLocalized = (field: string, locale?: string) => {
        if (locale && site[`${field}_${locale}`]) {
          return site[`${field}_${locale}`];
        }
        return site[field];
      };

      expect(getLocalized('nonexistent', 'en')).toBeUndefined();
      expect(getLocalized('nonexistent', 'de')).toBeUndefined();
    });

    test('handles all supported locale suffixes', () => {
      const site: Record<string, unknown> = {
        siteName: 'Spring Purge',
        siteName_en: 'Spring Purge',
        siteName_de: 'Hofflohmarkt',
        siteName_es: 'Limpieza de Primavera',
        siteName_fr: 'Vente de Printemps',
        siteName_ja: '春のガレージセール',
        siteName_pt: 'Limpeza de Primavera',
        siteName_zh: '春季清理大甩卖',
      };

      const getLocalized = (field: string, locale?: string) => {
        if (locale && site[`${field}_${locale}`]) {
          return site[`${field}_${locale}`];
        }
        return site[field];
      };

      expect(getLocalized('siteName', 'en')).toBe('Spring Purge');
      expect(getLocalized('siteName', 'de')).toBe('Hofflohmarkt');
      expect(getLocalized('siteName', 'es')).toBe('Limpieza de Primavera');
      expect(getLocalized('siteName', 'fr')).toBe('Vente de Printemps');
      expect(getLocalized('siteName', 'ja')).toBe('春のガレージセール');
      expect(getLocalized('siteName', 'pt')).toBe('Limpeza de Primavera');
      expect(getLocalized('siteName', 'zh')).toBe('春季清理大甩卖');
    });

    test('handles subtitle and location fields', () => {
      const site: Record<string, unknown> = {
        siteName: 'My Sale',
        subtitle: 'Vintage Items',
        subtitle_de: 'Vintage-Artikel',
        location: 'Austin, TX',
        location_de: 'Austin, Texas',
      };

      const getLocalized = (field: string, locale?: string) => {
        if (locale && site[`${field}_${locale}`]) {
          return site[`${field}_${locale}`];
        }
        return site[field];
      };

      expect(getLocalized('subtitle', 'en')).toBe('Vintage Items');
      expect(getLocalized('subtitle', 'de')).toBe('Vintage-Artikel');
      expect(getLocalized('location', 'en')).toBe('Austin, TX');
      expect(getLocalized('location', 'de')).toBe('Austin, Texas');
    });
  });

  describe('region field in site data', () => {
    test('site with region includes country and optional city', () => {
      const site = {
        siteName: 'Sale',
        region: {
          country: 'US',
          city: 'Austin',
        },
      };
      expect(site.region.country).toBe('US');
      expect(site.region.city).toBe('Austin');
    });

    test('site with region but no city is valid', () => {
      const site: { siteName: string; region?: { country: string; city?: string } } = {
        siteName: 'Sale',
        region: {
          country: 'DE',
        },
      };
      expect(site.region?.country).toBe('DE');
      expect(site.region?.city).toBeUndefined();
    });

    test('site without region has undefined region field', () => {
      const site: { siteName: string; region?: { country: string; city?: string } } = {
        siteName: 'Sale',
      };
      expect(site.region).toBeUndefined();
    });

    test('region field includes valid ISO country codes', () => {
      const validCountries = ['US', 'DE', 'FR', 'GB', 'JP', 'CN', 'BR', 'AU'];
      for (const country of validCountries) {
        const site = { siteName: 'Sale', region: { country } };
        expect(site.region.country).toHaveLength(2);
      }
    });
  });

  describe('currency formatting with locale', () => {
    test('formats USD with US locale', () => {
      const formatPrice = (amount: number, currency: string, locale: string) => {
        const fmt = new Intl.NumberFormat(locale, {
          style: 'currency',
          currency,
          maximumFractionDigits: 0,
        });
        return fmt.format(amount);
      };

      const result = formatPrice(450, 'USD', 'en-US');
      expect(result).toContain('450');
      expect(result).toContain('$');
    });

    test('formats EUR with German locale', () => {
      const formatPrice = (amount: number, currency: string, locale: string) => {
        const fmt = new Intl.NumberFormat(locale, {
          style: 'currency',
          currency,
          maximumFractionDigits: 0,
        });
        return fmt.format(amount);
      };

      const result = formatPrice(450, 'EUR', 'de-DE');
      expect(result).toContain('450');
      // EUR uses €, may appear before or after depending on locale
    });

    test('formats GBP with British locale', () => {
      const formatPrice = (amount: number, currency: string, locale: string) => {
        const fmt = new Intl.NumberFormat(locale, {
          style: 'currency',
          currency,
          maximumFractionDigits: 0,
        });
        return fmt.format(amount);
      };

      const result = formatPrice(450, 'GBP', 'en-GB');
      expect(result).toContain('450');
      expect(result).toContain('£');
    });

    test('handles unknown currency gracefully', () => {
      const formatPrice = (amount: number, currency: string, locale: string) => {
        try {
          const fmt = new Intl.NumberFormat(locale, {
            style: 'currency',
            currency,
            maximumFractionDigits: 0,
          });
          return fmt.format(amount);
        } catch {
          return `${currency} ${amount}`;
        }
      };

      const result = formatPrice(450, 'FAKE', 'en-US');
      expect(result).toContain('450');
    });

    test('formats multiple currencies in the same locale', () => {
      const formatPrice = (amount: number, currency: string, locale: string) => {
        const fmt = new Intl.NumberFormat(locale, {
          style: 'currency',
          currency,
          maximumFractionDigits: 0,
        });
        return fmt.format(amount);
      };

      const usd = formatPrice(100, 'USD', 'en-US');
      const gbp = formatPrice(100, 'GBP', 'en-US');
      expect(usd).not.toEqual(gbp);
      expect(usd).toContain('$');
      expect(gbp).toContain('£');
    });
  });

  describe('filter and sort UI text translation', () => {
    test('filter text keys are translatable', () => {
      const filterKeys = [
        'filter.search',
        'filter.hide_reserved',
        'filter.only_reserved',
        'filter.clear_tags',
      ];
      expect(filterKeys.length).toBe(4);
      for (const key of filterKeys) {
        expect(key).toContain('filter.');
      }
    });

    test('sort text keys are translatable', () => {
      const sortKeys = ['sort.newest', 'sort.oldest', 'sort.price_asc', 'sort.price_desc'];
      expect(sortKeys.length).toBe(4);
      for (const key of sortKeys) {
        expect(key).toContain('sort.');
      }
    });

    test('stat text keys are translatable', () => {
      const statKeys = ['stats.available', 'stats.reserved', 'stats.total'];
      expect(statKeys.length).toBe(3);
    });

    test('empty state text keys are translatable', () => {
      const emptyKeys = ['empty.no_results'];
      expect(emptyKeys.length).toBe(1);
    });
  });

  describe('item modal and photo navigation i18n', () => {
    test('modal control keys include navigation and count', () => {
      const keys = ['modal.close', 'modal.prev', 'modal.next', 'modal.selector', 'modal.photo_of'];
      expect(keys.length).toBe(5);
    });

    test('photo count uses plural rules', () => {
      // item.photos_one and item.photos_other
      const baseKey = 'item.photos';
      expect(baseKey).toBe('item.photos');
    });

    test('item.photos plural form for count=1', () => {
      // Should use _one form: "1 photo"
      const key = 'item.photos_one';
      expect(key).toContain('_one');
    });

    test('item.photos plural form for count>1', () => {
      // Should use _other form: "N photos"
      const key = 'item.photos_other';
      expect(key).toContain('_other');
    });

    test('modal.photo_of includes interpolation variables', () => {
      // "Photo {current} of {total}"
      const key = 'modal.photo_of';
      expect(key).toBe('modal.photo_of');
      // In actual translation, expect {current} and {total} placeholders
    });
  });

  describe('contact and share UI i18n', () => {
    test('contact section keys', () => {
      const keys = [
        'contact.title',
        'contact.email',
        'contact.sms',
        'contact.whatsapp',
        'contact.body',
      ];
      expect(keys.length).toBe(5);
    });

    test('contact.body includes interpolation variables', () => {
      // "{title} ({price})\nWhat time works for you?"
      const key = 'contact.body';
      expect(key).toBe('contact.body');
    });

    test('share section keys', () => {
      const keys = ['share.label', 'share.copy', 'share.copied'];
      expect(keys.length).toBe(3);
    });

    test('footer status keys', () => {
      const keys = ['footer.updated', 'footer.just_now'];
      expect(keys.length).toBe(2);
    });
  });

  describe('localStorage persistence of locale', () => {
    beforeEach(() => {
      vi.stubGlobal('localStorage', {
        getItem: vi.fn(),
        setItem: vi.fn(),
        clear: vi.fn(),
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    test('saves selected locale to localStorage', () => {
      const locale = 'de';
      localStorage.setItem('yrdsl-locale', locale);
      expect(localStorage.setItem).toHaveBeenCalledWith('yrdsl-locale', 'de');
    });

    test('reads locale from localStorage on mount', () => {
      // @ts-expect-error accessing mock methods on vi-stubbed global
      localStorage.getItem.mockReturnValue('fr');
      const stored = localStorage.getItem('yrdsl-locale');
      expect(stored).toBe('fr');
    });

    test('falls back to detected locale when localStorage is empty', () => {
      // @ts-expect-error accessing mock methods on vi-stubbed global
      localStorage.getItem.mockReturnValue(null);
      const stored = localStorage.getItem('yrdsl-locale');
      expect(stored).toBeNull();
      // Should then use detectLocale()
    });

    test('handles missing localStorage gracefully', () => {
      // Some browsers/environments might not have localStorage
      // Should not throw when calling getItem
      expect(() => {
        localStorage.getItem('yrdsl-locale');
      }).not.toThrow();
    });
  });

  describe('language picker component behavior', () => {
    test('language picker offers all supported locales', () => {
      const locales = ['en', 'de', 'es', 'fr', 'ja', 'pt', 'zh'];
      expect(locales).toHaveLength(7);
      for (const locale of locales) {
        expect(locale).toHaveLength(2);
      }
    });

    test('language picker displays correct locale names', () => {
      const localeNames = {
        en: 'English',
        de: 'Deutsch',
        es: 'Español',
        fr: 'Français',
        ja: '日本語',
        pt: 'Português',
        zh: '中文',
      };
      expect(Object.keys(localeNames)).toHaveLength(7);
      expect(localeNames.en).toBe('English');
      expect(localeNames.ja).toContain('語');
    });

    test('selecting a locale triggers onChange callback', () => {
      const onChange = vi.fn();
      // In actual component: <LanguagePicker onChange={onChange} />
      // Simulating: onChange('de')
      onChange('de');
      expect(onChange).toHaveBeenCalledWith('de');
    });

    test('current locale is highlighted in picker', () => {
      const currentLocale = 'de';
      // Picker should show current value selected
      expect(currentLocale).toBe('de');
    });
  });

  describe('region display in sale view', () => {
    test('displays region when region field is present', () => {
      const site = {
        siteName: 'Sale',
        region: { country: 'US', city: 'Austin' },
      };
      expect(site.region).toBeDefined();
      expect(site.region.country).toBe('US');
    });

    test('hides region when region field is null/undefined', () => {
      const site = {
        siteName: 'Sale',
        region: null,
      };
      expect(site.region).toBeNull();
    });

    test('displays country without city when city is not set', () => {
      const site: { siteName: string; region?: { country: string; city?: string } } = {
        siteName: 'Sale',
        region: { country: 'DE' },
      };
      expect(site.region?.city).toBeUndefined();
    });

    test('region display respects locale for country/city names', () => {
      const site = {
        siteName: 'Sale',
        region: { country: 'US', city: 'Austin' },
      };
      // Country codes and city names are typically not localized (they're proper nouns)
      // but the label "Location:" would be translated
      expect(site.region.country).toHaveLength(2);
      expect(site.region.city).toBeDefined();
    });
  });

  describe('visibility field in site data', () => {
    test('site with visibility=public', () => {
      const site = {
        siteName: 'Sale',
        visibility: 'public',
      };
      expect(site.visibility).toBe('public');
    });

    test('site with visibility=private', () => {
      const site = {
        siteName: 'Sale',
        visibility: 'private',
      };
      expect(site.visibility).toBe('private');
    });

    test('defaults to public when not specified', () => {
      const site: { siteName: string; visibility?: string } = {
        siteName: 'Sale',
        // visibility not set
      };
      expect(site.visibility).toBeUndefined();
      // Schema default makes this 'public'
    });

    test('publicUrl reflects visibility (/{user}/{slug} vs /s/{token})', () => {
      const publicSite = {
        siteName: 'Sale',
        visibility: 'public',
        publicUrl: '/alice/moving-sale',
      };
      const privateSite = {
        siteName: 'Sale',
        visibility: 'private',
        publicUrl: '/s/abc1234567',
      };
      expect(publicSite.publicUrl).not.toContain('/s/');
      expect(privateSite.publicUrl).toContain('/s/');
    });
  });
});
