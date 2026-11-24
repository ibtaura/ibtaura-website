// GA4 events for the Attention Test, sent only while the visitor has granted analytics consent.
// consent.js always defines window.gtag (a dataLayer push, from the first moment), so calling gtag directly
// would queue events before consent and gtag.js would send them if the visitor accepted later in the visit.
// Instead this goes through window.auraTrack (consent.js), which drops events until GA has loaded after
// opt-in, and also checks <html data-consent-analytics="1">, which consent.js sets to '0' on withdrawal.
// Nothing is queued or sent before consent; with no consent.js on the page this is a no-op.
export function track(name, params = {}) {
  try {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (document.documentElement.getAttribute('data-consent-analytics') !== '1') return;
    if (typeof window.auraTrack !== 'function') return;
    window.auraTrack(name, { event_category: 'attention_test', ...params });
  } catch (_) {
    /* analytics must never break the game */
  }
}
