---
name: eod-system
description: >
  Build an end-of-day reporting system for any business that runs setters, diallers
  and/or closers. Asks how many of each the business has and builds only what it needs:
  hosted EOD report forms per role (a field with nothing to report never blocks
  submission), a daily scorecard page showing what every person reported and who has
  not filed, a sales dashboard, and pre-formatted Slack and/or Discord automations
  (each report posted as filed, a daily team scorecard post, missed-report reminders).
  Every page sits behind a login: the owner creates the first account, then gives
  managers and each setter, dialler and closer their own login with a role-limited view.
  The business enters its own Slack / Discord / Google Sheet / CRM keys on a
  password-protected settings page and picks channels from a list. Google Sheets is
  the data store; deploys to Vercel; GoHighLevel pipeline optional.
  Use when: setting up EOD reports, a sales team scorecard, or a setter/closer/dialler
  tracker for a business or client.
  Aliases: eod, eod-deploy, sales-dashboard, eod-tracker, scorecard.
  Triggers: deploy EOD, EOD system for [business], set up EOD reports, /eod-system,
  daily scorecard, sales pipeline dashboard, closer setter dialler reports.
category: client-deployments
tags: [skill, eod, scorecard, dashboard, slack, discord, vercel, sales-team]
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
version: 3.0.4
---

# EOD System

Builds an end-of-day reporting system shaped to one business's sales team. Everything
needed is inside this skill folder, the app template is in `template/`, and the paths
below are relative to the folder this file is in (call it `$SKILL`).

## What gets built

| URL | What it is |
|-----|------------|
| `/eod-report` | The reports. One tab per role the business has (`/setter-eod`, `/dialler-eod`, `/closer-outcome` open the matching tab). |
| `/scorecard` | For owners and managers. Same date controls as the dashboards (Today, Yesterday, Last 7d, Last 30d, or any two dates) plus filters by role and by person. A row of **team tiles** first, each team total against the per-person target × people in the role × days expected (e.g. 50 messages × 3 setters × 5 days = 750), with the same status colours, then a dark grid of cards, one per person with a role tag; each card is a list of metric rows, the number (per-day average for counts), a meter with the target tick mid-bar, the target, the change vs the previous period (▲▼) and a status: **On target**, **Below** (within 30%), **Critical**, or **N/A**. Each card opens with "EOD filed 4 / 5 days", last-filed time and missing days. Clicking a name drills into that person: day-by-day table, period totals, notes and every call. Views are shareable links, e.g. `/scorecard?range=7d&role=closer&person=Charlie+Reed`. |
| `/overview`, `/eod` | Period KPIs with deltas, filters by person and source, live CRM pipeline, contacts panel. |
| `/login` | Sign-in. On the very first visit it is the owner sign-up form instead (setup code + name + email/username + password). |
| `/settings` | Owner only, reached from the settings icon in the top bar. The business pastes its own Slack / Discord / Google Sheet / CRM keys, picks channels from a dropdown, tests each connection, edits the team and targets, and creates the team's **logins**. |

Automations, already formatted, into Slack and/or Discord:

- **Each report as it is filed**, to that role's channel.
- **Daily scorecard post**, the whole team's day in one message, with who did not file.
- **Reminders**, names (and @mentions) whoever has not filed by the chosen hour.

Data lives in a Google Sheet the business owns. Hosting is Vercel.

### Logins and roles, mandatory, never skipped

Every deployment has logins. Nothing is visible signed out, and the API enforces the rules (hiding a page is never the only protection).

| Role | Sees | Can't |
|---|---|---|
| **Owner** (one) | Everything, including `/settings` and Logins | Nothing is off limits |
| **Manager** | Overview, EOD Deep Dive, Scorecard for everyone, every report form | Settings, logins |
| **Setter / Dialler / Closer** | Submit EOD with only their own report in their own name; their own scorecard | Anyone else's numbers, any dashboard, filing as someone else |

