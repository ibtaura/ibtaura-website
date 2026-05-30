
// ── Universal: Navbar glass fade + announcement bar fade ──
// Uses requestAnimationFrame for reliable mobile Safari support
(function() {
  var navbar = document.querySelector('.navbar');
  var announcement = document.querySelector('.announcement-bar');
  if (!navbar) return;

  var lastScrollY = -1;

  function updateNavbar() {
    var scrollY = window.scrollY || window.pageYOffset || 0;

    /* Only update DOM when scroll position actually changed */
    if (scrollY !== lastScrollY) {
      lastScrollY = scrollY;

      /* Fade out announcement bar */
      if (announcement) {
        announcement.style.opacity = 1 - Math.min(scrollY / 80, 1);
      }

      /* Navbar: solid → glass on scroll */
      if (scrollY > 30) {
        navbar.classList.add('scrolled');
      } else {
        navbar.classList.remove('scrolled');
      }
    }

    requestAnimationFrame(updateNavbar);
  }

  requestAnimationFrame(updateNavbar);
})();

// ── About page: hero video parallax ──────────────────────
// Uses rAF for reliable mobile Safari support
const heroVideo = document.getElementById('aboutHeroVideo');
if (heroVideo) {
  let lastParallaxY = -1;
  function updateParallax() {
    const scrolled = window.scrollY || window.pageYOffset || 0;
    if (scrolled !== lastParallaxY) {
      lastParallaxY = scrolled;
      heroVideo.style.transform = `translateY(${scrolled * 0.4}px)`;
    }
    requestAnimationFrame(updateParallax);
  }
  requestAnimationFrame(updateParallax);
}

// ── About page: word-by-word scroll reveal ────────────────
// Uses rAF for reliable mobile Safari support
const revealText = document.getElementById('aboutRevealText');

if (revealText) {
  const sentence = "We build products that make real health possible for real people. Rooted in care, precision, and purpose designed for the lives we actually live.";
  const words = sentence.split(' ');

  revealText.innerHTML = words
    .map(w => `<span class="reveal-word">${w}</span>`)
    .join(' ');

  const spans = revealText.querySelectorAll('.reveal-word');
  const section = revealText.closest('.about-reveal-section');
  let lastRevealY = -1;

  function updateReveal() {
    const scrollY = window.scrollY || window.pageYOffset || 0;
    if (scrollY !== lastRevealY) {
      lastRevealY = scrollY;

      const rect   = section.getBoundingClientRect();
      const start  = window.innerHeight * 0.75;
      const end    = -section.offsetHeight * 0.3;
      const total  = start - end;
      const progress = Math.max(0, Math.min(1, (start - rect.top) / total));

      const revealed = Math.floor(progress * spans.length);

      spans.forEach((span, i) => {
        if (i < revealed) {
          span.style.color = '#000';
        } else if (i === revealed) {
          const wordProgress = (progress * spans.length) - revealed;
          const gray = Math.round(204 - 204 * wordProgress);
          span.style.color = `rgb(${gray}, ${gray}, ${gray})`;
        } else {
          span.style.color = '#ccc';
        }
      });
    }
    requestAnimationFrame(updateReveal);
  }
  requestAnimationFrame(updateReveal);
}



// ── Documents: permission modal ───────────────────────────
function showDocPermission() {
  const modal = document.getElementById('docModal');
  if (modal) modal.classList.add('visible');
}

function hideDocPermission() {
  const modal = document.getElementById('docModal');
  if (modal) modal.classList.remove('visible');
}

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') { hideDocPermission(); closeValuePopup(); }
});

