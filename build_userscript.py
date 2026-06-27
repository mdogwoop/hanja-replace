#!/usr/bin/env python3
"""
Assembles hanjareplace.user.js from dict.js and converter.js.
Output is a self-contained Tampermonkey userscript (v2.0).
"""

import re, sys, os

BASE = os.path.dirname(os.path.abspath(__file__))

# ── Read dict entries ────────────────────────────────────────────
with open(os.path.join(BASE, 'dict.js'), encoding='utf-8') as f:
    raw_dict = f.read()

pairs = re.findall(r'"([^"]+)"\s*:\s*"([^"]+)"', raw_dict)
# keep unique, preserve order (dict already sorted longest-first)
seen = {}
for k, v in pairs:
    seen[k] = v

dict_lines = [f'  "{k}": "{v}",' for k, v in seen.items()]
dict_block = '\nvar HANJA_DICT = {\n' + '\n'.join(dict_lines) + '\n};\n'

# ── Read converter maps ──────────────────────────────────────────
with open(os.path.join(BASE, 'converter.js'), encoding='utf-8') as f:
    raw_conv = f.read()

# Take everything from the first `var T_TO_S` to EOF — this captures the two
# maps and the convertScript function verbatim, avoiding brittle brace matching.
start = raw_conv.index('var T_TO_S')
conv_block = '\n' + raw_conv[start:].rstrip() + '\n'

# ── Compose userscript ───────────────────────────────────────────
header = """\
// ==UserScript==
// @name         韓語漢字詞復原器
// @name:zh-TW   韓語漢字詞復原器
// @name:ko      한국어 한자어 복원기
// @namespace    https://github.com/local/hanja-replace
// @version      2.0.0
// @description  Replaces Korean Hangul words with their original Hanja (traditional/simplified/Japanese). Supports ruby annotation, Naver dictionary links, disambiguation, domain whitelist/blacklist.
// @author       hanja-replace contributors
// @match        *://*/*
// @exclude      https://mail.google.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_openInTab
// @run-at       document-idle
// ==/UserScript==

/* jshint esversion:6 */
(function () {
  'use strict';
"""

settings_block = """
  // ── Persistent settings (GM_getValue / GM_setValue) ──────────
  var CFG_KEY = 'hjr_settings_v2';

  var DEFAULT_SETTINGS = {
    enabled:       true,
    scriptMode:    'traditional',   // 'traditional' | 'simplified' | 'japanese'
    displayMode:   'replace',       // 'replace' | 'ruby'
    showNaverLink: true,
    showBadge:     true,
    blacklist:     [],
    whitelist:     [],
  };

  function loadSettings() {
    try {
      var raw = GM_getValue(CFG_KEY, null);
      if (raw) return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(raw));
    } catch (e) {}
    return Object.assign({}, DEFAULT_SETTINGS);
  }

  function saveSettings(s) {
    GM_setValue(CFG_KEY, JSON.stringify(s));
  }

  var settings = loadSettings();
"""

