/**
 * Aura — Analytics configuration
 * ------------------------------------------------------------------
 * The GA4 Measurement ID lives here and nowhere else.
 *
 * Local / manual:  replace G-LRQBNP0BFF below with your real ID.
 * Amplify deploy:  leave the placeholder. amplify.yml substitutes the
 *                  value of the GA_MEASUREMENT_ID environment variable
 *                  at build time.
 *
 * If the value is left as the placeholder (or is empty) analytics is
 * simply disabled — the consent banner still works, nothing breaks.
 */
window.AURA_ANALYTICS = {
  measurementId: 'G-LRQBNP0BFF',
  cookieDomain: 'auto',
  consentCookieName: 'aura_cookie_consent',
  consentVersion: 1,
  consentDays: 180
};
