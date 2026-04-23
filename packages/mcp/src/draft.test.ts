import { describe, expect, test } from 'vitest';
import { parseDraftFromHtml } from './draft.js';

describe('parseDraftFromHtml', () => {
  test('extracts Open Graph title + description + image', () => {
    const html = `
      <!doctype html><html><head>
        <meta property="og:title" content="Yellow Pepper Moccamaster">
        <meta property="og:description" content="4-year-old coffee machine, works great.">
        <meta property="og:image" content="https://cdn.example.com/hero.jpg">
      </head><body></body></html>`;
    const d = parseDraftFromHtml(html, 'https://example.com/moccamaster');
    expect(d.title).toBe('Yellow Pepper Moccamaster');
    expect(d.description).toBe('4-year-old coffee machine, works great.');
    expect(d.image).toBe('https://cdn.example.com/hero.jpg');
    expect(d.sourceUrl).toBe('https://example.com/moccamaster');
  });

  test('falls back to <title> when og:title is missing', () => {
    const html = `<html><head><title>Acme Widget</title></head></html>`;
    const d = parseDraftFromHtml(html, 'https://example.com/widget');
    expect(d.title).toBe('Acme Widget');
  });

  test('resolves relative og:image against the page URL', () => {
    const html = `<meta property="og:image" content="/cdn/hero.jpg">`;
    const d = parseDraftFromHtml(html, 'https://example.com/products/widget');
    expect(d.image).toBe('https://example.com/cdn/hero.jpg');
  });

  test('reads product price meta (Facebook product tags)', () => {
    const html = `
      <meta property="product:price:amount" content="249.95">
      <meta property="product:price:currency" content="eur">
      <title>X</title>`;
    const d = parseDraftFromHtml(html, 'https://example.com/x');
    expect(d.price).toBe(249.95);
    expect(d.currency).toBe('EUR');
  });

  test('reads JSON-LD Product offers when product meta is absent', () => {
    const html = `
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Product",
          "name": "Coffee Machine",
          "offers": {
            "@type": "Offer",
            "priceCurrency": "USD",
            "price": "329.00"
          }
        }
      </script>`;
    const d = parseDraftFromHtml(html, 'https://example.com/coffee');
    expect(d.price).toBe(329);
    expect(d.currency).toBe('USD');
  });

  test('walks JSON-LD @graph arrays', () => {
    const html = `
      <script type="application/ld+json">
        { "@context": "https://schema.org", "@graph": [
          { "@type": "Organization", "name": "Shop" },
          { "@type": "Product", "offers": [{ "priceCurrency": "GBP", "price": 42 }] }
        ] }
      </script>`;
    const d = parseDraftFromHtml(html, 'https://example.com/x');
    expect(d.price).toBe(42);
    expect(d.currency).toBe('GBP');
  });

  test('decodes HTML entities', () => {
    const html = `<meta property="og:title" content="Knick &amp; Knack">`;
    const d = parseDraftFromHtml(html, 'https://example.com/x');
    expect(d.title).toBe('Knick & Knack');
  });

  test('tolerates attribute order (content= before property=)', () => {
    const html = `<meta content="Alt title" property="og:title">`;
    const d = parseDraftFromHtml(html, 'https://example.com/x');
    expect(d.title).toBe('Alt title');
  });

  test('collapses whitespace in titles and descriptions', () => {
    const html = `<meta property="og:title" content="Line one
                                                      Line two">`;
    const d = parseDraftFromHtml(html, 'https://example.com/x');
    expect(d.title).toBe('Line one Line two');
  });

  test('returns mostly empty when nothing useful is present', () => {
    const html = `<html><body>Just text.</body></html>`;
    const d = parseDraftFromHtml(html, 'https://example.com/x');
    expect(d.title).toBeUndefined();
    expect(d.description).toBeUndefined();
    expect(d.image).toBeUndefined();
    expect(d.price).toBeUndefined();
  });
});