- **First visit = owner sign-up.** `/login` asks for the **setup code** (`ADMIN_PASSWORD`, generated and printed by `configure.js`), then name, email or username and a password. The code stops a stranger claiming the site, and re-entering it later resets a lost owner login.
- **Team logins** are created by the owner under Settings → Logins (name, email/username, role, password with a Generate button, and for reps "Files reports as" → their Team name). The owner hands each person their login; passwords can be reset or logins removed there, effective immediately.
- **Requires storage.** Logins live in the same encrypted store as settings, so Upstash Redis (Step 4) is not optional.
- **Never** create the owner account for the user, choose their password, or ask them to tell you a password. Give them the setup code and have them do the sign-up themselves.

### What is required on each report

One rule: **a field with nothing to report never blocks submission and never counts as a miss.**

| Report | Required | When empty |
|---|---|---|
| Setter | name, date, lead source | Every number defaults to 0, an empty day submits. |
| Dialler | name, date | Six KPIs are marked hit / miss against targets. Speed left blank, 0 leads triaged, or 0 calls due → that KPI shows "n/a" and is neither. Dials and conversations are always measured. |
| Closer | name, date, "Did you take any calls today?" | **No** → the call blocks disappear and the report submits with optional notes; it is stored separately so it never counts as a call. **Yes** → one block per call, each needs a prospect name and an outcome. |

---

## Requirements (check before starting)

```bash
node --version      # 18 or newer (20 or 22 recommended). Missing: install from nodejs.org
npm --version       # comes with Node
python3 --version   # 3.8 or newer, only used by the bootstrap script. Missing on a Mac: xcode-select --install
vercel --version    # if missing: npm i -g vercel
vercel whoami       # if it says you are not signed in: ask the user to run `vercel login` themselves
```

If any of these is missing, stop and help the user install it before going further.

The business also needs: a Vercel account (the free Hobby plan runs it, but Vercel's terms limit
Hobby to personal, non-commercial use, so tell a business to use a Pro account), a Google account
(for the Google Sheet and a free Google Cloud project that holds the service account), and admin
access to its Slack workspace and/or Discord server if it wants the automations. About 200 MB of
free disk is needed for `npm install` (the Google library is large).

Everything runs from the user's own accounts. This skill ships with no keys, sheets, channels or
client data, and never needs anyone else's.

---

## When invoked, the interview

Ask these before building. Group them into as few messages as possible (use a
multiple-choice question tool if one is available). If the user already gave an answer
in their request, do not ask it again. Offer the default in brackets.

**1. The business**
- Business name
- Timezone, as an IANA name [infer from their location, e.g. `Europe/London`, `America/New_York`]
- Currency symbol [`$`]
- Brand colour as a hex code [`#2ECC71`]
- Lead sources the team tracks [`Webinar, DM, Lead Magnet, VSL, Community`]

**2. The team, ask all three, every time**
- **How many setters, and their names?**
- **How many diallers, and their names?**
- **How many closers, and their names?**

Zero is a normal answer: that role is simply left out (no report tab, no channel, no
scorecard section, no reminders). Names turn the name box into a dropdown and are who
reminders chase; a head-count with no names keeps a free-text name box. At least one
role must be on.

**3. Slack, Discord, both, or neither?** Then, for each one chosen:
- **Bot token** (recommended, one key, channels picked from a list) or **webhook URLs** (one URL per channel, no bot)?
- **Will you paste the keys on the settings page yourself, or give them to me now?**
  Recommend the settings page: keys never pass through the chat, and it has the channel
  picker and test buttons. Either way, tell them which channels to have ready: one per
  role in use, plus one for the daily scorecard (they can reuse a channel).

**4. Daily targets, for each role they have**, these drive the On target / Below / Critical status on the scorecard. Offer the defaults and let them adjust; 0 switches a target off.
- Setters [50 messages, 30 outbounds, 20 follow-ups, 3 calls booked]
- Diallers [300 dials, 20 conversations, 5 min speed to lead, 60% show on set calls, 80% show on triaged calls]
- Closers [5 calls, 70% show rate, 25% close rate, no revenue target]

