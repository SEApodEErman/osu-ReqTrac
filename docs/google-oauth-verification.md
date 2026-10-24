# Google OAuth verification

Prepared on 25 October 2026. The pages and code are local preparation; they do
not mean Google has approved the app or that a submission has been made.

## Public pages and branding

The website source is in `D:\Repos\seapodeerman`. Review and publish those
changes before entering these URLs in Google Auth Platform → Branding:

| Field | Value |
| --- | --- |
| App name | `osu!ReqTrac` |
| Application home page | `https://seapodeerman.top/osu-reqtrac/` |
| Application privacy policy link | `https://seapodeerman.top/osu-reqtrac/privacy/` |
| Application Terms of Service link | `https://seapodeerman.top/osu-reqtrac/terms/` |
| Authorized domain | `seapodeerman.top` |
| Support contact used on the website | `seapodeerman.business@gmail.com` |

Select a support email that Google offers for your account or a managed Google
Group, and keep developer notification addresses monitored. Confirm the website
contact is appropriate before publishing. An existing application icon is at
`build/icon.png`; Google's branding guidance recommends a square 120 × 120 image
under 1 MB.

Check that all three public URLs return the intended page without login and
that the homepage links directly to the same privacy policy URL used in the
console. The policies describe actual public-link exports, local token storage,
backups containing settings, and the difference between disconnect and revoke.
Review those statements as the app operator before publication.

## Domain ownership

1. Open [Google Search Console](https://search.google.com/search-console/).
2. Add a **Domain** property for `seapodeerman.top` if it is not already verified.
3. Add the TXT record Google supplies in **Cloudflare DNS**, which manages this
   domain's authoritative DNS. Preserve the website's existing records.
4. Complete verification. Use a Google account that is also an owner or editor
   of the Cloud project used by the app. Listing a domain under Authorized
   domains alone does not establish ownership.

No TXT verification value has been generated or added by this preparation.

## Use the minimum permission

The updated backend requests only:

```text
https://www.googleapis.com/auth/drive.file
```

Google lists this as a recommended **non-sensitive** scope for the Sheets API.
It supports creating, reading, updating, and formatting spreadsheets created by
the app, plus managing sharing through the Drive API. The app does not have a
picker or a feature for opening arbitrary existing spreadsheets.

In Google Auth Platform → **Data Access**, keep `drive.file` and remove the broad
`spreadsheets` scope if this Cloud project has no other client that requires it.
Do not add broad `drive` access. Enable both the **Google Sheets API** and
**Google Drive API** in this same project.

Older released builds still request `spreadsheets` as well as `drive.file`.
Publish a release containing the narrowed scope before using it as evidence
for verification. Merely editing Data Access does not change old binaries.
Likewise, an existing Google grant is not narrowed by an app update: test by
revoking the previous grant in [Google Account connections](https://myaccount.google.com/connections),
disconnecting locally, and reconnecting with the updated app. Disconnect also
forgets the saved export reference, so publishing after reconnect creates a new
sheet; remove or manage the old sheet separately.

## Desktop client and a real-account check

Keep the existing **Desktop app** OAuth client belonging to this project. The
app opens the system browser, uses PKCE and a one-time state, and receives the
callback at its local HTTP loopback address. The public website hosts app
information; it is not an OAuth callback server. Do not replace the desktop
client with a Web application client just to use the website's domain.

Before submission, use a disposable local workspace and a test Google account:

1. Connect with the updated app and confirm the consent request is limited to
   app-specific Drive files.
2. Publish a few synthetic osu! requests and one manual request. Verify that
   the dashboard and category tabs render, the osu! request notes are present,
   and the manual request is absent.
3. Open the sheet link in a signed-out browser and confirm it is readable.
4. Change a test request and sync again. Confirm the existing export updates
   and formatting still works with only `drive.file`.
5. Disconnect and confirm the local app reports disconnected. The sheet should
   remain in Drive and retain its sharing settings. Revoke the grant separately
   in the Google Account and delete test sheets when finished.

Automated tests mock or avoid Google and cannot prove these real-account steps.
Do not exercise data deletion or restore against the operator's live database.

## Submit through Google Auth Platform

For a public release, configure **Audience** as External and move to production
when ready. Production publishing and verification are separate actions.
Complete the Branding review and use the verification controls shown in the
console, including publishing verified draft branding if prompted. With only
`drive.file`, the expected path is basic/brand verification rather than
sensitive-scope review; Google determines the final requirements for the project.

If the project still requests sensitive scopes, expect separate justification
and a demonstration of their use. Do not justify broad spreadsheet access for
this export flow when per-file access suffices.

Suggested feature explanation, after releasing the updated build:

> osu!ReqTrac is a desktop request tracker. Its optional Google Sheets feature
> creates a spreadsheet in the user's Google Drive, writes and formats an
> export of their osu! requests, and enables anyone-with-the-link read access
> when the user chooses Publish sheet or Sync now. It uses drive.file to work
> with the spreadsheet it creates and to set that file's sharing permissions.
> Tokens and the spreadsheet reference are stored locally on the user's
> computer. No developer-operated server receives the export or Google tokens.

If Google asks for a demonstration, show the app name, connection entry point,
consent permissions, publishing, sheet output, sync, policy links, and disconnect.
Use synthetic data and hide credentials, authorization codes, and tokens.

## Official references

- [Brand verification, domain ownership, homepage and privacy requirements](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)
- [Manage OAuth app branding](https://support.google.com/cloud/answer/15549049?hl=en)
- [Sheets API scopes and their classifications](https://developers.google.com/workspace/sheets/api/scopes)
- [Drive API per-file access](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [OAuth for desktop apps](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)
