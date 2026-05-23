// Extend our request type to have any additional members we need and create some aliases for ilog guys
declare global {
  var ilog: typeof console.log;
  var dlog: typeof console.debug;
  var wlog: typeof console.warn;
  var elog: typeof console.error;
  var asrt: typeof console.assert;
}

globalThis.ilog = console.log;
globalThis.dlog = console.debug;
globalThis.wlog = console.warn;
globalThis.elog = console.error;
globalThis.asrt = console.assert;
