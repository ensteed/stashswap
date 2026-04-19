import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { amanifest } from "./assets.js";

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
function load_view(rel_path: string) {
    const fpath = path.join(BASE_DIR, rel_path);
    return fs.readFileSync(fpath, "utf8");
}

export function render_loaded_view(html: string, vars: Record<string, string> = {}): string {
    // Handle includes like {{> partials/nav.html }}
    html = html.replace(INCLUDE_RE, (_, include_path) => {
        // This will need to be updated if we add arg options to the include path
        return render_view(include_path.trim(), vars);
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

export function render_view(template_path: string, vars: Record<string, string> = {}): string {
    let html = load_view(template_path);
    return render_loaded_view(html, vars);
}

export function render_layout(layout: string, vars: Record<string, string> = {}): string {
    const params = {
        client_entry_point: amanifest.main,
        client_css: amanifest.css,
        ...vars,
    };
    const layout_path = layout.endsWith(".html") ? layout : layout + ".html";
    return render_view("layouts/" + layout_path, params);
}

export function render_page(page: string, vars: Record<string, string> = {}): string {
    const page_path = page.endsWith(".html") ? page : page + ".html";
    return render_view("pages/" + page_path, vars);
}

export function render_partial(partial: string, vars: Record<string, string> = {}): string {
    const partial_path = partial.endsWith(".html") ? partial : partial + ".html";
    return render_view("partials/" + partial_path, vars);
}

export function render_page_layout(page: string, page_vars: Record<string, string> = {}, layout:string = "main", layout_vars: Record<string, string> = {}): string {
    const params = {
        main_content_html: render_page(page, page_vars),
        ...layout_vars,
    };
    return render_layout(layout, params);
}

const template = {
    render_loaded_view: render_loaded_view,
    render_view: render_view,
    render_layout: render_layout,
    render_page: render_page,
    render_partial: render_partial,
    render_page_layout: render_page_layout,
};

export default template;
