/**
 * Synchronous named hooks: the seam that keeps the dependency graph acyclic.
 *
 * Feature modules may not import page shells or the navigation module (that
 * would create import cycles). Instead they *emit* events here, and the
 * composition root (main.js) registers the handlers that wire events to the
 * owning module. Handlers run synchronously, preserving the original
 * call-by-call execution order.
 *
 * Current events:
 *   'navigate'        — something asks to switch pages (main.js → openPage)
 *   'page:changed'    — openPage switched pages (main.js → render + load)
 *   'module:rerender' — re-render the current module shell (main.js → renderModule)
 */

const handlers = new Map();

/** Register the handler for an event name (one handler per event). */
const on = (name, handler) => {
  handlers.set(name, handler);
};

/** Invoke the handler for an event name if one is registered. */
const emit = (name, ...args) => {
  const handler = handlers.get(name);
  if (handler) handler(...args);
};

export { on, emit };
