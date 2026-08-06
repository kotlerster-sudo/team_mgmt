/**
 * Plain-module constants shared between server code (rulebook / derive)
 * and the client wizard forms.
 *
 * IMPORTANT: keep this file server-safe (no 'use client', no JSX, no
 * DOM/window). It's imported from `lib/approvals/validation/rulebook.ts`
 * which runs during the Vercel build's page-data collection step.
 * The previous home for FY_LABELS was `app/partner/approvals/[id]/_shared.tsx`
 * which is `'use client'` — server bundles replaced it with a client-reference
 * proxy at build time, so `FY_LABELS.slice` blew up. Regression fixed 2026-08-06.
 */

export const FY_LABELS = [
  'FY22-23',
  'FY23-24',
  'FY24-25',
  'FY25-26',
  'FY26-27',
  'FY27-28',
  'FY28-29',
] as const;

export type FyLabel = (typeof FY_LABELS)[number];
