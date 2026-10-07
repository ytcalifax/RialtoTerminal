/**
 * DOM query and escaping primitives.
 *
 * Every module touches the DOM through these helpers so selectors and the
 * escaping policy stay consistent application-wide.
 */

/** `querySelector` with an optional scope root. */
const $ = (selector, root = document) => root.querySelector(selector);

/** `querySelectorAll` returning a real array. */
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/**
 * Escape a value for safe interpolation into HTML text or attributes.
 * Applied to *every* piece of upstream data before it enters a template
 * literal — the single most important XSS guard in the app.
 */
const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

export { $, $$, esc };
