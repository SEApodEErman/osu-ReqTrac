# UI Command-Center Redesign Design

## Goal

Rebuild osu!ReqTrac as a more polished, all-around desktop application while preserving its current dark/light colour identity, existing SQLite user data, and fast request-triage workflow. The Overview becomes an actionable command centre with stronger analytics derived from existing data.

## Scope

This is a coordinated Electron release: the renderer and backend API may change together. The API is internal to the shipped application; backward compatibility with older renderer builds or external consumers is not required.

The redesign includes the application shell, overview, request workspace, request creation/editing, settings/import/export presentation, a centralized frontend data layer, and a replacement internal REST contract.

It does not add a remote account service, cloud sync, a mobile-first UI, or analytics that require collecting data not already stored by the application or obtainable from its existing cached osu! metadata.

## Product Direction

Use the **command-centre** direction:

- The app opens to an actionable Overview rather than a passive metric page.
- The Requests screen remains a separate, fast, dense work area.
- The Overview emphasizes work that needs attention, current workload, and meaningful trends.
- A compact navigation rail/shell creates more working area without removing category-aware navigation.
- Existing charcoal, lavender, osu! pink, map-status, request-status, and priority colours remain the visual identity.

## Visual System

Retain the existing palette as semantic tokens rather than scattering raw values or inline styles.

| Token family | Existing values / intent |
| --- | --- |
| App surfaces | `--bg-app`, `--bg-sidebar`, `--bg-card`, `--border`, `--hover-bg` in current light and dark themes |
| Primary action and emphasis | `--osu-pink: #ff66aa`, its hover value, and transparent emphasis treatment |
| Request, beatmap, and priority state | Current `--req-*`, `--status-*`, and `--priority-*` colours |
| Typography | Existing Inter body type, Outfit display type, and emoji font stack |

Add token groups for spacing, radii, elevation, control heights, z-index layers, focus treatment, motion duration, and chart-series assignment. Use these through reusable component CSS classes or CSS modules; do not introduce a second colour scheme.

The UI is desktop-first. It must gracefully adapt to smaller Electron windows through collapsible navigation, responsive card grids, table column priority, and drawers, rather than attempting to become a mobile application.

## Information Architecture

### Overview

The Overview is the command centre. Its filter bar supports a configurable date range and one or more category filters. The filter state drives all cards and charts on the screen.

The page contains:

1. A greeting/context header with primary **Add request** action and visible filter summary.
2. KPI cards for active, due soon, completed, and created/completed in the chosen period.
3. An attention queue for overdue/due-soon requests, pending metadata, unassigned guest difficulties, and other existing actionable states. Each item drills through to a prefiltered request list.
4. Request-volume and completion-volume trends over the selected period.
5. Completion-time analytics derived from existing timestamps: median and average time to completion, a distribution/trend view, and a clear empty state when history is insufficient.
6. Category and requester comparisons, including the existing rule that excludes the connected mapper from requester rankings where appropriate.
7. A compact recent activity/request stream that links to the request detail.

### Requests

Requests remains a focused workspace with a sticky toolbar for search, filters, sort, view density, saved filter presets, bulk actions, and **Add request**. The default view keeps the current dense table strengths while improving column hierarchy, status controls, selected rows, and empty/loading/error states.

Opening a request uses a right-side details drawer where window width permits. The drawer supports editing, beatmap changes, metadata/date refresh, history, and contextual destructive actions. It falls back to a modal-style full focus surface at constrained widths. Links from Overview prepopulate the relevant request filters instead of duplicating a new list UI.

### Categories, Composer, and Settings

Categories stay in navigation and become first-class request/analytics filters. Category-specific behaviour is rendered by configuration rather than separate screen implementations.

The request composer is one progressive form for manual and osu!-linked requests. It groups beatmap metadata, requester, categories/tags, priority/deadline, notes, and guest difficulties into clear sections. Duplicate detection, linking, and failure recovery stay explicit.

Settings groups account/OAuth, Google Sheets, metadata sync, data use, imports/exports, categories, and destructive maintenance actions into clearly labelled sections. Existing workflows stay available.

## Frontend Architecture

Replace the current `App.jsx` orchestration and direct component `fetch` calls with feature-oriented modules:

```text
frontend/src/
  app/                 shell, route/view state, providers, Electron integration
  api/                 HTTP transport, endpoint clients, response validation, errors
  components/ui/       tokens and reusable controls (button, field, dialog, drawer, table)
  features/
    overview/          filters, KPI cards, charts, attention queue, drill-throughs
    requests/          list query state, table/cards, bulk toolbar, detail drawer
    request-composer/  create/edit/link/duplicate workflows
    settings/          configuration and integration surfaces
    imports/           import/export and job presentation
  hooks/               only truly cross-feature hooks
```

`App.jsx` becomes a composition root, not the owner of every request, modal, polling, and mutation state. Feature hooks consume endpoint clients, own local view state, and invalidate/refetch only affected resources after mutations.

The client transport applies timeouts, JSON parsing, response validation, normalized errors, and cancellation. Components never call `fetch` directly. Pending work is displayed from the shared job model rather than each feature inventing its own polling state.

## Replacement API Contract

The API is intentionally contract-breaking for this coordinated release. During implementation, update the backend and renderer at the same time, then remove unused legacy endpoints and response shapes. Static `/uploads/covers/*` paths remain usable because they are persistent local assets.

### Shared envelopes

Success responses return the resource or a named object documented by the endpoint. Errors always return:

```json
{
  "code": "REQUEST_NOT_FOUND",
  "message": "Request not found.",
  "details": { "requestId": 42 }
}
```

Long-running mutations return HTTP `202` and:

