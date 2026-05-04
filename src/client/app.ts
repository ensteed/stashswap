const ROOT_MODAL_ELEMENT = "modal-root";

type modal_dialog = {
    id: string;
    close_btn_id: string;
};

type dropdown_menu = {
    tbtn_id: string;
    menu_id: string;
};

type general_button = {
    id: string;
    on_click: (event: MouseEvent) => void;
};

declare global {
    interface Window {
        __appInit?: boolean;
    }
}

const MODAL_DIALOGS: modal_dialog[] = [
    {
        id: "login-modal",
        close_btn_id: "btn-login-modal-close",
    },
    {
        id: "create-account-modal",
        close_btn_id: "btn-create-account-modal-close",
    },
];

const DROPDOWN_MENUS: dropdown_menu[] = [
    {
        tbtn_id: "account-menu-button",
        menu_id: "dropdown-menu",
    },
];

const GENERAL_BUTTONS = [
    // {
    //     id: "btn-nav-right-login",
    //     on_click: (_e) => {
    //         show_modal(0);
    //     },
    // },
];

interface drop_area_meta {
    accepted_mime_types: Set<string>;
    accepted_exts: Set<string>;
}

function assert(condition: boolean, message: string = "") {
    if (!condition) {
        throw new Error("Assertion failed" + message ? ": " + message : "");
    }
}

const DROP_AREAS: Record<string, drop_area_meta> = {
    edit_listing_photo_drop_area: {
        accepted_mime_types: new Set(["image/png", "image/jpeg", "image/webp"]),
        accepted_exts: new Set(["png", "webp", "jpeg", "jpg"]),
    },
};

function get_event_element(target: EventTarget | null): HTMLElement | null {
    return target instanceof HTMLElement ? target : null;
}

function get_dialog_by_id(id: string): HTMLDialogElement | null {
    const el = document.getElementById(id);
    return el instanceof HTMLDialogElement ? el : null;
}

function fade_and_remove_item(id: string, delay = 1000) {
    const el = document.getElementById(id);
    if (!el) return;

    console.log(`Item ${id} should be removed in ${delay}..`);
    setTimeout(() => {
        el.classList.add("hide");
        el.addEventListener("transitionend", () => el.remove(), { once: true });
        console.log(`Item ${id} should now be removed!`);
    }, delay);
}

function handle_click_dropdown_menus(event: MouseEvent) {
    const target = get_event_element(event.target);
    if (!target) return;

    for (const dropdown of DROPDOWN_MENUS) {
        const account_menu = document.getElementById(dropdown.menu_id);
        const is_hidden = account_menu ? account_menu.classList.contains("hidden") : true;
        const is_sep = target.classList.contains("sep");
        if (account_menu && target.id === dropdown.tbtn_id) {
            // If the target is the toggle button, toggle the menu
            if (is_hidden) {
                account_menu.classList.remove("hidden");
            } else {
                account_menu.classList.add("hidden");
            }
        } else if (
            account_menu &&
            !is_hidden &&
            !is_sep &&
            (target.id === dropdown.menu_id || account_menu.contains(target))
        ) {
            account_menu.classList.add("hidden");
        }
    }
}

function handle_click_modal_dialogs(event: MouseEvent) {
    const target = get_event_element(event.target);
    if (!target) return;

    for (const modal of MODAL_DIALOGS) {
        if (target.id === modal.close_btn_id) {
            const dlg = get_dialog_by_id(modal.id);
            if (dlg) {
                dlg.close();
            }
        }
    }
}

function handle_mousedown_dropdown_menus(event: MouseEvent) {
    const target = get_event_element(event.target);
    if (!target) return;

    for (const dropdown of DROPDOWN_MENUS) {
        // Close the account menu if its open and the click is outside of it
        // But don't set hidden if the thing clicked is the button because then the on click signal
        // for the button will toggle it visible again
        if (target.id !== dropdown.tbtn_id && target.id !== dropdown.menu_id) {
            const account_menu = document.getElementById(dropdown.menu_id);
            if (account_menu && !account_menu.classList.contains("hidden") && !account_menu.contains(target)) {
                account_menu.classList.add("hidden");
            }
        }
    }
}

