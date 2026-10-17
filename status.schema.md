# `status.json` schema — Leo's AI agent office

`office.html` renders the pixel office from a single status object. It loads
`status.json` (same folder) on page load and then **every 60 seconds**.

| Situation | What the page shows |
|---|---|
| `status.json` loads and has an `agents` array | **Live** mode, with the badge `Live · updated HH:MM WIB` (from `updated_at`) |
| File missing, 404, invalid JSON, or no `agents` array, and no live data loaded yet | **Demo** mode, with the badge `Demo data` and the built-in generator running |
| A refresh fails after live data has loaded | Keeps the last live snapshot (no flip back to demo) |
| `?demo=1` in the URL | Always demo, never fetches |

Other query params:
- `?status=<url>` loads a different file, e.g. `office.html?status=status.sample.json`
- `?hour=<0-23.99>` overrides the Jakarta hour used for the window light (for previews)

> Note: browsers block `fetch()` on `file://`. To use live mode, serve the folder over HTTP
> (for example `python3 -m http.server` in this folder, or any static host). Opened straight from disk, the page runs in demo mode.

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
| `state` | `"working"` \| `"thinking"` \| `"idle"` | yes | Drives the animation. Unknown values are ignored and the previous state is kept. |
| `task` | string | yes | Caption under the desk (≤ 140 chars, clamped to 2 lines). **Keep it generic.** |

The `handoff` state is never written by hand. The page shows it automatically while an agent walks a handoff over.

Desk ids, in the order they appear on screen:

Row 1: `archangel`, `waktu`, `willow`, `atlas`, `wish`, `altmodei`, `brin`
Row 2: `lake`, `ote2`, `luke`, `alx`, `kate`, `coach` (then the lounge)

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
a sanitized one-line task, appends new handoffs, and writes `status.json` next to `office.html`.
See `status.sample.json` for a complete example.
