'use strict';

const DEFAULTS = {
  enabled:      true,
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

  const displayRadio = document.querySelector(`input[name="displayMode"][value="${s.displayMode}"]`);
  if (displayRadio) displayRadio.checked = true;

  els.whitelist.value = s.whitelist.join('\n');
  els.blacklist.value = s.blacklist.join('\n');
});

// Save handler
els.save.addEventListener('click', () => {
  const displayRadio = document.querySelector('input[name="displayMode"]:checked');

  const settings = {
    enabled:       els.enabled.checked,
    showBadge:     els.badge.checked,
    showNaverLink: els.naver.checked,
    displayMode:   displayRadio ? displayRadio.value : 'replace',
    whitelist:     parseList(els.whitelist.value),
    blacklist:     parseList(els.blacklist.value),
  };

  chrome.storage.sync.set(settings, () => {
    broadcastSettings(settings);
    saveDebugConfig();
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

// ════════════════════════════════════════════════════════════════
//  Debug 查漏补缺
// ════════════════════════════════════════════════════════════════
const DEBUG_DEFAULT = {
  enabled: false,
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  systemPrompt: '',
};

const dbg = {
  enabled:    document.getElementById('dbg-enabled'),
  base:       document.getElementById('dbg-base'),
  key:        document.getElementById('dbg-key'),
  model:      document.getElementById('dbg-model'),
  prompt:     document.getElementById('dbg-prompt'),
  test:       document.getElementById('dbg-test'),
  testStatus: document.getElementById('dbg-test-status'),
  refresh:    document.getElementById('dbg-refresh'),
  exportLog:  document.getElementById('dbg-export-log'),
  exportDict: document.getElementById('dbg-export-dict'),
  clear:      document.getElementById('dbg-clear'),
  summary:    document.getElementById('dbg-summary'),
};

// Load debug config into UI
chrome.storage.local.get('debugConfig', (r) => {
  const c = Object.assign({}, DEBUG_DEFAULT, r.debugConfig || {});
  dbg.enabled.checked = c.enabled;
  dbg.base.value      = c.baseUrl;
  dbg.key.value       = c.apiKey;
  dbg.model.value     = c.model;
  dbg.prompt.value    = c.systemPrompt;
});

function readDebugConfig() {
  return {
    enabled:      dbg.enabled.checked,
    baseUrl:      dbg.base.value.trim() || DEBUG_DEFAULT.baseUrl,
    apiKey:       dbg.key.value.trim(),
    model:        dbg.model.value.trim() || DEBUG_DEFAULT.model,
    systemPrompt: dbg.prompt.value,
  };
}

function saveDebugConfig() {
  chrome.storage.local.set({ debugConfig: readDebugConfig() });
}

// Test connection
dbg.test.addEventListener('click', () => {
  const cfg = readDebugConfig();
  if (!cfg.apiKey) { setTestStatus('請先填寫 API Key', true); return; }
  saveDebugConfig();
  setTestStatus('測試中…', false);
  chrome.runtime.sendMessage({ type: 'TEST_AI', config: cfg }, (res) => {
    if (chrome.runtime.lastError) { setTestStatus('擴展通訊失敗', true); return; }
    if (res && res.ok) setTestStatus('連線正常 ✓ ' + (res.sample || ''), false);
    else setTestStatus('失敗：' + ((res && res.error) || '未知錯誤'), true);
  });
});

function setTestStatus(msg, isErr) {
  dbg.testStatus.textContent = msg;
  dbg.testStatus.className = 'status inline visible' + (isErr ? ' error' : '');
}

// Log: refresh / aggregate
dbg.refresh.addEventListener('click', renderLog);

function renderLog() {
  chrome.storage.local.get('debugLog', (r) => {
    const log = Array.isArray(r.debugLog) ? r.debugLog : [];
    if (!log.length) { dbg.summary.textContent = '日誌為空。'; return; }

    const missCount = {};   // hangul -> { hanja(most common), count }
    const errList = [];
    let analyses = 0, fails = 0;

    log.forEach((e) => {
      if (e.error) { fails++; return; }
      analyses++;
      (e.missing || []).forEach((m) => {
        if (!m || !m.hangul) return;
        const k = m.hangul;
        if (!missCount[k]) missCount[k] = { hanja: m.hanja || '', count: 0, conf: m.conf || m.confidence || 0 };
        missCount[k].count++;
        if (m.hanja && !missCount[k].hanja) missCount[k].hanja = m.hanja;
      });
      (e.errors || []).forEach((x) => {
        if (x && x.hangul) errList.push(x);
      });
    });

    const missRows = Object.keys(missCount)
      .map((h) => ({ hangul: h, hanja: missCount[h].hanja, count: missCount[h].count }))
      .sort((a, b) => b.count - a.count);

    let html = `<p>共 <b>${log.length}</b> 條日誌（成功 ${analyses} / 失敗 ${fails}）｜`
      + ` 候選缺詞 <b>${missRows.length}</b> 個｜疑似錯誤 <b>${errList.length}</b> 條</p>`;

    if (missRows.length) {
      html += '<h4 style="margin:8px 0 4px">缺詞（按出現次數）</h4><table><tr><th>韓文</th><th>建議漢字</th><th class="count">次數</th></tr>';
      missRows.slice(0, 200).forEach((m) => {
        html += `<tr><td>${esc(m.hangul)}</td><td class="hanja">${esc(m.hanja)}</td><td class="count">${m.count}</td></tr>`;
      });
      html += '</table>';
    }

    if (errList.length) {
      html += '<h4 style="margin:10px 0 4px">疑似翻譯錯誤</h4><table><tr><th>韓文</th><th>現有</th><th>建議</th><th>理由</th></tr>';
      errList.slice(0, 100).forEach((x) => {
        html += `<tr><td>${esc(x.hangul)}</td><td>${esc(x.current || '')}</td>`
          + `<td class="hanja">${esc(x.suggested || '')}</td><td class="err">${esc(x.reason || '')}</td></tr>`;
      });
      html += '</table>';
    }

    dbg.summary.innerHTML = html;
  });
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Export full log
dbg.exportLog.addEventListener('click', () => {
  chrome.storage.local.get('debugLog', (r) => {
    download('hanja-debug-log.json', JSON.stringify(r.debugLog || [], null, 2));
  });
});

// Export aggregated missing words as a dict-ready JSON ({hangul: hanja})
dbg.exportDict.addEventListener('click', () => {
  chrome.storage.local.get('debugLog', (r) => {
    const log = Array.isArray(r.debugLog) ? r.debugLog : [];
    const dict = {};
    log.forEach((e) => (e.missing || []).forEach((m) => {
      if (m && m.hangul && m.hanja && !dict[m.hangul]) dict[m.hangul] = m.hanja;
    }));
    download('hanja-missing-dict.json', JSON.stringify(dict, null, 2));
  });
});

// Clear log
dbg.clear.addEventListener('click', () => {
  chrome.storage.local.set({ debugLog: [] }, () => {
    dbg.summary.textContent = '日誌已清空。';
  });
});

function download(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
