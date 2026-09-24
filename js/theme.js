(() => {
  'use strict';

  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
  const themes = ['light', 'dark', 'auto'];
  let preference = 'auto';

  // Missing or unrecognized preferences follow the system theme.
  try {
    const stored = localStorage.getItem('theme');

    if (themes.includes(stored)) {
      preference = stored;
    }
  } catch {
    // Theme selection still works when storage is unavailable.
  }

  // Resolve Auto to a concrete color scheme without changing the saved preference.
  const applyTheme = () => {
    let theme = preference;

    if (theme === 'auto') {
      theme = systemTheme.matches ? 'dark' : 'light';
    }

    document.documentElement.dataset.theme = theme;
  };

  // Apply colors immediately; the menu can wait until the DOM is ready.
  applyTheme();
  systemTheme.addEventListener('change', applyTheme);

  window.addEventListener('DOMContentLoaded', () => {
    const trigger = document.getElementById('bd-theme');
    const menu = document.getElementById('theme-menu');
    const buttons = [...menu.querySelectorAll('[data-theme-value]')];

    // The menu and trigger describe the preference, including Auto, rather than
    // the light/dark color scheme currently selected by the system.
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

    buttons.forEach(button => {
      button.addEventListener('click', () => {
        preference = button.dataset.themeValue;

        try {
          localStorage.setItem('theme', preference);
        } catch {
          // A failed save should not prevent changing the theme for this visit.
        }

        applyTheme();
        updateSelection();

        // Return focus before the user continues tabbing through the toolbar.
        setOpen(false);
        trigger.focus();
      });
    });

    const dropdown = trigger.closest('.dropdown');

    dropdown.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !menu.hidden) {
        event.preventDefault();
        event.stopPropagation();

        setOpen(false);
        trigger.focus();
      } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();

        // These keys navigate the menu, not the debugger behind it.
        event.stopPropagation();
        setOpen(true);

        // An index of -1 means focus is on the trigger. ArrowDown enters at the
        // first option and ArrowUp at the last; subsequent arrow presses wrap.
        const index = buttons.indexOf(document.activeElement);
        let next;

        switch (event.key) {
          case 'Home':
            next = 0;
            break;

          case 'End':
            next = buttons.length - 1;
            break;

          case 'ArrowDown':
            next = (index + 1) % buttons.length;
            break;

          case 'ArrowUp':
            next = index < 0
              ? buttons.length - 1
              : (index + buttons.length - 1) % buttons.length;
            break;
        }

        buttons[next].focus();
      }
    });

    document.addEventListener('click', event => {
      if (!dropdown.contains(event.target)) {
        setOpen(false);
      }
    });

    // Keep the menu open while focus moves between its options, but close it
    // when Tab (or another focus change) takes the user outside the dropdown.
    dropdown.addEventListener('focusout', event => {
      if (!dropdown.contains(event.relatedTarget)) {
        setOpen(false);
      }
    });

    updateSelection();
  });
})();
