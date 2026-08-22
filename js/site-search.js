/* site-search.js — standalone search for /search/.
 *
 * Replaces a <script> tag that pointed at js/jekyll-search.js, a file that does not
 * exist in this repository. The search page therefore did nothing at all: typing in
 * the box produced no results and no error a visitor could understand.
 *
 * Reads /search.json (title, url, date, category, tags, desc, content), ranks matches
 * so title hits outrank body hits, and renders them with a highlighted excerpt.
 * No dependencies — it must not wait on jQuery to become interactive.
 */
(function () {
  'use strict';

  var input = document.getElementById('search-input');
  var results = document.getElementById('results-container');
  var status = document.getElementById('search-status');
  if (!input || !results) { return; }

  var index = null;
  var pending = null;
  var indexUrl = results.getAttribute('data-index') || '/search.json';

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Score a single entry. Title matches are worth far more than body matches, and an
  // exact phrase beats scattered terms, so "hangul" surfaces the Hangul post rather
  // than every post that happens to mention it in passing.
  function score(entry, terms, phrase) {
    var title = (entry.title || '').toLowerCase();
    var desc = (entry.desc || '').toLowerCase();
    var body = (entry.content || '').toLowerCase();
    var meta = ((entry.tags || '') + ' ' + (entry.category || '')).toLowerCase();
    var total = 0;

    if (title.indexOf(phrase) !== -1) { total += 120; }
    if (desc.indexOf(phrase) !== -1) { total += 40; }
    if (body.indexOf(phrase) !== -1) { total += 12; }

    for (var i = 0; i < terms.length; i++) {
      var t = terms[i];
      if (!t) { continue; }
      var hit = false;
      if (title.indexOf(t) !== -1) { total += 30; hit = true; }
      if (meta.indexOf(t) !== -1) { total += 14; hit = true; }
      if (desc.indexOf(t) !== -1) { total += 8; hit = true; }
      if (body.indexOf(t) !== -1) { total += 3; hit = true; }
      // Every term must appear somewhere, so a two-word query does not match a
      // document containing only the commoner of the two words.
      if (!hit) { return 0; }
    }
    return total;
  }

  // Pull a window of body text around the first match so the reader can see why the
  // result matched, rather than always showing the same opening sentence.
  function excerpt(entry, phrase) {
    var source = entry.desc || entry.content || '';
    var lower = source.toLowerCase();
    var at = lower.indexOf(phrase);
    if (at === -1) { return source.slice(0, 160); }
    var start = Math.max(0, at - 60);
    var slice = source.slice(start, start + 200);
    return (start > 0 ? '\u2026' : '') + slice + (start + 200 < source.length ? '\u2026' : '');
  }

  function highlight(text, phrase) {
    var safe = escapeHtml(text);
    if (!phrase) { return safe; }
    var needle = escapeHtml(phrase).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return safe.replace(new RegExp(needle, 'gi'), function (m) {
      return '<mark>' + m + '</mark>';
    });
  }

  function render(matches, query) {
    if (!matches.length) {
      results.innerHTML = '';
      status.textContent = 'No results for \u201c' + query + '\u201d. Try a shorter or more general word.';
      return;
    }
    status.textContent = matches.length + (matches.length === 1 ? ' result' : ' results') +
                         ' for \u201c' + query + '\u201d';
    var phrase = query.toLowerCase();
    results.innerHTML = matches.map(function (m) {
      var e = m.entry;
      var meta = [];
      if (e.date) { meta.push(e.date); }
      if (e.category) { meta.push(e.category); }
      return '<li class="search-result">' +
               '<a href="' + escapeHtml(e.url) + '">' + highlight(e.title, query) + '</a>' +
               (meta.length ? '<span class="search-result__meta">' + escapeHtml(meta.join(' \u00b7 ')) + '</span>' : '') +
               '<p class="search-result__excerpt">' + highlight(excerpt(e, phrase), query) + '</p>' +
             '</li>';
    }).join('');
  }

  function run(query) {
    query = (query || '').trim();
    if (query.length < 2) {
      results.innerHTML = '';
      status.textContent = query.length ? 'Keep typing\u2026' : '';
      return;
    }
    if (!index) { pending = query; status.textContent = 'Loading\u2026'; return; }

    var phrase = query.toLowerCase();
    var terms = phrase.split(/\s+/);
    var matches = [];
    for (var i = 0; i < index.length; i++) {
      var s = score(index[i], terms, phrase);
      if (s > 0) { matches.push({ entry: index[i], score: s }); }
    }
    matches.sort(function (a, b) {
      if (b.score !== a.score) { return b.score - a.score; }
      return (b.entry.date || '').localeCompare(a.entry.date || '');
    });
    render(matches.slice(0, 20), query);
  }

  var timer;
  input.addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(function () { run(input.value); }, 120);
  });

  // Support arriving with ?q=... from elsewhere, which is also the URL shape declared
  // in the site's SearchAction structured data.
  function initialQuery() {
    var m = /[?&]q=([^&]+)/.exec(window.location.search);
    return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
  }

  var xhr = new XMLHttpRequest();
  xhr.open('GET', indexUrl, true);
  xhr.onreadystatechange = function () {
    if (xhr.readyState !== 4) { return; }
    if (xhr.status !== 200 && xhr.status !== 304) {
      status.textContent = 'Search is unavailable right now. Please browse the journal instead.';
      return;
    }
    try {
      index = JSON.parse(xhr.responseText);
    } catch (e) {
      status.textContent = 'Search is unavailable right now. Please browse the journal instead.';
      return;
    }
    var q = pending || initialQuery();
    if (q) { input.value = q; run(q); }
    pending = null;
  };
  xhr.send();

  var q0 = initialQuery();
  if (q0) { input.value = q0; }
})();
