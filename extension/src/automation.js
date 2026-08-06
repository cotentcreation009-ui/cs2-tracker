// Option-gated QoL automation for FACEIT pages. No UI — this module only ever
// clicks things the user explicitly opted into, and a wrong click is worse
// than no click, so every matcher is deliberately narrow:
//
//   auto.accept       — click the match-ready dialog's Accept/Ready button,
//                       once per dialog (WeakSet), max one click per 5s.
//   auto.closeModals  — dismiss cookie banners / promo modals matching a small
//                       allowlist of stable ids + test-id patterns only.
//   notify.matchReady — when the ready dialog appears while the tab is NOT
//                       focused, ask the background worker to notify.
//
// All three default OFF. Settings are read through SRSettings (api.js) and
// re-checked on change; the MutationObserver (debounced 300ms) disconnects
// entirely when every behavior is off. Every failure path is a silent no-op —
// the host page must never look broken because of us.

(function () {
  "use strict";

  const SETTING_KEYS = ["enabled", "auto.accept", "auto.closeModals", "notify.matchReady"];
  const DEBOUNCE_MS = 300;
  const ACCEPT_COOLDOWN_MS = 5000; // global: never more than 1 accept click per 5s
  const MODAL_COOLDOWN_MS = 5000; // same restraint for modal dismissals

  const DIALOG_SELECTOR = 'dialog, [role="dialog"], [role="alertdialog"]';
  // Conservative accept matcher: accessible text must START with accept/ready.
  const ACCEPT_RE = /^(accept|ready)\b/i;
  // Absolute never-click guard, applied to every candidate before any click.
  const NEVER_RE = /leave|cancel match|report/i;
  // auto.closeModals clicks ONLY elements matching this allowlist — stable ids
  // of known cookie-consent platforms plus narrow test-id patterns that require
  // both tokens (e.g. "cookie"+"accept") in the same attribute.
  const MODAL_ALLOWLIST = [
    "#onetrust-accept-btn-handler", // OneTrust (faceit.com's cookie banner)
    "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll", // Cookiebot
    'button[data-testid*="cookie" i][data-testid*="accept" i]',
    'button[data-testid*="modal" i][data-testid*="close" i]',
    'button[data-testid*="promo" i][data-testid*="close" i]',
  ];

  // Live view of the three gates (master `enabled` is folded in).
  const gates = { accept: false, closeModals: false, notify: false };

  const clickedDialogs = new WeakSet(); // ready dialogs we already accepted
  const notifiedDialogs = new WeakSet(); // ready dialogs we already evaluated for notify
  const dismissedModals = new WeakSet(); // modal buttons we already clicked
  let lastAcceptClick = 0;
  let lastModalClick = 0;

  let observer = null;
  let debounceTimer = 0;

  // ---- settings (all reads go through SRSettings; absent → everything off) --

  async function readRaw() {
    if (typeof SRSettings === "undefined" || !SRSettings || typeof SRSettings.get !== "function") {
      return null;
    }
    try {
      const s = await SRSettings.get(SETTING_KEYS);
      if (s && typeof s === "object") return s;
    } catch {}
    try {
      const s = await SRSettings.get();
      if (s && typeof s === "object") return s;
    } catch {}
    return null;
  }

  async function refresh() {
    const s = await readRaw();
    const master = !!s && s.enabled !== false;
    gates.accept = master && s["auto.accept"] === true;
    gates.closeModals = master && s["auto.closeModals"] === true;
    gates.notify = master && s["notify.matchReady"] === true;
    reconcile();
  }

  function watchSettings() {
    try {
      if (typeof SRSettings !== "undefined" && SRSettings && typeof SRSettings.onChange === "function") {
        SRSettings.onChange(() => void refresh());
        return;
      }
    } catch {}
    // Change *signal* only — actual reads still go through SRSettings.get().
    try {
      chrome.storage.onChanged.addListener((_changes, area) => {
        if (area === "sync") void refresh();
      });
    } catch {}
  }

  // ---- DOM helpers ---------------------------------------------------------

  function accessibleText(el) {
    const aria = el.getAttribute && el.getAttribute("aria-label");
    return String(aria || el.textContent || "").replace(/\s+/g, " ").trim();
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    if (el.closest && el.closest('[aria-hidden="true"]')) return false;
    try {
      if (typeof el.checkVisibility === "function") {
        return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
      }
    } catch {}
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function isClickableButton(el) {
    if (el.disabled || el.getAttribute("aria-disabled") === "true") return false;
    return isVisible(el);
  }

  // A visible, enabled button inside `dialog` whose accessible text starts
  // with accept/ready and is short enough to actually be a button label.
  function findAcceptButton(dialog) {
    const buttons = dialog.querySelectorAll('button, [role="button"]');
    for (const btn of buttons) {
      const text = accessibleText(btn);
      if (!text || text.length > 32) continue;
      if (!ACCEPT_RE.test(text) || NEVER_RE.test(text)) continue;
      if (!isClickableButton(btn)) continue;
      return btn;
    }
    return null;
  }

  // ---- behaviors -----------------------------------------------------------

  function scanReadyDialogs() {
    const dialogs = document.querySelectorAll(DIALOG_SELECTOR);
    for (const dlg of dialogs) {
      if (!isVisible(dlg)) continue;
      const btn = findAcceptButton(dlg);
      if (!btn) continue;

      // notify.matchReady — evaluated once, at the dialog's first sighting.
      if (gates.notify && !notifiedDialogs.has(dlg)) {
        notifiedDialogs.add(dlg);
        if (!document.hasFocus()) {
          try {
            chrome.runtime.sendMessage(
              { type: "notify", title: "Match ready", message: "Your FACEIT match is ready" },
              () => void chrome.runtime.lastError,
            );
          } catch {}
        }
      }

      // auto.accept — once per dialog, globally rate-limited.
      if (gates.accept && !clickedDialogs.has(dlg)) {
        const now = Date.now();
        if (now - lastAcceptClick >= ACCEPT_COOLDOWN_MS) {
          clickedDialogs.add(dlg);
          lastAcceptClick = now;
          try {
            btn.click();
          } catch {}
        }
      }
    }
  }

  function scanModals() {
    for (const sel of MODAL_ALLOWLIST) {
      let candidates;
      try {
        candidates = document.querySelectorAll(sel);
      } catch {
        continue;
      }
      for (const el of candidates) {
        if (dismissedModals.has(el)) continue;
        if (!isClickableButton(el)) continue;
        if (NEVER_RE.test(accessibleText(el))) continue;
        // Never dismiss the match-ready dialog itself.
        const host = el.closest(DIALOG_SELECTOR);
        if (host && findAcceptButton(host)) continue;
        const now = Date.now();
        if (now - lastModalClick < MODAL_COOLDOWN_MS) return;
        dismissedModals.add(el);
        lastModalClick = now;
        try {
          el.click();
        } catch {}
        return; // at most one dismissal per pass
      }
    }
  }

  function scan() {
    if (!(gates.accept || gates.closeModals || gates.notify)) return;
    try {
      if (gates.accept || gates.notify) scanReadyDialogs();
      if (gates.closeModals) scanModals();
    } catch {} // silent — never break the host page
  }

  // ---- observer lifecycle --------------------------------------------------

  function schedule() {
    if (debounceTimer) return;
    debounceTimer = setTimeout(() => {
      debounceTimer = 0;
      scan();
    }, DEBOUNCE_MS);
  }

  function reconcile() {
    const active = gates.accept || gates.closeModals || gates.notify;
    if (active && !observer) {
      observer = new MutationObserver(schedule);
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "style", "open", "aria-hidden"],
      });
      schedule();
    } else if (!active && observer) {
      observer.disconnect();
      observer = null;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = 0;
      }
    }
  }

  watchSettings();
  void refresh();
})();
