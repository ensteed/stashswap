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

const GENERAL_BUTTONS: general_button[] = [
    // {
    //     id: "btn-nav-right-login",
    //     on_click: (_event) => {
    //         show_modal(0);
    //     },
    // },
];

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

function show_modal(ind: number) {
    const modal = MODAL_DIALOGS[ind];
    if (!modal) return;

    const dlg = get_dialog_by_id(modal.id);
    if (dlg) {
        dlg.showModal();
    }
}

function handle_click_general_buttons(event: MouseEvent) {
    const target = get_event_element(event.target);
    if (!target) return;

    for (const btn of GENERAL_BUTTONS) {
        // If the target id matches then just do that, otherwise we gotta get the element from the document and see if it contains the target
        // as we might have icons or other such things that got the click
        if (target.id === btn.id) {
            btn.on_click(event);
        } else {
            const btn_element = document.getElementById(btn.id);
            if (btn_element && btn_element.contains(target)) {
                btn.on_click(event);
            }
        }
    }
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
        } else if (account_menu && !is_hidden && !is_sep && (target.id === dropdown.menu_id || account_menu.contains(target))) {
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
    handle_click_general_buttons(event);
}

function handle_keydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
        handle_escape_keydown_dropdown_menus();
    }
}

function handle_htmx_load(event: Event) {
    const target = get_event_element(event.target);
    if (!target) return;

    // Any item with temp-item class will fade out after a short time
    if (target.classList.contains("temp-item")) {
        fade_and_remove_item(target.id);
    }
    // If a modal dialog is being loaded, show it modally and hook to its close to remove it once its closed
    else if (target.parentElement?.id === ROOT_MODAL_ELEMENT && target instanceof HTMLDialogElement) {
        console.log("Should show modal");
        target.showModal();
        target.addEventListener(
            "close",
            () => {
                if (target.parentElement) {
                    target.parentElement.innerHTML = "";
                }
            },
            { once: true },
        );
    }
}

function client_init() {
    if (window.__appInit) return;

    window.__appInit = true;
    document.addEventListener("click", handle_click);
    document.addEventListener("mousedown", handle_mousedown);
    document.addEventListener("keydown", handle_keydown);
    document.addEventListener("htmx:load", handle_htmx_load as EventListener);
}

client_init();

export {};
