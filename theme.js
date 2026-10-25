(() => {
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  let preference = 'system';
  try {
    const saved = window.localStorage.getItem('word-web-theme');
    if (['light', 'dark', 'system'].includes(saved)) preference = saved;
  } catch {}

  function applyTheme() {
    const dark = preference === 'dark' || (preference === 'system' && system.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]').setAttribute('content', dark ? '#000000' : '#f4f2eb');
  }

  applyTheme();
  system.addEventListener('change', applyTheme);
  document.addEventListener('DOMContentLoaded', () => {
    const selector = document.getElementById('theme-select');
    selector.value = preference;
    selector.addEventListener('change', () => {
      preference = selector.value;
      try { window.localStorage.setItem('word-web-theme', preference); } catch {}
      applyTheme();
    });
  });
})();
