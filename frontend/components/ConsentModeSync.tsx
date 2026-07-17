"use client";

import { useEffect } from "react";
import { CONSENT_EVENT, hasAdConsent } from "@/lib/consent";

// Bridges the first-party cookie banner to Google Consent Mode v2. The head
// script defaults every ad/analytics signal to "denied"; this flips them to
// "granted" only once the visitor chooses "Accept all", and back to "denied"
// if they later pick "Necessary only" via Cookie settings. Runs on mount (to
// apply a stored choice) and on every consent change. No-ops when the AdSense
// head script isn't present (dev), since window.gtag won't exist.
export function ConsentModeSync() {
  useEffect(() => {
    const sync = () => {
      const gtag = (window as unknown as { gtag?: (...a: unknown[]) => void }).gtag;
      if (typeof gtag !== "function") return;
      const v = hasAdConsent() ? "granted" : "denied";
      gtag("consent", "update", {
        ad_storage: v,
        ad_user_data: v,
        ad_personalization: v,
        analytics_storage: v,
      });
    };
    sync();
    window.addEventListener(CONSENT_EVENT, sync);
    return () => window.removeEventListener(CONSENT_EVENT, sync);
  }, []);
  return null;
}
