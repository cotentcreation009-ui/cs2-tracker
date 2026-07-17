// Central config for the legal pages (privacy / terms) + cookie consent.
//
// ⚠️ EDIT THESE BEFORE LAUNCH, and have a lawyer review the page wording — the
// content in app/privacy and app/terms is a solid template tailored to what this
// site does, not legal advice.
export const SITE_NAME = "StatRun";
export const SITE_DOMAIN = "csrun.win";

// Real, monitored inbox for privacy / data-removal / legal / ad-network (AdSense)
// contact. A business address is fine here — it needn't match the site domain.
export const CONTACT_EMAIL = "admin@evamedialab.com";

// Governing law for the Terms. You can refine to a specific state later
// (e.g. "the State of California, United States") — one-line edit.
export const GOVERNING_LAW = "the United States";

// Shown as "Last updated" on both legal pages.
export const LEGAL_LAST_UPDATED = "June 25, 2026";

// Google AdSense publisher ID (public — it ships in every page + /ads.txt). The
// loader is added to <head> in prod; ad cookies are gated by Google Consent Mode
// (default denied) until the visitor picks "Accept all". Empty = no ad code.
export const ADSENSE_CLIENT = "ca-pub-3939177354565750";
