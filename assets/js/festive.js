/* Festive season layer for adarna.us (Christmas 2026). Opt in per page with festive.css + this file.
   Adds: falling snow (canvas), a twinkling light garland under the nav, snow caps and hanging ornaments
   on the home cards, a snowy-hills scene above the footer and a snow on/off switch.
   It switches itself off after the season (END), with ?festive=off, or when the visitor turns snow off
   (remembered in localStorage). Reduced-motion visitors get the decorations but no falling snow or twinkle.
   Everything is aria-hidden decoration; nothing here changes the page's content or layout. */
(function () {
  'use strict';
  var END = new Date('2027-01-07T00:00:00');
  var KEY = 'adarna.festive.snow';
  try {
    if (new Date() >= END || /[?&]festive=off\b/.test(location.search)) return;
  } catch (_) { return; }

  var root = document.documentElement;
  var dark = function () { return document.body && document.body.classList.contains('at-dark'); };
  root.classList.add('festive');
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var NS = 'http://www.w3.org/2000/svg';

  function store(get, val) {
    try { return get ? localStorage.getItem(KEY) : localStorage.setItem(KEY, val); } catch (_) { return null; }
  }
  function svg(tag, attrs) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }
  function deco(cls, html) {
    var s = document.createElement('span');
    s.className = cls;
    s.setAttribute('aria-hidden', 'true');
    if (html) s.innerHTML = html;
    return s;
  }

  /* ---------- fairy lights across the full top of the page ----------
     One colour (warm gold), small glowing bulbs on a thin wire in long, shallow swags. The shimmer
     runs across the row from left to right, so it reads as one calm line rather than a busy string. */
  function garland() {
    var box = deco('festive-garland');
    document.body.appendChild(box);
    var draw = function () {
      var w = window.innerWidth;
      if (!w || box.dataset.w === String(w)) return;
      box.dataset.w = String(w);
      var period = w < 600 ? 125 : 190, depth = w < 600 ? 5 : 7, gap = w < 600 ? 22 : 28, h = 20;
      var n = Math.max(2, Math.round(w / period));
      var step = w / n;
      var s = svg('svg', { width: w, height: h, viewBox: '0 0 ' + w + ' ' + h });
      var d = 'M0 2';
      for (var i = 0; i < n; i++) d += ' Q' + (i * step + step / 2) + ' ' + (2 + depth * 2) + ' ' + ((i + 1) * step) + ' 2';
      s.appendChild(svg('path', { d: d, class: 'festive-wire' }));
      var per = Math.max(3, Math.round(step / gap));
      for (var j = 0; j < n; j++) {
        for (var q = 1; q < per; q++) {
          var t = q / per;
          var x = j * step + step * t;
          var y = 2 + 2 * (1 - t) * t * depth * 2;
          var c = svg('circle', { cx: x.toFixed(1), cy: (y + 3).toFixed(1), r: 2.9, class: 'festive-fairy' });
          c.style.animationDelay = ((x / w) * 3).toFixed(2) + 's';
          s.appendChild(c);
        }
      }
      box.replaceChildren(s);
    };
    draw();
    window.addEventListener('resize', draw);
  }

  /* ---------- Santa's sleigh, flying across now and then ---------- */
  var SLEIGH = '<svg viewBox="0 0 220 64">' +
    '<g class="festive-deer"><path d="M8 34c6-6 18-7 26-3l6-8 3 2-4 9c2 3 1 6-2 8l2 12h-3l-3-10c-6 2-14 2-19 0l-3 10h-3l2-11c-3-2-4-6-2-9Z"/>' +
    '<path d="M38 22l-3-9m3 9 4-8m-6 1-4-3m6 3 3-5" class="festive-antler"/></g>' +
    '<g class="festive-deer" transform="translate(46 0)"><path d="M8 34c6-6 18-7 26-3l6-8 3 2-4 9c2 3 1 6-2 8l2 12h-3l-3-10c-6 2-14 2-19 0l-3 10h-3l2-11c-3-2-4-6-2-9Z"/>' +
    '<path d="M38 22l-3-9m3 9 4-8m-6 1-4-3m6 3 3-5" class="festive-antler"/><circle cx="43" cy="27" r="2.2" fill="#e53935"/></g>' +
    '<path d="M80 34c14 2 28 4 44 4" class="festive-rein"/>' +
    '<path d="M122 52h70c6 0 10-4 12-8" class="festive-runner"/>' +
    '<path d="M126 30h48l8 18h-52Z" fill="#c62828"/><path d="M126 30h48" stroke="#f6b93b" stroke-width="2.5"/>' +
    '<path d="M168 30c0-10 4-16 12-16 6 0 10 6 10 16Z" fill="#8a5a3b"/>' +
    '<circle cx="150" cy="22" r="8" fill="#e53935"/><circle cx="150" cy="18" r="4.6" fill="#f2c9a5"/>' +
    '<path d="M145 20c1 6 9 6 10 0Z" fill="#fff"/><path d="M145 15l5-9 6 8Z" fill="#e53935"/><circle cx="156" cy="14" r="2" fill="#fff"/>' +
    '</svg>';
  function sleigh() {
    if (reduced) return;
    var el = deco('festive-sleigh', SLEIGH);
    document.body.appendChild(el);
    var fly = function () {
      if (document.hidden || root.classList.contains('festive-snow-off')) { setTimeout(fly, 8000); return; }
      el.style.top = (12 + Math.random() * 22) + 'vh';
      el.classList.remove('is-flying');
      void el.offsetWidth;
      el.classList.add('is-flying');
      setTimeout(fly, 30000 + Math.random() * 25000);
    };
    setTimeout(fly, 3500);
  }

  /* A lumpy snow cap with a few icicles, drawn at the card's real width so nothing stretches. */
  function rng(seed) { return function () { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }
  function capSvg(w, seed) {
    var r = rng(seed), h = 34, d = 'M0 0H' + w + 'V' + (8 + r() * 4).toFixed(1), x = w;
    while (x > 0) {
      if (r() < 0.12 && x > 30 && x < w - 30) {           // an icicle
        var iw = 5 + r() * 5, il = 16 + r() * 14;
        d += 'L' + (x - iw * 0.2).toFixed(1) + ' 10Q' + (x - iw / 2).toFixed(1) + ' ' + il.toFixed(1) + ' ' + (x - iw).toFixed(1) + ' 10';
        x -= iw;
        continue;
      }
      var bw = 26 + r() * 54, depth = 9 + r() * 9, nx = Math.max(0, x - bw);
      d += 'Q' + ((x + nx) / 2).toFixed(1) + ' ' + (depth * 1.6).toFixed(1) + ' ' + nx.toFixed(1) + ' ' + (7 + r() * 5).toFixed(1);
      x = nx;
    }
    d += 'Z';
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '"><path d="' + d + '"/>' +
      '<path class="festive-cap-sheen" d="M0 3H' + w + '"/></svg>';
  }
  var BAUBLES = '<svg viewBox="0 0 120 120">' +
    '<path class="festive-sprig" d="M6 6c18 6 34 6 52 2 14-3 30-2 50 6"/>' +
    '<g class="festive-swing" style="--d:0s"><line x1="30" y1="8" x2="30" y2="52"/><circle cx="30" cy="62" r="11" fill="#e53935"/><rect x="26" y="49" width="8" height="5" rx="1.5" fill="#c9a24a"/><path d="M23 58a8 8 0 0 1 6-5" class="festive-shine"/></g>' +
    '<g class="festive-swing" style="--d:-1.1s"><line x1="62" y1="7" x2="62" y2="30"/><circle cx="62" cy="39" r="8.5" fill="#f6b93b"/><rect x="58.5" y="28" width="7" height="4.5" rx="1.5" fill="#c9a24a"/><path d="M57 36a6 6 0 0 1 4.5-4" class="festive-shine"/></g>' +
    '<g class="festive-swing" style="--d:-2.2s"><line x1="92" y1="10" x2="92" y2="64"/><circle cx="92" cy="75" r="12.5" fill="#2e9e5b"/><rect x="87.5" y="60" width="9" height="5.5" rx="1.5" fill="#c9a24a"/><path d="M84 70a9 9 0 0 1 7-6" class="festive-shine"/></g>' +
    '</svg>';
  var HOLLY = '<svg viewBox="0 0 90 60">' +
    '<path fill="#2f7d4f" d="M44 30C34 16 22 14 8 18c6 4 4 9 9 11-5 3-3 8 0 11 12 2 21-2 27-10Z"/>' +
    '<path fill="#3a9460" d="M46 30c10-14 22-16 36-12-6 4-4 9-9 11 5 3 3 8 0 11-12 2-21-2-27-10Z"/>' +
    '<circle cx="40" cy="34" r="5.5" fill="#d62828"/><circle cx="50" cy="35" r="5.5" fill="#e53935"/><circle cx="45" cy="26" r="5.5" fill="#c1121f"/>' +
    '<circle cx="43.5" cy="24.5" r="1.4" fill="#fff" opacity=".7"/></svg>';

  /* Snow caps go on the home cards, or, on other pages, on the site's big rounded grey cards (found by
     their look, so every page template gets them without per-page markup). The first card gets hanging
     baubles and the second a sprig of holly; the rest only snow, so the decoration stays light. */
  var CARD_GREY = ['rgb(244, 245, 245)', 'rgb(245, 245, 247)'];
  function findCards() {
    var home = document.querySelectorAll('.home-card, [data-festive-card]');
    if (home.length) return { list: Array.prototype.slice.call(home), home: true };
    var out = [];
    var all = document.querySelectorAll('body div, body section, body article, body header, body a');
    var minW = Math.min(500, window.innerWidth - 80);
    for (var i = 0; i < all.length && out.length < 10; i++) {
      var el = all[i];
      if (el.offsetWidth < minW || el.offsetHeight < 200) continue;
      if (el.closest('.festive-scene, footer, nav, .navbar, .site-footer, .m-sheet')) continue;
      var cs = getComputedStyle(el);
      if (CARD_GREY.indexOf(cs.backgroundColor) < 0 || parseFloat(cs.borderTopLeftRadius) < 14) continue;
      if (out.some(function (o) { return o.contains(el); })) continue;
      out.push(el);
    }
    return { list: out, home: false };
  }
  function cards() {
    var found = findCards();
    found.list.forEach(function (c, i) {
      var cs = getComputedStyle(c);
      if (cs.position === 'static') c.style.position = 'relative';
      var cap = deco('festive-snowcap');
      cap.style.borderTopLeftRadius = cs.borderTopLeftRadius;
      cap.style.borderTopRightRadius = cs.borderTopRightRadius;
      c.appendChild(cap);
      var seed = 1234 + i * 977;
      var paint = function () {
        var w = Math.round(c.getBoundingClientRect().width);
        if (w && cap.dataset.w !== String(w)) { cap.dataset.w = String(w); cap.innerHTML = capSvg(w, seed); }
      };
      paint();
      if ('ResizeObserver' in window) new ResizeObserver(paint).observe(c);
      var which = found.home ? i % 3 : i;
      if (which === 0) c.appendChild(deco('festive-baubles festive-right', BAUBLES));
      else if (which === 1) c.appendChild(deco('festive-holly festive-left', HOLLY));
      else if (which === 2 && found.home) c.appendChild(deco('festive-baubles festive-left', BAUBLES));
    });
  }

  /* ---------- a small winter scene above the footer ---------- */
  function tree(x, s) {
    return '<g transform="translate(' + x + ' 0) scale(' + s + ')">' +
      '<rect x="-3" y="88" width="6" height="10" fill="#7a5233"/>' +
      '<path d="M0 22 26 90H-26Z" fill="#2f6b45"/><path d="M0 8 20 58H-20Z" fill="#3d8558"/>' +
      '<path d="M0 8 7 26c-3-2-5 1-7-1-2 2-4-1-7 1Z" fill="#fff"/><path d="M-14 44c5 2 9-1 14 1 5-2 9 1 14-1l4 10H-18Z" fill="#fff" opacity=".9"/>' +
      '<path class="festive-star" d="M0 0l2.4 5 5.4.6-4 3.7 1.1 5.3L0 12l-4.9 2.6 1.1-5.3-4-3.7 5.4-.6Z" fill="#f6b93b"/></g>';
  }
  function gift(x, y, w, h, color, ribbon) {
    return '<g transform="translate(' + x + ' ' + y + ')"><rect width="' + w + '" height="' + h + '" rx="2" fill="' + color + '"/>' +
      '<rect x="' + (w / 2 - 2.5) + '" width="5" height="' + h + '" fill="' + ribbon + '"/><rect y="' + (h / 3) + '" width="' + w + '" height="4" fill="' + ribbon + '"/>' +
      '<path d="M' + (w / 2) + ' 0c-6-8-14-6-10 0Zm0 0c6-8 14-6 10 0Z" fill="' + ribbon + '"/></g>';
  }
  function snowman(x, base) {
    return '<g class="festive-snowman" transform="translate(' + x + ' ' + base + ')">' +
      '<circle cy="-14" r="15" class="festive-snowball"/><circle cy="-38" r="11" class="festive-snowball"/>' +
      '<path d="M-10 -30h20l-2 5h-16Z" fill="#e53935"/><path d="M5 -28l4 12h-5l-2-11Z" fill="#c62828"/>' +
      '<circle cx="-3.5" cy="-41" r="1.3" fill="#2b2b2b"/><circle cx="3.5" cy="-41" r="1.3" fill="#2b2b2b"/>' +
      '<path d="M0 -38l8 2-8 1.5Z" fill="#f08c2e"/>' +
      '<circle cy="-18" r="1.4" fill="#2b2b2b"/><circle cy="-11" r="1.4" fill="#2b2b2b"/>' +
      '<path d="M-12 -52h24v3h-24Z M-7 -64h14v12h-14Z" fill="#2b2b2b"/></g>';
  }
  function scene() {
    var footer = document.querySelector('[data-festive-scene], .home-about, .at-about, footer.footer-legal-section');
    if (!footer) return;
    var wrap = document.createElement('div');
    wrap.className = 'festive-scene';
    wrap.innerHTML =
      '<p class="festive-greeting">Happy holidays from all of us at Adarna</p>' +
      '<svg viewBox="0 0 1100 120" preserveAspectRatio="xMidYMax meet" aria-hidden="true">' +
      tree(150, 0.72) + tree(196, 0.5) + tree(905, 0.8) + tree(955, 0.55) +
      '<path class="festive-hill festive-hill-back" d="M0 104C140 82 260 86 380 98s220 6 330-6 250-12 390 8v16H0Z"/>' +
      '<path class="festive-hill" d="M0 110c120-12 230-10 340-2 130 9 230 8 360-2 140-11 260-6 400 6v8H0Z"/>' +
      gift(226, 79, 30, 24, '#e53935', '#f6d365') + gift(259, 87, 22, 16, '#2f80ed', '#ffffff') + gift(840, 82, 26, 20, '#2e9e5b', '#e53935') +
      snowman(330, 100) +
      '</svg>';
    footer.parentNode.insertBefore(wrap, footer);
  }

  /* ---------- small touches ---------- */
  function touches() {
    var bar = document.querySelector('.announcement-bar p');
    if (bar) bar.insertBefore(deco('festive-flake-icon', '<svg viewBox="0 0 24 24"><path d="M12 2v20M4.9 6.5l14.2 11M4.9 17.5l14.2-11M9.5 3.5 12 6l2.5-2.5M9.5 20.5 12 18l2.5 2.5M3 10l3.3 1.2L5 14.4M21 10l-3.3 1.2 1.3 3.2"/></svg>'), bar.firstChild);
  }

  /* ---------- falling snow ---------- */
  var canvas, ctx, flakes = [], raf = 0, running = false, W = 0, H = 0, dpr = 1;
  function sizeCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var want = Math.round(Math.min(110, Math.max(28, (W * H) / 14000)));
    while (flakes.length < want) flakes.push(newFlake(true));
    flakes.length = want;
  }
  function newFlake(anywhere) {
    var crystal = Math.random() < 0.16;
    var r = crystal ? 4.5 + Math.random() * 4 : 1.6 + Math.random() * 2.6;
    return {
      x: Math.random() * W, y: anywhere ? Math.random() * H : -10,
      r: r, crystal: crystal, vy: 0.25 + r * 0.17 + Math.random() * 0.3,
      sway: Math.random() * Math.PI * 2, swaySpeed: 0.005 + Math.random() * 0.012, swayAmp: 0.3 + Math.random() * 0.7,
      rot: Math.random() * Math.PI, spin: (Math.random() - 0.5) * 0.01, a: 0.7 + Math.random() * 0.3,
    };
  }
  function drawFlake(f) {
    ctx.globalAlpha = f.a;
    if (!f.crystal) {
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r + 1.2, 0, 6.283); ctx.fillStyle = isDark ? 'rgba(255,255,255,0.18)' : 'rgba(112,138,176,0.42)'; ctx.fill();
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 6.283); ctx.fillStyle = '#ffffff'; ctx.fill();
      return;
    }
    ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.rot);
    ctx.strokeStyle = isDark ? 'rgba(235,242,255,0.9)' : 'rgba(96,128,172,0.9)'; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
    for (var i = 0; i < 6; i++) {
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -f.r);
      ctx.moveTo(0, -f.r * 0.55); ctx.lineTo(f.r * 0.3, -f.r * 0.8);
      ctx.moveTo(0, -f.r * 0.55); ctx.lineTo(-f.r * 0.3, -f.r * 0.8);
      ctx.stroke(); ctx.rotate(Math.PI / 3);
    }
    ctx.restore();
  }
  var t0 = 0, wind = 0, isDark = false;
  function frame(ts) {
    ctx.clearRect(0, 0, W, H);
    // nothing falls while the Attention Test is running: it must not distract from the test
    if (document.body.classList.contains('at-testing')) { raf = requestAnimationFrame(frame); return; }
    // a slow breeze that now and then picks up and pushes the snow sideways
    t0 = ts || 0;
    wind = Math.sin(t0 / 9000) * 0.35 + Math.max(0, Math.sin(t0 / 3100)) * Math.max(0, Math.sin(t0 / 23000)) * 1.6;
    for (var i = 0; i < flakes.length; i++) {
      var f = flakes[i];
      f.sway += f.swaySpeed; f.rot += f.spin;
      f.y += f.vy; f.x += Math.sin(f.sway) * f.swayAmp + wind * (0.5 + f.r / 6);
      if (f.y > H + 10 || f.x < -30 || f.x > W + 30) { flakes[i] = newFlake(false); if (wind > 0.8 && Math.random() < 0.5) { flakes[i].x = -10; flakes[i].y = Math.random() * H; } continue; }
      drawFlake(f);
    }
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(frame);
  }
  function startSnow() {
    if (running || reduced) return;
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.className = 'festive-snow';
      canvas.setAttribute('aria-hidden', 'true');
      document.body.appendChild(canvas);
      ctx = canvas.getContext('2d');
      window.addEventListener('resize', function () { if (running) sizeCanvas(); });
    }
    canvas.hidden = false;
    isDark = dark();
    sizeCanvas();
    running = true;
    raf = requestAnimationFrame(frame);
  }
  function stopSnow() {
    running = false;
    cancelAnimationFrame(raf);
    if (canvas) { ctx.clearRect(0, 0, W, H); canvas.hidden = true; }
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { cancelAnimationFrame(raf); }
    else if (running) { raf = requestAnimationFrame(frame); }
  });

  /* ---------- snow on/off switch ---------- */
  function toggle() {
    if (reduced) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'festive-toggle';
    b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v20M4.9 6.5l14.2 11M4.9 17.5l14.2-11M9.5 3.5 12 6l2.5-2.5M9.5 20.5 12 18l2.5 2.5"/></svg>';
    var set = function (on) {
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.setAttribute('aria-label', on ? 'Turn snow off' : 'Turn snow on');
      b.title = on ? 'Turn snow off' : 'Turn snow on';
      root.classList.toggle('festive-snow-off', !on);
      if (on) startSnow(); else stopSnow();
    };
    b.addEventListener('click', function () {
      var on = b.getAttribute('aria-pressed') !== 'true';
      store(false, on ? 'on' : 'off');
      set(on);
    });
    document.body.appendChild(b);
    set(store(true) !== 'off');
  }

  function buttons() {
    var list = document.querySelectorAll('.card-btn, [data-festive-btn]');
    for (var i = 0; i < list.length; i++) list[i].classList.add('festive-btn-snow');
  }

  function init() {
    garland(); cards(); scene(); touches(); buttons(); toggle(); sleigh();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
