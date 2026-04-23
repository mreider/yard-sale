import type { SaleItem, SaleSite } from '@yrdsl/core';
import { SaleViewer } from '@yrdsl/viewer';
import '@yrdsl/viewer/styles.css';

/**
 * Sandbox route that renders <SaleViewer> against canned data. Two purposes:
 *
 *   1. Smoke test that the package imports + builds inside apps/web. This
 *      catches schema drift between packages/core and packages/viewer at
 *      build time, well before M2 wires up the real /{user}/{slug} viewer
 *      route.
 *   2. Lets contributors and theme-tweakers preview the renderer end-to-end
 *      without spinning up a separate self-hosted clone.
 *
 * When M2 lands and `/{user}/{slug}` is a real route fed by the api-worker,
 * this demo can either move to /demo or be deleted.
 */

const site: SaleSite = {
  siteName: 'Spring Purge',
  subtitle: 'everything must go',
  location: 'Austin, TX',
  description: 'Demo data. Same renderer powers the self-hosted template.',
  theme: 'conservative',
  currency: 'USD',
  language: 'en',
  contact: {
    email: 'demo@example.com',
    notes: 'Demo only. Pickup hours: anytime.',
  },
};

const items: SaleItem[] = [
  {
    id: 'couch-01',
    title: 'Mid-century sectional sofa',
    price: 450,
    tags: ['furniture', 'living room'],
    added: '2026-04-17',
    image: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=1200&q=80',
    description:
      'Three-seat sectional in charcoal linen. Lightly used, one scuff on the back-left leg. 94" × 36" × 32".',
    reserved: null,
  },
  {
    id: 'bike-01',
    title: 'Vintage steel road bike, 56cm',
    price: 320,
    tags: ['bikes', 'outdoor', 'vintage'],
    added: '2026-04-16',
    image: 'https://images.unsplash.com/photo-1485965120184-e220f721d03e?w=1200&q=80',
    description: 'Classic lugged-steel road bike, 56cm frame.',
    reserved: null,
  },
  {
    id: 'lamp-01',
    title: 'Brass arc floor lamp',
    price: 95,
    tags: ['lighting', 'vintage'],
    added: '2026-04-15',
    image: 'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=1200&q=80',
    description: 'Heavy marble base, 76" arc. Takes a standard E26 bulb.',
    reserved: { on: '2026-04-18', price: 85 },
  },
];

export function DemoPage() {
  return <SaleViewer site={site} items={items} />;
}
