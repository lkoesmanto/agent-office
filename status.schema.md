# `status.json` schema — Leo's AI agent office

`index.html` (Pixel) and `3d.html` (3D) render the office from a single status object, `status.json`
in the same folder. Shared logic lives in `shared.js` / `shared.css`.

> Browsers block `fetch()` on `file://`, so serve the folder over HTTP (GitHub Pages, or `python3 -m http.server`).
> If a fetch fails before any snapshot has loaded, the demo keeps running and a note says so. Once live data has loaded, the last snapshot stays on screen.

## Live controls (header)

The page **never fetches `status.json` on load**. It opens **paused**, runs the demo animation and shows `Paused · demo`.
There are no webhooks, no settings panel and no stored keys. The page only reads the published `status.json`.

| Control | Behavior |
|---|---|
| **Refresh** (blue) | Goes **live** and re-reads `status.json` now, then every 60 s (with a `?t=<ms>` cache-buster). The badge reads `Live · updated HH:MM WIB · auto-pause in 1h59m`. Pressing it again while live re-reads immediately and restarts the 2 h window. |
| **Pause** (grey) | Stops polling immediately and returns to paused/demo. Disabled unless live. |
| **Auto-pause** | Exactly 2 h after the most recent Refresh press, the page pauses itself and shows a quiet note. |

To get fresher data, the writer job publishes a new `status.json`. Refresh just picks up whatever is published.
(Settings from older versions, `agentOffice.settings.v1` / `agentOffice.lastUpdateRequest`, are deleted from localStorage on load.)

Query params: `?demo=1` (always demo; Refresh disabled), `?status=<url>` (snapshot URL used when live),
`?autopause=<minutes>` (test override for the 2 h window), `?hour=<0-23>` (window light preview),
`?handoff=<from>,<to>[,label]` (demo test: queue one handoff right away, e.g. `?demo=1&handoff=brin,luke` for a cross-floor walk).
The **Pixel | 3D** switch keeps the current query string.

## 3D view (`3d.html`)

A three.js (r160, pinned on jsDelivr) low-poly **two-storey cutaway office**: the front wall and ceiling are removed, so both floors are visible.
It uses the same `shared.js` data layer and controls, so every rule in this document applies to both views.

- **Upstairs, executive floor:** a glass-railed mezzanine. **Archangel** (Chief of Staff) sits at the corner boss desk: L-shaped walnut desk, dual monitors, leather high-back chair, brass *Chief of Staff* nameplate, rug and plants, with a larger gold label and a ★ badge. Atlas, Wish and Brin sit in the back row, AltModei and Ote2 in the front row.
- **Downstairs, operations:** Waktu, Willow, Lake and Luke (back row) and Alx, Kate and Presentation Coach (front row), plus the coffee station, lounge, whiteboard and wall clock.
- **Stairs:** an open-riser staircase with glass balustrades on the right. A handoff between floors walks along the aisle, up or down the stairs, and over to the receiving desk.
- A single shadow-casting light. Orbit with drag and zoom with scroll (no pan, limited angles). The camera drifts slowly when nobody has touched it for 6 s.

## Top-level object

```jsonc
{
  "updated_at": "2026-10-17T15:45:00+07:00", // ISO 8601 with offset (required). Shown in WIB.
  "agents":   [ Agent, ... ],                 // required, may be partial
  "handoffs": [ Handoff, ... ]                // optional
}
```

## Agent

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes* | One of the fixed desk ids below. *If missing, matched by `name` (case-insensitive). |
| `name` | string | no | Display name override (≤ 40 chars). |
| `role` | string | no | Role shown on the nameplate (≤ 40 chars). |
| `state` | `"working"` \| `"thinking"` \| `"idle"` \| `"stretching"` | yes | Drives the animation. Unknown values are ignored and the previous state is kept. **`working` with a task containing "stretch" (case-insensitive) is shown as `stretching`.** |
| `task` | string | yes | Caption under the desk (≤ 140 chars; 2 lines in Pixel, 1 line in 3D). **Keep it generic.** |

Animations: **working** = typing, **thinking** = thought bubble, **idle** = leaning back with coffee,
**stretching** = standing beside the chair, arms overhead, side bends and shoulder rolls (green-teal dot; per-agent timing offsets so the team doesn't move in lockstep).

The `handoff` state is never written by hand. The page shows it automatically while an agent walks a handoff over.

Desk ids (fixed). Pixel view order:

Row 1: `archangel`, `waktu`, `willow`, `atlas`, `wish`, `altmodei`, `brin`
Row 2: `lake`, `ote2`, `luke`, `alx`, `kate`, `coach` (then the lounge)

3D view: upstairs `archangel` (boss desk), `atlas`, `wish`, `brin`, `altmodei`, `ote2`; downstairs `waktu`, `willow`, `lake`, `luke`, `alx`, `kate`, `coach`.

Agents missing from the file keep their previous values (on first load, `idle` with an empty caption).
Unknown ids are ignored.

## Handoff

| Field | Type | Required | Notes |
|---|---|---|---|
| `from` | desk id | yes | Agent who walks over carrying the folder. |
| `to` | desk id | yes | Receiving agent. Must differ from `from`. |
| `label` | string | yes | Short description (≤ 80 chars), e.g. "research brief ready". |
| `at` | ISO 8601 | yes | When the handoff happened. Shown in the feed as HH:MM WIB. |

Behavior:
- Each handoff is de-duplicated by `from|to|at|label`. Leave already-shown handoffs in the file (a rolling list of the last ~10 is ideal). Only **new** ones animate.
- On the first live load, every handoff fills the feed (newest 3 visible) and the newest 2 replay as walks.
- On later polls, each new handoff walks across the office. It joins the feed when the folder is handed over.
- At most 3 walks run at once. An agent can't take part in two walks at the same time, so extra walks queue.

## Content rules (this goes on LinkedIn)
- No client names, people's names, emails, amounts, deal terms, or anything confidential.
- Use generic phrasing: "Reviewing a standard NDA template", not "Reviewing the NDA with <Company>".
- The writer should do an atomic write (write `status.json.tmp`, then rename) so the page never reads half a file.

## Phase 2 hook-up (suggested)
A small job (cron or agent hook) runs every 1–5 minutes, collects each agent's current state and
a sanitized one-line task, appends new handoffs, and writes `status.json` next to `index.html`.
See `status.sample.json` for a complete example.
