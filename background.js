// Service worker — handles install defaults and badge colour
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    chrome.storage.sync.set({
      enabled: true,
      displayMode: 'replace',     // 'replace' | 'ruby'
      showBadge: true,
      showNaverLink: true,
      blacklist: [],
      whitelist: [],
    });
  }
});

// Relay toggle messages from popup to the active tab
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'GET_COUNT') {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (!tab) { sendResponse({ count: 0 }); return; }
      chrome.tabs.sendMessage(tab.id, { type: 'GET_COUNT' }, (r) => {
        sendResponse(r || { count: 0 });
      });
    });
    return true; // async
  }
});
