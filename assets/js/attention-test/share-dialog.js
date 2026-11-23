// Clarus Attention Test: the share block (share.js) in a modal dialog.
//
// openShareDialog({ result, run, title }) opens an accessible modal titled `title` (default "Share your score")
// and mounts the normal share UI inside it: mountShare(container, { result, run }) from share.js, so the story and
// post cards are the same as on a fresh result screen. `result` is scoreRun(run) from scoring.js and must be valid;
// `run` is the raw run (its level is used when result.level is missing).
// Returns a Promise that resolves once the dialog has closed (close button, Esc or a click on the backdrop).
// An invalid result opens nothing and resolves straight away.
//
// Uses <dialog>.showModal() (the page behind becomes inert), with a Tab trap, page scroll locked while open and
// focus returned to whatever had it before. Older browsers get a role="dialog" fallback with the same behaviour.
// Styles: /assets/css/attention-dialog.css plus the share block's /assets/css/attention-share.css. Either one is
// added to <head> here when the page doesn't link it already, so the dialog works on any page.

const CSS = ['/assets/css/attention-share.css?v=1', '/assets/css/attention-dialog.css?v=1'];
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let uid = 0;
let current = null; // the open dialog's close function

function h(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  if (text != null) node.textContent = text;
  return node;
}

/** Adds each stylesheet the page doesn't link yet; resolves when they've loaded (or failed, or after 1.5 s). */
function ensureCss() {
  const waits = [];
  for (const href of CSS) {
    const path = href.split('?')[0];
    if (document.querySelector(`link[rel="stylesheet"][href^="${path}"]`)) continue;
    const link = h('link', { rel: 'stylesheet', href });
    waits.push(
      new Promise((resolve) => {
        link.addEventListener('load', resolve, { once: true });
        link.addEventListener('error', resolve, { once: true });
        setTimeout(resolve, 1500);
      })
    );
    document.head.appendChild(link);
  }
  return Promise.all(waits);
}

function lockScroll() {
  const root = document.documentElement;
  const body = document.body;
  const saved = { rootOverflow: root.style.overflow, bodyOverflow: body.style.overflow, bodyPad: body.style.paddingRight };
  const bar = window.innerWidth - root.clientWidth; // keep the layout still when the scrollbar goes
  root.style.overflow = 'hidden';
  body.style.overflow = 'hidden';
  if (bar > 0) body.style.paddingRight = `${bar}px`;
  return () => {
    root.style.overflow = saved.rootOverflow;
    body.style.overflow = saved.bodyOverflow;
    body.style.paddingRight = saved.bodyPad;
  };
}

function visibleFocusables(box) {
  return [...box.querySelectorAll(FOCUSABLE)].filter((el) => !el.closest('[hidden]') && el.getClientRects().length > 0);
}

/**
 * Opens the share dialog. See the header comment.
 * @param {{ result: object, run?: object, title?: string }} opts
 * @returns {Promise<void>} resolves when the dialog has closed
 */
export function openShareDialog({ result, run, title } = {}) {
  if (!result || !result.valid || !Number.isFinite(result.overall)) return Promise.resolve();
  if (current) current();

  const id = `atd-${++uid}`;
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const native = typeof HTMLDialogElement === 'function' && typeof HTMLDialogElement.prototype.showModal === 'function';

  const dialog = native
    ? h('dialog', { class: 'atd', 'aria-labelledby': `${id}-title` })
    : h('div', { class: 'atd atd-fallback', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': `${id}-title` });
  const panel = h('div', { class: 'atd-panel' });
  const head = h('div', { class: 'atd-head' });
  head.appendChild(h('h2', { class: 'atd-title', id: `${id}-title` }, title || 'Share your score'));
  const closeBtn = h('button', { class: 'atd-close', type: 'button', 'aria-label': 'Close' });
  closeBtn.appendChild(h('span', { 'aria-hidden': 'true' }, '×'));
  head.appendChild(closeBtn);
  const body = h('div', { class: 'atd-body' });
  const status = h('p', { class: 'atd-status', role: 'status' }, 'Making your card…');
  body.appendChild(status);
  panel.append(head, body);
  dialog.appendChild(panel);

  const backdrop = native ? null : h('div', { class: 'atd-backdrop', 'aria-hidden': 'true' });
  const unlock = lockScroll();
  let handle = null;
  let closed = false;
  let resolveClosed;
  const done = new Promise((resolve) => {
    resolveClosed = resolve;
  });

  function cleanup() {
    if (closed) return;
    closed = true;
    if (current === close) current = null;
    document.removeEventListener('keydown', onKey, true);
    try {
      if (handle) handle.destroy();
    } catch (_) {
      /* already gone */
    }
    dialog.remove();
    if (backdrop) backdrop.remove();
    unlock();
    if (opener && opener.isConnected) {
      try {
        opener.focus({ preventScroll: true });
      } catch (_) {
        opener.focus();
      }
    }
    resolveClosed();
  }

  function close() {
    if (closed) return;
    if (native && dialog.open) dialog.close(); // fires 'close', which cleans up
    else cleanup();
  }

  function onKey(e) {
    if (closed) return;
    if (e.key === 'Escape') {
      // Esc belongs to the dialog: keep page-wide Esc handlers (main.js popups) out of it. <dialog> still closes
      // itself (that's its default action, not a listener).
      e.stopPropagation();
      if (!native) {
        e.preventDefault();
        close();
      }
      return;
    }
    if (e.key !== 'Tab') return;
    const items = visibleFocusables(dialog);
    if (!items.length) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (!dialog.contains(active)) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  closeBtn.addEventListener('click', close);
  // Backdrop: the dialog element itself only receives clicks outside .atd-panel. Both ends of the click must be
  // there, so a text selection dragged out of the panel doesn't close it.
  let downOnBackdrop = false;
  const box = native ? dialog : backdrop;
  box.addEventListener('pointerdown', (e) => {
    downOnBackdrop = e.target === box;
  });
  box.addEventListener('click', (e) => {
    if (downOnBackdrop && e.target === box) close();
    downOnBackdrop = false;
  });
  if (native) dialog.addEventListener('close', cleanup);
  document.addEventListener('keydown', onKey, true);

  if (native) {
    document.body.appendChild(dialog);
    dialog.showModal();
  } else {
    document.body.append(backdrop, dialog);
  }
  closeBtn.focus();
  current = close;

  Promise.all([ensureCss(), import('./share.js?v=4')])
    .then(([, mod]) => {
      if (closed) return;
      const mount = h('div', { class: 'atd-share' });
      handle = mod.mountShare(mount, { result, run });
      if (!handle) throw new Error('mountShare returned nothing');
      status.remove();
      body.appendChild(mount);
    })
    .catch(() => {
      if (closed) return;
      status.textContent = 'Sorry, sharing isn’t available right now. Please try again.';
      status.classList.add('is-error');
    });

  return done;
}
