const handlers = new Map();
const on = (name, handler) => {
  handlers.set(name, handler);
};
const emit = (name, ...args) => {
  const handler = handlers.get(name);
  if (handler) handler(...args);
};

export { on, emit };
