export function fade_and_remove_item(id: string, delay = 1000) {
    const el = document.getElementById(id);
    if (!el) return;

    setTimeout(() => {
        el.classList.add("hide");
        el.addEventListener("transitionend", () => el.remove(), { once: true });
    }, delay);
}
