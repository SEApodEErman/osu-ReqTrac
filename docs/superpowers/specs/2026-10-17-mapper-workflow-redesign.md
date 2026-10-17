# Mapper-Workflow Redesign (opus5.5-redesign)

This records what the `opus5.5-redesign` branch changed and the calls made where the audit left choices open. It supersedes the delivery approach of `2026-08-10-ui-command-center-redesign-design.md`: the visual and Overview direction was kept, but the API stayed backward compatible and changed only where speed or the new flows needed it.

## Audit findings that drove the work

- First launch dropped people into Settings with no explanation of the osu! OAuth callback, a format-only "valid" check, a dead osu! login route, and an "osu! API disconnected" label that only meant "no user ID typed".
- Preferences lived in `localStorage`, but the packaged backend bound to a random port, so the renderer origin (and its storage) changed on every launch.
- Every inline edit refetched the whole request list (about 5 MB at 2,000 requests, mostly unused difficulty data), the osu! status was polled every second and re-rendered the whole app, and the add-request lookup fired on every keystroke into a 2-second FIFO queue that background syncs could fill for minutes.
- Calendar dates were parsed as UTC (deadlines a day early west of UTC), category selection leaked across tabs, fonts loaded from Google, flags didn't render on Windows, settings put "Delete all data" third, and wording varied between screens.

## Decisions

| Question | Call | Why |
| --- | --- | --- |
| Rewrite the API (August spec) or extend it? | Extend it. | Shipping risk is in the API rewrite; mappers feel the UI and the speed. Additions: `?ids=` row reads, preferences, credential test, identity lookup, initial status, batched refreshes. |
| Categories as sidebar tabs or filter chips? | Keep sidebar tabs, add active counts. | Mappers think in "my hitsound queue" vs "my GD queue". Selection and filters are now scoped per tab, which fixes the leak without losing the tabs. |
| Where do preferences live? | `settings.ui_preferences` in SQLite, plus a stable Electron port. | Survives restarts regardless of port and travels with backups. `localStorage` only caches the theme for first paint. |
| osu! account connection | Look up by username, profile link, or ID with the app's client credentials. | Mappers know their username, not their numeric ID; the authorization-code login needs a registered callback, which ReqTrac can't guarantee. The old route is left in place, unused. |
| osu! rate limits | Priority lanes; 60/min for user actions and bulk jobs, 30/min for background upkeep; batch users and beatmaps 50 per call. | Matches osu!'s published guidance while making clicks feel instant. |
| Single deletes | Delete immediately with a 6-second Undo; confirm only for 10+ at once. | Confirm dialogs for every row slow triage; select-all + Delete must not wipe a library silently. |
| Request details | Right-side drawer with Details / Difficulties / History tabs. | Keeps the table visible, and history is rarely needed at first glance. |
| Adding requests | Dialog with live preview, remembered categories, quick deadlines, add-another mode, Ctrl+Enter. | Requests arrive in bursts from Discord; keyboard-first saves time. |
| Initial status | Considering / Accepted / Working, default Accepted. | Many mappers log requests before deciding. |
| Adding while osu! is unreachable | Save the request and queue its metadata. | A request shouldn't be lost because osu! is down or not set up yet; failed syncs retry when credentials are saved. |
| Clipboard link detection | On by default, Electron only, asks via toast, never adds silently. | Copying a link is the most common first step; it can be turned off in Settings. |
| Persisting search text | No (filters and sort are persisted). | Stale searches on launch hide requests and confuse. |
| Overview contents | Up-next banner, clickable KPIs, needs-attention queue, 12-month chart, top requesters (excluding you), yearly table. | Answers "what do I work on now" before "how am I doing". |
| Flags and fonts | Bundle Inter/Outfit variable fonts and the Twemoji country-flag font (only used where flags are missing). | Offline-safe, no Google requests, flags render on Windows. |

## Follow-ups not done here

- Saved custom views beyond per-category memory.
- OS-level deadline reminders (the Overview covers in-app attention).
- Running the osu! authorization-code login inside the app, if the callback question is ever settled.
