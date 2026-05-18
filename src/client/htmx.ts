import { get_event_element } from "./dom";
import { fade_and_remove_item } from "./effects";
import { show_modal_dialog_with_close } from "./modals";

export function handle_htmx_load(event: Event, rootModalElementId: string) {
    const target = get_event_element(event.target);
    if (!target) return;

    if (target.classList.contains("temp-item")) {
        fade_and_remove_item(target.id);
    }

    const parent = target.parentElement;
    if (parent && parent.id === rootModalElementId && target instanceof HTMLDialogElement) {
        show_modal_dialog_with_close(target, parent);
    }
}
