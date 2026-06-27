'use strict';

const chkEnabled  = document.getElementById('chk-enabled');
const countVal    = document.getElementById('count-val');
const scriptRow   = document.getElementById('script-row');
const displayRow  = document.getElementById('display-row');
const btnOptions  = document.getElementById('btn-options');
const btnNaver    = document.getElementById('btn-naver');

// Load current settings and update UI
chrome.storage.sync.get(
  { enabled: true, scriptMode: 'traditional', displayMode: 'replace' },
  (s) => {
    chkEnabled.checked = s.enabled;
    setActive(scriptRow,  '.script-btn',  s.scriptMode);
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

// Script mode buttons
scriptRow.addEventListener('click', (e) => {
  const btn = e.target.closest('.script-btn');
  if (!btn) return;
  const scriptMode = btn.dataset.mode;
  setActive(scriptRow, '.script-btn', scriptMode);
  chrome.storage.sync.set({ scriptMode }, () => applySettings({ scriptMode }));
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
