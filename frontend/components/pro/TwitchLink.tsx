"use client";

// "Watch" pill linking to the match stream. Stops propagation so clicking it
// inside a card that is itself a link opens the stream rather than the detail
// page. Rendered as an <a> (external) — not a Next <Link>.
export function TwitchLink({
  url,
  className = "",
  finished = false,
}: {
  url: string;
  className?: string;
  /** The series is over: the same link now leads to the channel's VODs, and
   * the pill says so instead of promising a live broadcast. */
  finished?: boolean;
}) {
  const isTwitch = /twitch\.tv/i.test(url);
  // Curated organizer channels link straight to the broadcast; everything else
  // is a Twitch search on the event name — label it honestly.
  const isSearch = /twitch\.tv\/search/i.test(url);
  const title = finished
    ? isSearch
      ? "Find this event's VODs on Twitch"
      : "Open the channel — the VOD is in its videos"
    : isSearch
      ? "Find this event's live broadcast on Twitch"
      : "Open the stream";
  const label = finished ? "VOD" : isSearch ? "Find stream" : isTwitch ? "Twitch" : "Watch";
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      title={title}
      className={`pill inline-flex items-center gap-1.5 border-[#9147ff]/40 bg-[#9147ff]/12 text-[11px] font-semibold text-[#c9b6ff] transition hover:bg-[#9147ff]/20 ${className}`}
    >
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
        <path d="M4 3 3 6.5V19h4v2.5h2.5L12 19h3.5L21 13.5V3H4Zm2 2h13v7.5l-3 3h-4l-2.5 2.5V15.5H6V5Zm5.5 3v4H13V8h-1.5Zm4 0v4H17V8h-1.5Z" />
      </svg>
      {label}
    </a>
  );
}
