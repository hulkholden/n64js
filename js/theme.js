(() => {
  'use strict';

  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
  const themes = ['light', 'dark', 'auto'];
  let preference = 'auto';
  try {
    const stored = localStorage.getItem('theme');
    if (themes.includes(stored)) preference = stored;
  } catch { /* Theme selection still works when storage is unavailable. */ }

  const applyTheme = () => {
    document.documentElement.dataset.theme = preference === 'auto'
      ? (systemTheme.matches ? 'dark' : 'light') : preference;
  };
  applyTheme();
  systemTheme.addEventListener('change', applyTheme);

  window.addEventListener('DOMContentLoaded', () => {
    const trigger = document.getElementById('bd-theme');
    const menu = document.getElementById('theme-menu');
    const buttons = [...menu.querySelectorAll('[data-theme-value]')];
    const updateSelection = () => {
      for (const button of buttons) {
        const selected = button.dataset.themeValue === preference;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-pressed', String(selected));
        if (selected) {
          trigger.querySelector('i').className = button.querySelector('i').className;
        }
      }
      trigger.setAttribute('aria-label', `Theme (${preference})`);
    };
    const setOpen = open => {
      menu.hidden = !open;
      trigger.setAttribute('aria-expanded', String(open));
    };
    trigger.addEventListener('click', () => setOpen(menu.hidden));
    buttons.forEach(button => button.addEventListener('click', () => {
      preference = button.dataset.themeValue;
      try { localStorage.setItem('theme', preference); } catch { /* Optional storage. */ }
      applyTheme();
      updateSelection();
      setOpen(false);
      trigger.focus();
    }));
    const dropdown = trigger.closest('.dropdown');
    dropdown.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !menu.hidden) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        trigger.focus();
      } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(true);
        const index = buttons.indexOf(document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
          : event.key === 'ArrowDown' ? (index + 1) % buttons.length
          : (index < 0 ? buttons.length - 1 : (index + buttons.length - 1) % buttons.length);
        buttons[next].focus();
      }
    });
    document.addEventListener('click', event => {
      if (!dropdown.contains(event.target)) setOpen(false);
    });
    dropdown.addEventListener('focusout', event => {
      if (!dropdown.contains(event.relatedTarget)) setOpen(false);
    });
    updateSelection();
  });
})();