// ── Value cards popup ──────────────────────────────────────
var valueContent = {
  care: {
    title: 'Genuine Care',
    body: [
      'We care deeply about every person who uses our product — not because it is good for business, but because it is the right thing to do. Most companies treat care as a department. We treat it as a mindset.',
      'We do not chase vanity metrics. We chase meaning. Every feature we build, every line of code we write, is guided by one question: does this truly help someone? If the answer is no, we do not build it.',
      'Care without agenda is rare in the technology industry. Companies often perform care as a marketing strategy — as something to say, not something to live. We have chosen to make genuine care our default operating mode, embedded in how we hire, how we build, and how we serve every person who puts their trust in us.'
    ]
  },
  health: {
    title: 'Health for All',
    body: [
      'Health should never be a privilege. It should not depend on where you were born, how much money you have, what language you speak, or what kind of home you live in. Health is a human right — and we are building technology that treats it that way.',
      'We are building a product that works for a student in a small town just as well as it works for an executive in a city. No barriers. No gatekeeping. No premium tier for the people who already have everything.',
      'Every design decision we make is tested against this belief. If a feature is only useful to someone wealthy, we rethink it. If an interface is only accessible to someone educated, we redesign it. Health for all is not a tagline. It is a constraint we build within — every single day.'
    ]
  },
  soul: {
    title: 'Body & Soul',
    body: [
      'We believe health is not just physical. A person can have a perfect resting heart rate and still feel completely lost inside. True health means your body is strong and your soul is at peace. We take both seriously.',
      'The health industry has spent decades focused almost entirely on the physical — calories, steps, heart rate, sleep cycles. These things matter. But they are only half the picture. The other half is invisible to most devices, and that is exactly where we are going.',
      'We are not just building a wearable. We are building a companion for the whole human being — one that recognises that what you feel inside is just as important as what your sensors measure on the outside. When you care for your body and your soul together, that is when you truly thrive.'
    ]
  },
  unity: {
    title: 'Unity',
    body: [
      'We do not believe in internal competition. We do not believe in politics, hierarchy for its own sake, or the kind of culture where someone has to lose for someone else to win. That is not how we operate.',
      'We grow as one team, one family. When one person wins, we all win. When one person struggles, we all show up. This is not a motivational poster on a wall — it is how we actually make decisions, how we resolve disagreements, and how we treat each other on difficult days.',
      'From our first five employees to our future five thousand, this culture will not change. We will protect it actively — by hiring people who share it, by calling out behaviour that violates it, and by building systems that reinforce it. Unity is not a value we aspire to. It is a value we live.'
    ]
  },
  purpose: {
    title: 'Purpose First',
    body: [
      'We did not start this company to get rich. We started it because we genuinely believe the world needs what we are building, and that if we do not build it with the right intention, someone else will build it with the wrong one.',
      'That purpose keeps us honest. It keeps us from cutting corners when no one is watching. It keeps us from building things just because they are profitable. It keeps us from saying yes to partnerships that would compromise who we are.',
      'Every product decision, every hire, every investor conversation, every press release is evaluated through one lens — does this serve our purpose, or does it compromise it? Purpose is not our tagline. It is our filter. And we guard it fiercely.'
    ]
  },
  consistency: {
    title: 'Consistency',
    body: [
      'Your body never takes a day off. Your heart beats whether you are happy or sad, awake or asleep, celebrated or forgotten. It shows up for you every single second of every single day — without recognition, without complaint.',
      'We take that same commitment seriously. We show up for our users every day, not just on launch day. We show up for our team during difficult quarters, not just when the numbers look good. We show up for our mission even when it is hard and unglamorous.',
      'Consistency is not exciting. It does not make headlines. But it is what builds trust — and trust is the only thing that lasts. It is what separates the companies that endure from the ones that burn brightly for a moment and then disappear.'
    ]
  },
  goodness: {
    title: 'Goodness',
    body: [
      'We believe that the most successful companies in the long run are not the cleverest, the fastest, or even the most innovative. They are the ones built on goodness. Not goodness as a strategy — but goodness as a genuine, practised way of being.',
      'We try to do the right thing even when no one is watching. We try to treat every person — user, employee, partner, or stranger — with dignity, honesty, and kindness. We try to be the kind of company that people feel good about supporting.',
      'Goodness is the foundation of a healthy life. It is also the foundation of everything we build. When our users live well, when our team thrives, when the world is a little better because we existed — that is when we will know we have succeeded.'
    ]
  }
};

(function () {
  document.querySelectorAll('.value-card').forEach(function (card) {
    card.addEventListener('click', function () {
      var key = card.getAttribute('data-value');
      var data = valueContent[key];
      if (!data) return;
      document.getElementById('valuePopupTitle').textContent = data.title;
      document.getElementById('valuePopupBody').innerHTML = data.body.map(function (p) {
        return '<p>' + p + '</p>';
      }).join('');
      document.getElementById('valuePopup').classList.add('active');
      document.body.style.overflow = 'hidden';
    });
  });
})();

