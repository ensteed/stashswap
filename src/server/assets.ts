import { readFileSync } from "fs";
import path from "path";

interface asset_manifest {
    main: string;
    css: string;
    icons: string;
}

interface manifest_entry {
    file: string;
    isEntry?: boolean;
    css?: string[];
}

function load_asset_manifest() {
    const amanifest: asset_manifest = {main: "", css: "", icons: ""};
    const manifest = JSON.parse(readFileSync("public/.vite/manifest.json", "utf8"));
    for (const [key, value] of Object.entries(manifest) as [string, manifest_entry][]) {
        const nm = path.basename(key);
        if (value.isEntry) {
            amanifest.main = value.file;
            if (value.css && value.css.length > 0 && value.css[0]) {
                amanifest.css = value.css[0];
            }
        } else if (nm === "icons.svg") {
            amanifest.icons = value.file;
        } else {
            throw new Error(`Unknown asset in manifest: ${nm}`);
        }
    }
    return amanifest;
}

export const amanifest: asset_manifest = load_asset_manifest();
