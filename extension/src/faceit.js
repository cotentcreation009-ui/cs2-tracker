// FACEIT content script. Rather than depend on FACEIT's (frequently-changing,
// React-rendered) match-room DOM, we key off the ONE stable thing: player
// profile links look like /{lang}/players/{nickname}. We find those anywhere on
// the page (match rooms, team lists, hubs), resolve each nickname to its
// CheatMeter read, and drop a compact chip next to it. A MutationObserver keeps
// up with the SPA re-rendering.

(function () {
  const PLAYER_RE = /\/players(?:-modal)?\/([^/?#]+)/i;
  const inflight = new Set();
  let enabled = true;

  function nicknameFrom(href) {
    try {
      const path = new URL(href, location.href).pathname;
      const m = path.match(PLAYER_RE);
      if (!m) return null;
      const nick = decodeURIComponent(m[1]).trim();
      // Skip obvious non-nicknames.
      if (!nick || nick.length > 64 || nick === "undefined") return null;
      return nick;
    } catch {
      return null;
    }
  }

  async function decorate(anchor) {
    if (anchor.dataset.srDone) return;
    const nick = nicknameFrom(anchor.getAttribute("href") || "");
    if (!nick) return;
    anchor.dataset.srDone = "1";

    // Dedupe concurrent lookups for the same nickname on a busy page.
    const key = nick.toLowerCase();
    if (inflight.has(key)) return;
    inflight.add(key);

    const data = await SR.lookup({ faceit: nick });
    inflight.delete(key);
    if (!enabled) return;
    if (!data || data.error) return; // silent on failure — don't clutter

    const chip = SR.chip(data);
    chip.classList.add("sr-chip--faceit");
    // Place it right after the name link, guarding against double-insert.
    if (!anchor.nextElementSibling || anchor.nextElementSibling.dataset.srChip !== "1") {
      anchor.insertAdjacentElement("afterend", chip);
    }
  }

  function scan(root) {
    if (!enabled) return;
    const anchors = (root instanceof Element ? root : document).querySelectorAll(
      'a[href*="/players/"]:not([data-sr-done])',
    );
    anchors.forEach((a) => void decorate(a));
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      scan(document);
    }, 400); // debounce SPA churn
  }

  async function init() {
    enabled = await SR.enabled();
    if (!enabled) return;
    scan(document);
    const obs = new MutationObserver(schedule);
    obs.observe(document.documentElement, { childList: true, subtree: true });
    // FACEIT is a client-router SPA; re-scan on history changes too.
    window.addEventListener("popstate", schedule);
  }

  init();
})();
