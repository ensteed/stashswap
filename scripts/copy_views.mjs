import fs from "fs";
console.log("Copying views");
fs.cpSync("src/server/views", "dist/views", {"recursive": true});
