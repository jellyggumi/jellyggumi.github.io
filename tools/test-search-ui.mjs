#!/usr/bin/env node
/* test-search-ui.mjs — regression checks for the overlay search state machine.
 *
 * The overlay (magnifier button, `_includes/search.html` + `js/super-search.js`) used to
 * answer a nonsense query by hiding the results list and returning, so a failed feed, a
 * still-loading feed and a genuine zero-result query all rendered as one blank panel.
 * These checks load the shipped `js/super-search.js` and drive its real exported
 * functions and its real `init()` wiring against a minimal DOM stub. The stub is test
 * scaffolding only: no search rule is reimplemented here.
 *
 * Run: node tools/test-search-ui.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const searchModulePath = path.join(repoRoot, 'js', 'super-search.js');
const includePath = path.join(repoRoot, '_includes', 'search.html');
const cssPath = path.join(repoRoot, 'css', 'super-search.css');

const {
  superSearch,
  computeSearchState,
  renderSearchState,
  matchPosts,
  MIN_QUERY_LENGTH,
  MESSAGES
} = require(searchModulePath);

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

/* ---------------------------------------------------------------- DOM stub */

function makeElement(tag) {
  const classes = new Set();
  const listeners = new Map();
  return {
    tag,
    value: '',
    textContent: '',
    innerHTML: '',
    focusCount: 0,
    attributes: new Map(),
    listeners,
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c) => (classes.has(c) ? (classes.delete(c), false) : (classes.add(c), true))
    },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    dispatch(type, event) { (listeners.get(type) || []).forEach((fn) => fn(event || {})); },
    focus() { this.focusCount += 1; }
  };
}

// Minimal XML node shapes that satisfy the shipped xmlToJson walker.
function xmlText(value) {
  return { nodeType: 3, nodeName: '#text', nodeValue: value, childNodes: emptyChildNodes(), hasChildNodes: () => false };
}
function emptyChildNodes() {
  const list = [];
  list.item = (i) => list[i];
  return list;
}
function xmlElement(nodeName, children) {
  const list = children.slice();
  list.item = (i) => list[i];
  return { nodeType: 1, nodeName, nodeValue: null, childNodes: list, hasChildNodes: () => list.length > 0 };
}
function feedDocument(items) {
  const itemNodes = items.map((item) => xmlElement('item', [
    xmlElement('title', [xmlText(item.title)]),
    xmlElement('link', [xmlText(item.link)]),
    xmlElement('description', [xmlText(item.description)]),
    xmlElement('pubDate', [xmlText(item.pubDate)])
  ]));
  return { children: [xmlElement('rss', [xmlElement('channel', itemNodes)])] };
}

const FEED_ITEMS = [
  { title: 'Hangul Day Explained', link: '/journal/hangul/', description: 'Why the alphabet gets a holiday.', pubDate: 'Mon, 06 Oct 2025 00:00:00 +0000' },
  { title: 'Subway Fares in Seoul', link: '/journal/subway/', description: 'What a hangul-labelled card costs.', pubDate: 'Tue, 07 Oct 2025 00:00:00 +0000' }
];

// Builds a fresh browser-ish environment and calls the shipped init().
function mountOverlay({ status = 200, items = FEED_ITEMS, throwOnParse = false } = {}) {
  const button = makeElement('button');
  const container = makeElement('div');
  const input = makeElement('input');
  const results = makeElement('ul');
  const statusEl = makeElement('p');
  const bySelector = {
    '#js-super-search': container,
    '.super-search-btn': button,
    '#js-super-search__input': input,
    '#js-super-search__results': results,
    '#js-super-search__status': statusEl
  };

  let xhr;
  const windowListeners = new Map();

  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    XMLHttpRequest: globalThis.XMLHttpRequest,
    DOMParser: globalThis.DOMParser
  };

  globalThis.document = { querySelector: (sel) => bySelector[sel] || null };
  globalThis.window = {
    addEventListener(type, fn) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(fn);
    }
  };
  globalThis.XMLHttpRequest = function XMLHttpRequestStub() {
    this.readyState = 0;
    this.status = 0;
    this.responseText = '';
    this.open = () => {};
    this.send = () => { this.sent = true; };
    xhr = this;
  };
  globalThis.DOMParser = function DOMParserStub() {
    this.parseFromString = () => {
      if (throwOnParse) throw new Error('malformed feed');
      return feedDocument(items);
    };
  };

  superSearch({
    searchFile: '/feed.xml',
    searchSelector: '#js-super-search',
    inputSelector: '#js-super-search__input',
    resultsSelector: '#js-super-search__results',
    statusSelector: '#js-super-search__status'
  });

  const api = {
    button, container, input, results, status: statusEl,
    type(value) { input.value = value; input.dispatch('input'); },
    fireWindow(type, event) { (windowListeners.get(type) || []).forEach((fn) => fn(event)); },
    deliverFeed() {
      xhr.readyState = 4;
      xhr.status = status;
      xhr.responseText = '<rss/>';
      xhr.onreadystatechange();
    },
    restore() { Object.assign(globalThis, previous); }
  };
  return api;
}

