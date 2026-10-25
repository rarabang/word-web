// Native dialogs provide focus containment, Escape dismissal, and inert backgrounds.
for (const name of ["help", "settings"]) {
  const trigger = document.getElementById(`${name}-button`);
  const dialog = document.getElementById(`${name}-dialog`);
  trigger.addEventListener("click", () => dialog.showModal());
  dialog.querySelector("[data-close-dialog]").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => trigger.focus());
  dialog.addEventListener("keydown", event => event.stopPropagation());
  dialog.addEventListener("click", event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
}
