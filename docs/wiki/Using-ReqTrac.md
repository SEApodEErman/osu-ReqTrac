# Using ReqTrac

## Daily workflow

1. Paste a beatmap link into **Add request**. ReqTrac looks up the map and checks for duplicates.
2. Pick the requested work: hitsounds, guest difficulties, storyboards, or a custom category.
3. Set a status, priority, and optional deadline.
4. Use **Overview** to find overdue work, upcoming deadlines, requests awaiting a decision, and metadata sync failures.
5. Edit status or priority in the table, or open the request drawer for details, difficulties, and history.

You can drag a beatmap link onto the app. Clipboard detection can also offer to add copied links; it can be disabled in Settings.

## Categories and guest difficulties

Manage categories under **Settings → Categories**. Built-in categories can be renamed while retaining their special behavior. Custom categories can be added and archived.

For guest difficulties, select uploaded difficulties or enter planned ones manually. Connecting your osu! account helps ReqTrac recognize difficulties you own.

Manual requests can use Drive or Discord reference links. They can be linked to an osu! beatmap later.

## Import and export

Open **Import** to choose a list of beatmap links, a CSV or Excel file, or a public Google Sheet.

Spreadsheet import walks through source selection, column mapping, review, and import. Choose default categories and whether to skip or update maps already tracked. Review problem rows before importing.

Imports add or update requests. **Restoring a ReqTrac backup replaces the existing data**; see [Data and backups](https://github.com/SEApodEErman/osu-ReqTrac/wiki/Data-and-backups).

Use **Export** in the request table to save the requests currently shown as CSV. To publish a public request list, see [Google Sheets](https://github.com/SEApodEErman/osu-ReqTrac/wiki/Google-Sheets).

## Search and table controls

Use the search box for titles, mappers, requesters, and notes. It also supports filters such as `creator="..." stars>=5.5 mode=mania keys=7 added>=2026-01-01`. Open the search help button for the syntax supported by the current build.

Use the dropdowns to filter by status, priority, deadline, and tag. The **View** menu controls visible columns and density; column order and filters are remembered.

Select several rows for bulk status, priority, tag, category, date, or delete actions. After deleting, use the undo action while it is available.

## Shortcuts

Press **?** in the app for the full list. On macOS, use **Cmd** in place of **Ctrl**.

| Action | Shortcut |
| --- | --- |
| Add request | Ctrl+N |
| Import | Ctrl+I |
| Search | Ctrl+F |
| Overview / All requests | Ctrl+1 / Ctrl+2 |
| Settings | Ctrl+, |
| Navigate / open a table row | Up or Down / Enter |
| Select a range | Shift+Click |
| Save a request | Ctrl+S |
| Submit a new request | Ctrl+Enter |
| Close a dialog | Esc |

Manual and non-osu! requests are excluded from public Google Sheets publishing.
