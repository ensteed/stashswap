import { get_dialog_by_id, get_event_element } from "./dom";

const ROOT_MODAL_ELEMENT = "modal-root";

type modal_dialog = {
    id: string;
    close_btn_id: string;
};

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

export function show_modal_dialog_with_close(dlg: HTMLDialogElement, parent: HTMLElement) {
    dlg.showModal();
    dlg.addEventListener(
        "close",
        () => {
            parent.innerHTML = "";
        },
        { once: true }
    );
}

export function handle_dom_loaded_show_modal_dialog() {
    const root_modal = document.getElementById(ROOT_MODAL_ELEMENT);
    if (root_modal) {
        for (const child_dlg of root_modal.children) {
            if (child_dlg instanceof HTMLDialogElement && !child_dlg.open) {
                show_modal_dialog_with_close(child_dlg, root_modal);
            }
        }
    }
}

export function handle_click_modal_dialogs(event: MouseEvent) {
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
