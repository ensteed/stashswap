import fs from "fs";

console.log("Copying views");
fs.cpSync("src/server/views", "dist/views", {"recursive": true});

console.log("Copying client src");
fs.cpSync("src/client", "public", {"recursive": true});

console.log("Copying assets");
fs.cpSync("assets", "public", {"recursive": true});
