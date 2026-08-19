export function applyTheme(theme, root = document.body) {
    if (!root) return;
    if (theme === "light" || theme === "dark") {
        root.classList.remove("theme-dark", "dark");
        if (theme === "dark") {
            root.classList.add("theme-dark", "dark");
        }
    }
}

export function detectSystemMode() {
    const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    return mq && mq.matches ? "dark" : "light";
}
