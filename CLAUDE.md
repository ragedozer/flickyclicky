# Daily Shooter — Project Brief

## What This Is

A daily web-based clicking speed and accuracy game. Each day everyone in the world gets the same set of targets (deterministically seeded from the date). Players shoot targets for score, then share results. Takes ~1 minute to play.

## Core Mechanics

- **15–18 targets** per round (tuned to ~60 seconds)
- **Accuracy score**: distance from center on click → concentric ring zones (bullseye = max points)
- **Speed score**: time between target appearance and click → faster = bonus points, up to a cap
- **Miss**: clicking when no target is present costs nothing but wastes time
- **No ammo limit** — click freely, only hits on active targets score

## Target Types

1. **Pop-up** — appears at a fixed position, stays for a timed window, then fades out
2. **Drifter** — spawns at an edge, moves slowly across the screen
3. **Flyby** — spawns at an edge, moves fast across the screen (harder, more points potential)

## Scoring

- Bullseye ring: 100 pts base
- Inner ring: 75 pts
- Mid ring: 50 pts
- Outer ring: 25 pts
- Speed bonus: additive, up to 100 pts, decaying exponentially with reaction time
  (`SPEED_BONUS_PEAK * e^(-reactionMs / SPEED_DECAY_MS)`) — rewards fast "flick" clicks
  even on lower-value rings, e.g. an instant outer-ring hit (25 + ~100 = 125) can beat a
  slow bullseye (100 + ~4 = 104)
- Moving-target bonus: (base + speed bonus) is multiplied by `TYPE_SCORE_MULT`
  (drifter ×1.2, flyby ×1.35, popup ×1) — rewards hitting harder, moving targets
- Max possible per target: 200 pts (popup bullseye + instant); higher for drifter/flyby
- Max total (18 targets): 3600 pts (running total is clamped to this cap)

## Daily Seed System

- Seed = `YYYY-MM-DD` string → simple hash → deterministic RNG (mulberry32)
- Seed controls: target count, types, spawn positions, timing gaps, movement directions/speeds
- Same seed → same game for every player on that day
- "Already played" gate: stores today's date + score in localStorage
- Players can replay after seeing results but score is locked on first completion

## Share Feature

- Emoji grid: one emoji per target showing performance tier
  - 🎯 bullseye, ✅ inner, 🟡 mid, ⭕ outer, ❌ miss
- Copy text format:
  ```
  Daily Shooter — June 9 2026
  Score: 2840 / 3600 (A)
  🎯✅🎯🟡✅🎯❌🎯✅✅🎯🟡🎯✅🎯

  Play at: https://placeholder.url
  ```
- Button copies to clipboard, shows "Copied!" confirmation

## Grade Tiers

| Score % | Grade |
|---------|-------|
| 90–100  | S     |
| 75–89   | A     |
| 55–74   | B     |
| 35–54   | C     |
| <35     | D     |

## Tech Stack

- **Vanilla HTML5 / CSS / JS** — single `index.html` + `game.js` + `style.css`
- **No build step, no framework, no dependencies**
- **HTML5 Canvas** for game rendering
- **Web Audio API** for synthesized sound effects (no audio files)
- **localStorage** for daily result persistence and 7-day history
- Deployable to any static host (Netlify, Vercel, GitHub Pages)

## File Structure

```
/
├── index.html       # Shell, HUD elements, overlay screens
├── style.css        # Layout, overlays, UI styling
├── game.js          # All game logic, rendering, scoring, sharing
└── CLAUDE.md        # This file
```

## Build Plan

### Phase 1 — Core Gameplay

**Sprint 1: Game Engine** ✅ complete
- Canvas renderer
- Target spawning (pop-up type first)
- Click detection + distance-from-center scoring
- Speed scoring
- Basic HUD

**Sprint 2: Target Variety & Feel**
- Drifter and Flyby target types
- Hit feedback: ring burst animation, score popup at click point
- Miss flash
- Web Audio synth sounds (hit pop, miss click, bullseye chime)
- Combo streak visual

### Phase 2 — Daily System & Persistence ✅ complete

**Sprint 3: Seeded Daily Generation** ✅
- mulberry32 seeded RNG
- Seed from YYYY-MM-DD
- All target parameters derived from seed
- "Already played today" gate — shows prior result directly, no re-play of daily

**Sprint 4: Scoring & Results Screen** ✅
- Per-target breakdown table (type, emoji, reaction time, points; expandable)
- Animated score count-up with fanfare sounds per grade
- Stats row: accuracy pts, speed bonus, hits, avg reaction time
- Letter grade with pop animation
- 7-day history from localStorage (shows score under grade, today highlighted)

### Phase 3 — Sharing & Polish ✅ complete

**Sprint 5: Share Feature** ✅
- Emoji grid generation
- Copy-to-clipboard with placeholder URL; button label changes to "Copied!" on success
- Replace URL when deployed (SHARE_URL constant in game.js)

