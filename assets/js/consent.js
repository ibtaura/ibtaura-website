/**
 * Aura — Cookie consent + GA4 (Google Consent Mode v2)
 * ------------------------------------------------------------------
 * - Essential cookies only, until the visitor opts in.
 * - No Google Analytics script is requested at all until "Analytics"
 *   consent is granted, so nothing is loaded and no cookie is written.
 * - Consent Mode v2 defaults are declared up-front, so if/when GA does
 *   load it already knows what it is and is not allowed to store.
 */
(function () {
  'use strict';

  var CFG = window.AURA_ANALYTICS || {};
  var COOKIE = CFG.consentCookieName || 'aura_cookie_consent';
  var VERSION = CFG.consentVersion || 1;
  var DAYS = CFG.consentDays || 180;
  var GA_ID = CFG.measurementId || '';
  var GA_VALID = /^G-[A-Z0-9]+$/i.test(GA_ID) && GA_ID.indexOf('XXXXXXXXXX') === -1;

  /* ---------------- Consent Mode v2 defaults (before any tag) ------- */
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;

  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
    functionality_storage: 'granted',
    security_storage: 'granted',
    wait_for_update: 500
  });

  /* ---------------- storage helpers -------------------------------- */
  function readConsent() {
    try {
      var m = document.cookie.match(new RegExp('(?:^|; )' + COOKIE + '=([^;]*)'));
      var raw = m ? decodeURIComponent(m[1]) : localStorage.getItem(COOKIE);
      if (!raw) return null;
      var v = JSON.parse(raw);
      if (!v || v.v !== VERSION) return null;
      return v;
    } catch (e) { return null; }
  }

  function writeConsent(analytics, marketing) {
    var value = { v: VERSION, ts: Date.now(), analytics: !!analytics, marketing: !!marketing };
    var json = JSON.stringify(value);
    try {
      var d = new Date();
      d.setTime(d.getTime() + DAYS * 864e5);
      document.cookie = COOKIE + '=' + encodeURIComponent(json) +
        ';expires=' + d.toUTCString() + ';path=/;SameSite=Lax' +
        (location.protocol === 'https:' ? ';Secure' : '');
    } catch (e) {}
    try { localStorage.setItem(COOKIE, json); } catch (e) {}
    return value;
  }

  /* ---------------- clearing analytics cookies on withdrawal -------- */
  function clearAnalyticsCookies() {
    var hosts = [location.hostname, '.' + location.hostname];
    var parts = location.hostname.split('.');
    if (parts.length > 2) hosts.push('.' + parts.slice(-2).join('.'));
    document.cookie.split(';').forEach(function (c) {
      var name = c.split('=')[0].trim();
      if (!/^(_ga|_gid|_gat|_gac)/.test(name)) return;
      hosts.forEach(function (h) {
        document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=' + h;
      });
      document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
    });
  }

  /* ---------------- GA4 loader (only after opt-in) ------------------ */
  var gaLoaded = false;
  function loadGA(marketing) {
    if (!GA_VALID) return;            // no ID configured — stay dark
    if (gaLoaded) return;
    gaLoaded = true;

    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_ID);
    document.head.appendChild(s);

    gtag('js', new Date());
    gtag('config', GA_ID, {
      anonymize_ip: true,
      allow_google_signals: !!marketing,
      allow_ad_personalization_signals: !!marketing,
      cookie_domain: CFG.cookieDomain || 'auto',
      cookie_flags: 'SameSite=Lax;Secure',
      send_page_view: true
    });
  }

  function applyConsent(c, opts) {
    var analytics = !!(c && c.analytics);
    var marketing = !!(c && c.marketing);

    gtag('consent', 'update', {
      analytics_storage: analytics ? 'granted' : 'denied',
      ad_storage: marketing ? 'granted' : 'denied',
      ad_user_data: marketing ? 'granted' : 'denied',
      ad_personalization: marketing ? 'granted' : 'denied'
    });

    if (analytics) {
      loadGA(marketing);
    } else if (opts && opts.withdrawn) {
      clearAnalyticsCookies();
    }
    document.documentElement.setAttribute('data-consent-analytics', analytics ? '1' : '0');
  }

  /* ---------------- PII-safe event helper --------------------------- */
  var EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
  function safeLabel(str) {
    if (!str) return '';
    str = String(str).replace(/\s+/g, ' ').trim();
    if (EMAIL.test(str)) return '[redacted]';      // never send an address
    return str.slice(0, 80);
  }
  function track(name, params) {
    if (!gaLoaded) return;                          // no consent, no event
    try { gtag('event', name, params || {}); } catch (e) {}
  }
  window.auraTrack = track;                         // available for custom calls

  /* ---------------- automatic, non-personal event tracking ---------- */
  function initEventTracking() {
    document.addEventListener('click', function (ev) {
      var el = ev.target.closest && ev.target.closest('a, button');
      if (!el || !gaLoaded) return;

      var href = el.getAttribute('href') || '';
      var label = safeLabel(el.getAttribute('data-ga-label') || el.textContent);
      var custom = el.getAttribute('data-ga-event');

      if (custom) { track(custom, { label: label }); return; }

      // Downloads (PDF / ZIP)
      var dl = href.match(/\/([^\/?#]+\.(pdf|zip|xlsx|csv))(?:[?#]|$)/i);
      if (dl) {
        track('file_download', { file_name: dl[1].slice(0, 100), file_extension: dl[2].toLowerCase() });
        return;
      }
      // Inquiries — record that contact happened, never the address
      if (/^mailto:/i.test(href)) { track('inquiry', { method: 'email' }); return; }
      if (/^tel:/i.test(href))    { track('inquiry', { method: 'phone' }); return; }

      // Sign-up / beta access intent
      if (/testflight\.apple\.com/i.test(href) || /^(access now|get now|join|sign up|back now)$/i.test(label)) {
        track('signup_intent', { label: label });
        return;
      }
      // Outbound links — domain only, never the full query string
      if (/^https?:\/\//i.test(href) && href.indexOf(location.hostname) === -1) {
        var host = '';
        try { host = new URL(href).hostname; } catch (e) {}
        track('outbound_click', { destination: host, label: label });
        return;
      }
      // Primary CTAs on the site
      if (el.matches('.card-btn, .update-btn, .desktop-notify-btn, .announcement-cta, .btn, .btn-primary')) {
        track('cta_click', { label: label, page: location.pathname });
      }
    }, true);

    // Form submissions — that one happened, never its contents
    document.addEventListener('submit', function (ev) {
      if (!gaLoaded) return;
      var f = ev.target;
      track('form_submit', { form_id: safeLabel(f.getAttribute('id') || f.getAttribute('name') || 'form') });
    }, true);
  }

  /* ---------------- UI: "Manage cookies" link + popup -------------- */
  var hostEl = null, panelEl = null, modalEl = null, lastFocus = null;

  function h(tag, attrs, html) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (html != null) e.innerHTML = html;
    return e;
  }

  function buildWidget() {
    if (hostEl) return hostEl;

    hostEl = h('span', { class: 'acw-host' },
      '<button type="button" class="announcement-cta acw-trigger" aria-expanded="false" aria-controls="acw-panel">Manage cookies &rsaquo;</button>' +
      '<div class="acw-panel" id="acw-panel" role="dialog" aria-label="Cookie consent">' +
        '<p class="acw-text">We use cookies to keep the site working and, with your permission, to understand how visitors use it. ' +
        '<a href="privacy-policy.html#cookies" class="acw-link">Cookie policy</a></p>' +
        '<div class="acw-actions">' +
          '<button type="button" class="acb-btn acb-btn-primary" data-act="accept">Accept all</button>' +
          '<button type="button" class="acb-btn acb-btn-outline" data-act="manage">Manage preferences</button>' +
          '<button type="button" class="acb-btn acb-btn-outline" data-act="reject">Reject non-essential</button>' +
        '</div>' +
      '</div>');

    // Sit next to "Get now" in the announcement bar so it scrolls away with it
    var bar = document.querySelector('.announcement-bar p');
    if (bar) { bar.appendChild(document.createTextNode(' ')); bar.appendChild(hostEl); }
    else { hostEl.classList.add('acw-host--floating'); document.body.appendChild(hostEl); }

    /* The announcement bar is faded on scroll (opacity < 1), which would create a
       stacking context and trap the popup behind the navbar — so the panel is
       moved onto <body>. It stays position:absolute, so it still scrolls away
       with the page rather than sticking to the viewport. */
    panelEl = hostEl.querySelector('.acw-panel');
    document.body.appendChild(panelEl);

    function onAction(e) {
      var t = e.target.closest && e.target.closest('[data-act], .acw-trigger');
      if (!t) return;
      if (t.classList.contains('acw-trigger')) { togglePanel(); return; }
      var a = t.getAttribute('data-act');
      var prev = readConsent();
      if (a === 'accept') { applyConsent(writeConsent(true, true)); closePanel(); }
      if (a === 'reject') {
        applyConsent(writeConsent(false, false), { withdrawn: !!(prev && prev.analytics) });
        closePanel();
      }
      if (a === 'manage') { closePanel(); openModal(); }
    }
    hostEl.addEventListener('click', onAction);
    panelEl.addEventListener('click', onAction);

    return hostEl;
  }

  var openScrollY = 0;
  function currentScrollY() {
    return window.pageYOffset || document.documentElement.scrollTop || 0;
  }

  function positionPanel() {
    if (!hostEl || !panelEl) return;
    var trig = hostEl.querySelector('.acw-trigger');
    if (!trig) return;
    var r = trig.getBoundingClientRect();
    var sx = window.pageXOffset || 0, sy = currentScrollY();
    var w = panelEl.offsetWidth || 280;
    var left = r.left + sx + (r.width / 2) - (w / 2);
    var max = sx + document.documentElement.clientWidth - w - 12;
    left = Math.max(sx + 12, Math.min(left, max));
    panelEl.style.top = Math.round(r.bottom + sy + 12) + 'px';
    panelEl.style.left = Math.round(left) + 'px';
  }

  function openPanel() {
    if (!hostEl) return;
    positionPanel();
    panelEl.classList.add('is-open');
    var b = hostEl.querySelector('.acw-trigger');
    if (b) b.setAttribute('aria-expanded', 'true');
    openScrollY = currentScrollY();
    window.addEventListener('resize', positionPanel);
    document.addEventListener('keydown', onPanelKey, true);
    window.addEventListener('scroll', onScrollDismiss, { passive: true });
    setTimeout(function () { document.addEventListener('click', onOutsideClick, true); }, 0);
  }

  /* scrolling away dismisses the popup */
  function onScrollDismiss() {
    if (!panelEl || !panelEl.classList.contains('is-open')) return;
    if (Math.abs(currentScrollY() - openScrollY) > 8) closePanel();
  }

  function closePanel() {
    if (!hostEl) return;
    if (panelEl) panelEl.classList.remove('is-open');
    var b = hostEl.querySelector('.acw-trigger');
    if (b) b.setAttribute('aria-expanded', 'false');
    window.removeEventListener('resize', positionPanel);
    document.removeEventListener('keydown', onPanelKey, true);
    document.removeEventListener('click', onOutsideClick, true);
    window.removeEventListener('scroll', onScrollDismiss);
  }

  function togglePanel() {
    if (!hostEl) return;
    (panelEl && panelEl.classList.contains('is-open')) ? closePanel() : openPanel();
  }

  function onPanelKey(e) {
    if (e.key === 'Escape' && panelEl && panelEl.classList.contains('is-open')) {
      e.preventDefault(); closePanel();
      var b = hostEl.querySelector('.acw-trigger'); if (b) b.focus();
    }
  }
  function onOutsideClick(e) {
    if (hostEl && !hostEl.contains(e.target) && panelEl && !panelEl.contains(e.target)) closePanel();
  }

  /* scroll back to the top, then reveal the popup (used by the footer link) */
  function scrollTopThenOpen() {
    var atTop = (window.pageYOffset || document.documentElement.scrollTop || 0) < 8;
    if (window.lenis && typeof window.lenis.scrollTo === 'function') {
      window.lenis.scrollTo(0, { duration: 0.9 });
    } else {
      try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, 0); }
    }
    buildWidget();
    setTimeout(openPanel, atTop ? 60 : 780);
  }

  function markDecided() { /* the link stays available; nothing to flag */ }

  function row(id, title, desc, checked, locked) {
    return '<div class="acm-row">' +
      '<div class="acm-row-text"><span class="acm-row-title">' + title + '</span>' +
      '<span class="acm-row-desc">' + desc + '</span></div>' +
      '<label class="acm-switch' + (locked ? ' is-locked' : '') + '">' +
        '<input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') +
        (locked ? ' disabled aria-disabled="true"' : '') + ' />' +
        '<span class="acm-slider" aria-hidden="true"></span>' +
        '<span class="acm-sr">' + title + '</span>' +
      '</label></div>';
  }

  function openModal() {
    var c = readConsent() || { analytics: false, marketing: false };
    lastFocus = document.activeElement;

    modalEl = h('div', { id: 'aura-cookie-modal', class: 'acm-overlay' },
      '<div class="acm-dialog" role="dialog" aria-modal="true" aria-labelledby="acm-title" aria-describedby="acm-desc">' +
        '<h2 id="acm-title" class="acm-title">Cookie preferences</h2>' +
        '<p id="acm-desc" class="acm-desc">Choose which cookies we may use. Essential cookies keep the site working and cannot be turned off. ' +
        'You can change these choices at any time from “Manage cookies” at the top of the page, or “Cookie Settings” in the footer.</p>' +
        row('acm-essential', 'Essential', 'Required for the site to function — security and your cookie choice. Always on.', true, true) +
        row('acm-analytics', 'Analytics', 'Google Analytics, so we can see which pages are useful and improve them. Nothing is loaded until you allow it.', !!c.analytics, false) +
        row('acm-marketing', 'Marketing', 'Would allow measuring campaign performance. We do not run advertising cookies today.', !!c.marketing, false) +
        '<div class="acm-actions">' +
          '<button type="button" class="acb-btn acb-btn-ghost" data-act="reject">Reject non-essential</button>' +
          '<button type="button" class="acb-btn acb-btn-ghost" data-act="save">Save preferences</button>' +
          '<button type="button" class="acb-btn acb-btn-primary" data-act="accept">Accept all</button>' +
        '</div>' +
        '<button type="button" class="acm-close" data-act="close" aria-label="Close cookie preferences">&times;</button>' +
      '</div>');

    modalEl.addEventListener('click', function (e) {
      if (e.target === modalEl) return closeModal();
      var b = e.target.closest('[data-act]'); if (!b) return;
      var a = b.getAttribute('data-act');
      var prev = readConsent();
      if (a === 'close') return closeModal();
      if (a === 'accept') applyConsent(writeConsent(true, true));
      if (a === 'reject') applyConsent(writeConsent(false, false), { withdrawn: !!(prev && prev.analytics) });
      if (a === 'save') {
        var an = document.getElementById('acm-analytics').checked;
        var mk = document.getElementById('acm-marketing').checked;
        applyConsent(writeConsent(an, mk), { withdrawn: !!(prev && prev.analytics) && !an });
      }
      closeModal();
    });

    document.addEventListener('keydown', onKeydown, true);
    document.body.appendChild(modalEl);
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(function () {
      modalEl.classList.add('is-visible');
      var f = modalEl.querySelector('#acm-analytics'); if (f) f.focus();
    });
  }

  function onKeydown(e) {
    if (!modalEl) return;
    if (e.key === 'Escape') { e.preventDefault(); return closeModal(); }
    if (e.key !== 'Tab') return;
    var f = modalEl.querySelectorAll('button, input:not([disabled]), a[href]');
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function closeModal() {
    if (!modalEl) return;
    document.removeEventListener('keydown', onKeydown, true);
    modalEl.classList.remove('is-visible');
    document.body.style.overflow = '';
    var el = modalEl; modalEl = null;
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 200);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  window.auraOpenCookieSettings = scrollTopThenOpen;

  /* ---------------- footer "Cookie Settings" link ------------------- */
  function injectFooterLink() {
    var legal = document.querySelector('.sfl-legal');
    if (!legal || legal.querySelector('[data-cookie-settings]')) return;
    var b = h('button', {
      type: 'button',
      class: 'sfl-link acb-footer-link',
      'data-cookie-settings': '1'
    }, 'Cookie Settings &rsaquo;');
    b.addEventListener('click', scrollTopThenOpen);
    legal.appendChild(b);
  }

  /* ---------------- boot -------------------------------------------- */
  function init() {
    injectFooterLink();
    initEventTracking();
    buildWidget();
    var c = readConsent();
    if (c) {
      applyConsent(c);
    } else {
      // first visit: reveal the notice next to the announcement bar
      setTimeout(function () { if (!readConsent()) openPanel(); }, 600);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
