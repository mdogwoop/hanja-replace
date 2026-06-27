// ═══════════════════════════════════════════════════════════════
//  韓語漢字詞復原器  —  content script  v2.0
//  Depends on: dict.js (HANJA_DICT), converter.js (convertScript)
// ═══════════════════════════════════════════════════════════════

/* global HANJA_DICT, convertScript */

(function () {
  'use strict';

  // ── defaults (overridden by stored settings) ─────────────────
  var settings = {
    enabled: true,
    scriptMode: 'traditional',   // 'traditional' | 'simplified' | 'japanese'
    displayMode: 'replace',      // 'replace' | 'ruby'
    showBadge: true,
    showNaverLink: true,
    blacklist: [],
    whitelist: [],
  };

  // ── build sorted pattern from dict ───────────────────────────
  var SORTED_KEYS = Object.keys(HANJA_DICT).sort(function (a, b) {
    return b.length - a.length || a.localeCompare(b);
  });

  var PATTERN = new RegExp(
    '(' + SORTED_KEYS.map(escRe).join('|') + ')',
    'g'
  );

  function escRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // ── context disambiguation table ─────────────────────────────
  // Maps ambiguous Hangul → { default: Hanja, contextRules: [{near, hanja}] }
  // "near" is a regex tested against ±60 chars of surrounding text.
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

  // ── DOM skip list ─────────────────────────────────────────────
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

  // ── domain check ─────────────────────────────────────────────
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
      '  content: attr(' + ORIGINAL_ATTR + ');',
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
      '.hj-span.hj-link { cursor: pointer; text-decoration: none; }',
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
      '#hj-btn.off:hover { background: #999; color: #fff; }',
      '#hj-btn .hj-badge {',
      '  position: absolute; top: -6px; right: -6px;',
      '  background: #c0392b; color: #fff; font-size: 10px;',
      '  font-family: system-ui,sans-serif; min-width: 18px; height: 18px;',
      '  border-radius: 9px; display: flex; align-items: center;',
      '  justify-content: center; padding: 0 4px; font-weight: 600;',
      '}',
    ].join('\n');
    document.head.appendChild(s);
  }

  // ── resolve hanja with disambiguation ─────────────────────────
  function resolveHanja(hangul, contextText) {
    var hanja = HANJA_DICT[hangul];
    if (!hanja) return null;
    var d = DISAMBIG[hangul];
    if (d && contextText) {
      for (var i = 0; i < d.rules.length; i++) {
        if (d.rules[i].near.test(contextText)) {
          hanja = d.rules[i].hanja;
          break;
        }
      }
      if (!hanja) hanja = d.def;
    }
    return convertScript(hanja, settings.scriptMode);
  }

  // ── build a replaced span or ruby element ─────────────────────
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
    // replace mode
    var span = document.createElement('span');
    span.className = 'hj-span';
    span.setAttribute(ORIGINAL_ATTR, hangul);
    span.setAttribute(PROCESSED_ATTR, '1');
    span.textContent = hanja;
    if (settings.showNaverLink) {
      span.classList.add('hj-link');
      span.addEventListener('click', function (e) {
        e.stopPropagation();
        window.open(
          'https://hanja.dict.naver.com/search?query=' + encodeURIComponent(hangul),
          '_blank', 'noopener'
        );
      });
    }
    return span;
  }

  // ── walk text nodes and replace ───────────────────────────────
  function walkAndReplace(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (SKIP_TAGS.has(p.tagName)) return NodeFilter.FILTER_REJECT;
        if (p.isContentEditable) return NodeFilter.FILTER_REJECT;
        if (p.closest('[contenteditable="true"]')) return NodeFilter.FILTER_REJECT;
        if (p.hasAttribute(PROCESSED_ATTR)) return NodeFilter.FILTER_REJECT;
        if (p.closest('.hj-span,.hj-ruby')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    for (var ni = 0; ni < nodes.length; ni++) {
      var textNode = nodes[ni];
      var text = textNode.nodeValue;
      if (!PATTERN.test(text)) continue;
      PATTERN.lastIndex = 0;

      // gather ±60 chars of surrounding context for disambiguation
      var ctx = (textNode.parentElement && textNode.parentElement.textContent) || text;

      var frag = document.createDocumentFragment();
      var lastIndex = 0;
      var match;

      while ((match = PATTERN.exec(text)) !== null) {
        var hangul = match[1];
        var hanja = resolveHanja(hangul, ctx);
        if (!hanja) continue;

        if (match.index > lastIndex) {
          frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
        }
        frag.appendChild(makeReplacement(hangul, hanja));
        totalCount++;
        lastIndex = PATTERN.lastIndex;
      }

      if (lastIndex < text.length) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex)));
      }
      if (lastIndex > 0) {
        textNode.parentNode.replaceChild(frag, textNode);
      }
    }
  }

  // ── restore all replacements ──────────────────────────────────
  function restoreAll() {
    // Replace mode spans
    document.querySelectorAll('.hj-span').forEach(function (el) {
      var orig = el.getAttribute(ORIGINAL_ATTR);
      if (orig) el.replaceWith(document.createTextNode(orig));
    });
    // Ruby mode
    document.querySelectorAll('ruby.hj-ruby').forEach(function (el) {
      var txt = el.firstChild && el.firstChild.textContent;
      if (txt) el.replaceWith(document.createTextNode(txt));
    });
    totalCount = 0;
    updateBadge();
  }

  // ── toggle button ─────────────────────────────────────────────
  function createToggle() {
    if (toggleBtn) return;
    toggleBtn = document.createElement('button');
    toggleBtn.id = 'hj-btn';
    toggleBtn.innerHTML = '漢<span class="hj-badge" style="display:none">0</span>';
    toggleBtn.title = '漢字詞 ON/OFF';
    if (!isEnabled()) toggleBtn.classList.add('off');

    toggleBtn.addEventListener('click', function () {
      settings.enabled = !settings.enabled;
      chrome.storage.sync.set({ enabled: settings.enabled });
      toggleBtn.classList.toggle('off', !isEnabled());
      if (isEnabled()) {
        totalCount = 0;
        walkAndReplace(document.body);
        updateBadge();
      } else {
        restoreAll();
      }
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

  // ── MutationObserver for SPA pages ───────────────────────────
  function startObserver() {
    observer = new MutationObserver(function (mutations) {
      if (!isEnabled()) return;
      var added = false;
      mutations.forEach(function (m) {
        m.addedNodes.forEach(function (node) {
          if (node.nodeType === Node.ELEMENT_NODE && !SKIP_TAGS.has(node.tagName)) {
            walkAndReplace(node);
            added = true;
          } else if (node.nodeType === Node.TEXT_NODE && node.parentElement) {
            var tmp = document.createElement('span');
            tmp.textContent = node.nodeValue;
            if (PATTERN.test(node.nodeValue)) {
              PATTERN.lastIndex = 0;
              node.parentElement.replaceChild(tmp, node);
              walkAndReplace(tmp);
              if (!tmp.querySelector('.hj-span,.hj-ruby')) {
                tmp.replaceWith(document.createTextNode(tmp.textContent));
              }
              added = true;
            }
          }
        });
      });
      if (added) updateBadge();
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ── message from popup/background ────────────────────────────
  chrome.runtime.onMessage.addListener(function (msg, _s, sendResponse) {
    if (msg.type === 'GET_COUNT') {
      sendResponse({ count: totalCount });
    } else if (msg.type === 'APPLY_SETTINGS') {
      var prev = settings.enabled;
      settings = Object.assign(settings, msg.settings);
      if (settings.enabled !== prev || msg.forceReapply) {
        restoreAll();
        if (isEnabled()) {
          walkAndReplace(document.body);
          updateBadge();
        }
      }
      if (toggleBtn) toggleBtn.classList.toggle('off', !isEnabled());
      updateBadge();
    }
  });

  // ── initialise ────────────────────────────────────────────────
  function init(storedSettings) {
    if (storedSettings) settings = Object.assign(settings, storedSettings);
    injectStyle();
    if (document.body) {
      createToggle();
      if (isEnabled()) {
        walkAndReplace(document.body);
        updateBadge();
      }
      startObserver();
    }
  }

  chrome.storage.sync.get(
    ['enabled', 'scriptMode', 'displayMode', 'showBadge', 'showNaverLink', 'blacklist', 'whitelist'],
    function (stored) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { init(stored); });
      } else {
        init(stored);
      }
    }
  );
})();
