# STEMMate Namibia – A4 vertical slice

One thin but complete path through the system:

**Create a session plan (works offline) → validate → save on the device → sync to the server when a connection is available → see the result → recover if the sync fails.**

This is a design-and-engineering proof, not a production system. All data is synthetic.

## Requirements covered (A3 baseline IDs)

| ID | What the slice does | Where |
|---|---|---|
| FR-04 | Plan has a consistent structure (title, duration, steps, materials, safety note). No pupil names or identities are asked for. | `public/core.js` `validatePlan`, form in `public/index.html` |
| FR-05 | Plans sync when a connection returns. Status shown before and after: saved on device / syncing / synced / sync failed. | `public/core.js` `syncPlan`, `public/app.js` |
| QR-01 | Offline-first: plans are saved on the device first, the page opens offline (service worker), unsent plans sync later. | `public/app.js`, `public/sw.js` |
| QR-02 | Data minimisation: only plan fields are sent; emails and phone numbers are rejected. | `toServerPayload`, `containsContactDetails` |
| QR-03 | Keyboard use, visible focus, labels, contrast, state shown by icon + text (not colour alone), text kept in one place for translation. | `public/styles.css`, `public/index.html`, `TEXT` in `app.js` |

**Partly covered:** FR-02 (the activity list is cached for offline use, but there is no full activity page), QR-04 (a device cannot be cleared while plans are unsynced, but there is **no password/PIN** – see limitations).
**Not in the slice (deferred):** FR-01 browse and filter, FR-03 activity detail page, FR-06 kit requests, FR-07 read-only plan view, QR-05 timing target.

## Easiest way: no install, no terminal

1. Unzip the folder.
2. **Double-click `Open-STEMMate.html`.** The app opens in your browser (Chrome or Edge is best).
3. **Double-click `Run-tests.html`** to run the automated tests in the browser. The heading shows how many passed (19 tests).

In this "simple mode" there is no real server. The page **simulates the server inside your browser** (it uses the same rules as the real server and keeps its data in the browser, so plans are still there after you close and reopen it). A grey note at the top of the page says so. Use this mode to try the app, to rehearse the demo and to run the browser tests.

For the real client-server version (needed to show a genuine network failure, and what the automated server tests cover) use the next section.

## Optional: run with the real server (needs Node.js)

1. Install Node.js version 18 or newer from https://nodejs.org (check with `node -v`).
2. Copy this folder to the computer. **No `npm install` is needed** – there are no outside libraries.
3. Open a terminal in the folder and run `npm start`.
4. Open http://localhost:3000 in a browser (Chrome, Edge or Firefox).
5. Stop the server with Ctrl+C.

Optional: `PORT=4000 npm start` changes the port. `HOST=0.0.0.0 npm start` lets other devices on the same network open the page (the offline page cache only works on `localhost` or `https`).

## Run the automated tests

Two ways, both automatic and repeatable:

- **In the browser (no install):** double-click `Run-tests.html`. 19 tests (core rules, simulated server, colour contrast of the real stylesheet). Result when checked: 19 passed, 0 failed.
- **In Node:** `npm test`. 40 tests with Node's built-in test runner (no libraries), including the real server API. Result on Node v22.22.2: 40 passed, 0 failed.
Test names start with the requirement ID they check, so they can be copied into the traceability matrix.

| File | What it checks |
|---|---|
| `test/core.test.js` | validation rules, privacy rule, state changes (draft → synced / failed → retry), recovery after a closed page |
| `test/repository.test.js` | data is still there after restart, no duplicates, damaged file gives a clear error |
| `test/api.test.js` | the server API end to end: 201/200/400/413/503/404, restart persistence, retry after failure, path-traversal and header checks |
| `test/accessibility.test.js` | WCAG contrast of every colour pair, labels on all fields, page language, skip link, focus style, button size |
| `test/localserver.test.js` | the simulated server used in simple mode, and that the offline copy of the activities matches `data/activities.json` |
| `public/tests.js` (via `Run-tests.html`) | the same core rules in the browser, plus contrast read from the real stylesheet |

Optional UI checks (simulated browser): `npm install --no-save jsdom`, then `node ui-check/smoke.js` (real-server mode, 28 checks) and `node ui-check/file-mode-smoke.js` (double-click mode, 15 checks). jsdom is not a real browser.

## Demo script (for the 6–8 minute briefing)

