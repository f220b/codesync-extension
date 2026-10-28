# CodeSync

A Chrome extension that pushes your accepted **LeetCode**, **GeeksforGeeks** and **Codeforces**
solutions to GitHub repos you choose — automatically, as you solve, plus a one-click backfill of
your full LeetCode and Codeforces history.

## What it does

| Site | When it pushes | History backfill | What lands in the repo |
| --- | --- | --- | --- |
| LeetCode | Right after a submission is judged, and every 15 min in the background (no tab needed) | Yes | `3551. Problem Title/solution.<ext>` + `README.md` with the statement, difficulty and tags |
| Codeforces | Right after a submission is judged, and every 15 min | Yes | `2261H. Problem Title/solution.<ext>` |
| GeeksforGeeks | When the page shows "Problem Solved Successfully" | No | `<problem-slug>/solution.<ext>` |

- Only **accepted** submissions are pushed; for each problem, the newest accepted one wins.
- Unchanged files are skipped, so nothing creates empty commits.
- Backfills commit in batches (up to 40 files per commit) instead of one commit per file.
- File extensions follow the submission language (`.cpp`, `.py`, `.java`, `.go`, …).

## Install

1. Clone this repo.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and pick the cloned folder.
4. Pin CodeSync and click its icon.

## Set up

1. **Create a GitHub token.** GitHub → Settings → Developer settings → Personal access tokens →
   [Fine-grained tokens](https://github.com/settings/personal-access-tokens/new). Under Repository
   access, pick your solutions repos; under Permissions, set **Contents: Read and write**.
2. **Paste it into CodeSync** and click **Continue**. The token is checked against GitHub, saved
   in the extension's local storage, and not shown again.
3. **Enter a repo per site** as `owner/repo` (or a full `https://github.com/…` URL) and click
   **Save**. Each repo is checked for write access. Leave a site blank to skip it.
4. **Link LeetCode and Codeforces.** Log in to each site in Chrome, then click **Link account**.
   Linking starts the first full-history sync.

To change the token, click **Reset**. It clears the token, repos, linked accounts and sync state,
and returns to step 2.

## Daily use

Solve problems as usual. The card for each site shows its last result, e.g.
`Up to date · 3 pushed · 10/28/2026, 6:30 PM`.

- **Re-sync full history** walks every submission again. Files already in the repo are skipped,
  so it's safe to run any time.
- **Relink** if you switch LeetCode or Codeforces accounts.
- Codeforces sync briefly opens a background tab per new solve: its submission pages sit behind a
  Cloudflare check that a plain background request can't pass.

## Permissions

| Permission | Why |
| --- | --- |
| `storage` | Token, repos, linked accounts, sync cursors |
| `alarms` | The 15-minute background sync |
| `cookies`, host access to `leetcode.com` | Reads your submissions with your existing LeetCode login |
| `declarativeNetRequestWithHostAccess` | Makes background LeetCode requests look same-site, or LeetCode rejects them |
| `scripting`, host access to `codeforces.com`, `geeksforgeeks.org` | Reads the solution code from the editor or submission page |

Your token is stored only in this browser's extension storage and is sent only to `api.github.com`.

## Project layout

| File | Role |
| --- | --- |
| `manifest.json` | Extension manifest (MV3) |
| `background.js` | Service worker: GitHub API, LeetCode/Codeforces sync, 15-min alarm |
| `options.html`, `options.js` | Popup: token step, repos, linking, status |
| `leetcode.js`, `codeforces.js` | Content scripts that trigger a sync right after a submission is judged |
| `gfg.js` | Content script that pushes a GfG solution on success |
| `lib.js` | Shared helpers: language → extension, folder names, README, git blob SHA |
| `test_lib.js` | Tests for `lib.js` |

## Development

```bash
node test_lib.js   # prints "ok"
```

After editing any file, click ↻ on CodeSync in `chrome://extensions`. The popup picks up changes
on reopen, but the background worker keeps running old code until the extension is reloaded.

## Troubleshooting

| Status | Fix |
| --- | --- |
| `not logged in to LeetCode` / `log in to codeforces.com…` | Log in to the site in this Chrome profile, then **Relink** |
| `CodeSync was updated; reload it in chrome://extensions` | Click ↻ on the extension card |
| `GitHub 401: Bad credentials` | Token expired or revoked: **Reset** and paste a new one |
| `token has no write access` | Add the repo to the token's repository access with Contents: Read and write |
| `GitHub 5xx …` | GitHub-side error that persisted through retries; click **Re-sync full history** later |
