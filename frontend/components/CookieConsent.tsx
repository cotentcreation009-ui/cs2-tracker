"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CONSENT_EVENT, clearConsent, getConsent, setConsent } from "@/lib/consent";

/**
 * CookieConsent shows a bottom banner until the visitor chooses. The choice is
 * stored client-side; ad/analytics scripts gate on hasAdConsent(). Renders
 * nothing on the server / before a choice is needed, so there's no layout shift.
 */
export function CookieConsent() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const sync = () => setShow(getConsent() === null);
    sync();
    window.addEventListener(CONSENT_EVENT, sync);
    return () => window.removeEventListener(CONSENT_EVENT, sync);
  }, []);

  if (!show) return null;

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      className="fixed inset-x-0 bottom-0 z-50 p-3"
    >
      <div className="card-2 mx-auto flex max-w-4xl flex-col gap-3 px-4 py-3 shadow-xl sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted">
          We use cookies for essential site functionality and, with your consent,
          for advertising and analytics. See our{" "}
          <Link href="/privacy" className="text-brand hover:underline">
            Privacy Policy
          </Link>
          .
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => setConsent("necessary")}
            className="rounded-lg border border-line bg-panel2 px-3 py-1.5 text-sm font-medium text-ink transition hover:border-brand/60"
          >
            Necessary only
          </button>
          <button
            type="button"
            onClick={() => setConsent("all")}
            className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-bg transition hover:opacity-90"
          >
            Accept all
          </button>
        </div>
      </div>
    </div>
  );
}

/** Footer link that reopens the consent banner so visitors can change their choice. */
export function CookieSettingsButton() {
  return (
    <button
      type="button"
      onClick={clearConsent}
      className="text-faint underline-offset-2 hover:text-muted hover:underline"
    >
      Cookie settings
    </button>
  );
}
