import { readFileSync } from "fs";
import path from "path";

interface asset_manifest {
    main: string;
    css: string;
    icons: string;
    default_profile_pic: string;
}

interface manifest_entry {
    file: string;
    isEntry?: boolean;
    css?: string[];
}

function load_asset_manifest() {
    const amanifest: asset_manifest = { main: "", css: "", icons: "", default_profile_pic: "" };
    const manifest = JSON.parse(readFileSync("public/.vite/manifest.json", "utf8"));
    for (const [key, value] of Object.entries(manifest) as [string, manifest_entry][]) {
        const nm = path.basename(key);
        ilog(`Processing ${nm}`);
        if (value.isEntry) {
            amanifest.main = "/" + value.file;
            ilog(`Writing ${amanifest.main} to main`);
            if (value.css && value.css.length > 0 && value.css[0]) {
                amanifest.css = "/" + value.css[0];
                ilog(`Writing ${amanifest.css} to css`);
            }
        } else if (nm === "icons.svg") {
            amanifest.icons = "/" + value.file;
        } else if (nm === "default.png") {
            amanifest.default_profile_pic = "/" + value.file;
        } else {
            throw new Error(`Unknown asset in manifest: ${nm}`);
        }
    }
    return amanifest;
}

export const amanifest: asset_manifest = load_asset_manifest();