**Sprint 6: Game Feel & Accessibility** ✅
- Intro countdown (3-2-1-GO) with audio
- Screen shake on 3+ miss streak
- Mobile touch support + responsive CSS breakpoints (520px, 360px)
- Idle canvas animation: ambient faded targets drift in background on start/results screens
- Edge spawn indicators: pulsing chevrons appear at canvas border 700ms before a drifter/flyby enters, labelled DRIFT/FLYBY
- Keyboard shortcuts: Space/Enter = start or replay, P = practice mode
- Overlay fade-in transitions
- `touch-action: none` on canvas, `-webkit-tap-highlight-color` suppressed
- Accessible: focus-visible outlines on buttons, aria-label on canvas

### Theme Toggle & Mute ✅ complete

- `#top-controls` (fixed top-right, visible on every screen) holds two icon buttons:
  theme toggle (🌙/☀️) and mute toggle (🔊/🔇).
- Theme: dark is default. Light theme overrides all CSS custom properties under
  `:root[data-theme="light"]` (set via `document.documentElement.dataset.theme`),
  including canvas background/grid colors (`--canvas-bg`, `--grid-line`) and overlay
  scrim (`--overlay-bg`). Canvas `render()` reads these vars via `getComputedStyle` so
  the game canvas matches the theme. Persisted in localStorage as `ds_theme`.
- Mute: a single `muted` flag checked at the top of `playTone()` (the choke point for
  all sound effects) — when muted, no AudioContext work happens. Persisted as
  `ds_muted`.

### Daily Leaderboard ✅ complete

After finishing the daily round (not practice), players can enter a name and submit
their score to a global leaderboard for the day. The board shows everyone's rank,
highlights the player's row, auto-scrolls to it, and lets them scroll up/down through
the full list. The board resets at midnight **Pacific time** for all players.

**Storage**: Firebase Firestore (free tier), loaded via compat SDK `<script>` tags in
`index.html` (no build step / module conversion needed).

- Firestore path: `leaderboard_days/{pacificDateKey}/entries/{autoId}`
- `pacificDateKey` = `YYYY-MM-DD` in `America/Los_Angeles`, computed each load via
  `pacificDateKey()` in `game.js` — when the Pacific date rolls over, the app queries a
  new (empty) doc path, so the board "wipes" naturally with no cleanup job.
- Entry doc: `{ name (≤16 chars), score, grade, ts: serverTimestamp }`
- localStorage key `ds_lb_<pacificDateKey>` records `{ name, score, id }` once a player
  submits, so they can't double-submit and their position re-renders on revisit.

**Setup status**: ✅ done. Live Firebase project `flickyclicky` is configured in
`FIREBASE_CONFIG` (game.js), Firestore is enabled, and the security rules below are
published. Verified end-to-end against the real project — `db` initializes, score
submission writes to `leaderboard_days/{pacificDateKey}/entries`, and the rendered
list shows rank info (e.g. "You're #1 of 1 today").

Security rules (published):
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /leaderboard_days/{day}/entries/{entry} {
      allow read: if true;
      allow create: if request.resource.data.name is string
                    && request.resource.data.name.size() <= 16
                    && request.resource.data.score is number
                    && request.resource.data.score >= 0
                    && request.resource.data.score <= 3600
                    && request.resource.data.grade is string;
      allow update, delete: if false;
    }
  }
}
```

### Phase 4 — Deployment ✅ complete

**Sprint 7: Hosting** ✅
- Repo pushed to GitHub (`ragedozer/flickyclicky`), connected to Vercel for
  auto-deploy on push to `main`
- Live at https://flickyclicky.vercel.app/
- `SHARE_URL` in `game.js` updated to the live URL
- Open Graph + Twitter card meta tags added to `index.html`

## Key Constants (tunable)

```js
TARGETS_PER_ROUND = 18
POPUP_DURATION = 1900             // ms a pop-up target stays visible
SPAWN_GAP_MIN = 750               // ms normal gap between spawns
SPAWN_GAP_MAX = 2000
BURST_GAP_MIN = 0                 // nearly-simultaneous burst gap
BURST_GAP_MAX = 180
BURST_CHANCE = 0.28               // ~28% of gaps are bursts (multiple targets on screen)
SPEED_BONUS_PEAK = 100            // max additive speed bonus, awarded near-instantly
SPEED_DECAY_MS = 600              // exponential decay time constant (ms) for speed bonus
TYPE_SCORE_MULT = { popup: 1, drifter: 1.2, flyby: 1.35 } // moving-target score multiplier
MISS_PENALTY = 50                 // pts deducted per miss (click-miss or expiry), score floors at 0
TARGET_RADIUS = 44                // px, base target size
RING_RADII = [10, 20, 32, 44]    // px radii for each ring zone (bullseye→outer)
LB_NAME_MAX_LEN = 16              // max chars for leaderboard display name
LB_COLLECTION = 'leaderboard_days' // Firestore root collection for daily leaderboards
```

Note: `activeIndices` is an array — multiple targets can be on screen simultaneously during bursts. Click detection picks the closest active target to the click point.

## URL Placeholder

Until deployed, share text uses: `https://placeholder.url`
Replace with real URL in `game.js` → `SHARE_URL` constant.
