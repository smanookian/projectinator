/* Markdown Scratchpad — app.js
 * Classic script (no modules, no CDN). Works from file://.
 *
 * T-04: markdown parser.
 * T-05: live rendering — preview HTML updates as you type (debounced).
 * T-06: localStorage persistence — save on input (debounced), load on page load.
 * T-09: live word / character / line counts in the status bar.
 * T-10: copy-as-markdown button (Clipboard API + execCommand fallback).
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 1. DOM
   * ------------------------------------------------------------------ */
  var DOM = {
    editor: document.getElementById('editor'),
    preview: document.getElementById('preview'),
    statSaved: document.getElementById('stat-saved'),
    statWords: document.getElementById('stat-words'),
    statChars: document.getElementById('stat-chars'),
    statLines: document.getElementById('stat-lines'),
    toast: document.getElementById('toast'),
    btnClear: document.getElementById('btn-clear'),
    btnCopy: document.getElementById('btn-copy'),
    btnBold: document.getElementById('btn-bold'),
    btnItalic: document.getElementById('btn-italic'),
    btnHeading: document.getElementById('btn-heading'),
    btnList: document.getElementById('btn-list')
  };

  /* ------------------------------------------------------------------ *
   * 2. Markdown parser
   * ------------------------------------------------------------------ */

  var RE_FENCE = /^ {0,3}(```+|~~~+)\s*([^`\s]*)\s*$/;
  var RE_HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*$/;
  var RE_HR = /^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/;
  var RE_QUOTE = /^ {0,3}>[ \t]?/;
  var RE_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
  var RE_EMPTY_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])[ \t]*$/;
  var RE_TABLE_DELIM = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
  var RE_TASK = /^\[([ xX])\][ \t]+/;

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // `>` is escaped late (block parsing needs raw `>` for blockquotes).
  function escGt(s) {
    return String(s).replace(/>/g, '&gt;');
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // URL guard: allow only safe-looking targets.
  function safeUrl(raw) {
    var url = String(raw).trim().replace(/^&lt;|&gt;$/g, '');
    var bare = url.replace(/[\s\u0000-\u001f]/g, '').toLowerCase();
    // decode a couple of obvious obfuscations before testing the scheme
    bare = bare.replace(/&amp;/g, '&').replace(/&#x?[0-9a-f]+;?/g, '');
    if (/^(javascript|data|vbscript|file):/.test(bare)) return '';
    return escapeAttr(url);
  }

  /* --- inline ------------------------------------------------------- */

  var CODE_TOKEN = '\u0000C';
  var TOKEN_END = '\u0000';

  function renderInline(src) {
    var codes = [];
    var text = escGt(src);

    // 1. code spans (protected from every other rule)
    text = text.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, function (m, fence, body) {
      var inner = body;
      if (/^ /.test(inner) && / $/.test(inner) && /\S/.test(inner)) {
        inner = inner.slice(1, -1);
      }
      codes.push('<code>' + inner + '</code>');
      return CODE_TOKEN + (codes.length - 1) + TOKEN_END;
    });

    // 2. images then links
    text = text.replace(/!\[([^\]]*)\]\(\s*([^\s)]*)(?:\s+["'“]([^"'”]*)["'”])?\s*\)/g,
      function (m, alt, src2, title) {
        var u = safeUrl(src2);
        if (!u) return escapeAttr(alt);
        return '<img src="' + u + '" alt="' + escapeAttr(alt) + '"' +
          (title ? ' title="' + escapeAttr(title) + '"' : '') + '>';
      });

    text = text.replace(/\[([^\]]*)\]\(\s*([^\s)]*)(?:\s+["'“]([^"'”]*)["'”])?\s*\)/g,
      function (m, label, href, title) {
        var u = safeUrl(href);
        if (!u) return label;
        return '<a href="' + u + '"' + (title ? ' title="' + escapeAttr(title) + '"' : '') +
          ' target="_blank" rel="noopener noreferrer">' + label + '</a>';
      });

    // 3. autolinks: <https://…> (already escaped) and bare urls
    text = text.replace(/&lt;((?:https?|mailto):[^\s&]+)&gt;/g, function (m, u) {
      var s = safeUrl(u);
      return s ? '<a href="' + s + '" target="_blank" rel="noopener noreferrer">' + u + '</a>' : m;
    });

    // 4. emphasis
    text = text
      .replace(/\*\*\*(\S(?:[\s\S]*?\S)?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(\S(?:[\s\S]*?\S)?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(\S(?:[\s\S]*?\S)?)\*/g, '<em>$1</em>')
      .replace(/(^|[\s([{])___(\S(?:[\s\S]*?\S)?)___(?=$|[\s)\]}.,!?:;])/g, '$1<strong><em>$2</em></strong>')
      .replace(/(^|[\s([{])__(\S(?:[\s\S]*?\S)?)__(?=$|[\s)\]}.,!?:;])/g, '$1<strong>$2</strong>')
      .replace(/(^|[\s([{])_(\S(?:[\s\S]*?\S)?)_(?=$|[\s)\]}.,!?:;])/g, '$1<em>$2</em>')
      .replace(/~~(\S(?:[\s\S]*?\S)?)~~/g, '<del>$1</del>');

    // 5. hard line breaks
    text = text.replace(/(?: {2,}|\\)\n/g, '<br>\n');

    // 6. restore code spans
    text = text.replace(/\u0000C(\d+)\u0000/g, function (m, i) {
      return codes[Number(i)];
    });

    return text;
  }

  /* --- blocks ------------------------------------------------------- */

  function isBlockStart(line) {
    return line === '' ||
      RE_FENCE.test(line) ||
      RE_HEADING.test(line) ||
      RE_HR.test(line) ||
      RE_QUOTE.test(line) ||
      RE_ITEM.test(line) ||
      RE_EMPTY_ITEM.test(line);
  }

  function indentOf(line) {
    var m = /^[ \t]*/.exec(line)[0];
    return m.replace(/\t/g, '    ').length;
  }

  function dedent(line, n) {
    var i = 0, removed = 0;
    while (i < line.length && removed < n) {
      var ch = line.charAt(i);
      if (ch === ' ') { removed += 1; i += 1; }
      else if (ch === '\t') { removed += 4; i += 1; }
      else break;
    }
    return line.slice(i);
  }

  function renderBlocks(lines) {
    var out = [];
    var i = 0;

    while (i < lines.length) {
      var line = lines[i];

      // blank
      if (!/\S/.test(line)) { i += 1; continue; }

      // fenced code
      var fence = RE_FENCE.exec(line);
      if (fence) {
        var marker = fence[1].charAt(0);
        var minLen = fence[1].length;
        var lang = fence[2] || '';
        var buf = [];
        i += 1;
        while (i < lines.length) {
          var close = /^ {0,3}(```+|~~~+)\s*$/.exec(lines[i]);
          if (close && close[1].charAt(0) === marker && close[1].length >= minLen) { i += 1; break; }
          buf.push(lines[i]);
          i += 1;
        }
        out.push('<pre><code' + (lang ? ' class="language-' + escapeAttr(lang) + '"' : '') + '>' +
          escGt(buf.join('\n')) + (buf.length ? '\n' : '') + '</code></pre>');
        continue;
      }

      // indented code block (4 spaces / tab), only when not inside a list context
      if (/^(?: {4}|\t)/.test(line)) {
        var codeBuf = [];
        while (i < lines.length && (/^(?: {4}|\t)/.test(lines[i]) || !/\S/.test(lines[i]))) {
          if (!/\S/.test(lines[i])) {
            // trailing blanks end the block unless more code follows
            var j = i;
            while (j < lines.length && !/\S/.test(lines[j])) j += 1;
            if (j < lines.length && /^(?: {4}|\t)/.test(lines[j])) {
              for (; i < j; i++) codeBuf.push('');
              continue;
            }
            break;
          }
          codeBuf.push(dedent(lines[i], 4));
          i += 1;
        }
        out.push('<pre><code>' + escGt(codeBuf.join('\n')) + '\n</code></pre>');
        continue;
      }

      // horizontal rule
      if (RE_HR.test(line)) { out.push('<hr>'); i += 1; continue; }

      // ATX heading
      var head = RE_HEADING.exec(line);
      if (head) {
        var level = head[1].length;
        var content = head[2].replace(/\s+#+\s*$/, '');
        out.push('<h' + level + '>' + renderInline(content) + '</h' + level + '>');
        i += 1;
        continue;
      }

      // blockquote
      if (RE_QUOTE.test(line)) {
        var qBuf = [];
        while (i < lines.length && (RE_QUOTE.test(lines[i]) ||
               (/\S/.test(lines[i]) && qBuf.length && !isBlockStart(lines[i])))) {
          qBuf.push(lines[i].replace(RE_QUOTE, ''));
          i += 1;
        }
        out.push('<blockquote>' + renderBlocks(qBuf) + '</blockquote>');
        continue;
      }

      // list
      if (RE_ITEM.test(line) || RE_EMPTY_ITEM.test(line)) {
        var base = indentOf(line);
        var listBuf = [];
        var loose = false;
        var firstMarker = (RE_ITEM.exec(line) || RE_EMPTY_ITEM.exec(line))[2];
        var listOrdered = /\d/.test(firstMarker);
        while (i < lines.length) {
          var cur = lines[i];
          var curItem = RE_ITEM.exec(cur) || RE_EMPTY_ITEM.exec(cur);
          if (curItem && indentOf(cur) <= base + 1 &&
              /\d/.test(curItem[2]) !== listOrdered) break;
          if (!/\S/.test(cur)) {
            // blank: list continues only if the next non-blank line is indented or another item
            var k = i;
            while (k < lines.length && !/\S/.test(lines[k])) k += 1;
            var nextItem = k < lines.length ? (RE_ITEM.exec(lines[k]) || RE_EMPTY_ITEM.exec(lines[k])) : null;
            if (k < lines.length &&
                (indentOf(lines[k]) > base ||
                 (nextItem && indentOf(lines[k]) >= base &&
                  /\d/.test(nextItem[2]) === listOrdered))) {
              loose = true;
              for (; i < k; i++) listBuf.push('');
              continue;
            }
            break;
          }
          if (indentOf(cur) < base && !RE_ITEM.test(cur)) break;
          if (indentOf(cur) <= base && !RE_ITEM.test(cur) && !RE_EMPTY_ITEM.test(cur) &&
              (RE_HEADING.test(cur) || RE_HR.test(cur) || RE_FENCE.test(cur) || RE_QUOTE.test(cur))) break;
          listBuf.push(cur);
          i += 1;
        }
        out.push(renderList(listBuf, base, loose));
        continue;
      }

      // table
      if (line.indexOf('|') !== -1 && i + 1 < lines.length && RE_TABLE_DELIM.test(lines[i + 1]) &&
          lines[i + 1].indexOf('|') !== -1) {
        var header = splitRow(line);
        var aligns = splitRow(lines[i + 1]).map(function (c) {
          var s = c.trim();
          if (/^:.*:$/.test(s)) return 'center';
          if (/^:/.test(s)) return 'left';
          if (/:$/.test(s)) return 'right';
          return '';
        });
        i += 2;
        var body = [];
        while (i < lines.length && /\S/.test(lines[i]) && lines[i].indexOf('|') !== -1 &&
               !RE_HEADING.test(lines[i]) && !RE_HR.test(lines[i])) {
          body.push(splitRow(lines[i]));
          i += 1;
        }
        out.push(renderTable(header, aligns, body));
        continue;
      }

      // paragraph
      var pBuf = [];
      while (i < lines.length && /\S/.test(lines[i]) && !isBlockStart(lines[i])) {
        if (pBuf.length && lines[i].indexOf('|') !== -1 && RE_TABLE_DELIM.test(lines[i])) break;
        pBuf.push(lines[i].replace(/^ {0,3}/, ''));
        i += 1;
      }
      if (!pBuf.length) { pBuf.push(lines[i]); i += 1; }
      out.push('<p>' + renderInline(pBuf.join('\n')) + '</p>');
    }

    return out.join('\n');
  }

  function splitRow(row) {
    var s = row.trim().replace(/^\|/, '').replace(/\|$/, '');
    var cells = [];
    var cur = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (ch === '\\' && s.charAt(i + 1) === '|') { cur += '|'; i += 1; continue; }
      if (ch === '|') { cells.push(cur); cur = ''; continue; }
      cur += ch;
    }
    cells.push(cur);
    return cells;
  }

  function cell(tag, text, align) {
    return '<' + tag + (align ? ' style="text-align:' + align + '"' : '') + '>' +
      renderInline(text.trim()) + '</' + tag + '>';
  }

  function renderTable(header, aligns, body) {
    var html = '<table>\n<thead>\n<tr>';
    header.forEach(function (h, idx) { html += cell('th', h, aligns[idx]); });
    html += '</tr>\n</thead>\n';
    if (body.length) {
      html += '<tbody>\n';
      body.forEach(function (row) {
        html += '<tr>';
        for (var c = 0; c < header.length; c++) {
          html += cell('td', row[c] === undefined ? '' : row[c], aligns[c]);
        }
        html += '</tr>\n';
      });
      html += '</tbody>\n';
    }
    return html + '</table>';
  }

  function renderList(lines, base, loose) {
    var items = [];
    var ordered = false;
    var start = 1;
    var cur = null;

    lines.forEach(function (line) {
      var m = RE_ITEM.exec(line) || RE_EMPTY_ITEM.exec(line);
      if (m && indentOf(line) <= base + 1) {
        var marker = m[2];
        if (!items.length) {
          ordered = /\d/.test(marker);
          if (ordered) start = parseInt(marker, 10);
        }
        cur = { lines: [] };
        var rest = m[3] === undefined ? '' : m[3];
        if (rest !== '') cur.lines.push(rest);
        cur.contentIndent = indentOf(line) + marker.length + 1;
        items.push(cur);
        return;
      }
      if (!cur) { cur = { lines: [], contentIndent: base + 2 }; items.push(cur); }
      cur.lines.push(dedent(line, cur.contentIndent));
    });

    var html = '';
    items.forEach(function (item) {
      var body = item.lines.slice();
      var checkbox = '';
      if (body.length) {
        var task = RE_TASK.exec(body[0]);
        if (task) {
          checkbox = '<input type="checkbox" disabled' +
            (task[1].toLowerCase() === 'x' ? ' checked' : '') + '>';
          body[0] = body[0].replace(RE_TASK, '');
        }
      }
      var inner = renderBlocks(body);
      if (!loose) {
        // tight list: unwrap a single leading paragraph
        inner = inner.replace(/^<p>([\s\S]*?)<\/p>/, '$1');
      }
      html += '<li' + (checkbox ? ' class="task-item"' : '') + '>' + checkbox + inner + '</li>\n';
    });

    if (ordered) {
      return '<ol' + (start !== 1 ? ' start="' + start + '"' : '') + '>\n' + html + '</ol>';
    }
    return '<ul>\n' + html + '</ul>';
  }

  /**
   * renderMarkdown(text) -> HTML string.
   * All `&`, `<`, `>` in the source are escaped before any rule runs, so raw
   * HTML in the document is shown as text (safe for a local scratchpad).
   */
  function renderMarkdown(text) {
    if (text === null || text === undefined) return '';
    var src = String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/\r\n?/g, '\n')
      .replace(/\u00a0/g, ' ');
    return renderBlocks(src.split('\n'));
  }

  /* ------------------------------------------------------------------ *
   * 3. Live rendering
   * ------------------------------------------------------------------ */

  var RENDER_DELAY = 150;       // ms debounce while typing
  var renderTimer = null;
  var lastSource = null;        // last text actually rendered
  var listeners = [];           // callbacks notified after each render

  /** Register fn(text, html) to run after every preview render. */
  function onRender(fn) {
    if (typeof fn === 'function') listeners.push(fn);
  }

  function currentText() {
    return DOM.editor ? DOM.editor.value : '';
  }

  /** Render immediately (cancels any pending debounced render). */
  function renderNow(force) {
    if (renderTimer !== null) {
      clearTimeout(renderTimer);
      renderTimer = null;
    }
    var text = currentText();
    if (!force && text === lastSource) return;
    lastSource = text;

    var html = renderMarkdown(text);
    if (DOM.preview) {
      // Replacing innerHTML resets the pane's scroll offset; keep it stable
      // so typing at the bottom of a long note doesn't jump the preview.
      var pane = DOM.preview.parentNode;
      var scroller = pane && pane.scrollHeight > pane.clientHeight ? pane : DOM.preview;
      var top = scroller ? scroller.scrollTop : 0;
      var atBottom = scroller
        ? top + scroller.clientHeight >= scroller.scrollHeight - 4
        : false;

      DOM.preview.innerHTML = html;

      if (scroller) {
        scroller.scrollTop = atBottom
          ? scroller.scrollHeight
          : Math.min(top, scroller.scrollHeight);
      }
      DOM.preview.classList.toggle('is-empty', text.trim() === '');
    }

    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](text, html); } catch (e) { /* keep rendering */ }
    }
  }

  /** Schedule a render ~150ms after the last keystroke. */
  function updatePreview() {
    if (renderTimer !== null) clearTimeout(renderTimer);
    renderTimer = setTimeout(function () {
      renderTimer = null;
      renderNow(false);
    }, RENDER_DELAY);
  }

  if (DOM.editor) {
    DOM.editor.addEventListener('input', updatePreview);
    // paste/cut/drop fire `input` too, but these land the result instantly
    DOM.editor.addEventListener('change', function () { renderNow(false); });
    DOM.editor.addEventListener('blur', function () { renderNow(false); });
  }

  // First paint: render whatever is already in the textarea.
  renderNow(true);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { renderNow(false); });
  }

  /* ------------------------------------------------------------------ *
   * 4. Persistence (localStorage)
   * ------------------------------------------------------------------ */

  var STORAGE_KEY = 'scratchpad.doc';
  var SAVE_DELAY = 400;         // ms debounce after the last keystroke
  var saveTimer = null;
  var storageOk = true;         // flipped off if localStorage is unusable
  var lastSaved = null;         // last text successfully written

  var WELCOME = [
    '# Scratchpad',
    '',
    'Type **markdown** on the left, see it rendered on the right.',
    'Everything you write is saved in this browser automatically.',
    '',
    '## Quick tour',
    '',
    '- **bold**, *italic*, `code`, ~~strikethrough~~',
    '- [links](https://example.com) and lists',
    '- [x] task items',
    '- [ ] ...that you can tick by typing an `x`',
    '',
    '> Blockquotes, tables and fenced code blocks work too.',
    '',
    '```js',
    'console.log("hello");',
    '```',
    ''
  ].join('\n');

  function storage() {
    if (!storageOk) return null;
    try {
      var ls = window.localStorage;
      if (!ls) throw new Error('unavailable');
      return ls;
    } catch (e) {
      storageOk = false;
      return null;
    }
  }

  function setStatus(msg) {
    if (DOM.statSaved) DOM.statSaved.textContent = msg;
  }

  var toastTimer = null;
  /** Brief message in the bottom toast. */
  function toast(msg) {
    if (!DOM.toast) return;
    DOM.toast.textContent = msg;
    DOM.toast.classList.add('is-visible');
    if (toastTimer !== null) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastTimer = null;
      DOM.toast.classList.remove('is-visible');
    }, 1800);
  }

  function timeLabel() {
    var d = new Date();
    var h = d.getHours();
    var m = d.getMinutes();
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  /**
   * Write the current document to localStorage immediately.
   * Returns true on success. Failures (private mode, quota, file:// policy)
   * degrade silently: the app keeps working, the status bar says so.
   */
  function save(force) {
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    var text = currentText();
    if (!force && text === lastSaved) return true;

    var ls = storage();
    if (!ls) {
      setStatus('Not saved (storage unavailable)');
      return false;
    }
    try {
      ls.setItem(STORAGE_KEY, text);
      lastSaved = text;
      setStatus('Saved ' + timeLabel());
      return true;
    } catch (e) {
      storageOk = false;
      setStatus('Not saved (storage full)');
      return false;
    }
  }

  /** Schedule a save ~400ms after the last change. */
  function scheduleSave() {
    if (!storageOk) { setStatus('Not saved (storage unavailable)'); return; }
    if (currentText() === lastSaved) return;
    setStatus('Saving…');
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      save(false);
    }, SAVE_DELAY);
  }

  /**
   * Restore the saved document into the editor.
   * Seeds the welcome doc the first time (nothing stored yet).
   */
  function load() {
    if (!DOM.editor) return;
    var ls = storage();
    var stored = null;
    if (ls) {
      try { stored = ls.getItem(STORAGE_KEY); } catch (e) { storageOk = false; }
    }

    if (stored === null || stored === undefined) {
      if (!storageOk) {
        setStatus('Not saved (storage unavailable)');
      } else {
        DOM.editor.value = WELCOME;
        save(true);
      }
    } else {
      DOM.editor.value = stored;
      lastSaved = stored;
      setStatus(stored === '' ? 'Empty' : 'Loaded');
    }
    renderNow(true);
  }

  /** Wipe the document and the stored copy. */
  function clearDoc() {
    if (!DOM.editor) return;
    DOM.editor.value = '';
    renderNow(true);
    var ls = storage();
    if (ls) {
      try { ls.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
    }
    lastSaved = '';
    setStatus('Cleared');
  }

  if (DOM.editor) {
    DOM.editor.addEventListener('input', scheduleSave);
    DOM.editor.addEventListener('change', function () { save(false); });
    DOM.editor.addEventListener('blur', function () { save(false); });
  }

  // Never lose the last few keystrokes when the tab goes away.
  window.addEventListener('beforeunload', function () { save(false); });
  window.addEventListener('pagehide', function () { save(false); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') save(false);
  });

  // Ctrl/Cmd+S -> save now.
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      toast(save(true) ? 'Saved' : 'Could not save');
    }
  });

  if (DOM.btnClear) {
    DOM.btnClear.addEventListener('click', function () {
      if (currentText() !== '' && !window.confirm('Clear the scratchpad? This cannot be undone.')) return;
      clearDoc();
      toast('Cleared');
      if (DOM.editor) DOM.editor.focus();
    });
  }

  // Restore as soon as the DOM is ready (script is deferred, so usually now).
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }

  /* ------------------------------------------------------------------ *
   * 5. Toolbar formatting (bold / italic / heading / list)
   * ------------------------------------------------------------------ */

  /**
   * Replace [start,end) in the editor with `text` and place the selection.
   * Uses execCommand('insertText') when available so the browser's native
   * undo stack keeps working; falls back to direct value assignment.
   */
  function replaceRange(start, end, text, selStart, selEnd) {
    var ed = DOM.editor;
    if (!ed) return;
    ed.focus();
    ed.setSelectionRange(start, end);

    var ok = false;
    try {
      if (document.execCommand) {
        ok = text === ''
          ? (start !== end && document.execCommand('delete', false, null))
          : document.execCommand('insertText', false, text);
      }
    } catch (e) { ok = false; }

    if (!ok) {
      var v = ed.value;
      ed.value = v.slice(0, start) + text + v.slice(end);
    }

    ed.setSelectionRange(selStart, selEnd);
    renderNow(false);
    scheduleSave();
  }

  /* --- inline markers (bold, italic, code…) ------------------------- */

  var WORD_CHAR = /[^\s]/;

  /**
   * Toggle `marker` around the selection.
   * - empty selection: expands to the word under the caret, or inserts the
   *   marker pair with `placeholder` selected so typing replaces it;
   * - already-marked text (inside or just outside the selection): unwraps.
   */
  function toggleInline(marker, placeholder) {
    var ed = DOM.editor;
    if (!ed) return;
    var v = ed.value;
    var s = ed.selectionStart;
    var e = ed.selectionEnd;
    var m = marker.length;

    if (s === e) {
      var ws = s, we = e;
      while (ws > 0 && WORD_CHAR.test(v.charAt(ws - 1))) ws -= 1;
      while (we < v.length && WORD_CHAR.test(v.charAt(we))) we += 1;
      if (we > ws) { s = ws; e = we; }
    } else {
      // don't swallow the whitespace at the edges of a selection
      while (e > s && /\s/.test(v.charAt(e - 1))) e -= 1;
      while (s < e && /\s/.test(v.charAt(s))) s += 1;
    }

    var sel = v.slice(s, e);
    var doubled = marker === '*' && sel.slice(0, 2) === '**' && sel.slice(-2) === '**';

    // markers inside the selection -> unwrap
    if (!doubled && sel.length >= 2 * m &&
        sel.slice(0, m) === marker && sel.slice(sel.length - m) === marker) {
      var inner = sel.slice(m, sel.length - m);
      replaceRange(s, e, inner, s, s + inner.length);
      return;
    }

    // markers immediately outside the selection -> unwrap
    if (s - m >= 0 && v.slice(s - m, s) === marker && v.slice(e, e + m) === marker &&
        !(marker === '*' && (v.slice(Math.max(0, s - 2), s) === '**' || v.slice(e, e + 2) === '**'))) {
      replaceRange(s - m, e + m, sel, s - m, s - m + sel.length);
      return;
    }

    var body = sel !== '' ? sel : (placeholder || '');
    replaceRange(s, e, marker + body + marker, s + m, s + m + body.length);
  }

  /* --- line prefixes (headings, lists) ------------------------------ */

  /**
   * Apply `fn(lines) -> lines` to every line touched by the selection,
   * then restore a sensible caret/selection over the rewritten block.
   */
  function transformLines(fn) {
    var ed = DOM.editor;
    if (!ed) return;
    var v = ed.value;
    var s = ed.selectionStart;
    var e = ed.selectionEnd;

    var blockStart = v.lastIndexOf('\n', s - 1) + 1;
    var blockEnd;
    if (e > s && v.charAt(e - 1) === '\n') {
      blockEnd = e - 1;                       // selection ends on a line break
      if (blockEnd < blockStart) blockEnd = blockStart;
    } else {
      blockEnd = v.indexOf('\n', e);
      if (blockEnd === -1) blockEnd = v.length;
    }

    var lines = v.slice(blockStart, blockEnd).split('\n');
    var out = fn(lines.slice());
    var newBlock = out.join('\n');
    if (newBlock === lines.join('\n')) return;

    var selStart, selEnd;
    if (s === e) {
      // keep the caret at the same spot in its own line
      var rel = s - blockStart;
      var idx = 0, acc = 0;
      while (idx < lines.length - 1 && rel > acc + lines[idx].length) {
        acc += lines[idx].length + 1;
        idx += 1;
      }
      var nacc = 0;
      for (var k = 0; k < idx; k++) nacc += out[k].length + 1;
      var inLine = rel - acc;
      var shifted = inLine + (out[idx].length - lines[idx].length);
      if (shifted < 0) shifted = 0;
      if (shifted > out[idx].length) shifted = out[idx].length;
      selStart = selEnd = blockStart + nacc + shifted;
    } else {
      selStart = blockStart;
      selEnd = blockStart + newBlock.length;
    }

    replaceRange(blockStart, blockEnd, newBlock, selStart, selEnd);
  }

  var RE_LINE_HEADING = /^(\s*)(#{1,6})[ \t]+/;
  var RE_LINE_BULLET = /^(\s*)([-*+])[ \t]+/;
  var RE_LINE_ORDERED = /^(\s*)\d{1,9}[.)][ \t]+/;

  /** Cycle heading level on the touched lines: none -> # -> ## -> … -> none. */
  function toggleHeading() {
    transformLines(function (lines) {
      var levels = [];
      lines.forEach(function (line) {
        if (!/\S/.test(line)) return;
        var m = RE_LINE_HEADING.exec(line);
        levels.push(m ? m[2].length : 0);
      });
      var base = levels.length ? Math.min.apply(null, levels) : 0;
      var next = base >= 6 ? 0 : base + 1;

      return lines.map(function (line) {
        if (!/\S/.test(line)) return line;
        var m = RE_LINE_HEADING.exec(line);
        var indent = m ? m[1] : /^\s*/.exec(line)[0];
        var body = m ? line.slice(m[0].length) : line.slice(indent.length);
        if (next === 0) return indent + body;
        return indent + new Array(next + 1).join('#') + ' ' + body;
      });
    });
  }

  /** Toggle `- ` bullets on the touched lines. */
  function toggleList() {
    transformLines(function (lines) {
      var content = lines.filter(function (l) { return /\S/.test(l); });
      var allBullets = content.length > 0 && content.every(function (l) {
        return RE_LINE_BULLET.test(l);
      });

      if (!content.length) {
        // empty line(s): just start a list
        return lines.map(function (l) { return l + '- '; });
      }

      return lines.map(function (line) {
        if (!/\S/.test(line)) return line;
        if (allBullets) return line.replace(RE_LINE_BULLET, '$1');
        var ord = RE_LINE_ORDERED.exec(line);
        if (ord) return line.replace(RE_LINE_ORDERED, '$1- ');
        var indent = /^\s*/.exec(line)[0];
        return indent + '- ' + line.slice(indent.length);
      });
    });
  }

  var FORMATS = {
    bold: function () { toggleInline('**', 'bold text'); },
    italic: function () { toggleInline('*', 'italic text'); },
    heading: toggleHeading,
    list: toggleList
  };

  /** Run a named format action ('bold' | 'italic' | 'heading' | 'list'). */
  function format(name) {
    var fn = FORMATS[name];
    if (fn) fn();
  }

  function bindFormat(btn, name) {
    if (!btn) return;
    // mousedown-prevent keeps the textarea selection alive on click
    btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      format(name);
    });
  }

  bindFormat(DOM.btnBold, 'bold');
  bindFormat(DOM.btnItalic, 'italic');
  bindFormat(DOM.btnHeading, 'heading');
  bindFormat(DOM.btnList, 'list');

  // Keyboard shortcuts while editing.
  if (DOM.editor) {
    DOM.editor.addEventListener('keydown', function (e) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      var key = String(e.key || '').toLowerCase();
      var name = key === 'b' ? 'bold'
        : key === 'i' ? 'italic'
        : key === 'h' ? 'heading'
        : key === 'l' ? 'list'
        : null;
      if (!name) return;
      e.preventDefault();
      format(name);
    });
  }

  /* ------------------------------------------------------------------ *
   * 6. Live stats (words / characters / lines)
   * ------------------------------------------------------------------ */

  // A "word" is any run of non-whitespace. Markdown punctuation that stands
  // alone (`-`, `>`, `#`, `*`, `|`, `` ` ``) is not counted as a word.
  var RE_WS_RUN = /\S+/g;
  var RE_PUNCT_ONLY = /^[-*+>#|=_~`\\/()[\]{}.,:;!?'"“”‘’…–—]+$/;

  /** Count words, characters and lines of `text`. */
  function countStats(text) {
    var src = text === null || text === undefined ? '' : String(text);
    var normalized = src.replace(/\r\n?/g, '\n');

    var words = 0;
    var m;
    RE_WS_RUN.lastIndex = 0;
    while ((m = RE_WS_RUN.exec(normalized)) !== null) {
      if (!RE_PUNCT_ONLY.test(m[0])) words += 1;
    }

    // Characters: count code points, so emoji/astral chars count once.
    var chars = 0;
    for (var i = 0; i < normalized.length; i++) {
      var code = normalized.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < normalized.length) {
        var next = normalized.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) i += 1;
      }
      chars += 1;
    }

    var lines = normalized.length ? normalized.split('\n').length : 1;

    return { words: words, chars: chars, lines: lines };
  }

  function plural(n, one, many) {
    return n.toLocaleString ? n.toLocaleString() + ' ' + (n === 1 ? one : many)
      : n + ' ' + (n === 1 ? one : many);
  }

  var lastCounted = null;

  /** Refresh the status-bar counters from the editor contents. */
  function updateStats(text) {
    var src = text === undefined ? currentText() : text;
    if (src === lastCounted) return;
    lastCounted = src;

    var s = countStats(src);
    if (DOM.statWords) DOM.statWords.textContent = plural(s.words, 'word', 'words');
    if (DOM.statChars) DOM.statChars.textContent = plural(s.chars, 'character', 'characters');
    if (DOM.statLines) DOM.statLines.textContent = plural(s.lines, 'line', 'lines');
    return s;
  }

  if (DOM.editor) {
    // Counters are cheap — update them on every keystroke, no debounce.
    DOM.editor.addEventListener('input', function () { updateStats(); });
    DOM.editor.addEventListener('change', function () { updateStats(); });
  }
  // Keep them in sync with programmatic changes (load, clear, formatting).
  onRender(function (text) { updateStats(text); });
  updateStats();

  /* ------------------------------------------------------------------ *
   * 7. Copy as markdown
   * ------------------------------------------------------------------ */

  /**
   * Legacy clipboard path: select the text in a throwaway textarea and ask
   * the document to copy it. Needed on file:// and other insecure contexts,
   * where `navigator.clipboard` is usually undefined.
   */
  function copyFallback(text) {
    if (!document.body) return false;
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', 'readonly');
    ta.setAttribute('aria-hidden', 'true');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '-9999px';
    ta.style.opacity = '0';

    var active = document.activeElement;
    var selStart = null, selEnd = null;
    if (active === DOM.editor && DOM.editor) {
      selStart = DOM.editor.selectionStart;
      selEnd = DOM.editor.selectionEnd;
    }

    document.body.appendChild(ta);
    var ok = false;
    try {
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      ok = !!(document.execCommand && document.execCommand('copy'));
    } catch (e) {
      ok = false;
    }
    document.body.removeChild(ta);

    // Restore focus/selection so copying doesn't disturb typing.
    if (active && typeof active.focus === 'function') {
      try {
        active.focus();
        if (selStart !== null && DOM.editor) DOM.editor.setSelectionRange(selStart, selEnd);
      } catch (e) { /* ignore */ }
    }
    return ok;
  }

  var copyFlashTimer = null;

  function flashCopyButton() {
    if (!DOM.btnCopy) return;
    DOM.btnCopy.classList.add('is-copied');
    if (copyFlashTimer !== null) clearTimeout(copyFlashTimer);
    copyFlashTimer = setTimeout(function () {
      copyFlashTimer = null;
      DOM.btnCopy.classList.remove('is-copied');
    }, 1200);
  }

  function copyDone(ok, empty) {
    if (ok) {
      flashCopyButton();
      toast(empty ? 'Nothing to copy' : 'Markdown copied');
      setStatus(empty ? 'Nothing to copy' : 'Copied to clipboard');
    } else {
      toast('Copy failed — press Ctrl+C');
      setStatus('Copy failed');
    }
    return ok;
  }

  /**
   * Copy the raw markdown source to the clipboard.
   * Prefers the async Clipboard API, falls back to execCommand('copy').
   * Returns a promise resolving to true on success.
   */
  function copyMarkdown() {
    var text = currentText();
    var empty = text === '';

    if (empty) {
      return Promise.resolve(copyDone(true, true));
    }

    var clip = null;
    try {
      clip = navigator.clipboard && typeof navigator.clipboard.writeText === 'function'
        ? navigator.clipboard
        : null;
    } catch (e) { clip = null; }

    if (clip) {
      return clip.writeText(text).then(function () {
        return copyDone(true, false);
      }, function () {
        return copyDone(copyFallback(text), false);
      });
    }

    return Promise.resolve(copyDone(copyFallback(text), false));
  }

  if (DOM.btnCopy) {
    DOM.btnCopy.addEventListener('click', function (e) {
      e.preventDefault();
      copyMarkdown();
    });
  }

  // Ctrl/Cmd+Shift+C -> copy the whole document.
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey &&
        String(e.key || '').toLowerCase() === 'c') {
      e.preventDefault();
      copyMarkdown();
    }
  });

  /* Expose the parser + render API so other code/tests can reuse it. */
  window.Scratchpad = window.Scratchpad || {};
  window.Scratchpad.renderMarkdown = renderMarkdown;
  window.Scratchpad.renderInline = renderInline;
  window.Scratchpad.escapeHtml = escapeHtml;
  window.Scratchpad.updatePreview = updatePreview;
  window.Scratchpad.renderNow = renderNow;
  window.Scratchpad.onRender = onRender;
  window.Scratchpad.RENDER_DELAY = RENDER_DELAY;
  window.Scratchpad.save = save;
  window.Scratchpad.scheduleSave = scheduleSave;
  window.Scratchpad.load = load;
  window.Scratchpad.clearDoc = clearDoc;
  window.Scratchpad.toast = toast;
  window.Scratchpad.setStatus = setStatus;
  window.Scratchpad.format = format;
  window.Scratchpad.countStats = countStats;
  window.Scratchpad.updateStats = updateStats;
  window.Scratchpad.toggleInline = toggleInline;
  window.Scratchpad.toggleHeading = toggleHeading;
  window.Scratchpad.toggleList = toggleList;
  window.Scratchpad.transformLines = transformLines;
  window.Scratchpad.replaceRange = replaceRange;
  window.Scratchpad.copyMarkdown = copyMarkdown;
  window.Scratchpad.STORAGE_KEY = STORAGE_KEY;
  window.Scratchpad.SAVE_DELAY = SAVE_DELAY;
})();
