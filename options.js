'use strict';

const DEFAULTS = {
  enabled:      true,
  scriptMode:   'traditional',
  displayMode:  'replace',
  showBadge:    true,
  showNaverLink: true,
  blacklist:    [],
  whitelist:    [],
};

const els = {
  enabled:      document.getElementById('chk-enabled'),
  badge:        document.getElementById('chk-badge'),
  naver:        document.getElementById('chk-naver'),
  whitelist:    document.getElementById('whitelist'),
  blacklist:    document.getElementById('blacklist'),
  save:         document.getElementById('btn-save'),
  status:       document.getElementById('status'),
};

// Load settings into UI
chrome.storage.sync.get(DEFAULTS, (s) => {
  els.enabled.checked = s.enabled;
  els.badge.checked   = s.showBadge;
  els.naver.checked   = s.showNaverLink;

  const scriptRadio = document.querySelector(`input[name="scriptMode"][value="${s.scriptMode}"]`);
  if (scriptRadio) scriptRadio.checked = true;

  const displayRadio = document.querySelector(`input[name="displayMode"][value="${s.displayMode}"]`);
  if (displayRadio) displayRadio.checked = true;

  els.whitelist.value = s.whitelist.join('\n');
  els.blacklist.value = s.blacklist.join('\n');
});

// Save handler
els.save.addEventListener('click', () => {
  const scriptRadio  = document.querySelector('input[name="scriptMode"]:checked');
  const displayRadio = document.querySelector('input[name="displayMode"]:checked');

  const settings = {
    enabled:       els.enabled.checked,
    showBadge:     els.badge.checked,
    showNaverLink: els.naver.checked,
    scriptMode:    scriptRadio  ? scriptRadio.value  : 'traditional',
    displayMode:   displayRadio ? displayRadio.value : 'replace',
    whitelist:     parseList(els.whitelist.value),
    blacklist:     parseList(els.blacklist.value),
  };

  chrome.storage.sync.set(settings, () => {
    broadcastSettings(settings);
    showStatus('已儲存', false);
  });
});

function parseList(raw) {
  return raw.split('\n')
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean);
}

function broadcastSettings(settings) {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      chrome.tabs.sendMessage(tab.id, { type: 'APPLY_SETTINGS', settings }, () => {
        void chrome.runtime.lastError;
      });
    });
  });
}

function showStatus(msg, isError) {
  els.status.textContent = msg;
  els.status.className   = 'status visible' + (isError ? ' error' : '');
  setTimeout(() => { els.status.className = 'status'; }, 2000);
}
