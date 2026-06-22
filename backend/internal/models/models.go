// Package models holds the core domain types shared across the backend: the
// demo parser produces them, the database layer persists them, and the API
// serialises them. Keeping one set of types avoids drift between layers.
package models

import "time"

// Side is a CS2 team side. We keep the canonical short strings used throughout
// the app ("CT"/"T"); the parser maps demoinfocs' numeric teams onto these.
type Side string

const (
	SideCT      Side = "CT"
	SideT       Side = "T"
	SideUnknown Side = ""
)

// Player is a Steam account we know about. The SteamID64 is the source of truth;
// profile fields are hydrated from the Steam Web API when a key is available.
type Player struct {
	SteamID64   uint64    `json:"steamId64,string"`
	PersonaName string    `json:"personaName"`
	AvatarURL   string    `json:"avatarUrl"`
	ProfileURL  string    `json:"profileUrl"`
	VanityURL   string    `json:"vanityUrl,omitempty"`
	CountryCode string    `json:"countryCode,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// Match is one parsed game. share_code is unique when the match was ingested via
// a match-sharing code; demos parsed from a local file may not have one.
type Match struct {
	ID          int64     `json:"id"`
	ShareCode   string    `json:"shareCode,omitempty"`
	DemoHash    string    `json:"demoHash,omitempty"` // sha256 of the demo, for parse-once dedup
	DemoSource  string    `json:"demoSource"`         // "local" | "valve" | "faceit" | ...
	Map         string    `json:"map"`
	GameMode    string    `json:"gameMode,omitempty"`
	PlayedAt    time.Time `json:"playedAt"`
	DurationS   int       `json:"durationSeconds"`
	RoundsTotal int       `json:"roundsTotal"`
	TeamAScore  int       `json:"teamAScore"` // roster that started on T
	TeamBScore  int       `json:"teamBScore"` // roster that started on CT
	TickRate    float64   `json:"tickRate"`
	ParsedAt    time.Time `json:"parsedAt"`
	CreatedAt   time.Time `json:"createdAt"`
}

// MatchPlayer is one player's line in one match: the scoreboard row plus the
// advanced metrics that make this a tracker rather than a scoreboard dump.
type MatchPlayer struct {
	MatchID        int64  `json:"matchId"`
	SteamID64      uint64 `json:"steamId64,string"`
	PersonaName    string `json:"personaName"`
	StartSide      Side   `json:"startSide"`
	RoundsPlayed   int    `json:"roundsPlayed"`
	Kills          int    `json:"kills"`
	Deaths         int    `json:"deaths"`
	Assists        int    `json:"assists"`
	HeadshotKills  int    `json:"headshotKills"`
	Damage         int    `json:"damage"`
	UtilityDamage  int    `json:"utilityDamage"`
	EnemiesFlashed int    `json:"enemiesFlashed"`
	KASTRounds     int    `json:"kastRounds"`
	OpeningKills   int    `json:"openingKills"`
	OpeningDeaths  int    `json:"openingDeaths"`
	ClutchesWon    int    `json:"clutchesWon"`
	ClutchesLost   int    `json:"clutchesLost"`
	MVPs           int    `json:"mvps"`
	// Multi-kill round distribution (rounds with exactly N kills), used by the
	// HLTV-style rating and for "X-K rounds" UI badges.
	K1 int `json:"k1"`
	K2 int `json:"k2"`
	K3 int `json:"k3"`
	K4 int `json:"k4"`
	K5 int `json:"k5"`

	// Derived metrics (computed by the stats package, stored for fast reads).
	ADR     float64 `json:"adr"`
	KASTPct float64 `json:"kastPct"`
	HSPct   float64 `json:"hsPct"`
	KD      float64 `json:"kd"`
	KPR     float64 `json:"kpr"`
	DPR     float64 `json:"dpr"`
	Rating  float64 `json:"rating"`
	Won     bool    `json:"won"`
}

// Round is one round outcome inside a match, including each team's buy.
type Round struct {
	MatchID      int64  `json:"matchId"`
	Number       int    `json:"number"`
	WinnerSide   Side   `json:"winnerSide"`
	EndReason    string `json:"endReason"`
	CTBuy        string `json:"ctBuy,omitempty"`
	TBuy         string `json:"tBuy,omitempty"`
	CTEquipValue int    `json:"ctEquipValue"`
	TEquipValue  int    `json:"tEquipValue"`
}

// Kill is a single kill event, kept for match-detail killfeeds and future
// positional/heatmap features.
type Kill struct {
	MatchID     int64   `json:"matchId"`
	Round       int     `json:"round"`
	TimeSeconds float64 `json:"timeSeconds"`
	KillerID    uint64  `json:"killerId,string"`
	VictimID    uint64  `json:"victimId,string"`
	AssisterID  uint64  `json:"assisterId,string,omitempty"`
	Weapon      string  `json:"weapon"`
	Headshot    bool    `json:"headshot"`
	Opening     bool    `json:"opening"`
	Trade       bool    `json:"trade"`
}

// ParsedMatch is the complete result of parsing a single demo. The worker takes
// one of these and writes it to the database transactionally.
type ParsedMatch struct {
	Match   Match
	Players []MatchPlayer
	Rounds  []Round
	Kills   []Kill
}

// PlayerCareer is the rolling aggregate across every match we have for a player.
// It is recomputed on write (aggregate-on-write) so profile reads are cheap.
type PlayerCareer struct {
	SteamID64      uint64 `json:"steamId64,string"`
	Matches        int    `json:"matches"`
	Wins           int    `json:"wins"`
	Losses         int    `json:"losses"`
	RoundsPlayed   int    `json:"roundsPlayed"`
	Kills          int64  `json:"kills"`
	Deaths         int64  `json:"deaths"`
	Assists        int64  `json:"assists"`
	HeadshotKills  int64  `json:"headshotKills"`
	Damage         int64  `json:"damage"`
	KASTRounds     int64  `json:"kastRounds"`
	OpeningKills   int64  `json:"openingKills"`
	OpeningDeaths  int64  `json:"openingDeaths"`
	ClutchesWon    int64  `json:"clutchesWon"`
	ClutchesLost   int64  `json:"clutchesLost"`
	UtilityDamage  int64  `json:"utilityDamage"`
	EnemiesFlashed int64  `json:"enemiesFlashed"`
	MVPs           int64  `json:"mvps"`
	K1             int64  `json:"k1"`
	K2             int64  `json:"k2"`
	K3             int64  `json:"k3"`
	K4             int64  `json:"k4"`
	K5             int64  `json:"k5"`

	// Derived
	KD        float64   `json:"kd"`
	ADR       float64   `json:"adr"`
	KASTPct   float64   `json:"kastPct"`
	HSPct     float64   `json:"hsPct"`
	Rating    float64   `json:"rating"`
	WinRate   float64   `json:"winRate"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// --- API response DTOs ------------------------------------------------------

// PlayerProfile is the headline payload for a profile page: the Steam identity
// plus the rolling career aggregate.
type PlayerProfile struct {
	Player Player       `json:"player"`
	Career PlayerCareer `json:"career"`
}

// PlayerMatchSummary is one row in a player's recent-matches list: the match
// metadata plus that player's individual line in it.
type PlayerMatchSummary struct {
	Match Match       `json:"match"`
	Line  MatchPlayer `json:"line"`
}

// MatchDetail is the full breakdown of a single match.
type MatchDetail struct {
	Match   Match         `json:"match"`
	Players []MatchPlayer `json:"players"`
	Rounds  []Round       `json:"rounds"`
}

// WeaponStat is a player's aggregate performance with a single weapon, derived
// from the stored killfeed.
type WeaponStat struct {
	Weapon    string  `json:"weapon"`
	Kills     int     `json:"kills"`
	Headshots int     `json:"headshots"`
	HSPct     float64 `json:"hsPct"`
}

// Job status values for the durable jobs record.
const (
	JobQueued  = "queued"
	JobRunning = "running"
	JobDone    = "done"
	JobFailed  = "failed"
)

// IngestJob is the durable status record for a demo-parse job, pollable via the
// API after ingest.
type IngestJob struct {
	ID        string    `json:"id"`
	Type      string    `json:"type"`
	Status    string    `json:"status"`
	Source    string    `json:"source,omitempty"`
	DemoPath  string    `json:"demoPath,omitempty"`
	DemoURL   string    `json:"demoUrl,omitempty"`
	ShareCode string    `json:"shareCode,omitempty"`
	MatchID   *int64    `json:"matchId,omitempty"`
	Error     string    `json:"error,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// LeaderboardEntry is one row of the "top tracked players" board.
type LeaderboardEntry struct {
	SteamID64   uint64  `json:"steamId64,string"`
	PersonaName string  `json:"personaName"`
	AvatarURL   string  `json:"avatarUrl"`
	Matches     int     `json:"matches"`
	Rating      float64 `json:"rating"`
	KD          float64 `json:"kd"`
	ADR         float64 `json:"adr"`
	WinRate     float64 `json:"winRate"`
}

// MapStat is a player's aggregate performance on a single map.
type MapStat struct {
	Map          string  `json:"map"`
	Matches      int     `json:"matches"`
	Wins         int     `json:"wins"`
	Losses       int     `json:"losses"`
	WinRate      float64 `json:"winRate"`
	RoundsPlayed int     `json:"roundsPlayed"`
	Rating       float64 `json:"rating"`
	ADR          float64 `json:"adr"`
	KD           float64 `json:"kd"`
	HSPct        float64 `json:"hsPct"`
}