```json
{
  "job": {
    "id": "job_...",
    "kind": "metadata-sync",
    "status": "queued",
    "progress": { "completed": 0, "total": 120 }
  }
}
```

`GET /api/jobs/:id` returns the same job shape until it is terminal, with `result` or a normalized error once complete.

### Application bootstrap

`GET /api/app/bootstrap` supplies the shell's first render:

```json
{
  "account": { "id": 1, "username": "mapper", "avatarUrl": "..." },
  "configuration": { "isConfigured": true, "osu": { "connected": true }, "google": { "connected": false } },
  "categories": [],
  "tags": [],
  "capabilities": { "imports": true, "googleSheets": true }
}
```

This replaces initial independent requests for settings, categories, tags, and osu! status. Expensive analytics and the request list are not included.

### Requests

`GET /api/requests` accepts `page`, `pageSize`, `sort`, `direction`, `search`, repeated `categoryId`, repeated `status`, repeated `tag`, `priority`, `due`, and a persisted-filter identifier when supplied by the new UI. It returns:

```json
{
  "data": [],
  "page": 1,
  "pageSize": 50,
  "total": 128,
  "facets": { "statuses": [], "categories": [], "tags": [] }
}
```

`GET /api/requests/:id?include=history,difficulties` returns one normalized request and only requested detail collections. `POST /api/requests`, `PATCH /api/requests/:id`, and `DELETE /api/requests/:id` return a normalized request or success envelope.

Use `POST /api/requests/:id/actions/link-beatmap`, `change-mapset`, and `refresh-date` for request-specific actions. Replace the current multi-shape bulk patch/delete routes with `POST /api/requests/bulk`, whose body contains an explicit `action`, `ids`, and action payload, for example:

```json
{ "action": "set-status", "ids": [1, 2], "requestStatus": "Working" }
```

The response contains `affectedIds`, `skipped`, and a `job` when an action is asynchronous. Request listing and detail mutations preserve all existing request fields needed to render current data; response names use one consistent casing.

### Analytics

`GET /api/analytics/overview` accepts ISO `from` and `to` dates, repeated `categoryId`, and explicit `groupBy`/comparison choices. It returns only data already derivable from existing requests, categories, history, and cached user/beatmap metadata:

```json
{
  "range": { "from": "2026-01-01", "to": "2026-08-10" },
  "kpis": {},
  "attention": [],
  "volumeTrend": [],
  "completionTime": { "averageDays": 0, "medianDays": 0, "trend": [] },
  "categoryComparison": [],
  "requesterComparison": [],
  "recentRequests": []
}
```

The backend validates date bounds, category IDs, grouping values, and a bounded maximum date range. SQL queries compute aggregations server-side; the frontend does not load all requests just to calculate charts.

### Configuration, catalogues, integrations, and imports

Category and tag endpoints retain REST collection/resource semantics but adopt the shared error envelope and casing. Account settings and connection state are grouped under a configuration endpoint. osu! OAuth, Google Sheets, metadata refresh, spreadsheet import, JSON import/export, and beatmap-link import return either an immediate normalized result or the shared job envelope. Existing file upload remains multipart where necessary.

## Data Safety and Database Migration

The redesign does not delete, transform incompatibly, or reset existing user records. It preserves requests, categories, tags, history, cached beatmap metadata/covers, settings, OAuth connections, Google Sheets connection, and backup data.

Any persistent additions are additive: saved filter presets, dashboard preferences, analytics indexes, or job metadata. Migrations live in `backend/src/db.js`, are idempotent, and run only after an automatic backup succeeds. A failed migration must leave the existing database usable and show a clear recovery/restore path. No migration drops a table or existing column in this release.

## Error Handling and Accessibility

- Show normalized server errors in contextual form fields or task surfaces, with an error code available for support.
- Use a clear retry path for recoverable network, metadata, job, and OAuth errors.
- Keep optimistic UI limited to safe, immediately reversible state; refetch list/detail/analytics after mutations that influence aggregates.
- Provide loading skeletons, empty states, and per-surface error states rather than blocking the entire app.
- Support keyboard navigation, visible focus, sensible focus restoration after drawers/dialogs, reduced motion, semantic labels, and adequate contrast in both themes.

## Verification and Release Plan

1. Add or update backend route tests for bootstrap, request query/filter/pagination, request mutations, analytics validation/aggregation, jobs, and every schema migration.
2. Add frontend unit tests for request query/filter serialization, analytics filter state, drill-through state, error normalization, and calculated display helpers. Add component tests only where interaction behaviour is complex.
3. Run the backend test suite and frontend Node tests; run `npm run build:frontend` for production renderer validation.
4. Create a copy of an existing SQLite database, run the migration, and manually exercise bootstrap, request create/edit/delete, duplicate recovery, bulk actions, import/export, metadata sync, OAuth/Google status, settings, and analytics filters.
5. Package an unpacked Electron build and verify title-bar controls, external links, update notification, local backend origin, and both visual themes.
6. Release only after the backup/migration smoke test and packaged critical-flow smoke test pass. If a post-release migration issue is found, restore from the pre-migration backup rather than attempting destructive manual repair.

## Acceptance Criteria

- The app presents the command-centre Overview and dedicated Requests workspace using the existing visual identity.
- All current request, category, tag, metadata, integration, import/export, and settings workflows remain available.
- Overview date/category filters drive KPIs, attention, trend, completion-time, and comparison analytics from existing data.
- Frontend components do not call `fetch` directly; the centralized client handles contract, timeout, and errors.
- The backend and frontend use the documented replacement contract and shared job/error models.
- Existing SQLite data survives upgrade without loss; all persistent changes are additive and backed up.
- Automated tests, production renderer build, existing-database migration check, and packaged Electron smoke checks pass.
