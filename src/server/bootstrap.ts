import dotenv from "dotenv";
// Extend our request type to have any additional members we need and create some aliases for ilog guys
declare global {
  var ilog: any;
  var dlog: any;
  var wlog: any;
  var elog: any;
  var asrt: any;
}
globalThis.ilog = console.log;
globalThis.dlog = console.debug;
globalThis.wlog = console.warn;
globalThis.elog = console.error;
globalThis.asrt = console.assert;

// Pull our env vars - This should be done before we load any of our other files as they might access the env vars
dotenv.config();
