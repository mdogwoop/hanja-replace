// ═══════════════════════════════════════════════════════════════
//  Service worker — install defaults, popup relay, and the
//  Debug "查漏补缺" AI analysis (OpenAI-compatible API).
// ═══════════════════════════════════════════════════════════════

// API config + logs live in storage.local (key is sensitive → not synced).
var DEBUG_DEFAULT = {
  enabled: false,
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  systemPrompt: '',   // empty → use DEFAULT_SYSTEM_PROMPT
};

var LOG_KEY = 'debugLog';
var LOG_CAP = 200;

// In-flight analyses, mirrored to storage.session so the options page can show
// how many pages are still being analysed. Reset on every cold start.
var pending = {};
var pendingSeq = 0;
function setPending() {
  try { chrome.storage.session.set({ debugPending: pending }); } catch (e) { /* no session */ }
}
setPending();   // cold start → clear any stale state

var DEFAULT_SYSTEM_PROMPT = [
  '你是韩语汉字词（한자어）与韩国标准汉字（正体/繁体）的专家。',
  '一个浏览器扩展会把韩文网页里的汉字词还原成对应的韩国标准汉字。下面给你：',
  '(A) 扩展在本页已做的「韩文→汉字」替换对照表；',
  '(B) 本页若干段原始韩文文本（其中的汉字词大多尚未还原）。',
  '你的任务：',
  '1. 查漏(missing)：在 B 的文本中找出「本应是汉字词、但不在 A 对照表里」的词，',
  '   给出该词的韩文与对应的韩国标准正体汉字。只收录确实源自汉字的词（Sino-Korean）；',
  '   外来语（如 소프트웨어）、纯固有词不要列入。',
  '2. 查错(errors)：检查 A 对照表中的还原是否有误（汉字写错、同音异义消歧错误、',
  '   把非汉字词误替换等），给出修正建议。',
  '严格只输出如下 JSON，不要任何解释或 Markdown 代码块：',
  '{"missing":[{"hangul":"…","hanja":"…","confidence":0.0,"reason":"简短理由"}],',
  '"errors":[{"hangul":"…","current":"…","suggested":"…","reason":"简短理由"}]}',
  '汉字一律用韩国标准正体（繁体）。confidence 表示你判断该词是汉字词的把握(0~1)。',
  '若没有发现，对应数组返回空 []。',
].join('\n');

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
  // Seed debug config if absent (both install and update).
  chrome.storage.local.get('debugConfig', (r) => {
    if (!r.debugConfig) chrome.storage.local.set({ debugConfig: DEBUG_DEFAULT });
  });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'GET_COUNT') {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (!tab) { sendResponse({ count: 0 }); return; }
      chrome.tabs.sendMessage(tab.id, { type: 'GET_COUNT' }, (r) => {
        sendResponse(r || { count: 0 });
      });
    });
    return true;
  }

  // Options page asks for current in-flight analyses.
  if (msg.type === 'GET_DEBUG_STATUS') {
    sendResponse({ pending: Object.keys(pending).map((k) => pending[k]) });
    return true;
  }

  // Content script asks us to analyse a page sample.
  if (msg.type === 'AI_ANALYZE') {
    chrome.storage.local.get('debugConfig', (r) => {
      const cfg = r.debugConfig || DEBUG_DEFAULT;
      if (!cfg.enabled || !cfg.apiKey) {
        sendResponse({ ok: false, error: 'debug disabled or API key missing' });
        return;
      }
      const id = ++pendingSeq;
      pending[id] = { url: msg.sample.url, title: msg.sample.title || '', ts: Date.now() };
      setPending();
      analyze(msg.sample, cfg)
        .then((result) => {
          writeLog({
            ts: Date.now(),
            url: msg.sample.url,
            title: msg.sample.title || '',
            model: cfg.model,
            missing: result.missing || [],
            errors: result.errors || [],
          });
          sendResponse({ ok: true, missing: result.missing || [], errors: result.errors || [] });
        })
        .catch((e) => {
          writeLog({ ts: Date.now(), url: msg.sample.url, model: cfg.model, error: String(e) });
          sendResponse({ ok: false, error: String(e) });
        })
        .finally(() => {
          delete pending[id];
          setPending();
        });
    });
    return true; // async
  }

  // Options page "test connection".
  if (msg.type === 'TEST_AI') {
    const cfg = msg.config || DEBUG_DEFAULT;
    if (!cfg.apiKey) { sendResponse({ ok: false, error: 'API key missing' }); return true; }
    chatCompletion(cfg, [
      { role: 'user', content: 'ping，只回复两个字："正常"。' },
    ], { max_tokens: 8 })
      .then((txt) => sendResponse({ ok: true, sample: (txt || '').slice(0, 40) }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
});

// ── AI analysis ────────────────────────────────────────────────
async function analyze(sample, cfg) {
  const sys = (cfg.systemPrompt && cfg.systemPrompt.trim()) || DEFAULT_SYSTEM_PROMPT;
  const user = buildUserPrompt(sample);
  const content = await chatCompletion(cfg, [
    { role: 'system', content: sys },
    { role: 'user', content: user },
  ], { temperature: 0.2, response_format: { type: 'json_object' } });
  return parseResult(content);
}

function buildUserPrompt(sample) {
  const pairs = (sample.pairs || [])
    .map(([h, k]) => `${h} => ${k}`)
    .join('\n');
  const blocks = (sample.blocks || [])
    .map((b, i) => `${i + 1}. ${b}`)
    .join('\n');
  return [
    '【A 本页已替换对照表（韩文 => 已输出汉字）】',
    pairs || '（无）',
    '',
    '【B 本页原始韩文文本片段】',
    blocks || '（无）',
  ].join('\n');
}

async function chatCompletion(cfg, messages, extra) {
  const url = cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const body = Object.assign({ model: cfg.model, messages: messages }, extra || {});
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + cfg.apiKey,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    throw new Error('HTTP ' + resp.status + ' ' + t.slice(0, 200));
  }
  const data = await resp.json();
  return data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : '';
}

// Tolerant JSON extraction (handles ```json fences or surrounding prose).
function parseResult(text) {
  if (!text) return { missing: [], errors: [] };
  let s = String(text).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try {
    return normalize(JSON.parse(s));
  } catch (e) {
    const a = s.indexOf('{');
    const b = s.lastIndexOf('}');
    if (a !== -1 && b > a) {
      try { return normalize(JSON.parse(s.slice(a, b + 1))); } catch (e2) { /* fall through */ }
    }
    throw new Error('无法解析 AI 返回的 JSON');
  }
}

function normalize(obj) {
  return {
    missing: Array.isArray(obj.missing) ? obj.missing : [],
    errors: Array.isArray(obj.errors) ? obj.errors : [],
  };
}

function writeLog(entry) {
  chrome.storage.local.get(LOG_KEY, (r) => {
    const log = Array.isArray(r[LOG_KEY]) ? r[LOG_KEY] : [];
    log.unshift(entry);
    if (log.length > LOG_CAP) log.length = LOG_CAP;
    chrome.storage.local.set({ [LOG_KEY]: log });
  });
}
