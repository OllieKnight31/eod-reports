# EOD System

End-of-day reporting, a daily team scorecard and a sales dashboard for any business that
runs setters, diallers and/or closers. It shapes itself to the team: a business with no
diallers has no dialler report, channel or scorecard section.

**What you get**
- `/eod-report`, the reports. One tab per role in use: setter, dialler, closer. A field with nothing to report never blocks submission.
- `/scorecard`, Today / Yesterday / Last 7d / Last 30d / any dates, filterable by role and by person: each person's KPIs against target with progress bars, a day-by-day table, team totals, and who hasn't filed.
- `/overview`, `/eod`, period KPIs with deltas, filters, live CRM pipeline, contacts panel.
- **Logins on everything.** The owner creates their account on the first visit, then gives each team member a login with a role (see "Logins and roles").
- `/settings`, the business enters its own keys (Slack, Discord, Google Sheet, CRM), picks channels from a list, and tests each connection. Encrypted at rest.
- Slack and/or Discord: every report posted as it is filed, a daily scorecard post, and reminders that name whoever hasn't filed. All pre-formatted.
- Google Sheets as the data store (no database). GoHighLevel pipeline optional.

---

## Quick start

```bash
npm install

# 1. Shape it to the business (writes client.env + the schedule in vercel.json)
node scripts/configure.js --name "Acme Coaching" --tz Europe/London --currency "£" \
  --setters "Sam Jones, Jo Lee" --diallers 0 --closers "Charlie Reed, Dana Fox"

# 2. Look at it, works before anything is connected (sample data, kept in memory)
npm run dev                     # http://localhost:3210

# 3. Put it live
vercel link
node scripts/push-env.js        # sends client.env to Vercel
vercel --prod
```

Then in Vercel attach **Upstash Redis** (Storage → Upstash → Redis) so `/settings` has somewhere to
save, redeploy, and hand the business owner the site address plus the **setup code** that
`configure.js` printed. On their first visit they create the owner login with it, then connect the
Google Sheet, Slack and/or Discord on `/settings` and add logins for their team.

`configure.js` is safe to re-run, `node scripts/configure.js --closers "A, B, C"` just updates the closers.

### Logins and roles

Nothing is visible without signing in, and the server enforces every rule below, a page that is hidden is also refused by the API.

| Role | Sees | Can't |
|---|---|---|
| **Owner** | Everything: dashboards, scorecard, all reports, `/settings`, Logins | Nothing is off limits |
| **Manager** | Overview, EOD Deep Dive, Scorecard (everyone), all report forms | Open `/settings` or manage logins |
| **Setter / Dialler / Closer** | Submit EOD with only their own report, pre-filled with their name; their own scorecard | See anyone else's numbers, any dashboard, or file under another name |

**First visit.** `/login` shows a one-time form: setup code, name, email or username, password.
The setup code is `ADMIN_PASSWORD` (printed by `configure.js`), so a stranger who finds the site
first cannot claim it. That account is the owner. If the owner login is ever lost, the setup code
resets it: `POST /api?source=auth_setup` with `{code, name, username, password}` (the sign-up form
itself is only shown while no owner exists).

**Adding people.** Owner → Settings → Logins: name, email or username, role, a password (there is
a Generate button). For a setter, dialler or closer, "Files reports as" links the login to their
name on the Team list so their reports and scorecard line up. Reset a password or remove a login
there at any time; a removed login stops working immediately. Anyone can change their own password.

**Outside forms** (GoHighLevel, Tally, Typeform…) can no longer post reports anonymously. Set
`INBOUND_KEY` and have the form send `Authorization: Bearer <INBOUND_KEY>`.

Sessions are a signed, HttpOnly cookie lasting 14 days. Logins are stored encrypted alongside
the saved settings (Upstash on Vercel, `.data/` locally), with scrypt-hashed passwords.

Local preview: the setup code is the one `configure.js` printed (`npm run dev` shows it when it
starts; it is `draft` only if `configure.js` has never been run). Add `?as=owner`, `?as=manager`, `?as=setter`,
`?as=dialler` or `?as=closer` to any address to look at the site as that role without typing.

