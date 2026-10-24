# Getting started

## Install

1. Download the package for Windows, macOS, or Linux from [Releases](https://github.com/SEApodEErman/osu-ReqTrac/releases/latest).
2. Install and open osu!ReqTrac.
3. Follow the first-run setup, or skip it and return to **Settings** later.

Node.js is only needed for development. Requests can be tracked manually without an osu! API connection.

## Set up the osu! API

The standard setup uses your own OAuth application to read public beatmap and profile data.

1. Open your [osu! account settings](https://osu.ppy.sh/home/account/edit#oauth) and scroll to **OAuth**.
2. Choose **New OAuth Application** and give it a name, such as “ReqTrac.”
3. For the standard public-data setup, the callback URL is unused. Leave it empty, or enter `http://localhost` if the form requires a value.
4. Paste the **Client ID** and **Client Secret** into the first-run setup or **Settings → osu! connection**. ReqTrac checks them with osu! before saving.
5. Optionally enter your osu! username, profile link, or user ID. ReqTrac uses it to identify your guest difficulties and exclude your own account from requester rankings.

You do not need an account sign-in for this standard setup. Developers working on the separate OAuth callback flow should see [Development](https://github.com/SEApodEErman/osu-ReqTrac/wiki/Development).

## Add your first request

Paste a beatmap link with **Add request**, pick a category, and set the status, priority, and deadline as needed. Requests without an osu! link can be entered manually.

For work you have already finished, choose **Completed** when adding it. Past deadlines are allowed; the completion timestamp is recorded when the request is created.

Next: [Using ReqTrac](https://github.com/SEApodEErman/osu-ReqTrac/wiki/Using-ReqTrac).
