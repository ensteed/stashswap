import fs from "fs";
console.log("Removing output dist dir");
fs.rmSync("dist", {recursive: true, force: true});
