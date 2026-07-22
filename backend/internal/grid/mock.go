package grid

import "time"

// sampleMatches returns a small, realistic board — 2 live + 3 upcoming — used in
// mock mode (GRID_MOCK=1) so the UI can be exercised with no key and no network.
// Team ids are the gridId keys referenced by seriesScore/scoreByTeam/sideByTeam.
func sampleMatches(now time.Time) []MatchState {
	rfc := func(t time.Time) string { return t.UTC().Format(time.RFC3339) }

	team := func(id, name, short, primary, secondary string) Team {
		return Team{GridID: id, Name: name, ShortName: short, ColorPrimary: primary, ColorSecondary: secondary}
	}

	// Build a simple finished-round list alternating winners.
	rounds := func(n int, a, b string) []Round {
		out := make([]Round, 0, n)
		for i := 1; i <= n; i++ {
			w, side := a, "CT"
			if i%2 == 0 {
				w, side = b, "T"
			}
			out = append(out, Round{Number: i, WinnerTeam: w, WinnerSide: side, Finished: true})
		}
		return out
	}

	navi := team("t-navi", "Natus Vincere", "NAVI", "#f0cd78", "#111827")
	faze := team("t-faze", "FaZe Clan", "FaZe", "#e43b44", "#111827")
	vita := team("t-vita", "Team Vitality", "VIT", "#f6d743", "#0a0a0a")
	spirit := team("t-spirit", "Team Spirit", "SPR", "#2b6cff", "#0a0a0a")
	g2 := team("t-g2", "G2 Esports", "G2", "#e1000f", "#111827")
	mouz := team("t-mouz", "MOUZ", "MOUZ", "#e2231a", "#111827")
	astr := team("t-astr", "Astralis", "AST", "#e4002b", "#111827")
	liquid := team("t-liquid", "Team Liquid", "TL", "#0a1f4d", "#38d6ff")
	heroic := team("t-heroic", "Heroic", "HER", "#00b3a4", "#0a0a0a")
	c9 := team("t-c9", "Cloud9", "C9", "#0088ce", "#111827")

	// LIVE 1 — NAVI 1-0 FaZe, map 2 in progress.
	live1 := MatchState{
		SeriesID:          "mock-2911001",
		Status:            "live",
		StartScheduled:    rfc(now.Add(-40 * time.Minute)),
		FormatName:        "Best of 3",
		FormatShort:       "Bo3",
		BestOf:            3,
		TournamentID:      "trn-iem-cologne-2026",
		TournamentName:    "IEM Cologne 2026",
		TournamentLogoUrl: "",
		Teams:             []Team{navi, faze},
		SeriesScore:       map[string]int{navi.GridID: 1, faze.GridID: 0},
		CurrentMap:        2,
		Valid:             true,
		LiveUpdatedAt:     rfc(now),
		FetchedAt:         rfc(now),
		StreamUrl:         "https://twitch.tv/esl_csgo",
		Maps: []MapState{
			{
				Sequence: 1, MapName: "Mirage", Started: true, Finished: true,
				ScoreByTeam: map[string]int{navi.GridID: 13, faze.GridID: 9},
				SideByTeam:  map[string]string{navi.GridID: "CT", faze.GridID: "T"},
				WinnerTeam:  navi.GridID,
			},
			{
				Sequence: 2, MapName: "Inferno", Started: true, Finished: false,
				ScoreByTeam:  map[string]int{navi.GridID: 9, faze.GridID: 6},
				SideByTeam:   map[string]string{navi.GridID: "CT", faze.GridID: "T"},
				CurrentRound: 16, ClockSeconds: 42,
				Rounds:     rounds(15, navi.GridID, faze.GridID),
				WinnerTeam: "",
			},
		},
	}

	// LIVE 2 — Vitality 0-0 Spirit, map 1 early.
	live2 := MatchState{
		SeriesID:          "mock-2911002",
		Status:            "live",
		StartScheduled:    rfc(now.Add(-8 * time.Minute)),
		FormatName:        "Best of 3",
		FormatShort:       "Bo3",
		BestOf:            3,
		TournamentID:      "trn-iem-cologne-2026",
		TournamentName:    "IEM Cologne 2026",
		Teams:             []Team{vita, spirit},
		SeriesScore:       map[string]int{vita.GridID: 0, spirit.GridID: 0},
		CurrentMap:        1,
		Valid:             true,
		LiveUpdatedAt:     rfc(now),
		FetchedAt:         rfc(now),
		StreamUrl:         "https://twitch.tv/esl_csgo",
		Maps: []MapState{
			{
				Sequence: 1, MapName: "Ancient", Started: true, Finished: false,
				ScoreByTeam:  map[string]int{vita.GridID: 3, spirit.GridID: 2},
				SideByTeam:   map[string]string{vita.GridID: "T", spirit.GridID: "CT"},
				CurrentRound: 6, ClockSeconds: 78,
				Rounds:     rounds(5, vita.GridID, spirit.GridID),
				WinnerTeam: "",
			},
		},
	}

	// UPCOMING x3.
	up1 := MatchState{
		SeriesID: "mock-2911003", Status: "upcoming",
		StartScheduled: rfc(now.Add(30 * time.Minute)),
		FormatName:     "Best of 3", FormatShort: "Bo3", BestOf: 3,
		TournamentID: "trn-iem-cologne-2026", TournamentName: "IEM Cologne 2026",
		Teams: []Team{g2, mouz}, Valid: false,
	}
	up2 := MatchState{
		SeriesID: "mock-2911004", Status: "upcoming",
		StartScheduled: rfc(now.Add(2 * time.Hour)),
		FormatName:     "Best of 1", FormatShort: "Bo1", BestOf: 1,
		TournamentID: "trn-iem-cologne-2026", TournamentName: "IEM Cologne 2026",
		Teams: []Team{astr, liquid}, Valid: false,
	}
	up3 := MatchState{
		SeriesID: "mock-2911005", Status: "upcoming",
		StartScheduled: rfc(now.Add(5 * time.Hour)),
		FormatName:     "Best of 5", FormatShort: "Bo5", BestOf: 5,
		TournamentID: "trn-iem-cologne-2026", TournamentName: "IEM Cologne 2026 — Grand Final",
		Teams: []Team{heroic, c9}, Valid: false,
	}

	return []MatchState{live1, live2, up1, up2, up3}
}
