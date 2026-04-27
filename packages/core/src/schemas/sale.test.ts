import { describe, expect, it } from 'vitest';
import { ReservationInfo, SaleContact, SaleItem, SaleSite } from './sale.js';

describe('SaleItem', () => {
  it('accepts the minimum viable item', () => {
    const parsed = SaleItem.parse({
      id: 'couch-01',
      title: 'Couch',
      price: 450,
      added: '2026-04-20',
    });
    expect(parsed.tags).toEqual([]);
    expect(parsed.reserved).toBeUndefined();
  });

  it('accepts a fully populated item with reservation', () => {
    const parsed = SaleItem.parse({
      id: 'couch-01',
      slug: 'couch',
      title: 'Couch',
      price: 450,
      tags: ['furniture', 'living room'],
      added: '2026-04-20',
      image: 'photos/couch.jpg',
      images: ['photos/couch.jpg', 'photos/couch-side.jpg'],
      description: 'Charcoal linen sectional.',
      reserved: { on: '2026-04-21', price: 400, note: 'Alice on Saturday' },
      sortOrder: 1,
      updatedAt: '2026-04-20T15:00:00Z',
    });
    expect(parsed.reserved?.note).toBe('Alice on Saturday');
    expect(parsed.images).toHaveLength(2);
  });

  it('rejects missing required fields', () => {
    expect(() => SaleItem.parse({ id: 'x', title: 'x' })).toThrow();
    expect(() => SaleItem.parse({ id: 'x', title: 'x', price: 1 })).toThrow(/added/);
  });

  it('rejects a negative price silently? no — accepts it (numbers are unconstrained)', () => {
    // Documenting the shape: price is a plain number. Validation of
    // "prices are non-negative" happens in the editor, not the schema.
    // If we ever want to enforce here, add z.number().nonnegative().
    expect(() =>
      SaleItem.parse({ id: 'x', title: 'x', price: -5, added: '2026-04-20' }),
    ).not.toThrow();
  });

  it('allows reserved: null (item was un-reserved)', () => {
    const parsed = SaleItem.parse({
      id: 'x',
      title: 'x',
      price: 1,
      added: '2026-04-20',
      reserved: null,
    });
    expect(parsed.reserved).toBeNull();
  });
});

describe('SaleSite', () => {
  it('applies defaults for theme, currency, language', () => {
    const parsed = SaleSite.parse({ siteName: 'Spring Purge' });
    expect(parsed.theme).toBe('conservative');
    expect(parsed.currency).toBe('USD');
    expect(parsed.language).toBe('en');
  });

  it('rejects unknown theme values', () => {
    expect(() => SaleSite.parse({ siteName: 'x', theme: 'neon' })).toThrow(/theme/);
  });

  it('preserves locale sibling keys via passthrough', () => {
    const parsed = SaleSite.parse({
      siteName: 'Spring Purge',
      siteName_de: 'Hofflohmarkt',
      location_de: 'Austin, TX',
    }) as Record<string, unknown>;
    expect(parsed.siteName_de).toBe('Hofflohmarkt');
    expect(parsed.location_de).toBe('Austin, TX');
  });

  it('rejects a non-3-letter currency code', () => {
    expect(() => SaleSite.parse({ siteName: 'x', currency: 'DOLLAR' })).toThrow(/currency/);
  });

  it('accepts host-only fields as optional', () => {
    const parsed = SaleSite.parse({
      siteName: 'Spring Purge',
      slug: 'spring-purge',
      publishedAt: '2026-04-20T00:00:00Z',
    });
    expect(parsed.slug).toBe('spring-purge');
    expect(parsed.publishedAt).toBe('2026-04-20T00:00:00Z');
  });
});

describe('SaleSite visibility and region', () => {
  it('defaults visibility to public', () => {
    const parsed = SaleSite.parse({ siteName: 'Spring Purge' });
    expect(parsed.visibility).toBe('public');
  });

  it('accepts private visibility', () => {
    const parsed = SaleSite.parse({ siteName: 'x', visibility: 'private' });
    expect(parsed.visibility).toBe('private');
  });

  it('rejects unknown visibility values', () => {
    expect(() => SaleSite.parse({ siteName: 'x', visibility: 'unlisted' })).toThrow();
  });

  it('accepts a valid region', () => {
    const parsed = SaleSite.parse({
      siteName: 'x',
      region: { country: 'US', city: 'Austin' },
    });
    expect(parsed.region?.country).toBe('US');
    expect(parsed.region?.city).toBe('Austin');
  });

  it('rejects a region with a non-2-letter country code', () => {
    expect(() => SaleSite.parse({ siteName: 'x', region: { country: 'USA' } })).toThrow();
  });

  it('accepts region without city', () => {
    const parsed = SaleSite.parse({ siteName: 'x', region: { country: 'DE' } });
    expect(parsed.region?.country).toBe('DE');
    expect(parsed.region?.city).toBeUndefined();
  });

  it('passes through privateToken as host-only field', () => {
    const parsed = SaleSite.parse({ siteName: 'x', privateToken: 'abc1234567' }) as Record<
      string,
      unknown
    >;
    expect(parsed.privateToken).toBe('abc1234567');
  });
});

describe('SaleContact', () => {
  it('accepts all channels', () => {
    const parsed = SaleContact.parse({
      email: 'seller@example.com',
      sms: '15125551234',
      whatsapp: '15125551234',
      notes: 'Cash or Venmo.',
    });
    expect(parsed.email).toBe('seller@example.com');
  });

  it('rejects an invalid email', () => {
    expect(() => SaleContact.parse({ email: 'not an email' })).toThrow(/email/);
  });

  it('allows an empty contact (no channels selected)', () => {
    // Editor enforces "at least one" before publish; schema doesn't.
    expect(() => SaleContact.parse({})).not.toThrow();
  });
});

describe('ReservationInfo', () => {
  it('requires on + price, note optional', () => {
    expect(() => ReservationInfo.parse({ on: '2026-04-20' })).toThrow(/price/);
    expect(() => ReservationInfo.parse({ price: 100 })).toThrow(/on/);
    const ok = ReservationInfo.parse({ on: '2026-04-20', price: 100 });
    expect(ok.note).toBeUndefined();
  });
});