/* ------------------------------------------------------------- pure states */

test('module exports the shipped state helpers', () => {
  assert.equal(typeof superSearch, 'function');
  assert.equal(typeof superSearch.toggle, 'function');
  assert.equal(typeof computeSearchState, 'function');
  assert.equal(typeof renderSearchState, 'function');
  assert.equal(typeof matchPosts, 'function');
  assert.equal(MIN_QUERY_LENGTH, 3);
});

test('empty query is idle with no message', () => {
  const state = computeSearchState('', FEED_ITEMS, 'ready');
  assert.equal(state.kind, 'idle');
  assert.equal(state.message, '');
  assert.deepEqual(state.results, []);
});

test('query below the minimum length says so instead of staying silent', () => {
  const state = computeSearchState('ha', FEED_ITEMS, 'ready');
  assert.equal(state.kind, 'short');
  assert.equal(state.message, MESSAGES.short);
  assert.match(state.message, /at least 3 characters/);
});

test('query typed before the feed arrives reports loading', () => {
  const state = computeSearchState('hangul', [], 'loading');
  assert.equal(state.kind, 'loading');
  assert.equal(state.message, MESSAGES.loading);
});

test('failed index reports an error rather than an empty panel', () => {
  const state = computeSearchState('hangul', [], 'error');
  assert.equal(state.kind, 'error');
  assert.match(state.message, /Search is unavailable right now/);
});

test('nonsense query returns an explicit no-results state naming the query', () => {
  const state = computeSearchState('qzxwvnonsense', FEED_ITEMS, 'ready');
  assert.equal(state.kind, 'empty');
  assert.deepEqual(state.results, []);
  assert.match(state.message, /^No results for /);
  assert.ok(state.message.includes('qzxwvnonsense'));
  assert.match(state.message, /Try a shorter or more general word\./);
});

test('single match is announced in the singular', () => {
  const state = computeSearchState('Hangul Day', FEED_ITEMS, 'ready');
  assert.equal(state.kind, 'results');
  assert.equal(state.results.length, 1);
  assert.ok(state.message.startsWith('1 result for '));
  assert.ok(!state.message.startsWith('1 results'));
});

test('multiple matches are announced in the plural and include description hits', () => {
  const state = computeSearchState('hangul', FEED_ITEMS, 'ready');
  assert.equal(state.kind, 'results');
  assert.equal(state.results.length, 2, 'title match plus description match');
  assert.ok(state.message.startsWith('2 results for '));
});

test('query is trimmed and matched case-insensitively', () => {
  const state = computeSearchState('  SUBWAY  ', FEED_ITEMS, 'ready');
  assert.equal(state.kind, 'results');
  assert.equal(state.results.length, 1);
  assert.equal(state.query, 'SUBWAY');
});

/* ---------------------------------------------------------------- renderer */

test('no-results state writes the message, clears the list and marks it not busy', () => {
  const status = makeElement('p');
  const results = makeElement('ul');
  results.innerHTML = '<li>stale</li>';
  renderSearchState(computeSearchState('qzxwvnonsense', FEED_ITEMS, 'ready'), { status, results });
  assert.match(status.textContent, /^No results for /);
  assert.equal(results.innerHTML, '', 'stale results must not survive a zero-result query');
  assert.equal(results.classList.contains('is-hidden'), true);
  assert.equal(results.getAttribute('aria-busy'), 'false');
});

