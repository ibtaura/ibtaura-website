/* Phone and tablet header (768 px and under, see style.css): a fixed bar with the logo, search and menu,
   and full-screen panels for the pages and for search. Runs straight after the header so it never flashes. */
(function () {
  var navbar = document.querySelector('.navbar');
  var inner = navbar && navbar.querySelector('.navbar-inner');
  if (!inner) return;

  var MORE = [['articles.html', 'Health Library'], ['about.html', 'About Adarna'], ['careers.html', 'Careers'], ['contact.html', 'Contact Us']];
  var QUICK = [['/aura-clarus-app', 'Clarus App'], ['/aura-clarus-desktop', 'Clarus Desktop'], ['/articles', 'Health Library'], ['/kickstarter', 'Kickstarter']];
  var ARROW = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 8h10.5M9 4l4 4-4 4"/></svg>';

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  var logo = el('a', 'm-logo');
  logo.href = 'index.html';
  logo.setAttribute('aria-label', 'Adarna home');
  logo.innerHTML = '<svg viewBox="44 42 93 93" aria-hidden="true"><path fill="currentColor" d="M74.3215 57.8194C79.7457 49.9834 91.2956 50.0805 96.6086 57.9923C96.7379 58.1847 96.8651 58.3778 96.9934 58.5694C90.8836 63.3269 86.9534 70.7524 86.9534 79.0958C86.9536 93.455 98.5941 105.096 112.953 105.096C116.416 105.096 119.72 104.415 122.741 103.187C123.181 104.101 123.621 105.022 124.059 105.951C129.017 116.474 119.186 127.62 107.969 124.538L105.909 123.973C104.067 123.466 102.356 122.576 100.731 121.571C97.5576 119.611 91.5232 116.575 84.4924 116.506C80.2583 116.464 77.0876 117.632 74.8323 119.004C71.4567 121.058 68.126 123.652 64.2532 124.435L61.5061 124.99C50.564 127.203 41.5692 116.342 46.2835 106.223C54.2376 89.149 62.423 75.0088 74.3215 57.8194Z"/><ellipse fill="currentColor" cx="112.453" cy="79.0953" rx="23.5" ry="24"/></svg>';

  var searchBtn = el('button', 'm-nav-btn m-search-btn');
  searchBtn.type = 'button';
  searchBtn.setAttribute('aria-label', 'Search');
  searchBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>';

  var menuBtn = el('button', 'm-nav-btn m-menu-btn');
  menuBtn.type = 'button';
  menuBtn.setAttribute('aria-label', 'Menu');
  menuBtn.setAttribute('aria-expanded', 'false');
  menuBtn.innerHTML = '<span></span><span></span><span></span>';

  inner.appendChild(logo);
  inner.appendChild(searchBtn);
  inner.appendChild(menuBtn);

  function row(href, label) {
    var a = el('a', 'm-row');
    a.href = href;
    a.innerHTML = ARROW;
    a.appendChild(el('span', '', label));
    return a;
  }

  /* The pages */
  var menu = el('div', 'm-sheet');
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-modal', 'true');
  menu.setAttribute('aria-label', 'Menu');
  menu.setAttribute('data-lenis-prevent', '');
  var pages = el('nav', 'm-pages');
  navbar.querySelectorAll('.nav-link').forEach(function (link) {
    var a = el('a', link.classList.contains('active') ? 'active' : '', link.textContent);
    a.href = link.getAttribute('href');
    pages.appendChild(a);
  });
  menu.appendChild(pages);
  menu.appendChild(el('p', 'm-label', 'More'));
  MORE.forEach(function (m) { menu.appendChild(row(m[0], m[1])); });
  var cookies = el('button', 'm-row');
  cookies.type = 'button';
  cookies.innerHTML = ARROW;
  cookies.appendChild(el('span', '', 'Manage cookies'));
  menu.appendChild(cookies);

  /* Search */
  var search = el('div', 'm-sheet');
  search.setAttribute('role', 'dialog');
  search.setAttribute('aria-modal', 'true');
  search.setAttribute('aria-label', 'Search');
  search.setAttribute('data-lenis-prevent', '');
  var form = el('form', 'm-search');
  form.setAttribute('role', 'search');
  form.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>';
  var input = el('input');
  input.type = 'text';
  input.placeholder = 'Search';
  input.autocomplete = 'off';
  input.setAttribute('aria-label', 'Search adarna.us');
  input.setAttribute('enterkeyhint', 'search');
  form.appendChild(input);
  var results = el('div', 'm-results');
  results.setAttribute('aria-live', 'polite');
  search.appendChild(form);
  search.appendChild(results);

  document.body.appendChild(menu);
  document.body.appendChild(search);

  var open = null, index = null, loading = null;

  function showQuick() {
    results.textContent = '';
    results.appendChild(el('p', 'm-label', 'Quick Links'));
    QUICK.forEach(function (q) { results.appendChild(row(q[0], q[1])); });
  }

  function loadIndex() {
    if (loading) return loading;
    loading = fetch('assets/search-index.json').then(function (r) { return r.json(); })
      .then(function (items) { index = items; find(); })
      .catch(function () { loading = null; });
    return loading;
  }

  function matches(query) {
    var words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return (index || []).map(function (item) {
      var title = item.t.toLowerCase(), all = title + ' ' + item.d.toLowerCase();
      if (!words.every(function (w) { return all.indexOf(w) !== -1; })) return null;
      return { item: item, score: words.filter(function (w) { return title.indexOf(w) !== -1; }).length };
    }).filter(Boolean).sort(function (a, b) { return b.score - a.score; }).slice(0, 8);
  }

  function find() {
    var query = input.value.trim();
    if (!query) { showQuick(); return; }
    results.textContent = '';
    if (!index) { results.appendChild(el('p', 'm-label', 'Searching…')); return; }
    var found = matches(query);
    results.appendChild(el('p', 'm-label', found.length ? 'Results' : 'No results'));
    found.forEach(function (f) {
      var a = el('a', 'm-result');
      a.href = f.item.u;
      a.appendChild(el('b', '', f.item.t));
      if (f.item.d) a.appendChild(el('span', '', f.item.d));
      results.appendChild(a);
    });
  }

  function focusables() {
    return [menuBtn].concat([].slice.call(open.querySelectorAll('a, button, input')));
  }

  function onKey(e) {
    if (e.key === 'Escape') { close(); return; }
    if (e.key !== 'Tab') return;
    var list = focusables(), first = list[0], last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function show(sheet) {
    open = sheet;
    sheet.classList.add('is-open');
    navbar.classList.add('m-open');
    document.documentElement.classList.add('m-locked');
    if (window.lenis && window.lenis.stop) window.lenis.stop();
    menuBtn.setAttribute('aria-expanded', 'true');
    menuBtn.setAttribute('aria-label', 'Close');
    document.addEventListener('keydown', onKey);
  }

  function close() {
    if (!open) return;
    open.classList.remove('is-open');
    open = null;
    navbar.classList.remove('m-open');
    document.documentElement.classList.remove('m-locked');
    if (window.lenis && window.lenis.start) window.lenis.start();
    menuBtn.setAttribute('aria-expanded', 'false');
    menuBtn.setAttribute('aria-label', 'Menu');
    document.removeEventListener('keydown', onKey);
    menuBtn.focus({ preventScroll: true });
  }

  menuBtn.addEventListener('click', function () {
    if (open) { close(); return; }
    show(menu);
    var first = pages.querySelector('a');
    if (first) first.focus({ preventScroll: true });
  });

  searchBtn.addEventListener('click', function () {
    show(search);
    input.value = '';
    showQuick();
    loadIndex();
    input.focus({ preventScroll: true });
  });

  input.addEventListener('input', find);
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var best = results.querySelector('a');
    if (best) location.href = best.href;
  });

  /* Opening the current page, or a link that stays on it, just closes the panel */
  [menu, search].forEach(function (sheet) {
    sheet.addEventListener('click', function (e) { if (e.target.closest('a')) close(); });
  });

  cookies.addEventListener('click', function () {
    close();
    var trigger = document.querySelector('.acw-trigger');
    if (trigger) setTimeout(function () { trigger.click(); }, 0);
  });

  window.addEventListener('pageshow', close);
  var wide = window.matchMedia('(min-width: 769px)');
  (wide.addEventListener ? wide.addEventListener.bind(wide, 'change') : wide.addListener.bind(wide))(close);
})();
