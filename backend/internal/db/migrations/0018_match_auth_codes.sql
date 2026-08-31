-- Accounts that have connected their CS2 match history.
--
-- The owner generates a "match history authentication code" on Steam's help
-- site and hands it over once, together with one recent share code. From then
-- on Valve's GetNextMatchSharingCode walks the account's matches forward
-- forever — the same mechanism Leetify and csstats onboard with.
--
-- The auth code is a credential: it grants read access to one account's match
-- HISTORY (never the account itself). It is stored server-side only and must
-- never appear in an API response or a log line.
CREATE TABLE IF NOT EXISTS match_auth_codes (
    steam_id   BIGINT PRIMARY KEY,
    auth_code  TEXT NOT NULL,
    -- The newest share code we have walked to. Valve rejects a known-code
    -- older than about a month, so a long-dormant account transitions to
    -- needs_reseed rather than erroring forever.
    head_code  TEXT NOT NULL,
    -- active | needs_reseed (head too old; owner must supply a fresh code)
    --        | revoked      (Valve rejected the auth code; owner must reissue)
    status     TEXT NOT NULL DEFAULT 'active',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- When the chain was last walked, regardless of whether it moved.
    walked_at  TIMESTAMPTZ
);