### Team

Each of `--setters`, `--diallers`, `--closers` takes:

| Value | Result |
|---|---|
| `"Sam Jones, Jo Lee"` | Role on; the name box on the report becomes a dropdown; those people are chased by reminders |
| `3` | Role on; names are typed free-text |
| `0` / `none` | Role off, no report tab, no channel, no scorecard section, no reminders |

Add a mention ID so reminders actually notify the person: `"Sam Jones:U01ABC2345"` (Slack member ID) or `"Sam Jones:123456789012345678"` (Discord user ID).

### Slack and Discord

Two ways to connect each, entered on `/settings` (or with `configure.js --set KEY=value`):

| | Bot token | Webhook URLs |
|---|---|---|
| What you paste | One token | One URL per channel |
| Choosing channels | Picked from a dropdown of your real channels | Fixed by the URL |
| Slack setup | api.slack.com/apps → create app → OAuth scopes `chat:write`, `chat:write.public`, `channels:read`, `groups:read` → install → copy the `xoxb-` token | Same app → Incoming Webhooks → add one per channel |
| Discord setup | discord.com/developers → application → Bot → copy token → invite the bot with Send Messages + Embed Links | Channel settings → Integrations → Webhooks → copy URL |

Four destinations per provider: setter reports, dialler reports, closer reports, daily scorecard.
Use one provider or both; each destination is independent.

### Daily scorecard and reminders

`/scorecard` needs no setup. Pick Today, Yesterday, Last 7d, Last 30d or any two dates, and
narrow to a role or one person (or click a name). It is a grid of cards, one per person, each a
list of metric rows:

- the number (counts as a per-day average over the days that person filed, rates as a %)
- a meter that runs 0 → 2× target, so the target tick always sits mid-bar
- the target, the change against the previous period of the same length (▲▼, in % for counts
  and points for rates), and a status: **On target**, **Below** (within 30% of target),
  **Critical** (further off), or **N/A** (no target, or nothing to measure)

Above the cards, a row of **team tiles** measures the whole team against the same targets
multiplied up: each person's daily target × people in that role × days expected (50 messages ×
3 setters × 5 days = 750). Rates keep their plain target. Each tile shows the total, the meter,
the status and the change vs the previous period, so a red team number points you to the
person card underneath that is dragging it.

Every card opens with "EOD filed 4 / 5 days", when they last filed and which days are missing.
Selecting one person adds their day-by-day table, period totals, notes and (for closers) every call.
Targets for all three roles are set on `/settings` (0 switches one off). The view lives in the
address bar (`/scorecard?range=7d&role=closer&person=Charlie+Reed`), so it can be bookmarked or shared.

The **scorecard post** and **reminders** are two scheduled jobs. `configure.js` writes a schedule
into `vercel.json` that checks in every hour; whether each job runs, at what local hour
(`--reminder-hour`, default 21; `--scorecard-hour`, default 8, before noon it recaps yesterday,
from noon it covers today), on which days and in which timezone are all ordinary settings, so
they can be changed on `/settings` at any time with no redeploy.
`CRON_SECRET` (generated for you) must be set in Vercel; the jobs refuse to run without it.
Vercel's Hobby plan runs each cron once a day, which is all this needs.

Check without posting anything:
```bash
curl -H "Authorization: Bearer $CRON_SECRET" "$DOMAIN/api?action=scorecard_post&force=1&dry=1"
curl -H "Authorization: Bearer $CRON_SECRET" "$DOMAIN/api?action=nudge&force=1&dry=1"
```

### Walkthrough videos

Every setup guide on `/settings` has a narrated video of the same steps (Google Sheets, Slack bot,
Slack webhooks, Discord webhooks, Discord bot, team @mentions, GoHighLevel, Close). They are
illustrations of each screen with the button to press highlighted, plus captions, and live in
`public/walkthroughs/` so they ship with the site, nothing is hosted elsewhere, and nothing
downloads until play is pressed.

They are generated, not recorded. To change the wording or re-voice them:

```bash
sh tools/walkthroughs/setup-voice.sh               # once: installs the Kokoro voice (~400 MB, needs uv)
# edit tools/walkthroughs/scenes.js, then
node tools/walkthroughs/build.js                  # all videos
node tools/walkthroughs/build.js sheets           # just one
KOKORO_VOICE=af_heart node tools/walkthroughs/build.js    # a different speaker
```

The voice is **Kokoro**, a neural text-to-speech model that runs on your own machine, no key,
no account, no cost. The speaker is "Fable" (`bm_fable`, British male); others include
`af_heart`, `af_bella`, `am_michael`, `am_fenrir`, `bf_emma`, `bf_isabella`, `bm_george`.
`VOICE=gemini` uses Google's Gemini voice instead (needs `GOOGLE_API_KEY` with credit), and
`VOICE=say` falls back to the robotic built-in Mac voice.

Needs macOS, Google Chrome, ffmpeg and (for Kokoro) `uv`. Narration is cached, so only new or reworded lines are re-voiced.

### Google Sheet

1. Create a Google Sheet. 2. In Google Cloud Console create a service account and a JSON key.
3. Share the sheet with the service account's `client_email` as Editor. 4. Paste the sheet URL and
the JSON key on `/settings` and press **Test connection**. Tabs and headers are created on first use.

---

## CRM modes

The pipeline section + "Open in CRM" deep-links are driven by `CRM_PROVIDER`. Set in env.

| Mode | What you get | What you set |
|------|-------------|---------------|
| `none` (default) | No pipeline section. Forms still log to sheet + Discord. Dashboard works fully off the sheet. | `CRM_PROVIDER=none` |
| `ghl` | Live pipeline kanban (6 closer-relevant stages), Open-in-CRM buttons on every contact, and closer outcomes move the opportunity. | `CRM_PROVIDER=ghl` + `GHL_API_KEY`, `GHL_LOCATION_ID`, `GHL_PIPELINE_ID`, `GHL_STAGES_JSON` |
| `close` | Live pipeline kanban from Close (stages map to Close opportunity statuses), each card links to the lead. Read-only, outcomes are not written back. | `CRM_PROVIDER=close` + `CLOSE_API_KEY`, `CLOSE_PIPELINE_ID`, `CLOSE_STAGES_JSON` |

### Adding a new CRM provider

Edit `api/_lib/crm-adapter.js`:

1. Implement an async function returning the same normalized shape:
   ```js
   { available: true, provider: 'hubspot', stages: [{key, label, count, value, contacts: []}], contactsByEmail: {...} }
   ```
2. Add a `case` to the `getCRMPipelineNormalized()` switch.
3. Update `buildCRMContactUrl()` if your CRM has a deep-link URL pattern.

That's it. The frontend hides the pipeline section automatically when `available: false`.

---

## Form integrations

### Sending data from a third-party form (e.g. GHL form, Tally, Typeform)

Outside forms need `INBOUND_KEY` set, sent as `Authorization: Bearer <INBOUND_KEY>`. Both endpoints accept JSON or form-encoded POSTs. Map your form fields to these keys:

**Setter EOD**, POST to `/api?source=setter_eod`
```json
{
  "setter": "Sam Jones",
  "date": "2026-05-02",
  "lead_source": "DM",
  "messages_sent": 120,
  "outbounds": 35,
  "calls_booked": 4,
  "hit_kpis": "Yes",
  "notes": "Great day."
}
```

**Closer outcome**, POST to `/api?source=closer_outcome`
```json
{
  "closer": "Charlie Reed",
  "date": "2026-05-02",
  "lead_source": "Webinar",
  "setter": "Sam Jones",
  "prospect_name": "Jane Doe",
  "prospect_email": "jane@example.com",
  "outcome": "closed_won",
  "ticket": 5000,
  "package": "Scale",
  "payment_type": "Paid in Full",
  "notes": "Smooth call."
}
```

Field names are flexible, the handlers accept several common aliases (`setter_name`, `dms_sent`, `calls_booked_on_calendar`, `additional_notes`, etc.). See `api/_lib/handlers/` for the full mapping.

---

## Configuration reference

Everything is env-driven. See [`.env.example`](.env.example) for the canonical list.

