# `status.json` schema — Leo's AI agent office

`index.html` (Pixel) and `3d.html` (3D) render the office from a single status object, `status.json`
in the same folder. Shared logic lives in `shared.js` / `shared.css`.

> Browsers block `fetch()` on `file://`, so serve the folder over HTTP (GitHub Pages, or `python3 -m http.server`).
> If a fetch fails before any snapshot has loaded, the demo keeps running and a note says so. Once live data has loaded, the last snapshot stays on screen.

## Live controls (header)

The page **never fetches `status.json` on load**. It opens **paused**, runs the demo animation and shows `Paused · demo`.

| Control | Behavior |
|---|---|
| **Refresh** (blue) | Goes **live**: fetches `status.json` now and every 60 s (with a `?t=<ms>` cache-buster). The badge reads `Live · updated HH:MM WIB · auto-pause in 1h59m`. If a webhook is configured, also POSTs to it (see below). Pressing it again while live **restarts the 2-hour window**. |
| **Pause** (grey) | Stops polling immediately and returns to paused/demo. |
| **Auto-pause** | Exactly 2 h after the most recent Refresh press, the page pauses itself. |
| **Gear** | Settings: *Webhook URL*, *Sender key*, *Key header name* (default `Authorization`). Saved **only in this browser's localStorage** (`agentOffice.settings.v1`). **Clear** removes them. Never stored in the repo or page source. |

Webhook request (only if a URL is set):
- `POST <Webhook URL>`, `Content-Type: application/json`, body `{"action":"refresh_status","requested_at":"<ISO UTC>"}`.
- Key header: if the header name is `Authorization`, it is sent as `Bearer <key>`. Any other name (e.g. `X-Sender-Key`) sends the raw key. With no key set, no key header is sent.
- Fire and forget. The Refresh button shows **Updating…** until `status.json`'s `updated_at` changes (or reaches the request time), or 5 minutes pass.
- At most **once per 5 minutes** (stored as `agentOffice.lastUpdateRequest`). While live and inside that window, Refresh is disabled and shows `Refresh in m:ss`. Pressing Refresh from paused during the window goes live without re-sending the request.
- On a CORS/network/HTTP failure, the page shows a quiet note: *Couldn't request an update, showing the last snapshot*. The receiver must allow CORS from `https://lkoesmanto.github.io` (preflight `OPTIONS` for `Content-Type` + the key header).
- Without a webhook, Refresh still goes live with whatever `status.json` is already published.

Query params: `?demo=1` (always demo; Refresh disabled), `?status=<url>` (snapshot URL used when live),
`?autopause=<minutes>` (test override for the 2 h window), `?hour=<0-23>` (window light preview).
The **Pixel | 3D** switch keeps the current query string.
`3d.html` is a three.js (r160, pinned on jsDelivr) low-poly version of the same office. It uses the same `shared.js` data layer and controls, so every rule here applies to both views.

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
