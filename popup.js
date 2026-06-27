'use strict';

const chkEnabled  = document.getElementById('chk-enabled');
const countVal    = document.getElementById('count-val');
const displayRow  = document.getElementById('display-row');
const btnOptions  = document.getElementById('btn-options');
const btnNaver    = document.getElementById('btn-naver');

// Load current settings and update UI
chrome.storage.sync.get(
  { enabled: true, displayMode: 'replace' },
  (s) => {
    chkEnabled.checked = s.enabled;
    setActive(displayRow, '.display-btn', s.displayMode);
  }
);

// Poll replacement count from active tab
chrome.runtime.sendMessage({ type: 'GET_COUNT' }, (r) => {
  countVal.textContent = (r && r.count != null) ? r.count : '—';
});

// Toggle enabled
chkEnabled.addEventListener('change', () => {
  const enabled = chkEnabled.checked;
  chrome.storage.sync.set({ enabled }, () => applySettings({ enabled }));
});

// Display mode buttons
displayRow.addEventListener('click', (e) => {
  const btn = e.target.closest('.display-btn');
  if (!btn) return;
  const displayMode = btn.dataset.mode;
  setActive(displayRow, '.display-btn', displayMode);
  chrome.storage.sync.set({ displayMode }, () => applySettings({ displayMode }));
});

// Options page
btnOptions.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// Naver dictionary shortcut
btnNaver.addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://hanja.dict.naver.com/' });
});

function setActive(container, selector, mode) {
  container.querySelectorAll(selector).forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
}

function applySettings(delta) {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab) return;
    chrome.tabs.sendMessage(tab.id, { type: 'APPLY_SETTINGS', settings: delta }, () => {
      // ignore errors (e.g. extension pages)
      void chrome.runtime.lastError;
    });
  });
}
