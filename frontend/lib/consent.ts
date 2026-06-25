// Cookie-consent state, stored client-side. Ad/analytics scripts must gate on
// hasAdConsent() so they only load after the visitor opts in (EU/GDPR/ePrivacy).
//
// NOTE: this is a first-party banner suitable for basic consent + gating. For
// *personalized* ads in the EEA/UK via Google AdSense you additionally need a
// Google-certified CMP (e.g. Funding Choices) wired to IAB TCF — this mechanism
// is the gate that such a CMP (or your own non-EEA setup) plugs into.

const KEY = "cs2:cookie-consent";
export type Consent = "all" | "necessary";
const EVENT = "cs2-consent-change";

export function getConsent(): Consent | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(KEY);
    return v === "all" || v === "necessary" ? v : null;
  } catch {
    return null;
  }
}

export function setConsent(c: Consent): void {
  try {
    window.localStorage.setItem(KEY, c);
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* storage disabled — ignore */
  }
}

export function clearConsent(): void {
  try {
    window.localStorage.removeItem(KEY);
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* ignore */
  }
}

/** Whether the visitor has opted in to advertising/analytics cookies. */
export function hasAdConsent(): boolean {
  return getConsent() === "all";
}

export const CONSENT_EVENT = EVENT;