1. Open the app (double-click `Open-STEMMate.html`, or `npm start` and http://localhost:3000). Point out the connection banner and the "synthetic data" footer.
2. **Validation:** press "Save plan" with an empty form. Show the error summary and the messages next to each field.
3. **Happy path:** pick "Balloon rocket race", add steps and a safety note, save. Show Saved on device → Syncing → Synced, then the plan in "Plans received by the server".
4. **Offline:** open *Demo controls*, tick "Pretend there is no connection", save a plan. Show "Saved on this device". Untick it and show it sync by itself.
5. **Failure and recovery:** tick "Make the next sync attempt fail", save a plan. Show **Sync failed**, the reason, and that the plan is still on the device. Press **Retry sync** and show Synced.
6. **Persistence:** close the browser tab and open the app again: plans are still there. (With the real server: also stop it with Ctrl+C, start it again and press "Refresh list".)
7. **Real outage (real-server mode only):** stop the server, save a plan (it fails), start the server, press Retry.
8. **Privacy:** type an email address into a step. Show it is rejected.

## Manual checks still to be done by a person (not done by the automated tests)

- Keyboard only: Tab through the whole page, submit the form, fix an error, retry a failed sync. Focus must always be visible and in a logical order.
- Zoom to 200% and view at 320 px width: nothing should need sideways scrolling.
- Screen reader (NVDA or TalkBack): fields announce their labels and hints, the error summary is read out, status messages are announced.
- Offline reload with the server stopped (needs a first visit online so the service worker can save the page).
- Test on the real low-specification device the team agreed on.

## What is stored and where

**Plan** (browser: `localStorage` key `stemmate.plans.v1`; server: `data/plans.json`)

| Field | Type | Notes |
|---|---|---|
| id | text | made on the device so a plan can be sent twice safely |
| title | text, 3–80 | |
| activityId | text, optional | links to a synthetic activity |
| durationMinutes | whole number, 5–240 | |
| steps | list of text, 1–20 | |
| materials | list of text, 0–30 | |
| safetyNote | text, 3–300 | |
| version | number | always 1 in this slice |
| createdAt | date-time | |
| receivedAt | date-time | server only |
| status, lastError, syncedAt, updatedAt | | device only, never sent |

**Activity** (`data/activities.json`, read-only, synthetic): id, name, level, topic, durationMinutes, materials.

No pupil data of any kind is stored.

## Technical decisions made in this code (inputs for the team's ADRs)

| Decision | Chosen | Other option | Why chosen |
|---|---|---|---|
| Where unsent plans live | browser `localStorage` | IndexedDB | simplest, enough for a slice; limit about 5 MB |
| Server | plain Node `http`, no libraries | Express + database | nothing to install, easy on low-resource machines |
| Server storage | one JSON file, written safely (temp file then swap) | SQLite | no install; fine for one process |
| Sync method | send the whole plan; server replaces by `id` | send changes only | safe to repeat, so a retry can never create a duplicate |
| Rules | one file `core.js` used by browser and server | write rules twice | same rules on both sides, and testable without a browser |
| Offline page | service worker, network first | cache first | changes show up straight away; offline still works |

The team's architecture person should check this table against the ADRs and diagrams so the report and the code say the same thing.

## Known limitations and residual risks

- **No password or PIN (QR-04 not met).** Anyone using the same browser profile can read the saved plans. Mitigation in the slice: the device can only be cleared when everything is synced. A PIN lock is the next step.
- **No login on the server.** Anyone who can reach the server can send or list plans. Must be fixed before any real use.
- **No editing and no conflict handling.** A plan is created once. If two devices change the same plan there is no merge.
- **Names are not detected.** The privacy check finds emails and long numbers only; a learner's name typed into a step would not be caught. Facilitator training and guidance text are still needed.
- **One server process, JSON file.** Not safe for many users at the same time.
- **localStorage can be cleared by the browser** if the device is very low on space. The page tells the user when a save fails, but cannot recover plans the browser deleted.
- **Simple mode uses a simulated server.** It follows the same rules as the real one, but it is not a network. Say this clearly in the report; use the real server for the demo if a genuine network failure must be shown.
- **Browsers may block storage on files.** If a browser blocks it, the page warns that plans will be lost when the page closes (this was checked in a simulated browser only). Chrome and Edge normally allow it.
- **Not tested on a real browser here.** The automated tests ran on Node v22; the UI check used a simulated browser. The service worker, keyboard use, screen readers and real low-specification devices still need human testing (see the manual checks above).
- **English only.** Sentences are kept in one place (`TEXT` in `app.js`, plus the HTML) but no translation exists yet.
- **Synthetic data only.** Activities are invented for this prototype and are not from the case dossier.

## Folder map

```
Open-STEMMate.html      double-click to open the app (simple mode)
Run-tests.html          double-click to run the in-browser tests
server.js               web server and API
src/planRepository.js   the only code that reads/writes the server's plan file
public/                 the web page (index.html, styles.css, app.js, core.js, localserver.js, activities-data.js, sw.js) and the browser tests (tests.html, tests.js)
data/activities.json    synthetic sample activities
data/plans.json         created automatically when the first plan arrives (not committed)
test/                   automated tests
ui-check/                optional simulated-browser checks
```

## AI assistance disclosure

This code was drafted with help from Claude (Anthropic) and then run and tested. The team member submitting it must confirm in their individual AI declaration what they reviewed, ran and changed. Test results above are from actual runs of `npm test`.
