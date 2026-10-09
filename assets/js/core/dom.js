/**
 * `querySelector` with an optional scope root.
 * @param {string} selector
 * @param {ParentNode} [root=document] - element or document to scope the query
 */
const $ = (selector, root = document) => root.querySelector(selector);

/**
 * `querySelectorAll` returning a real array.
 * @param {string} selector
 * @param {ParentNode} [root=document] - element or document to scope the query
 */
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
const safeExternalUrl = (value) => {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
};

export { $, $$, esc, safeExternalUrl };
