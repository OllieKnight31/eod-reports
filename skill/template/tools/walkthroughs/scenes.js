// The walkthrough videos, as data. One entry per video; each scene is one narrated frame.
//
//   say: what the voice reads (also the captions). Written naturally; build.js spells
//          out acronyms for voices that need it.
//   cap: the one-line instruction under the picture (<em> = emphasised)
//   html, the picture: a simplified ILLUSTRATION of the screen (never a copy of the real
//          site), with class "hl" on the thing to press
//
// Edit the words here and run `node tools/walkthroughs/build.js` to rebuild the videos.

const dots = '<div class="dots"><i></i><i></i><i></i></div>';
const win = (url, body, cls = '') => `<div class="win ${cls}"><div class="bar">${dots}<div class="url">${url}</div></div><div class="body">${body}</div></div>`;
const side = (brand, items, on) => `<div class="side"><div class="brand">${brand}</div>${items.map((t, i) => `<div class="it${i === on ? ' on' : ''}">${t}</div>`).join('')}</div>`;
const main = (h2, sub, inner) => `<div class="main"><h2>${h2}</h2>${sub ? `<div class="sub">${sub}</div>` : ''}${inner}<div class="tag">illustration</div></div>`;
const fld = (label, value, cls = '') => `<div class="fld"><label>${label}</label><div class="inp ${cls}">${value}</div></div>`;
const btn = (text, cls = '', tip = '') => `<span class="btn ${cls}"${tip ? ` data-tip="${tip}"` : ''}>${text}</span>`;
const row = (...kids) => `<div class="row">${kids.join('')}</div>`;
const chk = (t) => `<span class="chk"><i>✓</i>${t}</span>`;
const modal = (title, inner) => `<div class="modal"><div><h3>${title}</h3>${inner}</div></div>`;
// Our own settings page, simplified.
const sett = (section, inner) => win('<b>your-site</b>/settings', main(section, 'Settings', inner));

const SLACK_SIDE = ['Basic Information', 'OAuth &amp; Permissions', 'Incoming Webhooks', 'App Home'];
const GCP = 'Google Cloud';