test('loading state marks the results list busy', () => {
  const status = makeElement('p');
  const results = makeElement('ul');
  renderSearchState(computeSearchState('hangul', [], 'loading'), { status, results });
  assert.equal(status.textContent, MESSAGES.loading);
  assert.equal(results.getAttribute('aria-busy'), 'true');
});

test('error state is rendered to the live region', () => {
  const status = makeElement('p');
  const results = makeElement('ul');
  renderSearchState(computeSearchState('hangul', [], 'error'), { status, results });
  assert.equal(status.textContent, MESSAGES.error);
  assert.equal(results.innerHTML, '');
});

test('successful results still render links and stay visible', () => {
  const status = makeElement('p');
  const results = makeElement('ul');
  renderSearchState(computeSearchState('subway', FEED_ITEMS, 'ready'), { status, results });
  assert.equal(results.classList.contains('is-hidden'), false);
  assert.ok(results.innerHTML.includes('href="/journal/subway/"'));
  assert.ok(results.innerHTML.includes('Subway Fares in Seoul'));
  assert.ok(results.innerHTML.includes('super-search__result-date'));
  assert.equal(status.textContent, '1 result for \u201csubway\u201d');
});

test('result titles and links are HTML-escaped', () => {
  const status = makeElement('p');
  const results = makeElement('ul');
  const hostile = [{ title: 'Tea <script>alert(1)</script>', link: '/a"b/', description: '', pubDate: 'Mon, 06 Oct 2025 00:00:00 +0000' }];
  renderSearchState(computeSearchState('tea', hostile, 'ready'), { status, results });
  assert.ok(!results.innerHTML.includes('<script>'));
  assert.ok(results.innerHTML.includes('&lt;script&gt;'));
  assert.ok(results.innerHTML.includes('href="/a&quot;b/"'));
});

test('an invalid pubDate does not emit a broken date label', () => {
  const status = makeElement('p');
  const results = makeElement('ul');
  const items = [{ title: 'Undated Note', link: '/x/', description: '', pubDate: 'not-a-date' }];
  renderSearchState(computeSearchState('undated', items, 'ready'), { status, results });
  assert.ok(!results.innerHTML.includes('Invalid Date'));
  assert.ok(results.innerHTML.includes('Undated Note'));
});

/* ------------------------------------------------------ init() integration */

test('overlay reports no results for a nonsense query after the feed loads', () => {
  const ui = mountOverlay();
  try {
    ui.deliverFeed();
    ui.type('qzxwvnonsense');
    assert.match(ui.status.textContent, /^No results for /);
    assert.ok(ui.status.textContent.includes('qzxwvnonsense'));
    assert.equal(ui.results.innerHTML, '');
    assert.equal(ui.results.getAttribute('aria-busy'), 'false');
  } finally { ui.restore(); }
});

test('overlay still renders successful results end to end', () => {
  const ui = mountOverlay();
  try {
    ui.deliverFeed();
    ui.type('subway');
    assert.equal(ui.status.textContent, '1 result for \u201csubway\u201d');
    assert.ok(ui.results.innerHTML.includes('/journal/subway/'));
    assert.equal(ui.results.classList.contains('is-hidden'), false);
  } finally { ui.restore(); }
});

test('a query typed before the feed arrives resolves once it does', () => {
  const ui = mountOverlay();
  try {
    ui.type('subway');
    assert.equal(ui.status.textContent, MESSAGES.loading, 'must not look empty while loading');
    assert.equal(ui.results.getAttribute('aria-busy'), 'true');
    ui.deliverFeed();
    assert.equal(ui.status.textContent, '1 result for \u201csubway\u201d', 'must not stay stuck on loading');
    assert.equal(ui.results.getAttribute('aria-busy'), 'false');
  } finally { ui.restore(); }
});

test('an HTTP failure on the feed surfaces the error state', () => {
  const ui = mountOverlay({ status: 500 });
  try {
    ui.type('subway');
    ui.deliverFeed();
    assert.equal(ui.status.textContent, MESSAGES.error);
    assert.equal(ui.results.innerHTML, '');
  } finally { ui.restore(); }
});