| Variable | Required | Default | Purpose |
|----------|---------|---------|---------|
| `SPREADSHEET_ID` | yes | none | Google Sheet to read/write |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | yes | none | Stringified service account JSON |
| `BRAND_NAME` | no | "EOD System" | Page header label |
| `BRAND_COLOR` | no | `#2ECC71` | Accent color (hex) |
| `LEAD_SOURCES` | no | `Webinar,DM,Lead Magnet,VSL,Community` | Sources to segment by |
| `CRM_PROVIDER` | no | `none` | `ghl` \| `close` \| `none` |
| `GHL_API_KEY` | if `ghl` | none | GHL private integration token |
| `GHL_LOCATION_ID` | if `ghl` | none | GHL sub-account ID |
| `GHL_PIPELINE_ID` | if `ghl` | none | Sales pipeline ID |
| `GHL_STAGES_JSON` | if `ghl` | none | Map of closer stage keys → GHL stage UUIDs |
| `DISCORD_SETTER_WEBHOOK` | no | none | Setter EOD → Discord channel |
| `DISCORD_CLOSER_WEBHOOK` | no | none | Closer outcome → Discord channel |
| `SLACK_SETTER_WEBHOOK` | no | none | Setter EOD → Slack channel |
| `SLACK_CLOSER_WEBHOOK` | no | none | Closer outcome → Slack channel |
| `SHEET_TAB_CLOSER` | no | `CLOSER OUTCOMES` | Override closer tab name |
| `SHEET_TAB_SETTER` | no | `SETTER ACTIVITY` | Override setter tab name |

---

## File map

```
<your project>/
├── api/
│   ├── index.js                 ← Vercel entry: routes every GET/POST and applies the access rules
│   └── _lib/
│       ├── config.js            ← Env loader + publicConfig()
│       ├── auth.js              ← Logins, sessions, what each role may do
│       ├── settings-store.js    ← Encrypted settings and logins (Upstash on Vercel, .data/ locally)
│       ├── sheets.js            ← Google Sheets client + tab schemas
│       ├── notify.js            ← Slack + Discord posting (webhooks or bot tokens)
│       ├── crm-adapter.js       ← Pipeline shape for GoHighLevel, Close or none
│       ├── ghl-write.js         ← GoHighLevel write-back for closer outcomes
│       └── handlers/            ← setter-eod, dialler-eod, closer-outcome, scorecard, nudge,
│                                  dashboard, overview, settings
├── public/                      ← login, eod-report, scorecard, overview, eod, settings, auth.js,
│                                  walkthroughs/ (the guide videos)
├── scripts/                     ← configure.js, dev.js, push-env.js, set-cron.js
├── tools/walkthroughs/          ← rebuilds the guide videos (optional)
├── vercel.json                  ← Deployment, routing and the hourly schedule
├── package.json                 ← Single dependency: googleapis
├── .env.example                 ← Full settings reference
├── config.example.json          ← Schema reference (informational)
└── README.md                    ← This file
```

---

## Sheet schemas (auto-created)

### `CLOSER OUTCOMES`
`Timestamp | Date | Closer | Lead Source | Lead Source Detail | Setter | Prospect Email | Prospect Name | Outcome | Package Sold | Ticket Price | Payment Type | Payment Received | Lost Reason | Follow-up Date | Objections | Notes | CRM Contact ID | Recording URL`

### `SETTER ACTIVITY`
`Timestamp | Date | Setter | Lead Source | Lead Source Detail | Profile Visits | New Followers | Total Followers | Qualified Followers (ICP) | Messages Sent | Outbounds | Inbounds | Follow Ups | Links Sent | Calls Proposed | Calls Booked | No Shows | Cancellations | Hottest Lead | Lead Quality | Hit KPIs | Notes`

To extend: append columns to the headers array in `api/_lib/sheets.js`. The `ensureTab()` helper widens existing sheets automatically, never insert in the middle.

---

## API reference