core_block = """
  // ── Build sorted regex from dictionary ───────────────────────
  // 跳过单字词条:在韩文页面里单字(구/금/만…)极高频,会造成海量误替换
  // 和 DOM 操作,是移动端卡顿的主因。只匹配 2 字以上的词。
  var MIN_LEN = 2;

  var SORTED_KEYS = Object.keys(HANJA_DICT)
    .filter(function (k) { return k.length >= MIN_LEN; })
    .sort(function (a, b) {
      return b.length - a.length || a.localeCompare(b);
    });

  var PATTERN = new RegExp(
    '(' + SORTED_KEYS.map(function (s) {
      return s.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');
    }).join('|') + ')',
    'g'
  );

  // 快速预筛:节点不含韩文音节时直接跳过昂贵的主正则
  var HANGUL_RE = /[가-힣]/;

  // ── Disambiguation table ──────────────────────────────────────
  var DISAMBIG = {
    '시장': {
      def: '市場',
      rules: [
        { near: /선거|당선|시청|구청|도지사|군수|구청장|시의원/, hanja: '市長' },
        { near: /가격|물가|상인|상점|시세|거래|마켓|소비|구매/, hanja: '市場' },
      ],
    },
    '경기': {
      def: '景氣',
      rules: [
        { near: /축구|야구|농구|배구|테니스|탁구|경기장|심판|선수|골|승리|패/, hanja: '競技' },
        { near: /수원|성남|고양|용인|인천|안산|경기도청|경기북|경기남/, hanja: '京畿' },
        { near: /경기침체|불황|활성화|호황|불경기|침체|회복|성장|지표/, hanja: '景氣' },
      ],
    },
    '사고': {
      def: '事故',
      rules: [
        { near: /교통|추돌|충돌|부상|사망|피해|현장|구조|112/, hanja: '事故' },
        { near: /방식|능력|창의|논리|비판|사고력|사고방식|추론/, hanja: '思考' },
      ],
    },
    '전기': {
      def: '電氣',
      rules: [
        { near: /전력|발전|충전|배전|전압|전류|단전|정전|한전/, hanja: '電氣' },
        { near: /인물|일대기|전기작가|전기문|서술|기록/, hanja: '傳記' },
        { near: /학기|수업|입학|전기모집|전기선발/, hanja: '前期' },
      ],
    },
    '의사': {
      def: '醫師',
      rules: [
        { near: /병원|진료|처방|환자|수술|의원|의대|면허/, hanja: '醫師' },
        { near: /표시|결정|통보|확인|서면|의사표시|의사결정/, hanja: '意思' },
      ],
    },
    '역사': {
      def: '歷史',
      rules: [
        { near: /조선|고려|신라|삼국|사학|사료|연대|사건|문명/, hanja: '歷史' },
        { near: /기차|열차|승강장|플랫폼|출발|도착|선로/, hanja: '驛舍' },
      ],
    },
    '부자': {
      def: '富者',
      rules: [
        { near: /아버지|아들|父子관계|부자지간|부자사이/, hanja: '父子' },
        { near: /재산|돈|갑부|억만|자산|부유/, hanja: '富者' },
      ],
    },
    '정리': {
      def: '整理',
      rules: [
        { near: /수학|증명|공리|공식|定理/, hanja: '定理' },
        { near: /부채|구조|파산|청산|법정/, hanja: '整理' },
      ],
    },
    '구조': {
      def: '構造',
      rules: [
        { near: /구조대|구명|익수|화재|사고현장|매몰|수색/, hanja: '救助' },
        { near: /건물|건축|설계|기둥|골격|원자|분자|사회구조/, hanja: '構造' },
      ],
    },
  };

  var SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'SELECT', 'CODE', 'PRE',
    'KBD', 'SAMP', 'VAR', 'NOSCRIPT', 'SVG', 'MATH', 'IFRAME', 'CANVAS',
  ]);

  var PROCESSED_ATTR = 'data-hj-done';
  var ORIGINAL_ATTR  = 'data-hj-orig';
  var STYLE_ID       = 'hanja-replacer-style-v2';

  var totalCount = 0;
  var toggleBtn  = null;
  var observer   = null;

  // ── Domain check ─────────────────────────────────────────────
  function isEnabled() {
    if (!settings.enabled) return false;
    var host = location.hostname;
    if (settings.whitelist && settings.whitelist.length > 0) {
      return settings.whitelist.some(function (p) { return host.indexOf(p) !== -1; });
    }
    if (settings.blacklist && settings.blacklist.length > 0) {
      if (settings.blacklist.some(function (p) { return host.indexOf(p) !== -1; })) {
        return false;
      }
    }
    return true;
  }

  // ── CSS injection ─────────────────────────────────────────────
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '.hj-span {',
      '  border-bottom: 1.5px dotted #c0392b;',
      '  cursor: help;',
      '  position: relative;',
      '  transition: background 0.15s;',
      '}',
      '.hj-span:hover { background: rgba(192,57,43,0.09); }',
      '.hj-span::after {',
      '  content: attr(data-hj-orig);',
      '  position: absolute;',
      '  bottom: 120%; left: 50%;',
      '  transform: translateX(-50%);',
      '  background: #2c3e50; color: #ecf0f1;',
      '  padding: 3px 8px; border-radius: 4px;',
      '  font-size: 12px; white-space: nowrap;',
      '  pointer-events: none; opacity: 0;',
      '  transition: opacity 0.15s; z-index: 999999;',
      '  font-family: "Malgun Gothic","맑은 고딕",sans-serif;',
      '}',
      '.hj-span:hover::after { opacity: 1; }',
      '.hj-span.hj-link { cursor: pointer; }',
      '.hj-span.hj-link:hover { color: #c0392b; }',
      'ruby.hj-ruby { display: inline; }',
      'ruby.hj-ruby rt { font-size: 0.55em; color: #c0392b; }',
      '#hj-btn {',
      '  position: fixed; bottom: 20px; right: 20px;',
      '  z-index: 2147483647; width: 48px; height: 48px;',
      '  border-radius: 50%; border: 2px solid #c0392b;',
      '  background: #fff; color: #c0392b;',
      '  font-size: 18px; font-weight: 700; cursor: pointer;',
      '  box-shadow: 0 2px 10px rgba(0,0,0,.18);',
      '  display: flex; align-items: center; justify-content: center;',
      '  transition: all .2s; font-family: serif;',
      '  user-select: none; line-height: 1;',
      '}',
      '#hj-btn:hover { background: #c0392b; color: #fff; transform: scale(1.08); }',
      '#hj-btn.off { opacity: .45; border-color: #999; color: #999; }',
      '#hj-btn .hj-badge {',
      '  position: absolute; top: -6px; right: -6px;',
      '  background: #c0392b; color: #fff; font-size: 10px;',
      '  font-family: system-ui,sans-serif; min-width: 18px; height: 18px;',
      '  border-radius: 9px; display: flex; align-items: center;',
      '  justify-content: center; padding: 0 4px; font-weight: 600;',
      '}',
      '#hj-panel {',
      '  position: fixed; bottom: 76px; right: 14px;',
      '  z-index: 2147483646; background: #1a1a2e; color: #e0e0e0;',
      '  border: 1px solid #e63946; border-radius: 10px;',
      '  padding: 14px 16px; font-family: system-ui,sans-serif;',
      '  font-size: 13px; min-width: 200px; box-shadow: 0 4px 16px rgba(0,0,0,.3);',
      '}',
      '#hj-panel h3 { margin: 0 0 10px; font-size: 13px; color: #e63946; }',
      '#hj-panel label { display: flex; justify-content: space-between; align-items: center; margin: 6px 0; }',
      '#hj-panel select { background: #16213e; color: #e0e0e0; border: 1px solid #444; border-radius: 4px; padding: 2px 4px; }',
      '#hj-panel .hj-close { float: right; cursor: pointer; color: #888; font-size: 16px; line-height: 1; background: none; border: none; }',
    ].join('\\n');
    document.head.appendChild(s);
  }

  // ── Resolve with disambiguation ───────────────────────────────
  function resolveHanja(hangul, contextText) {
    var hanja = HANJA_DICT[hangul];
    if (!hanja) return null;
    var d = DISAMBIG[hangul];
    if (d && contextText) {
      for (var i = 0; i < d.rules.length; i++) {
        if (d.rules[i].near.test(contextText)) {
          return convertScript(d.rules[i].hanja, settings.scriptMode);
        }
      }
      return convertScript(d.def, settings.scriptMode);
    }
    return convertScript(hanja, settings.scriptMode);
  }

  // ── Build replacement element ─────────────────────────────────
  function makeReplacement(hangul, hanja) {
    if (settings.displayMode === 'ruby') {
      var ruby = document.createElement('ruby');
      ruby.className = 'hj-ruby';
      ruby.setAttribute(PROCESSED_ATTR, '1');
      ruby.appendChild(document.createTextNode(hangul));
      var rt = document.createElement('rt');
      rt.textContent = hanja;
      ruby.appendChild(rt);
      return ruby;
    }
    var span = document.createElement('span');
    span.className = 'hj-span';
    span.setAttribute(ORIGINAL_ATTR, hangul);
    span.setAttribute(PROCESSED_ATTR, '1');
    span.textContent = hanja;
    if (settings.showNaverLink) {
      span.classList.add('hj-link');
      span.addEventListener('click', function (e) {
        e.stopPropagation();
        GM_openInTab(
          'https://hanja.dict.naver.com/search?query=' + encodeURIComponent(hangul),
          { active: true }
        );
      });
    }
    return span;
  }

  // ── Incremental, idle-time processing ─────────────────────────
  // 不再一次性遍历整页(大页面会产生几百毫秒的长任务,移动端直接卡死)。
  // 改为:收集候选文本节点 → 放进队列 → 利用空闲时间分批处理,每批让出主线程。
  var nodeQueue = [];
  var draining  = false;

  var idle = window.requestIdleCallback
    ? window.requestIdleCallback.bind(window)
    : function (cb) { return setTimeout(function () { cb({ timeRemaining: function () { return 8; } }); }, 16); };

  function collectInto(root) {
    if (!root || (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE)) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (SKIP_TAGS.has(p.tagName)) return NodeFilter.FILTER_REJECT;
        if (p.isContentEditable) return NodeFilter.FILTER_REJECT;
        if (p.closest('[contenteditable="true"]')) return NodeFilter.FILTER_REJECT;
        if (p.hasAttribute(PROCESSED_ATTR)) return NodeFilter.FILTER_REJECT;
        if (p.closest('.hj-span,.hj-ruby')) return NodeFilter.FILTER_REJECT;
        if (!HANGUL_RE.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    while (walker.nextNode()) nodeQueue.push(walker.currentNode);
  }

  function scheduleScan(root) {
    collectInto(root);
    kick();
  }

  function kick() {
    if (draining || nodeQueue.length === 0) return;
    draining = true;
    idle(drain);
  }

  function drain(deadline) {
    var processed = 0;
    while (nodeQueue.length > 0 &&
           ((deadline && deadline.timeRemaining() > 4) || processed < 40)) {
      processNode(nodeQueue.shift());
      processed++;
    }
    draining = false;
    if (processed > 0) updateBadge();
    if (nodeQueue.length > 0) kick();
  }

  function processNode(textNode) {
    if (!textNode || !textNode.parentNode) return;
    var p = textNode.parentElement;
    if (!p || p.hasAttribute(PROCESSED_ATTR)) return;

    var text = textNode.nodeValue;
    PATTERN.lastIndex = 0;

    var ctx = p.textContent || text;
    var frag = null;
    var lastIndex = 0;
    var match;

    while ((match = PATTERN.exec(text)) !== null) {
      var hangul = match[1];
      var hanja = resolveHanja(hangul, ctx);
      if (!hanja) continue;
      if (!frag) frag = document.createDocumentFragment();
      if (match.index > lastIndex) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      }
      frag.appendChild(makeReplacement(hangul, hanja));
      totalCount++;
      lastIndex = PATTERN.lastIndex;
    }

    if (frag) {
      if (lastIndex < text.length) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex)));
      }
      textNode.parentNode.replaceChild(frag, textNode);
    }
  }

  // ── Restore all replacements ──────────────────────────────────
  function restoreAll() {
    nodeQueue = [];   // 丢弃所有待处理任务
    document.querySelectorAll('.hj-span').forEach(function (el) {
      var orig = el.getAttribute(ORIGINAL_ATTR);
      if (orig) el.replaceWith(document.createTextNode(orig));
    });
    document.querySelectorAll('ruby.hj-ruby').forEach(function (el) {
      var txt = el.firstChild && el.firstChild.textContent;
      if (txt) el.replaceWith(document.createTextNode(txt));
    });
    totalCount = 0;
    updateBadge();
  }

  // ── Settings panel ────────────────────────────────────────────
  var panelEl = null;

  function buildPanel() {
    if (panelEl) { panelEl.remove(); panelEl = null; return; }
    panelEl = document.createElement('div');
    panelEl.id = 'hj-panel';
    panelEl.innerHTML = [
      '<button class="hj-close" id="hj-panel-close">✕</button>',
      '<h3>韓語漢字詞復原器</h3>',
      '<label>字形 <select id="hj-script">',
      '  <option value="traditional">正體</option>',
      '  <option value="simplified">简体</option>',
      '  <option value="japanese">新字体</option>',
      '</select></label>',
      '<label>顯示 <select id="hj-display">',
      '  <option value="replace">替換</option>',
      '  <option value="ruby">注音</option>',
      '</select></label>',
      '<label>Naver 辭典 <input type="checkbox" id="hj-naver"></label>',
      '<label>顯示替換數 <input type="checkbox" id="hj-badge"></label>',
    ].join('');

    document.body.appendChild(panelEl);

    panelEl.querySelector('#hj-script').value   = settings.scriptMode;
    panelEl.querySelector('#hj-display').value  = settings.displayMode;
    panelEl.querySelector('#hj-naver').checked  = settings.showNaverLink;
    panelEl.querySelector('#hj-badge').checked  = settings.showBadge;

    panelEl.querySelector('#hj-panel-close').addEventListener('click', function () {
      panelEl.remove(); panelEl = null;
    });

    panelEl.querySelector('#hj-script').addEventListener('change', function (e) {
      settings.scriptMode = e.target.value;
      saveSettings(settings);
      restoreAll();
      if (isEnabled()) { scheduleScan(document.body); }
    });

    panelEl.querySelector('#hj-display').addEventListener('change', function (e) {
      settings.displayMode = e.target.value;
      saveSettings(settings);
      restoreAll();
      if (isEnabled()) { scheduleScan(document.body); }
    });

    panelEl.querySelector('#hj-naver').addEventListener('change', function (e) {
      settings.showNaverLink = e.target.checked;
      saveSettings(settings);
      restoreAll();
      if (isEnabled()) { scheduleScan(document.body); }
    });

    panelEl.querySelector('#hj-badge').addEventListener('change', function (e) {
      settings.showBadge = e.target.checked;
      saveSettings(settings);
      updateBadge();
    });
  }

  // ── Toggle button ─────────────────────────────────────────────
  function createToggle() {
    if (toggleBtn) return;
    toggleBtn = document.createElement('button');
    toggleBtn.id = 'hj-btn';
    toggleBtn.innerHTML = '漢<span class="hj-badge" style="display:none">0</span>';
    toggleBtn.title = '左鍵 ON/OFF　右鍵 設定';
    if (!isEnabled()) toggleBtn.classList.add('off');

    toggleBtn.addEventListener('click', function (e) {
      if (e.button !== 0) return;
      settings.enabled = !settings.enabled;
      saveSettings(settings);
      toggleBtn.classList.toggle('off', !isEnabled());
      if (isEnabled()) {
        totalCount = 0;
        scheduleScan(document.body);
      } else {
        restoreAll();
      }
    });

    toggleBtn.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      buildPanel();
    });

    document.body.appendChild(toggleBtn);
  }

  function updateBadge() {
    if (!toggleBtn) return;
    var badge = toggleBtn.querySelector('.hj-badge');
    if (!badge) return;
    if (totalCount > 0 && settings.showBadge) {
      badge.style.display = 'flex';
      badge.textContent = totalCount > 9999 ? '9999+' : String(totalCount);
    } else {
      badge.style.display = 'none';
    }
  }

  // ── GM menu commands ──────────────────────────────────────────
  GM_registerMenuCommand('韓語漢字 — 開啟/關閉', function () {
    settings.enabled = !settings.enabled;
    saveSettings(settings);
    if (isEnabled()) {
      totalCount = 0; scheduleScan(document.body);
    } else {
      restoreAll();
    }
    if (toggleBtn) toggleBtn.classList.toggle('off', !isEnabled());
  });

  GM_registerMenuCommand('韓語漢字 — 字形: ' + settings.scriptMode, function () {
    var modes = ['traditional', 'simplified', 'japanese'];
    var idx   = modes.indexOf(settings.scriptMode);
    settings.scriptMode = modes[(idx + 1) % modes.length];
    saveSettings(settings);
    restoreAll();
    if (isEnabled()) { scheduleScan(document.body); }
  });

  // ── MutationObserver ──────────────────────────────────────────
  // 只把新增节点丢进队列,真正的替换交给空闲时间分批做。
  function startObserver() {
    observer = new MutationObserver(function (mutations) {
      if (!isEnabled()) return;
      for (var i = 0; i < mutations.length; i++) {
        var nodes = mutations[i].addedNodes;
        for (var j = 0; j < nodes.length; j++) {
          var node = nodes[j];
          if (node.nodeType === Node.ELEMENT_NODE && !SKIP_TAGS.has(node.tagName)) {
            collectInto(node);
          } else if (node.nodeType === Node.TEXT_NODE && node.parentElement) {
            var pp = node.parentElement;
            if (!SKIP_TAGS.has(pp.tagName) &&
                !pp.hasAttribute(PROCESSED_ATTR) &&
                HANGUL_RE.test(node.nodeValue)) {
              nodeQueue.push(node);
            }
          }
        }
      }
      kick();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ── Init ──────────────────────────────────────────────────────
  function init() {
    injectStyle();
    if (document.body) {
      createToggle();
      if (isEnabled()) {
        scheduleScan(document.body);
      }
      startObserver();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
"""

footer = """\
})();
"""

# ── Write output ─────────────────────────────────────────────────
out_path = os.path.join(BASE, 'hanjareplace.user.js')
with open(out_path, 'w', encoding='utf-8') as f:
    f.write(header)
    f.write(dict_block)
    f.write(conv_block)
    f.write(settings_block)   # defines `settings`, must precede core_block
    f.write(core_block)
    f.write(footer)

with open(out_path, encoding='utf-8') as f:
    count = f.read().count('\n')

print(f'Written: {out_path}  ({count} lines)')