**5. Schedule**
- Missed-report reminders? [yes, 21:00 local, Mon-Fri]
- Daily scorecard post? [yes, 08:00 local, a morning post recaps yesterday; noon or later covers today]

**6. CRM**, GoHighLevel, Close, or none? [none]. Either adds the live pipeline to the dashboard; GoHighLevel also moves opportunities when closers log outcomes (Close is read-only). Keys go on the settings page.

Read the plan back in a few lines and confirm before creating anything.

### Handling keys

- Never print a key, token, webhook URL or password back to the user or into a file other than `client.env`.
- Prefer the settings page for all of them. If the user hands a key over in chat, pass it with `--set` (below) and do not repeat it.
- `client.env` is gitignored and must never be committed or shared.

---

## Build

### Step 1, Create the project

```bash
python3 "$SKILL/scripts/bootstrap.py" --name "<business name>"       # → ./<slug>-eod, runs npm install (about 170 MB)
cd <slug>-eod
```

`$SKILL` is the folder this file is in, normally `~/.claude/skills/eod-system`. Pass `--dest <path>` if the
user wants the project somewhere else. It refuses to overwrite an existing folder. If `npm install` fails
(no network, no disk space) the folder is still created: fix the cause and run `npm install` inside it.

### Step 2, Shape it to the business

One command, built from the interview answers:

```bash
node scripts/configure.js \
  --name "Acme Coaching" --tz Europe/London --currency "£" --color "#3498DB" \
  --sources "Webinar,DM,Referral" \
  --setters "Sam Jones, Jo Lee" \
  --diallers 0 \
  --closers "Charlie Reed, Dana Fox" \
  --reminder-hour 21 --scorecard-hour 8
```

| Flag | Values |
|---|---|
| `--setters` / `--diallers` / `--closers` | `"Name, Name"` · a head-count like `3` · `0` or `none` to leave the role out |
| a name with a mention ID | `"Sam Jones:U01ABC2345"` (Slack member ID) or `"Sam Jones:123456789012345678"` (Discord user ID), makes reminders actually notify them |
| `--no-reminders`, `--no-scorecard` | Switch a scheduled job off (`--reminders` / `--scorecard` switch it back on) |
| `--set KEY=VALUE` | Anything else, repeatable, see "Settings reference". Use for keys the user gave you in chat, and for targets (e.g. `--set KPI_SETTER_MESSAGES=80 --set KPI_CLOSER_REVENUE=4000`). |

It writes `client.env`, generates the settings password and the cron secret, writes the
schedule into `vercel.json`, validates every value, and prints a summary. **It is safe to
re-run** with just the flags that changed (`--closers "A, B, C"` only touches the closers).

Give the user the **setup code** it prints. They enter it once, on their first visit, to create the owner login, it is not a day-to-day password.

### Step 3, Show them

```bash
npm run dev          # http://localhost:3210
```

Open `/login` first so they see the owner sign-up (in the preview the setup code is the one
`configure.js` generated, and `npm run dev` prints it when it starts; it is `draft` only when
`configure.js` has not been run), then
show each role's view by adding `?as=owner`, `?as=manager`, `?as=setter`, `?as=dialler` or
`?as=closer` to any address (preview only, it signs in as a sample person in that role). With no Google Sheet connected the preview
runs on two weeks of in-memory sample data using their real team names,
so they can see the scorecard and submit test reports before anything is wired up.
Sample data is never sent to Slack or Discord. Ask if anything should change (team,
colours, sources) and re-run Step 2 before deploying.

### Step 4, Put it live

```bash
vercel link                  # interactive. Without a terminal prompt: vercel link --yes --project <slug>-eod
node scripts/push-env.js     # sends client.env to Vercel (values go over stdin, not the command line)
vercel --prod
```

Then give the site its storage (logins and saved settings live there). From the project folder:

```bash
vercel integration add upstash/upstash-kv --name <slug>-kv --non-interactive --no-env-pull
vercel --prod
```

