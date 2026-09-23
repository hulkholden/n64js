// Each tab list owns only its direct tabs; nested debugger tabs keep their state.
export function showTab(tab) {
  const list = tab.closest('[role="tablist"]');
  if (tab.classList.contains('active')) return;
  for (const sibling of list.querySelectorAll('[role="tab"]')) {
    const selected = sibling === tab;
    sibling.classList.toggle('active', selected);
    sibling.setAttribute('aria-selected', String(selected));
    sibling.tabIndex = selected ? 0 : -1;
    document.querySelector(sibling.dataset.tabTarget).classList.toggle('active', selected);
  }
  tab.dispatchEvent(new Event('tabshown', { bubbles: true }));
}

export function initTabs(onShown) {
  document.querySelectorAll('.tabbable > .nav').forEach((list, listIndex) => {
    list.setAttribute('role', 'tablist');
    const tabs = [...list.querySelectorAll('[data-tab-target]')];
    tabs.forEach((tab, index) => {
      const panel = document.querySelector(tab.dataset.tabTarget);
      tab.id ||= `tab-${listIndex}-${index}`;
      tab.setAttribute('aria-controls', panel.id);
      tab.setAttribute('aria-selected', String(tab.classList.contains('active')));
      tab.tabIndex = tab.classList.contains('active') ? 0 : -1;
      tab.parentElement.setAttribute('role', 'presentation');
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', tab.id);
      tab.addEventListener('click', () => showTab(tab));
      tab.addEventListener('keydown', event => {
        let next;
        switch (event.key) {
          case 'ArrowRight': case 'ArrowDown': next = (index + 1) % tabs.length; break;
          case 'ArrowLeft': case 'ArrowUp': next = (index + tabs.length - 1) % tabs.length; break;
          case 'Home': next = 0; break;
          case 'End': next = tabs.length - 1; break;
          default: return;
        }
        event.preventDefault();
        // Keep debugger keyboard shortcuts from consuming tab navigation.
        event.stopPropagation();
        tabs[next].focus();
        showTab(tabs[next]);
      });
    });
    list.addEventListener('tabshown', onShown);
  });
}
