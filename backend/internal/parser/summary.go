package parser

// Per-player summaries of a parsed demo — CSRun's own numbers.
//
// Everything here is computed from the demo we parsed ourselves, which matters
// twice over. It is the only source for some of it (Premier rating exists
// nowhere else we can reach), and it belongs to us: no third party can
// withdraw it, and the formula can be published and argued with. That is the
// opposite of a borrowed metric, and the page must say so wherever these
// numbers appear.

// PlayerSummary is one player's line from one parsed match.
type PlayerSummary struct {
	SteamID uint64 `json:"steamId,string"`
	Name    string `json:"name,omitempty"`

	// Premier rating carried in and out. Zero means the demo said nothing —
	// an uncalibrated player — and must render as a dash, never as zero.
	RankOld    int `json:"rankOld,omitempty"`
	RankNew    int `json:"rankNew,omitempty"`
	RankChange int `json:"rankChange,omitempty"`

	Kills   int `json:"kills"`
	Deaths  int `json:"deaths"`
	Assists int `json:"assists,omitempty"`
	HSKills int `json:"hsKills,omitempty"`
	Damage  int `json:"damage,omitempty"`
	Rounds  int `json:"rounds,omitempty"`

	// Bullet-level aim quality. Shotguns are already excluded upstream.
	Shots   int `json:"shots,omitempty"`
	Hits    int `json:"hits,omitempty"`
	HsHits  int `json:"hsHits,omitempty"`
	LegHits int `json:"legHits,omitempty"`

	// Duel tells, averaged over the kills that carried them.
	ReactionMs float64 `json:"reactionMs,omitempty"` // spotted -> kill
	Preaim     float64 `json:"preaim,omitempty"`     // crosshair offset at spot, degrees
	SnapKills  int     `json:"snapKills,omitempty"`

	// Opening duels: the first kill of each round, and being its victim.
	OpeningKills  int `json:"openingKills,omitempty"`
	OpeningDeaths int `json:"openingDeaths,omitempty"`

	// Kill context — what our parser sees that scoreboards never do.
	Wallbangs    int `json:"wallbangs,omitempty"`
	ThroughSmoke int `json:"throughSmoke,omitempty"`
	NoScopes     int `json:"noScopes,omitempty"`
	BlindKills   int `json:"blindKills,omitempty"`

	// AimRating is ours: a 0-100 read of mechanical quality, computed from the
	// four components below with published weights. It is deliberately NOT a
	// rescaling of anyone else's rating — it is a different measurement, and
	// naming it ours is the honest presentation.
	AimRating float64 `json:"aimRating,omitempty"`
}

// ADR is damage per round played, the figure every CS2 player already reads.
func (p PlayerSummary) ADR() float64 {
	if p.Rounds <= 0 {
		return 0
	}
	return float64(p.Damage) / float64(p.Rounds)
}

// Accuracy is the share of fired bullets that hit an enemy.
func (p PlayerSummary) Accuracy() float64 { return safeRatio(p.Hits, p.Shots) }

// HeadshotPct is the share of kills that were headshots.
func (p PlayerSummary) HeadshotPct() float64 { return safeRatio(p.HSKills, p.Kills) }

// OpeningWinPct is how often this player won the round's first duel.
func (p PlayerSummary) OpeningWinPct() float64 {
	return safeRatio(p.OpeningKills, p.OpeningKills+p.OpeningDeaths)
}

