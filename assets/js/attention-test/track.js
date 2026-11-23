// GA4 events for the Attention Test. consent.js only defines a working gtag after the visitor opts in,
// so this is a no-op until then.
export function track(name, params = {}) {
  try {
    if (typeof window.gtag === 'function') window.gtag('event', name, { event_category: 'attention_test', ...params });
  } catch (_) {
    /* analytics must never break the game */
  }
}