module.exports = [
  // ───────────────────────────── Google Sheets ─────────────────────────────
  {
    id: 'sheets', title: 'Connect Google Sheets',
    intro: { k: 'Walkthrough · about 5 minutes', h1: 'Connect your Google Sheet', p: 'Every report your team files is saved as a row in a Google Sheet that you own.',
      say: 'This walkthrough connects your Google Sheet, so every report your team files has somewhere to be saved. It takes about five minutes, and you only do it once.' },
    scenes: [
      { cap: 'Open <em>sheets.new</em>, name the sheet, and copy its address',
        say: 'First, open a new Google Sheet by going to sheets.new. Give it a name, then copy the address from the top of your browser.',
        html: win('<span class="hl" data-tip="Copy this address">docs.google.com/spreadsheets/d/<b>1AbC…xyz</b>/edit</span>', main('<span class="hl">EOD Reports</span>', 'Untitled spreadsheet (click the name to rename it)',
          `<div class="grid">${Array.from({ length: 35 }, (_, i) => `<div>${i < 7 ? ['', 'A', 'B', 'C', 'D', 'E', 'F'][i] : i % 7 === 0 ? i / 7 : ''}</div>`).join('')}</div>`)) },
      { cap: 'Paste it into <em>Google Sheet link</em> on the settings page',
        say: 'Back on the settings page, paste that address into the box called Google Sheet link.',
        html: sett('Google Sheets', fld('Google Sheet link', 'https://docs.google.com/spreadsheets/d/1AbC…xyz/edit', 'hl') + fld('Service account key', '{ "type": "service_account", … }', 'ph tall')) },
      { cap: 'In Google Cloud, <em>create a project</em> (it’s free)',
        say: 'Next, open Google Cloud and create a new project. It is free. Give it any name you like and press Create.',
        html: win('console.cloud.google.com/<b>projectcreate</b>', side(GCP, ['New Project'], 0) + main('New Project', 'A project keeps your keys in one place', fld('Project name', 'EOD Reports') + row(btn('Create', 'pri hl', 'Click'), btn('Cancel')))) },
      { cap: 'Open the <em>Google Sheets API</em> page and press Enable',
        say: 'Now switch on the Google Sheets API. Open its page from the link in the guide, and press Enable.',
        html: win('console.cloud.google.com/apis/library/<b>sheets.googleapis.com</b>', side(GCP, ['APIs &amp; Services', 'Library'], 1) + main('Google Sheets API', 'Read and write Google Sheets', row(btn('Enable', 'pri hl', 'Click')) + '<div class="sub">Lets your service account write rows to your sheet.</div>')) },
      { cap: 'Create a <em>service account</em>: a robot login for your sheet',
        say: 'Then create a service account. Think of it as a robot login that is only allowed to write to your sheet. Give it a name, press Create and continue, then Done.',
        html: win('console.cloud.google.com/iam-admin/<b>serviceaccounts/create</b>', side(GCP, ['IAM &amp; Admin', 'Service Accounts'], 1) + main('Create service account', 'Step 1 of 3 (the other two are optional)', fld('Service account name', 'eod-reports') + row(btn('Create and continue', 'pri hl', 'Click'), btn('Done')))) },
      { cap: 'Open the account → <em>Keys</em> → Add key → Create new key',
        say: 'Click the service account you just made. Open the Keys tab, press Add key, and choose Create new key.',
        html: win('console.cloud.google.com/iam-admin/<b>serviceaccounts</b>', side(GCP, ['IAM &amp; Admin', 'Service Accounts'], 1) + main('eod-reports', 'eod-reports@your-project.iam.gserviceaccount.com',
          `<div class="tabs"><div class="tab">Details</div><div class="tab">Permissions</div><div class="tab on hl">Keys</div></div>${row(btn('Add key ▾'))}<div class="menu"><div class="hl" data-tip="Click">Create new key</div><div>Upload existing key</div></div>`)) },
      { cap: 'Choose <em>JSON</em> and press Create. A file downloads',
        say: 'Choose JSON, and press Create. A small file downloads to your computer. That file is the key.',
        html: win('console.cloud.google.com/iam-admin/<b>serviceaccounts</b>', side(GCP, ['IAM &amp; Admin', 'Service Accounts'], 1) + main('eod-reports', '', modal('Create private key', `<div class="li hl"><b>◉ JSON</b><span>Recommended</span></div><div class="li">○ P12</div>${row(btn('Create', 'pri hl', 'Click'), btn('Cancel'))}`))) },
      { cap: 'Open the file, copy <em>everything</em>, paste it into Service account key, and Save',
        say: 'Open the downloaded file with any text editor. Select everything, copy it, and paste it into the Service account key box. Then press Save Google Sheets.',
        html: sett('Google Sheets', fld('Google Sheet link', '1AbC…xyz') + fld('Service account key', '{ "type": "service_account", "project_id": "your-project", "private_key": "-----BEGIN…', 'tall hl') + row(btn('Save Google Sheets', 'grn hl', 'Then click'))) },
      { cap: '<em>Share</em> your sheet with the address in the green box, as Editor',
        say: 'After saving, a green box shows an email address. Go back to your Google Sheet, press Share, paste that address, choose Editor, and send.',
        html: win('docs.google.com/spreadsheets/d/<b>1AbC…xyz</b>/edit', main('EOD Reports', '', modal('Share “EOD Reports”', fld('Add people', 'eod-reports@your-project.iam.gserviceaccount.com', 'hl') + row('<span class="chip hl">Editor ▾</span>', btn('Send', 'pri hl', 'Click'))))) },
      { cap: 'Press <em>Test connection</em>. You’re done',
        say: 'Finally, press Test connection. When it says connected, you are finished. The tabs and headings are created automatically the first time someone files a report.',
        html: sett('Google Sheets', '<div class="note">Share your Google Sheet with this address as Editor: <b>eod-reports@your-project.iam.gserviceaccount.com</b></div>' + row(btn('Test connection', 'hl', 'Click'), '<span class="ok">Connected to “EOD Reports”.</span>')) },
    ],
    outro: { h1: 'Google Sheets is connected', list: ['Reports now save to your sheet', 'Tabs and headings create themselves', 'Next: connect Slack or Discord'],
      say: 'That is Google Sheets connected. Every report now saves straight to your sheet. Next, connect Slack or Discord so the team sees each report as it comes in.' },
  },

  // ───────────────────────────── Slack: bot token ──────────────────────────
  {
    id: 'slack', title: 'Connect Slack',
    intro: { k: 'Walkthrough · about 3 minutes', h1: 'Connect Slack', p: 'Reports, the daily scorecard and reminders post straight into your Slack channels.',
      say: 'This walkthrough connects Slack, so every report, the daily scorecard and reminders post straight into your channels. It takes about three minutes.' },
    scenes: [
      { cap: 'Open <em>api.slack.com/apps</em> → Create New App → From scratch',
        say: 'Open the Slack apps page from the link in the guide. Press Create New App, and choose From scratch.',
        html: win('api.slack.com/<b>apps</b>', main('Your Apps', '', row(btn('Create New App', 'pri')) + modal('Create an app', `<div class="li hl" data-tip="Choose this"><b>From scratch</b><span>Configure it yourself</span></div><div class="li">From a manifest</div>`))) },
      { cap: 'Name it, pick your <em>workspace</em>, and press Create App',
        say: 'Give the app a name, such as EOD Reports. Pick your workspace, and press Create App.',
        html: win('api.slack.com/<b>apps</b>', main('Your Apps', '', modal('Name app &amp; choose workspace', fld('App Name', 'EOD Reports') + fld('Pick a workspace', 'Your Company ▾') + row(btn('Create App', 'pri hl', 'Click'))))) },
      { cap: 'Open <em>OAuth &amp; Permissions</em> and add four Bot Token Scopes',
        say: 'In the left menu, open OAuth and Permissions. Scroll to Bot Token Scopes and add these four: chat write, chat write public, channels read, and groups read.',
        html: win('api.slack.com/apps/<b>A01…</b>/oauth', side('EOD Reports', SLACK_SIDE.map((t, i) => (i === 1 ? `<span class="hl">${t}</span>` : t)), 1) + main('Scopes', 'Bot Token Scopes',
          `<div class="li"><span class="chip">chat:write</span></div><div class="li"><span class="chip">chat:write.public</span></div><div class="li"><span class="chip">channels:read</span></div><div class="li"><span class="chip">groups:read</span></div>${row(btn('Add an OAuth Scope', 'hl'))}`)) },
      { cap: 'Scroll up and press <em>Install to Workspace</em>, then Allow',
        say: 'Scroll back to the top of that page and press Install to Workspace. Slack asks for permission. Press Allow.',
        html: win('api.slack.com/apps/<b>A01…</b>/oauth', side('EOD Reports', SLACK_SIDE, 1) + main('OAuth Tokens', 'Install the app to get your token', row(btn('Install to Workspace', 'grn hl', 'Click')))) },
      { cap: 'Copy the <em>Bot User OAuth Token</em>. It starts with xoxb-',
        say: 'You now have a Bot User OAuth Token. It starts with xoxb. Press Copy.',
        html: win('api.slack.com/apps/<b>A01…</b>/oauth', side('EOD Reports', SLACK_SIDE, 1) + main('OAuth Tokens', 'Bot User OAuth Token', row('<div class="inp" style="flex:1">xoxb-1234567890-••••••••••••••••</div>', btn('Copy', 'hl', 'Click')))) },
      { cap: 'Paste it into <em>Bot token</em>, Save, then Connect &amp; load channels',
        say: 'On the settings page, paste it into the Bot token box and press Save Slack. Then press Connect and load channels.',
        html: sett('Slack', fld('Bot token', 'xoxb-••••••••••••••••', 'hl') + row(btn('Save Slack', 'grn'), btn('Connect &amp; load channels', 'hl', 'Then click'))) },
      { cap: 'Pick a <em>channel</em> for each report, Save, and send a test',
        say: 'The boxes turn into lists of your real channels. Pick where each report should go, press Save Slack again, then press Send test messages and check your channels.',
        html: sett('Slack', fld('Setter reports go to', '#setter-eod ▾', 'hl') + fld('Closer reports go to', '#closer-eod ▾') + fld('Daily scorecard goes to', '#sales-scorecard ▾') + row(btn('Save Slack', 'grn'), btn('Send test messages', 'hl'), '<span class="ok">Test message sent to 3 Slack channels.</span>')) },
      { cap: 'Private channel? Type <em>/invite @your-app</em> in it first',
        say: 'One last thing. If a channel is private, the app cannot post there until you invite it. In that channel, type /invite, followed by your app name.',
        html: win('app.slack.com · <b>#closer-eod</b> 🔒', side('Your Company', ['# general', '# setter-eod', '🔒 closer-eod'], 2) + main('🔒 closer-eod', 'Private channel', '<div style="height:150px"></div>' + fld('Message', '/invite @EOD Reports', 'hl'))) },
    ],
    outro: { h1: 'Slack is connected', list: ['Reports post as they’re filed', 'Daily scorecard posts automatically', 'Reminders chase anyone who hasn’t filed'],
      say: 'That is Slack connected. Reports post as they are filed, the daily scorecard posts on its own, and reminders chase anyone who has not filed.' },
  },

  // ───────────────────────────── Slack: webhooks ───────────────────────────
  {
    id: 'slack-webhooks', title: 'Slack webhooks',
    intro: { k: 'Walkthrough · about 2 minutes', h1: 'Slack with webhooks', p: 'A webhook is a private web address that posts into one channel. Use these instead of a bot token.',
      say: 'This is the other way to connect Slack. A webhook is a private web address that posts into one specific channel. You make one for each channel.' },
    scenes: [
      { cap: 'In your Slack app, open <em>Incoming Webhooks</em> and switch it On',
        say: 'Open your Slack app. In the left menu choose Incoming Webhooks, and switch it on.',
        html: win('api.slack.com/apps/<b>A01…</b>/incoming-webhooks', side('EOD Reports', SLACK_SIDE.map((t, i) => (i === 2 ? `<span class="hl">${t}</span>` : t)), 2) + main('Incoming Webhooks', 'Post messages from outside Slack', '<span class="tgl hl" data-tip="Switch on">Activate Incoming Webhooks <i></i></span>')) },
      { cap: 'Press <em>Add New Webhook to Workspace</em> and choose the channel',
        say: 'Press Add New Webhook to Workspace. Choose the channel you want reports to land in, and press Allow.',
        html: win('api.slack.com/apps/<b>A01…</b>/incoming-webhooks', side('EOD Reports', SLACK_SIDE, 2) + main('Webhook URLs for Your Workspace', '', row(btn('Add New Webhook to Workspace', 'hl', 'Click')) + modal('Where should EOD Reports post?', fld('Channel', '#setter-eod ▾', 'hl') + row(btn('Allow', 'grn'))))) },
      { cap: 'Copy the <em>Webhook URL</em>. Treat it like a password',
        say: 'Slack gives you a Webhook URL. Press Copy. Treat it like a password, because anyone who has it can post in that channel.',
        html: win('api.slack.com/apps/<b>A01…</b>/incoming-webhooks', side('EOD Reports', SLACK_SIDE, 2) + main('Webhook URLs for Your Workspace', '', `<div class="li"><span class="chip">https://hooks.slack.com/services/T00…/B00…/••••</span>${btn('Copy', 'hl', 'Click')}</div><div class="sub">#setter-eod</div>`)) },
      { cap: 'Paste it in the matching box, <em>Save</em>, and send a test',
        say: 'On the settings page, open Prefer webhooks, and paste the address into the matching box. Repeat for each channel, press Save Slack, then Send test messages.',
        html: sett('Slack webhooks', fld('Setter reports webhook', 'https://hooks.slack.com/services/T00…/B00…/••••', 'hl') + fld('Closer reports webhook', 'https://hooks.slack.com/services/…', 'ph') + row(btn('Save Slack', 'grn hl'), btn('Send test messages'))) },
    ],
    outro: { h1: 'Slack webhooks are set', list: ['One webhook per channel', 'Keep the addresses private'], say: 'That is it. One webhook for each channel, and your reports will start arriving.' },
  },

  // ───────────────────────────── Discord: webhooks ─────────────────────────
  {
    id: 'discord', title: 'Connect Discord',
    intro: { k: 'Walkthrough · about 1 minute per channel', h1: 'Connect Discord', p: 'A webhook is a private web address that posts into one channel. You make one per channel.',
      say: 'This walkthrough connects Discord using webhooks. A webhook is a private web address that posts into one channel. It takes about a minute for each channel.' },
    scenes: [
      { cap: 'Hover the channel and click the <em>cog</em> (Edit Channel)',
        say: 'In Discord, hover over the channel you want reports in, and click the cog icon to edit the channel.',
        html: win('discord.com · <b>Your Server</b>', side('Your Server', ['# general', '# setter-eod  <span class="hl" data-tip="Click the cog">⚙</span>', '# closer-eod'], 1) + main('# setter-eod', 'Reports will post here', '<div style="height:200px"></div>'), 'dark') },
      { cap: 'Open <em>Integrations</em> → Webhooks → New Webhook',
        say: 'Open Integrations, then Webhooks, and press New Webhook.',
        html: win('discord.com · <b>Channel settings</b>', side('# setter-eod', ['Overview', 'Permissions', 'Invites', '<span class="hl">Integrations</span>'], 3) + main('Integrations', 'Webhooks', row(btn('New Webhook', 'pri hl', 'Click'))), 'dark') },
      { cap: 'Name it, then press <em>Copy Webhook URL</em>',
        say: 'Give the webhook a name, then press Copy Webhook URL. Treat it like a password.',
        html: win('discord.com · <b>Channel settings</b>', side('# setter-eod', ['Overview', 'Permissions', 'Invites', 'Integrations'], 3) + main('Webhooks', '', fld('Name', 'EOD Reports') + fld('Channel', '# setter-eod ▾') + row(btn('Copy Webhook URL', 'pri hl', 'Click'))), 'dark') },
      { cap: 'Paste it in the matching box, <em>Save Discord</em>, and send a test',
        say: 'On the settings page, paste it into the matching box. Repeat for each channel. You can reuse one channel for several reports. Then press Save Discord, and Send test messages.',
        html: sett('Discord', fld('Setter reports webhook', 'https://discord.com/api/webhooks/1234…/••••', 'hl') + fld('Closer reports webhook', 'https://discord.com/api/webhooks/…', 'ph') + fld('Daily scorecard webhook', 'https://discord.com/api/webhooks/…', 'ph') + row(btn('Save Discord', 'grn hl'), btn('Send test messages'))) },
    ],
    outro: { h1: 'Discord is connected', list: ['Reports post as they’re filed', 'Daily scorecard posts automatically'], say: 'That is Discord connected. Reports will post as they are filed, along with the daily scorecard.' },
  },

  // ───────────────────────────── Discord: bot ──────────────────────────────
  {
    id: 'discord-bot', title: 'Discord with a bot',
    intro: { k: 'Walkthrough · about 4 minutes', h1: 'Discord with a bot', p: 'One bot token, then pick each channel from a list.',
      say: 'This is the other way to connect Discord. You create one bot, then pick each channel from a list instead of pasting an address for every one.' },
    scenes: [
      { cap: 'Open the <em>Discord Developer Portal</em> → New Application',
        say: 'Open the Discord Developer Portal from the link in the guide. Press New Application, give it a name, and create it.',
        html: win('discord.com/<b>developers/applications</b>', main('Applications', '', row(btn('New Application', 'pri hl', 'Click'))), 'dark') },
      { cap: 'Open <em>Bot</em> → Reset Token → copy it',
        say: 'In the left menu open Bot. Press Reset Token, then copy the token. Discord only shows it once.',
        html: win('discord.com/developers/applications/<b>1234…</b>/bot', side('EOD Reports', ['General Information', 'Installation', 'OAuth2', '<span class="hl">Bot</span>'], 3) + main('Bot', 'Token', row(btn('Reset Token', 'hl', 'Click'), btn('Copy'))), 'dark') },
      { cap: 'Open <em>OAuth2</em> → URL Generator → tick bot and three permissions',
        say: 'Open OAuth2, then the URL Generator. Tick bot. Then tick View Channels, Send Messages, and Embed Links. Open the link it generates, and add the bot to your server.',
        html: win('discord.com/developers/applications/<b>1234…</b>/oauth2', side('EOD Reports', ['General Information', 'Installation', '<span class="hl">OAuth2</span>', 'Bot'], 2) + main('URL Generator', 'Scopes and bot permissions', chk('bot') + '<div class="sub" style="margin:8px 0">Bot permissions</div>' + chk('View Channels') + chk('Send Messages') + chk('Embed Links') + fld('Generated URL', 'https://discord.com/oauth2/authorize?client_id=…', 'hl')), 'dark') },
      { cap: 'Paste the token, Save, <em>Connect &amp; load channels</em>, and pick',
        say: 'On the settings page, open Prefer a bot, paste the token, and press Save Discord. Press Connect and load channels, pick a channel for each report, and save again.',
        html: sett('Discord bot', fld('Bot token', '••••••••••••.••••••.••••••••••••', 'hl') + row(btn('Save Discord', 'grn'), btn('Connect &amp; load channels', 'hl', 'Then click')) + fld('Setter reports go to', '#setter-eod ▾')) },
    ],
    outro: { h1: 'Your Discord bot is connected', list: ['One token for every channel', 'Change channels any time'], say: 'That is your Discord bot connected. You can change which channel each report goes to at any time.' },
  },

  // ───────────────────────────── Team: mention IDs ─────────────────────────
  {
    id: 'team', title: 'Team and @mentions',
    intro: { k: 'Walkthrough · about 2 minutes', h1: 'Add your team', p: 'Names turn the report’s name box into a pick-list. IDs make reminders actually notify people.',
      say: 'This walkthrough adds your team. Names turn the name box on each report into a pick list, and member IDs make reminders actually notify each person.' },
    scenes: [
      { cap: 'Choose your roles, type a name, and press <em>Add</em>',
        say: 'On the settings page, under Team, switch on the roles you have. Then type each person’s name and press Add. Names save straight away.',
        html: sett('Team', row('<span class="chip hl">Setters ✓</span>', '<span class="chip">Diallers</span>', '<span class="chip hl">Closers ✓</span>') + '<div class="li">Sam Jones<span>Remind ✓ · Remove</span></div>' + row('<div class="inp" style="flex:1">Jo Lee</div>', btn('Add setter', 'hl', 'Click'))) },
      { cap: 'Slack: profile → <em>⋮ More</em> → Copy member ID',
        say: 'To make reminders notify someone on Slack, open their profile, press the three dots for More, and choose Copy member ID.',
        html: win('app.slack.com · <b>Profile</b>', main('Jo Lee', 'Setter', row(btn('Message'), btn('⋮ More', 'hl')) + '<div class="menu"><div>View full profile</div><div class="hl" data-tip="Click">Copy member ID</div></div>')) },
      { cap: 'Discord: turn on <em>Developer Mode</em>, right-click → Copy User ID',
        say: 'On Discord, turn on Developer Mode in your settings, under Advanced. Then right click the person and choose Copy User ID.',
        html: win('discord.com · <b>Your Server</b>', side('Members', ['Sam Jones', '<span class="hl">Jo Lee</span>'], 1) + main('Jo Lee', '', '<div class="menu"><div>Profile</div><div>Message</div><div class="hl" data-tip="Click">Copy User ID</div></div>'), 'dark') },
      { cap: 'Paste the ID next to their name and <em>Save team</em>',
        say: 'Back on the settings page, paste the ID into the box next to their name, and press Save team. Untick Remind for anyone who should be listed but never chased.',
        html: sett('Team', '<div class="row"><div class="inp" style="flex:1">Jo Lee</div><div class="inp hl" style="flex:1">U01ABC2345</div><span class="chk"><i>✓</i>Remind</span></div>' + row(btn('Save team', 'grn hl', 'Click'))) },
    ],
    outro: { h1: 'Your team is set up', list: ['Pick-lists on every report', 'Reminders that reach the right person'], say: 'That is your team set up. Reports now have pick lists, and reminders reach the right person.' },
  },

  // ───────────────────────────── CRM: GoHighLevel ──────────────────────────
  {
    id: 'crm-ghl', title: 'Connect GoHighLevel',
    intro: { k: 'Walkthrough · about 3 minutes', h1: 'Connect GoHighLevel', p: 'Shows your live pipeline on the dashboard and moves opportunities when closers log outcomes.',
      say: 'This walkthrough connects Go High Level. It shows your live pipeline on the dashboard, and moves opportunities when your closers log a call outcome.' },
    scenes: [
      { cap: 'In your sub-account: <em>Settings → Private Integrations</em> → Create',
        say: 'Open Go High Level and switch into the sub account your sales team uses. Go to Settings, then Private Integrations, and press Create new integration.',
        html: win('app.gohighlevel.com/v2/location/<b>aBcD1234</b>/settings', side('Settings', ['Business Profile', 'My Staff', 'Pipelines', '<span class="hl">Private Integrations</span>'], 3) + main('Private Integrations', '', row(btn('Create new integration', 'pri hl', 'Click')))) },
      { cap: 'Tick the <em>contacts, opportunities and pipelines</em> scopes',
        say: 'Tick these scopes: view and edit contacts, view and edit opportunities, and view pipelines. Then create it.',
        html: win('app.gohighlevel.com/v2/location/<b>aBcD1234</b>/settings', side('Settings', ['Business Profile', 'My Staff', 'Pipelines', 'Private Integrations'], 3) + main('Select scopes', '', chk('View Contacts') + chk('Edit Contacts') + '<br>' + chk('View Opportunities') + chk('Edit Opportunities') + '<br>' + chk('View Pipelines') + row(btn('Create', 'pri hl', 'Click')))) },
      { cap: 'Copy the token. It starts with <em>pit-</em>',
        say: 'Copy the token. It starts with pit-.',
        html: win('app.gohighlevel.com/v2/location/<b>aBcD1234</b>/settings', side('Settings', ['Private Integrations'], 0) + main('Integration created', 'Copy your token now', row('<div class="inp" style="flex:1">pit-1a2b3c4d-••••-••••-••••••••</div>', btn('Copy', 'hl', 'Click')))) },
      { cap: 'Your <em>location ID</em> is in the address bar',
        say: 'Your location ID is in the address bar, right after the word location. You can copy the whole address.',
        html: win('app.gohighlevel.com/v2/location/<span class="hl" data-tip="This part"><b>aBcD1234EfGh5678</b></span>/dashboard', main('Dashboard', 'Your sub-account', '<div style="height:180px"></div>')) },
      { cap: 'Choose GoHighLevel, paste both, Save, then <em>Connect &amp; load pipelines</em>',
        say: 'On the settings page, under CRM, choose Go High Level. Paste the token and the location ID, press Save CRM, then Connect and load pipelines.',
        html: sett('CRM', fld('Which CRM do you use?', 'GoHighLevel ▾') + fld('GoHighLevel private integration token', 'pit-••••••••', 'hl') + fld('GoHighLevel location ID', 'aBcD1234EfGh5678', 'hl') + row(btn('Save CRM', 'grn'), btn('Connect &amp; load pipelines', 'hl', 'Then click'))) },
      { cap: 'Pick your <em>pipeline</em> and match each column to a stage',
        say: 'Choose your pipeline. Then match each dashboard column to a stage in it, and save. Leave a column on Not used to hide it.',
        html: sett('CRM', fld('Pipeline', 'Sales Pipeline ▾', 'hl') + row('<div style="flex:1">' + fld('Call Booked', 'Call Booked ▾') + '</div>', '<div style="flex:1">' + fld('Closed Won', 'Won ▾') + '</div>', '<div style="flex:1">' + fld('No Show', 'No-Show ▾') + '</div>') + row(btn('Save CRM', 'grn hl', 'Click'))) },
    ],
    outro: { h1: 'GoHighLevel is connected', list: ['Live pipeline on the dashboard', 'Outcomes move the opportunity'], say: 'That is Go High Level connected. Your pipeline is live on the dashboard, and call outcomes move each opportunity for you.' },
  },

  // ───────────────────────────── CRM: Close ────────────────────────────────
  {
    id: 'crm-close', title: 'Connect Close',
    intro: { k: 'Walkthrough · about 2 minutes', h1: 'Connect Close', p: 'Shows your live Close pipeline on the dashboard.',
      say: 'This walkthrough connects Close, so your live pipeline shows on the dashboard. It takes about two minutes.' },
    scenes: [
      { cap: 'In Close: <em>Settings → Developer → API Keys</em> → New API Key',
        say: 'Open Close. Go to Settings, then Developer, then API Keys, and press New API Key.',
        html: win('app.close.com/settings/developer/<b>api-keys</b>', side('Settings', ['Profile', 'Team', 'Statuses &amp; Pipelines', '<span class="hl">Developer</span>'], 3) + main('API Keys', '', row(btn('New API Key', 'pri hl', 'Click')))) },
      { cap: 'Name it and copy the key. It starts with <em>api_</em>',
        say: 'Give it a name and copy the key. It starts with api_. Close only shows it once, so copy it now.',
        html: win('app.close.com/settings/developer/<b>api-keys</b>', main('API Keys', '', modal('New API Key', fld('Name', 'EOD Reports') + row('<div class="inp" style="flex:1">api_1a2B3c••••••••••••••</div>', btn('Copy', 'hl', 'Click')) + '<div class="note warn">This key is only shown once.</div>'))) },
      { cap: 'Choose Close, paste the key, Save, then <em>Connect &amp; load pipelines</em>',
        say: 'On the settings page, under CRM, choose Close. Paste the key, press Save CRM, then Connect and load pipelines.',
        html: sett('CRM', fld('Which CRM do you use?', 'Close ▾', 'hl') + fld('Close API key', 'api_••••••••', 'hl') + row(btn('Save CRM', 'grn'), btn('Connect &amp; load pipelines', 'hl', 'Then click'))) },
      { cap: 'Pick your <em>pipeline</em> and match each column to a status',
        say: 'Choose your pipeline, match each dashboard column to one of its statuses, and save.',
        html: sett('CRM', fld('Pipeline', 'Sales ▾', 'hl') + row('<div style="flex:1">' + fld('Call Booked', 'Demo Scheduled ▾') + '</div>', '<div style="flex:1">' + fld('Closed Won', 'Won ▾') + '</div>', '<div style="flex:1">' + fld('Closed Lost', 'Lost ▾') + '</div>') + row(btn('Save CRM', 'grn hl', 'Click'))) },
    ],
    outro: { h1: 'Close is connected', list: ['Live pipeline on the dashboard', 'Each card links to the lead in Close'], say: 'That is Close connected. Your pipeline is live on the dashboard, and each card links straight to the lead in Close.' },
  },
];