Only `ping`, `config` (brand only) and the sign-in calls are open. Everything else needs a login
with the right role, or `Authorization: Bearer <INBOUND_KEY>` for reports posted by an outside form.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api?action=ping` | Health check |
| `GET` | `/api?action=config` | Brand only when signed out; the full page config when signed in |
| `GET` | `/api?action=dashboard_data` | Full dashboard payload (owner and managers) |
| `GET` | `/api?action=overview_data` | Period-over-period KPIs (owner and managers) |
| `POST` | `/api?source=setter_eod` | Log setter EOD report (single aggregate) |
| `POST` | `/api?source=closer_eod` | Log a full closer EOD: **multiple calls** in one report: `{ closer, date, calls: [ {...}, ... ] }`. Each call → its own sheet row + GHL opportunity upsert, then one consolidated Discord report. |
| `POST` | `/api?source=closer_outcome` | Log a single closer call outcome (back-compat; used by external per-call webhooks) |

The hosted `/eod-report` closer form posts to `closer_eod`, the closer adds one block per call they took that day and submits once. When `CRM_PROVIDER=ghl`, each closer outcome also upserts the prospect contact + opportunity (stage/status mapped from the outcome) via `api/_lib/ghl-write.js`.

### Common query params for `dashboard_data` / `overview_data`

| Param | Format | Default |
|-------|--------|---------|
| `start` | YYYY-MM-DD | 7 days ago |
| `end` | YYYY-MM-DD | today |
| `source` | one of `LEAD_SOURCES` | none |
| `closer` | exact name | none |
| `setter` | exact name | none |

---

## License

Yours to use and change for your own business or your clients. Provided as is, with no warranty.

## In-app settings page (`/settings`)

Lets the client connect their own accounts from the website instead of you setting
Vercel env vars: Google Sheet + service account key, Discord/Slack webhooks, GoHighLevel
token/location/pipeline/stage mapping, and branding. Each section has a test button;
the GHL test loads the pipelines so stages are picked from dropdowns, not pasted as UUIDs.

- Saved values are AES-256-GCM encrypted at rest and **override** env vars of the same name.
- Secrets are never sent back to the browser, the page only shows a masked tail.
- Webhook URLs are validated against Discord/Slack hosts before the server will call them.

Three things still have to be real env vars, because they protect everything else:

| Env var | Why |
|---|---|
| `ADMIN_PASSWORD` | Generated by `configure.js`. Unlocks `/settings`. The page stays switched off until it is set. Also the encryption secret unless `SETTINGS_SECRET` is set. |
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` | Where saved settings live. Injected automatically when you attach Upstash Redis to the Vercel project (Storage → Upstash). |

Changing `ADMIN_PASSWORD` makes previously saved settings unreadable unless `SETTINGS_SECRET`
was set separately. A save reaches other warm serverless instances within 30 seconds.

Local preview, no Vercel needed: `npm run dev` → http://localhost:3210/settings (sign up with the setup code that `npm run dev` prints, or add `?as=owner`);
settings are written to the gitignored `.data/settings.json`.

## Reports

One page (`/eod-report`) with three tabs; `/setter-eod`, `/dialler-eod` and `/closer-outcome` open it on the right tab.

| Report | Required | Everything else |
|---|---|---|
| Setter | name, date, lead source | Numbers default to 0, an empty day submits. |
| Dialler | name, date | Six KPIs marked hit / miss against the `KPI_*` targets. A KPI with nothing to measure (speed left blank, 0 leads triaged, 0 calls due) is marked "n/a" and is neither. |
| Closer | name, date, and "Did you take any calls today?" | **Yes** → one block per call, each needs a prospect name and an outcome. **No** → the call blocks drop away and the report submits with optional notes; it is logged to `CLOSER NO-CALL DAYS`, never `CLOSER OUTCOMES`. |

Inbound webhooks: `POST /api?source=setter_eod | dialler_eod | closer_eod | closer_outcome`.
A zero-call closer day over the API is `{ "closer": "…", "date": "…", "no_calls": true, "notes": "…" }`.

### Roster

`ROSTER_JSON` (or the Team section of `/settings`) lists who files each report. A role with names gets a
dropdown instead of a free-text box, and inbound spellings are snapped to the roster name.

### Missed-EOD reminders

See "Daily scorecard and reminders" above. Closers are included, a closer with no calls files a zero-call report.
