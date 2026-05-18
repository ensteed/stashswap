import { handle_dom_loaded_show_modal_dialog, handle_click_modal_dialogs } from "./modals";
import { handle_htmx_load } from "./htmx";
import { handle_dragover_drop_areas, handle_drop_drop_areas, handle_click_drop_areas, handle_change_drop_areas } from "./dropareas";
import {
    handle_click_dropdown_menus,
    handle_mousedown_dropdown_menus,
    handle_escape_keydown_dropdown_menus,
} from "./dropdowns";

declare global {
    interface Window {
        __appInit?: boolean;
    }
}

function handle_mousedown(event: MouseEvent) {
    handle_mousedown_dropdown_menus(event);
}

function handle_click(event: MouseEvent) {
    handle_click_modal_dialogs(event);
    handle_click_dropdown_menus(event);
    handle_click_drop_areas(event);
}

function handle_keydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
        handle_escape_keydown_dropdown_menus();
    }
}

function handle_dragover_event(e: DragEvent) {
    e.preventDefault();
    handle_dragover_drop_areas(e);
}

function handle_drop_event(e: DragEvent) {
    e.preventDefault();
    handle_drop_drop_areas(e);
}

function handle_dom_content_loaded() {
    handle_dom_loaded_show_modal_dialog();
}

function handle_change_event(e: Event) {
    handle_change_drop_areas(e);
}

function client_init() {
    if (window.__appInit) return;

    console.log("Client init called");

    window.__appInit = true;
    document.addEventListener("click", handle_click);
    document.addEventListener("mousedown", handle_mousedown);
    document.addEventListener("keydown", handle_keydown);
    window.addEventListener("DOMContentLoaded", handle_dom_content_loaded);
    document.addEventListener("dragover", handle_dragover_event);
    document.addEventListener("drop", handle_drop_event);
    document.addEventListener("change", handle_change_event);
    
    document.addEventListener("htmx:load", handle_htmx_load as EventListener);
}

client_init();

export {};
