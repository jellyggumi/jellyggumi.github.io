/* super-search
Author: Kushagra Gour (http://kushagragour.in)
MIT Licensed

Local change: the overlay used to answer every unproductive query the same way, by
adding `is-hidden` to the results list and returning. A nonsense query, a query typed
before feed.xml finished loading, and a failed feed request were all indistinguishable
from each other and from an idle box: the reader saw a blank overlay and no message.
The standalone /search/ page already reports these states, so the overlay now shares
the same contract through one pure state function plus one renderer, both exported so
they can be exercised outside a browser.
*/
(function () {
	var searchFile = '/feed.xml',
		searchEl,
		searchButtonEl,
		searchInputEl,
		searchResultsEl,
		searchStatusEl,
		currentInputValue = '',
		lastSearchResultHash,
		indexState = 'loading',
		posts = [];

	// Shortest query that is searched. Anything shorter matches almost every post, so it
	// is now reported as an instruction instead of being silently ignored.
	var MIN_QUERY_LENGTH = 3;

	var MESSAGES = {
		short: 'Type at least ' + MIN_QUERY_LENGTH + ' characters to search.',
		loading: 'Loading search\u2026',
		error: 'Search is unavailable right now. Please browse the journal instead.'
	};

	// Changes XML to JSON
	// Modified version from here: http://davidwalsh.name/convert-xml-json
	function xmlToJson(xml) {
		// Create the return object
		var obj = {};
		if (xml.nodeType == 3) { // text
			obj = xml.nodeValue;
		}

		// do children
		// If all text nodes inside, get concatenated text from them.
		var textNodes = [].slice.call(xml.childNodes).filter(function (node) { return node.nodeType === 3; });
		if (xml.hasChildNodes() && xml.childNodes.length === textNodes.length) {
			obj = [].slice.call(xml.childNodes).reduce(function (text, node) { return text + node.nodeValue; }, '');
		}
		else if (xml.hasChildNodes()) {
			for(var i = 0; i < xml.childNodes.length; i++) {
				var item = xml.childNodes.item(i);
				var nodeName = item.nodeName;
				if (typeof(obj[nodeName]) == "undefined") {
					obj[nodeName] = xmlToJson(item);
				} else {
					if (typeof(obj[nodeName].push) == "undefined") {
						var old = obj[nodeName];
						obj[nodeName] = [];
						obj[nodeName].push(old);
					}
					obj[nodeName].push(xmlToJson(item));
				}
			}
		}
		return obj;
	}

	function getPostsFromXml(xml) {
		var json = xmlToJson(xml);
		return json.channel.item;
	}

	function escapeHtml(value) {
		return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
			return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
		});
	}

	function matchPosts(list, needle) {
		return (list || []).filter(function (post) {
			return (post.title + '').toLowerCase().indexOf(needle) !== -1 ||
				(post.description + '').toLowerCase().indexOf(needle) !== -1;
		});
	}

	// Pure: turns a raw query plus the current index condition into exactly one state.
	// `kind` is one of idle, short, loading, error, empty, results.
	function computeSearchState(rawQuery, list, state) {
		var query = (rawQuery == null ? '' : String(rawQuery)).trim();
		if (!query) {
			return { kind: 'idle', message: '', query: '', results: [] };
		}
		if (query.length < MIN_QUERY_LENGTH) {
			return { kind: 'short', message: MESSAGES.short, query: query, results: [] };
		}
		if (state === 'error') {
			return { kind: 'error', message: MESSAGES.error, query: query, results: [] };
		}
		if (state !== 'ready') {
			return { kind: 'loading', message: MESSAGES.loading, query: query, results: [] };
		}
		var matches = matchPosts(list, query.toLowerCase());
		if (!matches.length) {
			return {
				kind: 'empty',
				message: 'No results for \u201c' + query + '\u201d. Try a shorter or more general word.',
				query: query,
				results: []
			};
		}
		return {
			kind: 'results',
			message: matches.length + (matches.length === 1 ? ' result' : ' results') +
				' for \u201c' + query + '\u201d',
			query: query,
			results: matches
		};
	}

	function resultDate(post) {
		var d = new Date(post.pubDate);
		if (isNaN(d.getTime())) { return ''; }
		return d.toUTCString().replace(/.*(\d{2})\s+(\w{3})\s+(\d{4}).*/, '$2 $1, $3');
	}

	function resultsMarkup(matches) {
		return matches.map(function (post) {
			var date = resultDate(post);
			return '<li><a href="' + escapeHtml(post.link) + '">' + escapeHtml(post.title) +
				(date ? '<span class="super-search__result-date">' + escapeHtml(date) + '</span>' : '') +
				'</a></li>';
		}).join('');
	}

	// Writes one state to the DOM. `elements` is { status, results } so the renderer can
	// run against any element pair, including a stub in a test.
	function renderSearchState(state, elements) {
		var statusEl = elements && elements.status;
		var resultsEl = elements && elements.results;
		if (statusEl) {
			statusEl.textContent = state.message;
		}
		if (!resultsEl) { return state; }
		if (resultsEl.setAttribute) {
			resultsEl.setAttribute('aria-busy', state.kind === 'loading' ? 'true' : 'false');
		}
		if (state.kind === 'results') {
			var hash = state.results.reduce(function (acc, post) { return post.title + acc; }, '');
			if (hash !== lastSearchResultHash) {
				resultsEl.innerHTML = resultsMarkup(state.results);
				lastSearchResultHash = hash;
			}
			resultsEl.classList.remove('is-hidden');
			return state;
		}
		lastSearchResultHash = '';
		resultsEl.innerHTML = '';
		resultsEl.classList.add('is-hidden');
		return state;
	}

	function currentElements() {
		return { status: searchStatusEl, results: searchResultsEl };
	}

	function toggleSearch() {
		searchEl.classList.toggle('is-active');
		var isOpen = searchEl.classList.contains('is-active');
		searchEl.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
		searchButtonEl.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
		if (isOpen) {
			// while opening
			searchInputEl.value = '';
			currentInputValue = '';
			// The box is empty again, so a stale message and stale results go with it.
			renderSearchState(computeSearchState('', posts, indexState), currentElements());
			setTimeout(function () { searchInputEl.focus(); }, 210);
		} else {
			// while closing
			renderSearchState(computeSearchState('', posts, indexState), currentElements());
			searchButtonEl.focus();
		}
	}

	function handleInput() {
		currentInputValue = (searchInputEl.value + '');
		renderSearchState(computeSearchState(currentInputValue, posts, indexState), currentElements());
	}

	function init(options) {
		options = options || {};
		// A fresh mount starts with nothing loaded, so a query typed immediately reports
		// loading rather than inheriting an earlier index condition.
		indexState = 'loading';
		posts = [];
		lastSearchResultHash = '';
		searchFile = options.searchFile || searchFile;
		searchEl = document.querySelector(options.searchSelector || '#js-super-search');
		searchButtonEl = document.querySelector('.super-search-btn');
		searchInputEl = document.querySelector(options.inputSelector || '#js-super-search__input');
		searchResultsEl = document.querySelector(options.resultsSelector || '#js-super-search__results');
		searchStatusEl = document.querySelector(options.statusSelector || '#js-super-search__status');

		var xmlhttp=new XMLHttpRequest();
		xmlhttp.open('GET', searchFile);
		xmlhttp.onreadystatechange = function () {
			if (xmlhttp.readyState != 4) return;
			if (xmlhttp.status != 200 && xmlhttp.status != 304) {
				indexState = 'error';
				handleInput();
				return;
			}
			try {
				var node = (new DOMParser).parseFromString(xmlhttp.responseText, 'text/xml');
				node = node.children[0];
				var parsed = getPostsFromXml(node);
				posts = parsed ? [].concat(parsed) : [];
				indexState = 'ready';
			} catch (e) {
				indexState = 'error';
			}
			// A query typed while the feed was still in flight would otherwise sit on the
			// loading message forever, because nothing re-ran the match.
			handleInput();
		}
		xmlhttp.onerror = function () {
			indexState = 'error';
			handleInput();
		};
		xmlhttp.send();

		// Toggle on ESC key
		window.addEventListener('keyup', function onKeyPress(e) {
			if (e.which === 27 && searchEl.classList.contains('is-active')) {
				toggleSearch();
			}
		});
		// Open on '/' key
		window.addEventListener('keypress', function onKeyPress(e) {
			if (e.which === 47 && !searchEl.classList.contains('is-active')) {
				toggleSearch();
			}
		});

		searchInputEl.addEventListener('input', function onInputChange() {
			handleInput();
		});
	}

	init.toggle = toggleSearch;

	if (typeof window !== 'undefined') {
		window.superSearch = init;
		window.toggleSearch = toggleSearch;
	}

	// Exported so tools/test-search-ui.mjs exercises the shipped functions instead of a
	// second copy of the same rules.
	if (typeof module !== 'undefined' && module.exports) {
		module.exports = {
			superSearch: init,
			computeSearchState: computeSearchState,
			renderSearchState: renderSearchState,
			matchPosts: matchPosts,
			MIN_QUERY_LENGTH: MIN_QUERY_LENGTH,
			MESSAGES: MESSAGES
		};
	}

})();
