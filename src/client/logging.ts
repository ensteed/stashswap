declare global {
  var ilog: typeof console.log;
  var dlog: typeof console.debug;
  var wlog: typeof console.warn;
  var elog: typeof console.error;
  var asrt: typeof console.assert;
}
globalThis.ilog = console.log.bind(console);
globalThis.dlog = console.debug.bind(console);
globalThis.wlog = console.warn.bind(console);
globalThis.elog = console.error.bind(console);
globalThis.asrt = console.assert.bind(console);

export {};