test('a malformed feed surfaces the error state instead of a blank list', () => {
  const ui = mountOverlay({ throwOnParse: true });
  try {
    ui.deliverFeed();
    ui.type('subway');
    assert.equal(ui.status.textContent, MESSAGES.error);
  } finally { ui.restore(); }
});

/* ------------------------------------------- toggle, keyboard and focus */

test('opening clears a stale message and closing restores focus to the button', () => {
  const ui = mountOverlay();
  try {
    ui.deliverFeed();
    ui.type('qzxwvnonsense');
    assert.notEqual(ui.status.textContent, '');

    superSearch.toggle();
    assert.equal(ui.container.classList.contains('is-active'), true);
    assert.equal(ui.container.getAttribute('aria-hidden'), 'false');
    assert.equal(ui.button.getAttribute('aria-expanded'), 'true');
    assert.equal(ui.status.textContent, '', 'a reopened overlay must not show the previous message');
    assert.equal(ui.results.innerHTML, '');

    superSearch.toggle();
    assert.equal(ui.container.classList.contains('is-active'), false);
    assert.equal(ui.container.getAttribute('aria-hidden'), 'true');
    assert.equal(ui.button.getAttribute('aria-expanded'), 'false');
    assert.equal(ui.button.focusCount, 1, 'focus returns to the magnifier on close');
  } finally { ui.restore(); }
});

test('Escape closes an open overlay and leaves a closed one alone', () => {
  const ui = mountOverlay();
  try {
    ui.deliverFeed();
    ui.fireWindow('keyup', { which: 27 });
    assert.equal(ui.container.classList.contains('is-active'), false, 'Escape on a closed overlay is a no-op');

    superSearch.toggle();
    assert.equal(ui.container.classList.contains('is-active'), true);
    ui.fireWindow('keyup', { which: 27 });
    assert.equal(ui.container.classList.contains('is-active'), false);
    assert.equal(ui.button.focusCount, 1);
  } finally { ui.restore(); }
});

test('the slash shortcut still opens the overlay', () => {
  const ui = mountOverlay();
  try {
    ui.deliverFeed();
    ui.fireWindow('keypress', { which: 47 });
    assert.equal(ui.container.classList.contains('is-active'), true);
    superSearch.toggle();
  } finally { ui.restore(); }
});

/* ------------------------------------------------------- shipped markup */

test('the include ships an accessible live status region wired to the script', () => {
  const html = fs.readFileSync(includePath, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const status = html.match(/<p\b[^>]*\bid="js-super-search__status"[^>]*>/)?.[0] || '';
  assert.ok(status, 'status element id');
  assert.match(status, /\brole="status"/, 'role=status on the real element');
  assert.match(status, /\baria-live="polite"/, 'aria-live=polite on the real element');
  assert.ok(html.includes('aria-describedby="js-super-search__status"'), 'input describes the status');
  assert.ok(html.includes('aria-busy="false"'), 'results list declares a busy state');
  assert.ok(/statusSelector:\s*'#js-super-search__status'/.test(html), 'statusSelector passed to superSearch()');
  assert.ok(html.includes('aria-label="Close search"'), 'close control keeps its label');
  assert.ok(html.includes('aria-controls="js-super-search"'), 'trigger keeps aria-controls');
});

test('the status region has a stylesheet rule', () => {
  const css = fs.readFileSync(cssPath, 'utf8');
  assert.ok(css.includes('.super-search__status'), 'status rule present');
});

test('shipped user-facing strings stay plain English', () => {
  const strings = [
    MESSAGES.short,
    MESSAGES.loading,
    MESSAGES.error,
    computeSearchState('zzz', [], 'ready').message,
    computeSearchState('subway', FEED_ITEMS, 'ready').message
  ];
  for (const value of strings) {
    assert.ok(!value.includes('\u2014'), `em dash in: ${value}`);
    assert.ok(!/\p{Extended_Pictographic}/u.test(value), `emoji in: ${value}`);
  }
});

/* -------------------------------------------------------------- runner */

let failed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`pass  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${name}`);
    console.error(`      ${error.message}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed === 0 ? 0 : 1);
