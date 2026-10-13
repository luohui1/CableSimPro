// Reuse the visible-text traversal, its real saved objects and read-only guards.
process.env.REGULARITY_AUDIT = '1';
await import('./verify-visible-text.mjs');