// SummarisePlayers reduces a parsed match to one line per player.
//
// Round stats and kill events are both walked because they carry different
// truths: the stats block knows how many bullets were fired, and only the kill
// list knows who won a round's opening duel.
func SummarisePlayers(m *ReplayMatch) []PlayerSummary {
	if m == nil {
		return nil
	}
	out := make([]PlayerSummary, len(m.Players))
	for i, p := range m.Players {
		out[i] = PlayerSummary{
			SteamID:    p.SteamID,
			Name:       p.Name,
			RankOld:    p.RankOld,
			RankNew:    p.RankNew,
			RankChange: p.RankChange,
		}
	}
	valid := func(i int) bool { return i >= 0 && i < len(out) }

	// Reaction and preaim are averaged over the kills that carried a sample,
	// weighted by that sample count — a round with four measured duels should
	// count for more than a round with one.
	rctSum := make([]float64, len(out))
	rctN := make([]int, len(out))
	preSum := make([]float64, len(out))
	preN := make([]int, len(out))

	for _, r := range m.RoundData {
		for _, st := range r.Stats {
			if !valid(st.I) {
				continue
			}
			p := &out[st.I]
			p.Rounds++
			p.Damage += st.Dmg
			p.Shots += st.Shots
			p.Hits += st.Hits
			p.HsHits += st.HsHits
			p.LegHits += st.LegHits
			p.SnapKills += st.Snap
			if st.AimN > 0 {
				rctSum[st.I] += st.RctMs * float64(st.AimN)
				rctN[st.I] += st.AimN
				preSum[st.I] += st.Preaim * float64(st.AimN)
				preN[st.I] += st.AimN
			}
		}

		for ki, k := range r.Kills {
			if valid(k.Killer) {
				p := &out[k.Killer]
				p.Kills++
				if k.Headshot {
					p.HSKills++
				}
				if k.Wallbang {
					p.Wallbangs++
				}
				if k.ThruSmk {
					p.ThroughSmoke++
				}
				if k.Noscope {
					p.NoScopes++
				}
				if k.Blind {
					p.BlindKills++
				}
				// The round's first kill is its opening duel.
				if ki == 0 {
					p.OpeningKills++
				}
			}
			if valid(k.Victim) {
				out[k.Victim].Deaths++
				if ki == 0 {
					out[k.Victim].OpeningDeaths++
				}
			}
			// Assister is stored as index+1 so that zero can mean "none".
			if k.Assister > 0 && valid(k.Assister-1) {
				out[k.Assister-1].Assists++
			}
		}
	}

	for i := range out {
		if rctN[i] > 0 {
			out[i].ReactionMs = round2(rctSum[i] / float64(rctN[i]))
		}
		if preN[i] > 0 {
			out[i].Preaim = round2(preSum[i] / float64(preN[i]))
		}
		out[i].AimRating = round2(AimRating(out[i]))
	}
	return out
}

// AimRating scores AIM QUALITY from 0 to 100 — deliberately not performance.
//
// Four mechanical components, each a thing a player does with their crosshair:
// how often bullets land, how often they land on heads, where the crosshair
// already was when a duel started, and how often the opening duel was won.
// Damage and K/D are excluded on purpose: they measure a game's outcome, and
// mixing outcome into an aim number is how a rating stops meaning anything.
//
// Each component is clamped between a floor and ceiling drawn from ordinary
// matchmaking play, so one freak round cannot dominate and the output reads
// like a percentile. Reaction time is NOT used: the parser measures
// spotted-to-kill, which on real demos ranges past 1400ms because it includes
// repositioning and holding an angle — a measure of engagement, not reflex.
//
// The bands below are provisional. They are honest guesses at MM-average play,
// and the right long-term source for them is our own corpus percentiles once
// it is large enough to define them. Until then this is a comparative read,
// not an absolute one.
func AimRating(p PlayerSummary) float64 {
	if p.Shots == 0 && p.Kills == 0 {
		return 0
	}
	acc := band(p.Accuracy(), 0.08, 0.30)
	hs := band(p.HeadshotPct(), 0.15, 0.60)
	open := band(p.OpeningWinPct(), 0.30, 0.70)
	// Crosshair placement: lower is better, so the band is inverted. Unmeasured
	// preaim falls back to the midpoint rather than scoring a perfect zero.
	pre := 0.5
	if p.Preaim > 0 {
		pre = 1 - band(p.Preaim, 3, 12)
	}
	return 100 * (0.35*acc + 0.25*hs + 0.25*pre + 0.15*open)
}

// band maps v onto 0..1 between lo and hi, clamping outside.
func band(v, lo, hi float64) float64 {
	if hi <= lo {
		return 0
	}
	if v <= lo {
		return 0
	}
	if v >= hi {
		return 1
	}
	return (v - lo) / (hi - lo)
}

func safeRatio(n, d int) float64 {
	if d <= 0 {
		return 0
	}
	return float64(n) / float64(d)
}
