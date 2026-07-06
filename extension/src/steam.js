// Steam profile content script. Resolves the profile's SteamID64 and drops a
// StatRun CheatMeter panel into the profile header. /profiles/{id} gives the id
// in the URL; /id/{vanity} pages embed it as `g_steamID = "…"` in an inline
// script, which we read from the DOM (no page-JS execution needed).

(function () {
  function steamId64() {
    const m = location.pathname.match(/\/profiles\/(\d{17})/);
    if (m) return m[1];
    for (const s of document.scripts) {
      const t = s.textContent || "";
      const g = t.match(/g_steamID\s*=\s*"(\d{17})"/);
      if (g) return g[1];
    }
    // Last resort: an abuse/report link carries the id.
    const rep = document.querySelector('a[href*="ReportAbuse"], a[href*="steamid="]');
    if (rep) {
      const g = (rep.getAttribute("href") || "").match(/(\d{17})/);
      if (g) return g[1];
    }
    return null;
  }

  async function init() {
    if (!(await SR.enabled())) return;
    const id = steamId64();
    if (!id) return;
    if (document.querySelector('[data-sr-panel="1"]')) return;

    const data = await SR.lookup({ steamid: id });
    if (!data || data.error) return;

    const panel = SR.panel(data);
    // Prefer to sit under the profile header; fall back to the top of content.
    const anchor =
      document.querySelector(".profile_header") ||
      document.querySelector(".profile_content") ||
      document.querySelector(".responsive_page_template_content") ||
      document.body;
    anchor.insertAdjacentElement("afterend", panel);
  }

  // Steam profiles are server-rendered (not an SPA), so one pass at idle is enough.
  init();
})();