function closeValuePopup() {
  document.getElementById('valuePopup').classList.remove('active');
  document.body.style.overflow = '';
}

// ── Scroll reveal: staggered items ───────────────────────
// Wait until page is fully laid out before attaching observer
window.addEventListener('load', function () {
  const groupObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const items = entry.target.querySelectorAll('.scroll-reveal-item');
      items.forEach((item, i) => {
        setTimeout(() => {
          item.classList.add('revealed');
        }, 200 + i * 280);
      });
      groupObserver.unobserve(entry.target);
    });
  }, {
    rootMargin: '-38% 0px -38% 0px',
    threshold: 0
  });

  document.querySelectorAll('.scroll-reveal-group').forEach(el => {
    groupObserver.observe(el);
  });
});

// ── FAQ accordion ────────────────────────────────────────
document.querySelectorAll('.faq-trigger').forEach(btn => {
  btn.addEventListener('click', () => {
    const item = btn.closest('.faq-item');
    const isOpen = item.classList.contains('open');
    document.querySelectorAll('.faq-item.open').forEach(i => i.classList.remove('open'));
    if (!isOpen) item.classList.add('open');
  });
});

// ── Values carousel: drag to scroll ──────────────────────
const valuesGrid = document.querySelector('.values-grid');
if (valuesGrid) {
  let isDown = false, startX, scrollLeft;
  valuesGrid.addEventListener('mousedown', e => {
    isDown = true;
    startX = e.pageX - valuesGrid.offsetLeft;
    scrollLeft = valuesGrid.scrollLeft;
  });
  valuesGrid.addEventListener('mouseleave', () => { isDown = false; });
  valuesGrid.addEventListener('mouseup', () => { isDown = false; });
  valuesGrid.addEventListener('mousemove', e => {
    if (!isDown) return;
    e.preventDefault();
    const x = e.pageX - valuesGrid.offsetLeft;
    valuesGrid.scrollLeft = scrollLeft - (x - startX) * 1.2;
  });
}

// ── Founder note: fade-in ─────────────────────────────────
const founderInner = document.querySelector('.founder-inner');

if (founderInner) {
  const obs = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        founderInner.classList.add('in-view');
        obs.disconnect();
      }
    });
  }, { threshold: 0.1 });
  obs.observe(founderInner);
}

// Active nav link on scroll
const sections = document.querySelectorAll('section[id]');
const navLinks  = document.querySelectorAll('.nav-link');

const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const id = entry.target.getAttribute('id');
      navLinks.forEach(link => {
        link.classList.toggle('active', link.getAttribute('href') === `#${id}`);
      });
    }
  });
}, { threshold: 0.5 });

sections.forEach(s => observer.observe(s));

// ── Preorder Modal ────────────────────────────────────────
const preorderModal  = document.getElementById('preorder-modal');
const openPreorder   = document.getElementById('open-preorder');
const closePreorder  = document.getElementById('close-preorder');
const cancelPreorder = document.getElementById('cancel-preorder');
const goNotify       = document.getElementById('go-notify');
const backPreorder   = document.getElementById('back-preorder');
const notifyForm     = document.getElementById('notify-form');
const step1          = document.getElementById('preorder-step-1');
const step2          = document.getElementById('preorder-step-2');
const step3          = document.getElementById('preorder-step-3');