function handle_escape_keydown_dropdown_menus() {
    for (const dropdown of DROPDOWN_MENUS) {
        const account_menu = document.getElementById(dropdown.menu_id);
        if (account_menu && !account_menu.classList.contains("hidden")) {
            account_menu.classList.add("hidden");
        }
    }
}

function handle_mousedown(event: MouseEvent) {
    handle_mousedown_dropdown_menus(event);
}

function handle_click(event: MouseEvent) {
    handle_click_modal_dialogs(event);
    handle_click_dropdown_menus(event);
}

function handle_keydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
        handle_escape_keydown_dropdown_menus();
    }
}

function show_dialog_with_close(dlg: HTMLDialogElement, parent: HTMLElement) {
    dlg.showModal();
    dlg.addEventListener(
        "close",
        () => {
            parent.innerHTML = "";
        },
        { once: true }
    );
}

function handle_htmx_load(event: Event) {
    const target = get_event_element(event.target);
    if (!target) return;

    // Any item with temp-item class will fade out after a short time
    if (target.classList.contains("temp-item")) {
        fade_and_remove_item(target.id);
    }

    // If a modal dialog is being loaded, show it modally and hook to its close to remove it once its closed
    const parent = target.parentElement;
    if (parent && parent.id === ROOT_MODAL_ELEMENT && target instanceof HTMLDialogElement) {
        show_dialog_with_close(target, parent);
    }
}

function on_dom_content_loaded() {
    const root_modal = document.getElementById(ROOT_MODAL_ELEMENT);
    if (root_modal) {
        for (const child_dlg of root_modal.children) {
            if (child_dlg instanceof HTMLDialogElement && !child_dlg.open) {
                show_dialog_with_close(child_dlg, root_modal);
            }
        }
    }
}

function clear_drop_area_states() {
    for (const key of Object.keys(DROP_AREAS)) {
        const element = document.getElementById(key);
        if (element) element.classList.remove("valid", "invalid");
    }
}

function are_drop_items_valid(da: drop_area_meta, items: DataTransferItemList): boolean {
    if (!da) return false;
    for (let i = 0; i < items.length; ++i) {
        const kind = items[i].kind;
        const type = items[i].type;
        if (kind !== "file" || !da.accepted_mime_types.has(type)) return false;
    }
    return items.length > 0;
}

function are_drop_files_valid(da: drop_area_meta, files: FileList): boolean {
    if (!da) return false;
    for (let i = 0; i < files.length; ++i) {
        const file = files.item(i);
        if (!file) return false;
        const ext = file.name.includes(".") ? file.name.split(".").pop()?.toLowerCase() : "";
        const accepted_mime_type = da.accepted_mime_types.has(file.type);
        const accepted_file_ext = ext && da.accepted_exts.has(ext);
        if (!accepted_mime_type && !accepted_file_ext) return false;
    }
    return files.length > 0;
}

function client_init() {
    if (window.__appInit) return;

    console.log("Client init called");

    window.__appInit = true;
    document.addEventListener("click", handle_click);
    document.addEventListener("mousedown", handle_mousedown);
    document.addEventListener("keydown", handle_keydown);
    document.addEventListener("htmx:load", handle_htmx_load as EventListener);
    window.addEventListener("DOMContentLoaded", on_dom_content_loaded);

    document.addEventListener("dragover", (e: DragEvent) => {
        e.preventDefault();
        clear_drop_area_states();
        const item = get_event_element(e.target);
        if (!item) return;
        const da = DROP_AREAS[item.id];
        e.dataTransfer?.items;
        if (!da || !e.dataTransfer?.files) return;
        const da_valid = are_drop_items_valid(da, e.dataTransfer.items);
        item.classList.toggle("valid", da_valid);
        item.classList.toggle("invalid", !da_valid);
    });

    document.addEventListener("drop", (e: DragEvent) => {
        e.preventDefault();
        const item = get_event_element(e.target);
        if (!item) return;
        const da = DROP_AREAS[item.id];
        if (!da || !e.dataTransfer?.files) return;
        const da_valid = are_drop_files_valid(da, e.dataTransfer.files);
        if (!da_valid) return;
        const input_element = document.getElementById("edit_listing_photo_upload_input");
        if (!input_element) return;
        assert(input_element instanceof HTMLInputElement);
        (input_element as HTMLInputElement).files = e.dataTransfer.files;
    });
}

client_init();

export {};