That provisions a free Upstash Redis store, connects it to the project and adds `KV_REST_API_URL` /
`KV_REST_API_TOKEN` automatically. If the CLI asks for terms to be accepted in a browser, the same
thing can be done in the Vercel dashboard: **Storage → Upstash → Redis → connect to this project**,
then redeploy. This is required: without it the sign-in page says storage isn't connected and
nobody can get in.

If `vercel link` or the dashboard step needs the user to log in or click, tell them
exactly what to do and wait, do not guess credentials.

### Step 5, Owner sign-up, then connect the accounts

Send the user to `https://<project>.vercel.app`. It opens the owner sign-up: they enter the setup
code, their name, an email or username and a password of their own choosing. Then, on `/settings`,
walk them through whichever of these apply. Every section on the page has its own narrated **video walkthrough**, a step-by-step guide with direct links, its own Save button and a test button, so the steps below are a summary, point them at the on-page guide first.

**Google Sheet (required, it is the data store)**
1. Create a blank Google Sheet.
2. [console.cloud.google.com](https://console.cloud.google.com) → create a project → enable the **Google Sheets API** → APIs & Services → Credentials → Create credentials → Service account → open it → Keys → Add key → JSON.
3. Share the sheet with the service account's `client_email` (ends `.iam.gserviceaccount.com`) as **Editor**.
4. On `/settings`: paste the sheet URL and the whole JSON file → **Test connection**.

**Slack, bot token**
1. [api.slack.com/apps](https://api.slack.com/apps) → Create New App → From scratch.
2. OAuth & Permissions → Bot Token Scopes: `chat:write`, `chat:write.public`, `channels:read`, `groups:read`.
3. Install to Workspace → copy the **Bot User OAuth Token** (`xoxb-…`).
4. On `/settings`: paste it → **Connect & load channels** → pick a channel for each report and the scorecard → Save → **Send test messages**.
   For a private channel, first run `/invite @<app name>` in that channel.

**Slack, webhooks instead**: same app → Incoming Webhooks → activate → Add New Webhook to Workspace once per channel → paste each URL under "Use webhook URLs instead".

**Discord, webhooks (simplest)**: in each channel → Edit Channel → Integrations → Webhooks → New Webhook → Copy URL → paste under "Use webhook URLs instead" → Save → **Send test messages**.

**Discord, bot token**: [discord.com/developers](https://discord.com/developers/applications) → New Application → Bot → Reset Token → copy. OAuth2 → URL Generator → scope `bot`, permissions Send Messages + Embed Links + View Channels → open the URL and add it to the server. On `/settings`: paste → **Connect & load channels** → pick channels.

**Close (if used)**: [app.close.com/settings/developer/api-keys](https://app.close.com/settings/developer/api-keys/) → New API Key → copy (`api_…`). On `/settings`: choose Close, paste → **Connect & load pipelines** → pick the pipeline and match each column to a status. Close is read-only: the dashboard shows the live pipeline and each card links to the lead, but closer reports never change anything in Close. A column with no matching status can be left unmatched; it shows as empty.

**GoHighLevel (if used)**: Settings → Private Integrations → create with scopes contacts (read/write), opportunities (read/write), pipelines (read) → copy the `pit-…` token. The location ID is in the URL: `/v2/location/<this>/`. On `/settings`: choose GoHighLevel, paste both → **Test connection & load pipelines** → pick the pipeline and match each stage from the dropdowns (a full dashboard address pasted into the location box is accepted). The match also decides where a closer's logged call moves the deal: won → Closed Won (marked won), lost → Closed Lost (marked lost), follow-up → Proposal Sent, live but no close → Call Completed, rescheduled → Call Booked, no-show → No Show. An unmatched stage leaves the deal where it is. A second report for the same prospect moves the same deal, it never makes a duplicate.

If the user gave keys in chat instead, put them in with `node scripts/configure.js --set KEY=VALUE`, then `node scripts/push-env.js` and `vercel --prod`.

### Step 6, Verify

```bash
DOMAIN="https://<project>.vercel.app"
curl -s "$DOMAIN/api?action=ping"        # "sheets":"configured" once the sheet is connected
curl -s "$DOMAIN/api?action=config"      # signed out this returns the brand only; it should match the interview
```

Signed out, every data call must be refused:

```bash
curl -s -o /dev/null -w "%{http_code}\n" "$DOMAIN/api?action=dashboard_data"    # 401
curl -s -o /dev/null -w "%{http_code}\n" "$DOMAIN/api?action=settings"          # 401
```

The team, roles and targets are visible on `/settings` once the owner has signed in; check them there.

Then have the owner add one login per role in use under Settings → Logins, and check each in a
private window: a manager sees every dashboard but is bounced from `/settings`; a setter, dialler
or closer lands on Submit EOD with only their own form and their name filled in, and `/overview`
bounces them back.

File one report per role in use (signed in as that role):
- Setter with everything left at 0, must submit.
- Dialler with only name and date, must submit, quiet KPIs show "n/a".
- Closer with "No, zero calls today", must submit with nothing else filled in.

Check each landed in its channel and on `/scorecard`. Dry-run the scheduled jobs (posts nothing):

```bash
SECRET=$(grep '^CRON_SECRET=' client.env | cut -d"'" -f2)
curl -s -H "Authorization: Bearer $SECRET" "$DOMAIN/api?action=scorecard_post&force=1&dry=1"
curl -s -H "Authorization: Bearer $SECRET" "$DOMAIN/api?action=nudge&force=1&dry=1"
```

To see the real scheduler fire without waiting for the hour: on `/settings` set the reminder and
scorecard hour to the current local hour, then from the project folder run
`vercel crons run "/api?action=cron"`. Check the posts arrive and that their "File it now" links open
the public site (`/api?action=ping` shows `links_point_to`). Each job runs once per day, so set the
hours back afterwards.

Finally delete the TEST rows from the Google Sheet (tabs: `SETTER ACTIVITY`,
`DIALLER ACTIVITY`, `CLOSER OUTCOMES`, `CLOSER NO-CALL DAYS`).

### Step 7, Hand over

Give the user: the site address (everyone uses the same one and signs in), a reminder that
the setup code is in `client.env` should the owner login ever need resetting, and where the
project folder is. Remind them to add a login for each team member under Settings → Logins
and send each person their own email/username and password.

---

## Changing things later

| They want | Do |
|---|---|
| Give someone access, change their role, reset a password, remove them | Owner → Settings → Logins (immediate, no redeploy) |
| Add / remove a person, or a whole role | `node scripts/configure.js --closers "A, B, C"` (or edit Team on `/settings`), then `push-env.js` + `vercel --prod` |
| Reminder or scorecard time, days, on/off, or timezone | `/settings` → Reminders & daily scorecard / Branding (no redeploy, the schedule checks in every hour) |
| Channels, keys, targets for any role, branding, currency, mechanisms (lead sources), CRM | `/settings` (no redeploy; live within 30 seconds) |

A value saved on `/settings` overrides the same value in `client.env` / Vercel env.

## Settings reference

Every key can go in `configure.js --set`, in Vercel env, or on `/settings` (except the three marked env-only).

| Key | Meaning |
|---|---|
| `REPORT_ROLES` | Roles in use, e.g. `setter,closer` (set by the `--setters/--diallers/--closers` flags) |
| `ROSTER_JSON` | Names per role, with optional `slack` / `discord` mention IDs and `nudge:false` |
| `BRAND_NAME`, `BRAND_COLOR`, `TIMEZONE`, `CURRENCY_SYMBOL`, `LEAD_SOURCES` | Business details |
| `CLOSER_EXTRA_SOURCES` | Lead sources offered only on the closer report |
| `SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_KEY` | The Google Sheet |
| `SLACK_BOT_TOKEN`, `SLACK_{SETTER,DIALLER,CLOSER,SCORECARD}_CHANNEL` | Slack via bot token + channel IDs |
| `SLACK_{SETTER,DIALLER,CLOSER,SCORECARD}_WEBHOOK` | Slack via webhook URLs |
| `DISCORD_BOT_TOKEN`, `DISCORD_{…}_CHANNEL`, `DISCORD_{…}_WEBHOOK` | Same for Discord |
| `KPI_DIALS`, `KPI_CONVERSATIONS`, `KPI_SPEED_TO_LEAD_MIN`, `KPI_SET_SHOW_RATE`, `KPI_TRIAGED_SHOW_RATE` | Dialler targets |
| `KPI_SETTER_MESSAGES`, `KPI_SETTER_OUTBOUNDS`, `KPI_SETTER_FOLLOWUPS`, `KPI_SETTER_CALLS_BOOKED` | Setter targets (0 = none) |
| `KPI_CLOSER_CALLS`, `KPI_CLOSER_SHOW_RATE`, `KPI_CLOSER_CLOSE_RATE`, `KPI_CLOSER_REVENUE` | Closer targets (0 = none) |
| `REMINDERS`, `NUDGE_HOUR`, `NUDGE_DAYS`, `NUDGE_ROLES` | Reminders: `on`/`off`, local hour, days (0 = Sunday), which roles |
| `SCORECARD_POST`, `SCORECARD_HOUR` | Daily scorecard post: `on`/`off`, local hour |
| `CRM_PROVIDER` | `none`, `ghl` or `close` |
| `GHL_API_KEY`, `GHL_LOCATION_ID`, `GHL_PIPELINE_ID`, `GHL_STAGES_JSON` | GoHighLevel |
| `CLOSE_API_KEY`, `CLOSE_PIPELINE_ID`, `CLOSE_STAGES_JSON` | Close (read-only pipeline) |
| `ADMIN_PASSWORD` *(env-only)* | The **setup code** for the owner sign-up; also signs sessions and encrypts saved settings and logins. Generated by `configure.js`. Changing it later makes saved settings and logins unreadable unless `SETTINGS_SECRET` was set. |
| `INBOUND_KEY` *(env-only, optional)* | Lets an outside form post reports with `Authorization: Bearer <key>`. Unset = only signed-in people can file. |
| `CRON_SECRET` *(env-only)* | Vercel sends it with each scheduled call. Generated by `configure.js`. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` *(env-only)* | Added automatically when Upstash Redis is attached in Vercel. |

## Customising the reports

The forms are in `public/eod-report.html`; each report has a handler in `api/_lib/handlers/`
and a column list in `api/_lib/sheets.js`.

- **Walkthrough videos**: generated from `tools/walkthroughs/scenes.js` (narration + an illustrated frame per step) by `node tools/walkthroughs/build.js` into `public/walkthroughs/`. The voice is Kokoro, a neural model that runs locally with no key (speaker "Fable", `bm_fable`; change with `KOKORO_VOICE=…`); install it once with `sh tools/walkthroughs/setup-voice.sh`. `VOICE=gemini` uses Google's voice instead (needs `GOOGLE_API_KEY` with credit); `VOICE=say` is the robotic Mac fallback. Needs macOS, Chrome, ffmpeg and `uv`. After changing a guide's steps on the settings page, update its scenes and rebuild so video and text agree.
- **Team tiles**: built by `teamRow(...)` in `getScorecard` (`api/_lib/handlers/scorecard.js`). Headcount is the roster for the role (or whoever filed, with no roster), days are the expected reporting days; add a line there for a new team metric.
- **Scorecard metrics**: each role's rows are defined in `ROWS` in `api/_lib/handlers/scorecard.js`, `{ key, label, value, target, unit, lower }`. Counts are shown per day filed; a row with no `target` shows as N/A; `lower: true` is for lower-is-better (speed to lead). Status is ≥100% of target = On target, ≥70% = Below, else Critical (`WARN_AT`). The ▲▼ compares with the previous period of the same length. "Expected" days are the reminder days (`NUDGE_DAYS`), so nobody is marked missing on a day off. A new metric that adds up over days also needs a line in the role's `merge…` function.
- **Add a question**: add the input to the form, read it in the handler, append a column to that report's header array (never insert in the middle, existing sheets are widened automatically), add it to the channel post in the handler, and to the scorecard card in `api/_lib/handlers/scorecard.js` + `public/scorecard.html`. Keep the form and the post in step or the post shows a field that always reads 0.
- **Keep the empty-field rule**: a new dialler KPI must come out `null` (shown "n/a") when its input is blank or its denominator is 0, never `false`. Nothing inside a closer call block may be `required` in HTML, the block is hidden on a zero-call day and a hidden required field silently blocks submit; validate it in the submit handler instead.
- **Name boxes that became dropdowns**: read them with `[name=x]`, never `input[name=x]`.
- **Access rules** live in `api/_lib/auth.js` (roles, sessions, what each role may file or see) and are applied in `api/index.js`; `public/auth.js` only hides what the server already refuses. A new page needs `<script src="/auth.js" data-allow="owner,manager"></script>` in its head, and a new API action needs a role check in `api/index.js`.
- **External forms** (GHL, Tally, Typeform) need `INBOUND_KEY` sent as `Authorization: Bearer …` and can post to `POST /api?source=setter_eod | dialler_eod | closer_eod | closer_outcome`. A zero-call closer day is `{"closer":"…","date":"…","no_calls":true,"notes":"…"}`.
- **Another CRM**: add a function to `api/_lib/crm-adapter.js` returning `{available, provider, stages:[{key,label,count,value,contacts}], contactsByEmail}` and a `case` in `getCRMPipelineNormalized()`.

After any code change run `npm run check`, look at it with `npm run dev`, then `vercel --prod`.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Sign-in page says the site has no setup code | `ADMIN_PASSWORD` is not set in Vercel, run `push-env.js`, redeploy |
| Sign-in page says storage isn't connected | Upstash Redis not attached to the project, or not redeployed since |
| Owner forgot their password | The setup code resets it: `curl -X POST "$DOMAIN/api?source=auth_setup" -H 'Content-Type: application/json' -d '{"code":"<setup code>","name":"…","username":"…","password":"<new, chosen by the owner>"}'`, have the owner run it or type the values themselves; never pick the password for them |
| A team member can't sign in | Owner → Settings → Logins → Reset password |
| An outside form (GHL, Tally) stopped posting reports | Reports now need a login or `INBOUND_KEY`; set it and send it as a Bearer token |
| Sheet test says access denied | The sheet is not shared with the service account email as Editor |
| Slack test says "invite the app to the channel" | Private channel, `/invite @<app>` there, or add the `chat:write.public` scope for public ones |
| Slack connects but lists no channels | App is missing `channels:read` / `groups:read`, add, reinstall, reconnect |
| Reminder or scorecard never arrives | No channel connected for it; `CRON_SECRET` missing in Vercel; switched off or set to a different hour or day on `/settings`; wrong timezone under Branding; or the role has no names on the roster (reminders only chase named people) |
| Saved channels show as an ID with "(not visible to the bot)" | The bot was removed from that channel or the channel was deleted; pick it again from the list |
| "Send test messages" says some failed | It names each failed channel and the fix; the others still sent |
| Closer report says the CRM push was skipped | Normal with Close or no CRM; only GoHighLevel is written to |
| GoHighLevel test says "Location is not active" | The token belongs to a different or closed sub-account; create the private integration inside the sub-account being connected |
| Reminder names someone but does not notify them | No Slack / Discord member ID on their roster entry |
| A role's tab is missing | It is not in `REPORT_ROLES`, add it under Team on `/settings` or re-run `configure.js` |

## Sharing this skill

```bash
python3 "$SKILL/scripts/package.py" --out ~/Desktop/eod-system-skill.zip
```

The recipient unzips it into `~/.claude/skills/` (so the folder is `~/.claude/skills/eod-system`),
restarts Claude Code and asks Claude to set up the EOD system for their business. The zip contains
no keys or business data.