function openPreorderModal() {
  preorderModal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closePreorderModal() {
  preorderModal.classList.remove('active');
  document.body.style.overflow = '';
  setTimeout(() => {
    step1.style.display = '';
    step2.style.display = 'none';
    step3.classList.remove('active');
    notifyForm && notifyForm.reset();
  }, 300);
}

openPreorder   && openPreorder.addEventListener('click',   (e) => { e.preventDefault(); openPreorderModal(); });
closePreorder  && closePreorder.addEventListener('click',  closePreorderModal);
cancelPreorder && cancelPreorder.addEventListener('click', closePreorderModal);
preorderModal  && preorderModal.addEventListener('click',  (e) => { if (e.target === preorderModal) closePreorderModal(); });

goNotify && goNotify.addEventListener('click', () => {
  step1.style.display = 'none';
  step2.style.display = 'block';
});

backPreorder && backPreorder.addEventListener('click', () => {
  step2.style.display = 'none';
  step1.style.display = '';
});

notifyForm && notifyForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const submitBtn = notifyForm.querySelector('button[type="submit"]');
  submitBtn.textContent = 'Signing up…';
  submitBtn.disabled = true;

  const data = new FormData();
  data.append('name',     document.getElementById('notify-name').value);
  data.append('email',    document.getElementById('notify-email').value);
  data.append('_subject', 'New Pre-Order Notification Request');
  data.append('_replyto', document.getElementById('notify-email').value);

  try {
    await fetch('https://formspree.io/admin@ibtaura.co.in', {
      method: 'POST',
      body: data,
      headers: { 'Accept': 'application/json' }
    });
  } catch (_) {}

  step2.style.display = 'none';
  step3.classList.add('active');
});

// ── Contact Modal ──────────────────────────────────────────
const modal       = document.getElementById('contact-modal');
const openBtn     = document.getElementById('open-contact');
const closeBtn    = document.getElementById('close-contact');
const cancelBtn   = document.getElementById('cancel-contact');
const form        = document.getElementById('contact-form');
const formView    = document.getElementById('modal-form-view');
const successView = document.getElementById('modal-success-view');

function openModal() {
  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  modal.classList.remove('active');
  document.body.style.overflow = '';
  formView.style.display = '';
  successView.classList.remove('active');
  form && form.reset();
}

openBtn   && openBtn.addEventListener('click',   (e) => { e.preventDefault(); openModal(); });
closeBtn  && closeBtn.addEventListener('click',  closeModal);
cancelBtn && cancelBtn.addEventListener('click', closeModal);
modal     && modal.addEventListener('click',     (e) => { if (e.target === modal) closeModal(); });

form && form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.textContent = 'Sending…';
  submitBtn.disabled = true;

  const data = new FormData();
  data.append('name',     document.getElementById('fname').value);
  data.append('email',    document.getElementById('femail').value);
  data.append('_replyto', document.getElementById('femail').value);

  try {
    await fetch('https://formspree.io/admin@ibtaura.co.in', {
      method: 'POST',
      body: data,
      headers: { 'Accept': 'application/json' }
    });
  } catch (_) {}

  formView.style.display = 'none';
  successView.classList.add('active');
});

