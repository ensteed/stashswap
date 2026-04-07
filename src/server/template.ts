import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BASE_DIR = path.join(__dirname, "./views");

// This is reg exp for {{> ...}} where ... can be really anything.. this can be used in the future to pass args if needed
const INCLUDE_RE = /{{>\s*([^}]+)\s*}}/g;

// {{type:key}} OR {{key}}  (type optional)
const SLOT_RE = /\{\{\s*(?:(html|attr|url|text|raw)\s*:\s*)?(\w+)\s*\}\}/g;

// A set of functions for replacing the handlebar vars depending on the type - the default if no type is specified is raw (no escaping)
const enc = {
    html: (s: string) =>
        s
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#39;"),
    attr: (s: string) =>
        s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"),
    url: (s: string) => encodeURIComponent(s),
    text: (s: string) => s, // plain text (e.g., email .txt body)
    raw: (s: string) => s, // no escaping
} as const;

// Load fragment from disk relative to BASE_DIR
function load_fragment(rel_path: string) {
    const fpath = path.join(BASE_DIR, rel_path);
    return fs.readFileSync(fpath, "utf8");
}

export function render_loaded_fragment(html: string, vars: Record<string, string> = {}) {
    // Handle includes like {{> fragments/nav.html }}
    html = html.replace(INCLUDE_RE, (_, include_path) => {
        // This will need to be updated if we add arg options to the include path
        return render_fragment(include_path.trim(), vars);
    });

    // Replace slots with "sink-aware" encoding - ie using the enc thing to replace strings
    html = html.replace(SLOT_RE, (_m, type, key) => {
        const v = vars[key];
        // If var doesn't exist return null - == covers both undefined and null but lets falsy numbers (and bools) through
        if (v == null) return "";

        // The regexp will make type be falsy if no type is specified in the capture group. IE if {{ var }} is specified rather than
        // {{ type::var }}, then type will be falsy and var would be var. We default to raw in that case.
        const fn = (type ? (enc as any)[type] : enc.raw) as (x: string) => string;
        return fn(v);
    });

    return html;
}

export function render_fragment(template_path: string, vars: Record<string, string> = {}) {
    let html = load_fragment(template_path);
    return render_loaded_fragment(html, vars);
}

const template = {
    render_fragment,
    render_loaded_fragment,
};

export default template;
