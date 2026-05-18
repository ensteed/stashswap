import { get_event_element } from "./dom";

type DropdownMenu = {
    tbtn_id: string;
    menu_id: string;
};

const DROPDOWN_MENUS: DropdownMenu[] = [
    {
        tbtn_id: "account-menu-button",
        menu_id: "dropdown-menu",
    },
];

export function handle_click_dropdown_menus(event: MouseEvent) {
    const target = get_event_element(event.target);
    if (!target) return;

    for (const dropdown of DROPDOWN_MENUS) {
        const menu = document.getElementById(dropdown.menu_id);
        const is_hidden = menu ? menu.classList.contains("hidden") : true;
        const is_sep = target.classList.contains("sep");

        if (menu && target.id === dropdown.tbtn_id) {
            menu.classList.toggle("hidden");
        } else if (
            menu &&
            !is_hidden &&
            !is_sep &&
            (target.id === dropdown.menu_id || menu.contains(target))
        ) {
            menu.classList.add("hidden");
        }
    }
}

export function handle_mousedown_dropdown_menus(event: MouseEvent) {
    const target = get_event_element(event.target);
    if (!target) return;

    for (const dropdown of DROPDOWN_MENUS) {
        if (target.id !== dropdown.tbtn_id && target.id !== dropdown.menu_id) {
            const menu = document.getElementById(dropdown.menu_id);
            if (menu && !menu.classList.contains("hidden") && !menu.contains(target)) {
                menu.classList.add("hidden");
            }
        }
    }
}

export function handle_escape_keydown_dropdown_menus() {
    for (const dropdown of DROPDOWN_MENUS) {
        const menu = document.getElementById(dropdown.menu_id);
        if (menu && !menu.classList.contains("hidden")) {
            menu.classList.add("hidden");
        }
    }
}