// ── Siri orb + AI popup ────────────────────────────────────
(function initSiriOrb() {
  const canvas = document.getElementById('siri-orb');
  if (!canvas) return;

  const dpr  = window.devicePixelRatio || 1;
  const size = 52;
  canvas.style.width  = size + 'px';
  canvas.style.height = size + 'px';
  canvas.width  = size * dpr;
  canvas.height = size * dpr;

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const W = size, H = size, R = size / 2;

  const blobs = [
    { color: [0,   55, 200], f1: 0.52, p1: 0,             amp: R*0.52, br: R*1.15 },
    { color: [90,   0, 170], f1: 0.38, p1: Math.PI*0.80,  amp: R*0.50, br: R*1.02 },
    { color: [170,  0, 110], f1: 0.30, p1: Math.PI*0.40,  amp: R*0.48, br: R*0.98 },
    { color: [0,  120, 160], f1: 0.68, p1: Math.PI*1.50,  amp: R*0.46, br: R*0.92 },
    { color: [120,  0, 190], f1: 0.58, p1: Math.PI*1.20,  amp: R*0.44, br: R*0.88 },
    { color: [0,   40, 160], f1: 0.44, p1: Math.PI*0.60,  amp: R*0.42, br: R*0.84 },
    { color: [150,  0,  80], f1: 0.72, p1: Math.PI*1.80,  amp: R*0.40, br: R*0.80 },
    { color: [60,   0, 155], f1: 0.26, p1: Math.PI*1.10,  amp: R*0.38, br: R*0.76 },
  ];

  let t = 0;

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath();
    ctx.arc(R, R, R, 0, Math.PI * 2);
    ctx.clip();

    // 1 — glass base: faint blue-white tint
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(215, 228, 255, 0.28)';
    ctx.fillRect(0, 0, W, H);

    // 2 — liquid colour blobs inside the glass
    blobs.forEach(blob => {
      const a1 = t * blob.f1 + blob.p1;
      const a2 = t * blob.f1 * 1.31 + blob.p1 + 0.6;
      const x  = R + Math.cos(a1) * blob.amp + Math.cos(a2) * blob.amp * 0.26;
      const y  = R + Math.sin(a1 * 1.27) * blob.amp * 0.84 + Math.sin(a2) * blob.amp * 0.2;

      const grad = ctx.createRadialGradient(x, y, 0, x, y, blob.br);
      const [r, g, b] = blob.color;
      grad.addColorStop(0,   `rgba(${r},${g},${b},0.92)`);
      grad.addColorStop(0.48,`rgba(${r},${g},${b},0.45)`);
      grad.addColorStop(1,   `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
    });

    // 3 — frosted glass veil over the blobs
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.fillRect(0, 0, W, H);

    // 4 — primary specular: large soft highlight top-left
    const s1 = ctx.createRadialGradient(R*0.40, R*0.36, 0, R*0.40, R*0.36, R*0.68);
    s1.addColorStop(0,    'rgba(255,255,255,0.92)');
    s1.addColorStop(0.30, 'rgba(255,255,255,0.38)');
    s1.addColorStop(0.65, 'rgba(255,255,255,0.07)');
    s1.addColorStop(1,    'rgba(255,255,255,0)');
    ctx.fillStyle = s1;
    ctx.fillRect(0, 0, W, H);

    // 5 — secondary specular: tiny bright sparkle top-right edge
    const s2 = ctx.createRadialGradient(R*1.55, R*0.42, 0, R*1.55, R*0.42, R*0.28);
    s2.addColorStop(0,   'rgba(255,255,255,0.70)');
    s2.addColorStop(1,   'rgba(255,255,255,0)');
    ctx.fillStyle = s2;
    ctx.fillRect(0, 0, W, H);

    // 6 — bottom depth shadow (inside)
    const depth = ctx.createRadialGradient(R, R*1.55, 0, R, R*1.55, R*0.90);
    depth.addColorStop(0,   'rgba(0,0,20,0.13)');
    depth.addColorStop(1,   'rgba(0,0,20,0)');
    ctx.fillStyle = depth;
    ctx.fillRect(0, 0, W, H);

    // 7 — inner rim: bright top arc fading to nothing
    const rimGrad = ctx.createLinearGradient(0, 0, 0, H * 0.5);
    rimGrad.addColorStop(0,    'rgba(255,255,255,0.80)');
    rimGrad.addColorStop(0.18, 'rgba(255,255,255,0.22)');
    rimGrad.addColorStop(1,    'rgba(255,255,255,0)');
    ctx.beginPath();
    ctx.arc(R, R, R - 1, 0, Math.PI * 2);
    ctx.strokeStyle = rimGrad;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.restore();
    t += 0.0022;
    requestAnimationFrame(draw);
  }

  draw();

  // ── popup logic ──
  const popup = document.getElementById('ai-popup');
  const input = document.getElementById('ai-popup-input');
  const send  = document.getElementById('ai-popup-send');
  if (!popup) return;

  function openPopup() {
    const rc     = canvas.getBoundingClientRect();
    const gap    = 14;
    const popupW = 300;
    const popupH = popup.offsetHeight || 100;

    let left = rc.left;
    let top  = rc.top - popupH - gap;

    if (left + popupW > window.innerWidth - 16) left = window.innerWidth - popupW - 16;
    if (top < 16) top = rc.bottom + gap;

    popup.style.left            = left + 'px';
    popup.style.top             = top  + 'px';
    popup.style.transformOrigin = (top < rc.top ? 'bottom' : 'top') + ' left';
    popup.classList.add('active');
    setTimeout(() => input && input.focus(), 120);
  }

  function closePopup() {
    popup.classList.remove('active');
    if (input) input.value = '';
  }

  canvas.addEventListener('click', openPopup);

  document.addEventListener('click', e => {
    if (popup.classList.contains('active') && !popup.contains(e.target) && e.target !== canvas) {
      closePopup();
    }
  });

  if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') closePopup(); });
  if (send)  send.addEventListener('click', closePopup);
})();
