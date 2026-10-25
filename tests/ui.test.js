const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

test('utility dialogs open, close, restore focus, and isolate game shortcuts', () => {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      handlers: {}, open: false,
      addEventListener(type, handler) { this.handlers[type] = handler; },
      showModal() { this.open = true; },
      close() { this.open = false; this.handlers.close(); },
      focus() { this.focused = true; },
      querySelector() { return element(`${id}-close`); },
      getBoundingClientRect() { return { left: 20, right: 200, top: 20, bottom: 200 }; },
    });
    return elements.get(id);
  }
  vm.runInNewContext(fs.readFileSync(require.resolve('../ui.js'), 'utf8'), {
    document: { getElementById: element },
  });
  for (const name of ['help', 'settings']) {
    const trigger = element(`${name}-button`);
    const dialog = element(`${name}-dialog`);
    trigger.handlers.click();
    assert.equal(dialog.open, true);
    let stopped = false;
    dialog.handlers.keydown({ stopPropagation() { stopped = true; } });
    assert.equal(stopped, true);
    dialog.handlers.click({ target: dialog, clientX: 50, clientY: 50 });
    assert.equal(dialog.open, true, 'clicks inside the dialog keep it open');
    dialog.handlers.click({ target: dialog, clientX: 0, clientY: 0 });
    assert.equal(dialog.open, false);
    assert.equal(trigger.focused, true);
    trigger.handlers.click();
    element(`${name}-dialog-close`).handlers.click();
    assert.equal(dialog.open, false);
  }
});
