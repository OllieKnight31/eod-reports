# EOD System, a Claude Code skill

Builds an end of day reporting system for a sales team that runs setters, diallers and/or closers.
You tell Claude about your team, and it builds and deploys a small website on your own accounts.

## What it does

- **Report forms per role.** One hosted page with a tab for each role you actually have. A field
  with nothing to report never blocks a submission: a setter can file a day of zeros, a dialler
  only needs a name and a date, a closer can file "no calls today".
- **Daily scorecard.** Every person against their targets (On target, Below, Critical), who has
  filed and who has not, by day or over any date range.
- **Sales dashboard.** Period totals with change against the previous period, filters by person
  and lead source, and an optional live pipeline from GoHighLevel or Close.
- **Slack and/or Discord.** Each report posted as it is filed, a daily team scorecard post, and
  reminders that name whoever has not filed.
- **Logins for everyone.** One owner, managers who see everything, and setters, diallers and
  closers who only see their own report and their own scorecard.
- **Your data stays yours.** Reports are stored in a Google Sheet you own. The site runs on your
  Vercel account. This skill contains no keys and sends nothing to anyone else.

## What you need

| Thing | Why | Cost |
|---|---|---|
| A Mac with [Claude Code](https://claude.com/claude-code) | Runs the skill | Your Claude plan |
| [Node.js](https://nodejs.org) 18 or newer (20 or 22 recommended) | Runs the preview and the Vercel tools | Free |
| python3 | Creates the project folder. On a Mac: `xcode-select --install` | Free |
| About 200 MB of free disk | The Google library that `npm install` downloads is large | |
| A [Vercel](https://vercel.com) account and the CLI (`npm i -g vercel`, then `vercel login`) | Hosts the site | The free Hobby plan runs it, but Vercel's terms keep Hobby for personal, non-commercial use. A business should use Pro. |
| Upstash Redis, added from inside Vercel | Stores logins and saved settings | Free tier is enough |
| A Google account | The Google Sheet, plus a free Google Cloud project for a service account key | Free |
| Admin access to your Slack workspace and/or Discord server | Only if you want posts and reminders | Free |
| GoHighLevel or Close | Optional, adds the live pipeline | Your existing plan |

You do not need to prepare any keys before you start. Claude walks you through each one, and you
paste them into the site's own settings page, not into the chat.

## Setup

1. Unzip or clone this folder anywhere.
2. In Terminal, from this folder:

   ```bash
   ./install.sh
   ```

   This copies `skill/` to `~/.claude/skills/eod-system`. If the skill is already installed it
   changes nothing and tells you so; `./install.sh --update` replaces it, backs up the old copy to
   `~/.claude/skill-backups/` and keeps any configuration it finds.
3. Restart Claude Code.

Prefer to do it by hand? Copy the `skill` folder to `~/.claude/skills/` and rename it `eod-system`.

## First run

Open Claude Code in the folder where you want the project to live and say:

> Set up the EOD system for my business

Claude then:

1. **Asks about your business**: name, timezone, currency, brand colour, lead sources, how many
   setters, diallers and closers you have and their names, Slack or Discord, daily targets, and
   when reminders and the scorecard post should go out. Zero is a fine answer for any role.
2. **Creates the project** in a new folder (`<your-business>-eod`) and installs its one dependency.
3. **Shows you a preview** at `http://localhost:3210` with two weeks of sample data, before
   anything is connected. Nothing in the preview is sent to Slack or Discord.
4. **Deploys to your Vercel account** and attaches Upstash Redis. You may be asked to log in to
   Vercel or click to accept terms in your browser.
5. **Gives you a setup code.** Open your new site, enter the code, and create the owner login
   with a password you choose. Claude should never choose or ask for your password.
6. **Walks you through the settings page**, where you connect the Google Sheet, Slack and/or
   Discord and any CRM. Every section has a short video, a written guide, a Save button and a
   Test button.
7. **Checks it with you**: one test report per role, a dry run of the reminders and the scorecard
   post, then you add a login for each team member under Settings, Logins.

Allow 30 to 45 minutes the first time. Most of that is creating the Google service account and the
Slack or Discord app, which you only do once.

### The accounts you connect, in short

- **Google Sheet**: create a blank sheet. In [Google Cloud](https://console.cloud.google.com) create
  a project, enable the Google Sheets API, create a service account and download a JSON key. Share
  the sheet with the service account's email address as Editor. Paste the sheet link and the JSON
  on the settings page and press Test connection.
- **Slack**: create an app at [api.slack.com/apps](https://api.slack.com/apps), add the bot scopes
  `chat:write`, `chat:write.public`, `channels:read` and `groups:read`, install it to the workspace
  and paste the bot token (`xoxb-...`). Then pick a channel for each report from the list. Webhook
  URLs work too.
- **Discord**: the simple route is one webhook per channel (Edit Channel, Integrations, Webhooks).
  A bot token with a channel picker is also supported.
- **GoHighLevel or Close**: optional. A private integration token and location ID for GoHighLevel,
  or an API key for Close.

## Changing things later

Most changes are made on the site's settings page with no redeploy: channels, keys, targets,
branding, reminder and scorecard times, lead sources, the team list and every login. To add or
remove a whole role, ask Claude to "update my EOD system" from the project folder.

## Troubleshooting

| Problem | Fix |
|---|---|
| Claude does not recognise "set up the EOD system" | Restart Claude Code. Check that `~/.claude/skills/eod-system/SKILL.md` exists. |
| `install.sh` says it is already installed | Nothing was changed. Run `./install.sh --update` to replace it. |
| `python3: command not found` | Run `xcode-select --install`, then try again. |
| `npm install` fails or the disk is full | Free up about 200 MB, then run `npm install` inside the project folder. |
| The preview will not start on port 3210 | Something else is using it. Run `PORT=4000 npm run dev`. |
| The preview rejects the setup code | Use the code `npm run dev` prints when it starts. It is in `client.env` as `ADMIN_PASSWORD`. |
| The live sign-in page says the site has no setup code | `ADMIN_PASSWORD` is not in Vercel. Run `node scripts/push-env.js`, then `vercel --prod`. |
| The live sign-in page says storage is not connected | In Vercel: Storage, Upstash, Redis, connect it to this project, then redeploy. |
| The sheet test says access denied | Share the sheet with the service account email as Editor. |
| Slack connects but lists no channels | The app is missing `channels:read` or `groups:read`. Add them, reinstall the app, reconnect. |
| Slack says to invite the app | For a private channel run `/invite @your-app` in that channel. |
| Reminders or the scorecard post never arrive | No channel is chosen for them, the hour or days are different on the settings page, the timezone is wrong, or the role has no named people. Reminders only chase people on the team list. |
| A reminder names someone but does not notify them | Add their Slack member ID or Discord user ID to their entry on the team list. |
| The owner forgot their password | From the project folder, ask Claude to "reset the owner login". It uses the setup code in `client.env`, and you choose the new password yourself. |
| A team member cannot sign in | Owner, Settings, Logins, Reset password. |

The full reference, including every setting and how to customise the reports, is in
`skill/SKILL.md` and in the `README.md` inside each project the skill creates.

## What is in this folder

| Path | What it is |
|---|---|
| `skill/SKILL.md` | The instructions Claude follows |
| `skill/scripts/` | `bootstrap.py` creates a project from the template; `package.py` zips the skill to pass on |
| `skill/template/` | The app that gets deployed: API, pages, setup scripts and the guide videos |
| `install.sh` | Copies `skill/` into place |

Keep `client.env` (created inside each project) private. It holds your setup code and is never
committed or shared.
