export function assert(condition: boolean, message: string = "") {
    if (!condition) {
        throw new Error("Assertion failed" + (message ? ": " + message : ""));
    }
}

export function get_event_element(target: EventTarget | null): HTMLElement | null {
    return target instanceof HTMLElement ? target : null;
}

export function get_dialog_by_id(id: string): HTMLDialogElement | null {
    const el = document.getElementById(id);
    return el instanceof HTMLDialogElement ? el : null;
}
