// EOD System, runtime config.
// Values come from process.env (Vercel project settings), overridden by anything
// saved through the /settings page (see lib/settings-store.js).
// See .env.example for the full list and defaults.

function csv(v, fallback) {
  if (!v) return fallback;
  return String(v).split(',').map(s => s.trim()).filter(Boolean);
}

function parseJSON(v, fallback) {
  if (!v) return fallback;
  try { return JSON.parse(v); } catch { return fallback; }
}

// Roster entries may be bare names or {name, slack, discord, nudge}. `slack` / `discord`
// are the member IDs the missed-EOD reminder @mentions, a post with no mention notifies
// nobody. nudge:false = on the dropdown but never chased (e.g. occasional cover).
const ROLES = ['setter', 'dialler', 'closer'];
function parseRoster(raw) {
  const out = {};
  for (const role of ROLES) {
    out[role] = (Array.isArray(raw && raw[role]) ? raw[role] : [])
      .map(p => (typeof p === 'string' ? { name: p } : p))
      .filter(p => p && p.name)
      .map(p => ({
        name: String(p.name).trim(),
        slack: p.slack ? String(p.slack).trim() : '',
        discord: p.discord ? String(p.discord).trim() : '',
        nudge: p.nudge !== false,
      }));
  }
  return out;
}

// Which reports this business uses. A business with no diallers simply has no dialler
// tab, channel, scorecard section or reminder. Default: all three.
//   REPORT_ROLES="setter,closer"
function reportRoles(env) {
  const picked = csv(env.REPORT_ROLES, ROLES).map(r => r.toLowerCase()).filter(r => ROLES.includes(r));
  // keep the canonical order whatever order they were typed in
  return picked.length ? ROLES.filter(r => picked.includes(r)) : [...ROLES];
}

// One channel's delivery targets. Any mix works: a webhook URL per provider, and/or a
// channel ID that the provider's bot token posts into.
function channel(env, key) {
  return {
    discord:         env[`DISCORD_${key}_WEBHOOK`] || '',
    slack:           env[`SLACK_${key}_WEBHOOK`]   || '',
    discord_channel: env[`DISCORD_${key}_CHANNEL`] || '',
    slack_channel:   env[`SLACK_${key}_CHANNEL`]   || '',
  };
}

// A target: the env value if given (0 = "no target for this one"), else the default.
function target(v, fallback) {
  if (v === undefined || v === null || String(v).trim() === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function build(env) {
  const roles = reportRoles(env);
  return {
    report_roles: roles,

    brand: {
      name: env.BRAND_NAME || 'EOD System',
      color: env.BRAND_COLOR || '#2ECC71',
      timezone: env.TIMEZONE || 'UTC',
      // Shown on revenue in the dashboards, the closer form and the closer notifications.
      currency_symbol: env.CURRENCY_SYMBOL || '$',
    },

    // Sources the dashboard segments by. Order is preserved in the UI.
    // Override with: LEAD_SOURCES="Webinar,DM,Ads,Referral"
    lead_sources: csv(env.LEAD_SOURCES, ['Webinar', 'DM', 'Lead Magnet', 'VSL', 'Community']),

    // Booking origins that exist only on the closer form, e.g. a dialler working old leads
    // is a real source of calls and revenue but not a setter lead source. The dashboard
    // segments closer outcomes by lead_sources + these.
    // Set with: CLOSER_EXTRA_SOURCES="Dialler, Old Leads,Referral Partner"
    closer_extra_sources: csv(env.CLOSER_EXTRA_SOURCES, []),

    // Who can be credited with booking a call on the closer form. Each role gets its own
    // optional field ("Setter (who booked)", "Dialler (who booked)") so a call both touched
    // credits both. Roles: setter, dialler.
    // Default is every booking role in REPORT_ROLES, so a business with no dialler never
  // sees the dialler field.
    closer_booked_by: csv(env.CLOSER_BOOKED_BY, ['setter', 'dialler']).map(s => s.toLowerCase()).filter(r => roles.includes(r)),

    // Sheet
    sheet: {
      spreadsheet_id: env.SPREADSHEET_ID || '',
      service_account_key: env.GOOGLE_SERVICE_ACCOUNT_KEY || '',
      tabs: {
        closer_outcomes:  env.SHEET_TAB_CLOSER || 'CLOSER OUTCOMES',
        setter_activity:  env.SHEET_TAB_SETTER || 'SETTER ACTIVITY',
        dialler_activity: env.SHEET_TAB_DIALLER || 'DIALLER ACTIVITY',
        // Zero-call closer days. Never CLOSER OUTCOMES, every row there is read as a call.
        closer_no_calls:  env.SHEET_TAB_CLOSER_NO_CALLS || 'CLOSER NO-CALL DAYS',
      },
    },

    // Notifications, Discord and/or Slack per channel. Each is independently
    // optional. Set neither/either/both. Empty = silently skipped.
    notify: {
      // Bot tokens, one per provider, shared by every channel that has a *_CHANNEL id.
      slack_bot_token:   env.SLACK_BOT_TOKEN   || '',
      discord_bot_token: env.DISCORD_BOT_TOKEN || '',
      setter:    channel(env, 'SETTER'),
      dialler:   channel(env, 'DIALLER'),
      closer:    channel(env, 'CLOSER'),
      // The daily team scorecard. Falls back to nothing, no channel, no post.
      scorecard: channel(env, 'SCORECARD'),
    },

    // Who files which report. Drives the name dropdowns on the forms, free text splits
    // one person into several on the dashboard ("Jo", "Jo Lee", "Joanna"), and the
    // missed-EOD reminder. A role with no entries keeps its free-text box.
    //   ROSTER_JSON='{"dialler":[{"name":"Jo Lee","slack":"U…"}],"setter":["Sam"],"closer":[…]}'
    roster: parseRoster(parseJSON(env.ROSTER_JSON, {})),

    // Dialler KPI targets. These drive the hit/miss marks on the form, in the post and
    // on the scorecard.
    dialler_targets: {
      dials:             target(env.KPI_DIALS, 300),
      conversations:     target(env.KPI_CONVERSATIONS, 20),
      speed_to_lead_min: target(env.KPI_SPEED_TO_LEAD_MIN, 5),
      set_show_rate:     target(env.KPI_SET_SHOW_RATE, 60),
      triaged_show_rate: target(env.KPI_TRIAGED_SHOW_RATE, 80),
    },

    // Setter and closer daily targets, the bars on the scorecard. 0 = no target.
    setter_targets: {
      messages:     target(env.KPI_SETTER_MESSAGES, 50),
      outbounds:    target(env.KPI_SETTER_OUTBOUNDS, 30),
      followups:    target(env.KPI_SETTER_FOLLOWUPS, 20),
      calls_booked: target(env.KPI_SETTER_CALLS_BOOKED, 3),
    },
    closer_targets: {
      calls:      target(env.KPI_CLOSER_CALLS, 5),
      show_rate:  target(env.KPI_CLOSER_SHOW_RATE, 70),
      close_rate: target(env.KPI_CLOSER_CLOSE_RATE, 25),
      revenue:    target(env.KPI_CLOSER_REVENUE, 0),
    },

    // Missed-EOD reminder (GET /api?action=nudge, fired by a Vercel cron).
    //   NUDGE_HOUR=21            local hour (in TIMEZONE) the reminder goes out
    //   NUDGE_DAYS="1,2,3,4,5"   0 = Sunday. Per-role override: NUDGE_DAYS_DIALLER="0,1,2,3,4,5,6"
    //   NUDGE_ROLES="dialler,setter,closer"
    //   REMINDERS="off"          switch them off without touching the schedule
    nudge: {
      enabled: String(env.REMINDERS || 'on').toLowerCase() !== 'off',
      hour: Number(env.NUDGE_HOUR || 21),
      days: csv(env.NUDGE_DAYS, ['1', '2', '3', '4', '5']).map(Number),
      days_by_role: Object.fromEntries(ROLES
        .filter(r => env[`NUDGE_DAYS_${r.toUpperCase()}`])
        .map(r => [r, csv(env[`NUDGE_DAYS_${r.toUpperCase()}`], []).map(Number)])),
      roles: csv(env.NUDGE_ROLES, ROLES).map(r => r.toLowerCase()).filter(r => roles.includes(r)),
    },

    // Daily scorecard post (fired by the same cron as the reminder).
    //   SCORECARD_HOUR=8   local hour it goes out. Before noon it covers YESTERDAY
    //                      (a morning recap); from noon on it covers today.
    scorecard: {
      enabled: String(env.SCORECARD_POST || 'on').toLowerCase() !== 'off',
      hour: Number(env.SCORECARD_HOUR || 8),
    },

    // CRM provider, drives the live pipeline section + Open-in-CRM deep links.
    // Supported: 'ghl' | 'close' | 'none'. Add a new provider in lib/crm-adapter.js.
    crm: {
      provider: (env.CRM_PROVIDER || 'none').toLowerCase(),
      ghl: {
        api_key: env.GHL_API_KEY || '',
        location_id: env.GHL_LOCATION_ID || '',
        pipeline_id: env.GHL_PIPELINE_ID || '',
        // Map closer-relevant stage keys → GHL stage UUIDs. Override with:
        //   GHL_STAGES_JSON='{"callBooked":"<id>","callCompleted":"<id>", ...}'
        // Stages NOT listed here are excluded from the pipeline view.
        stages: parseJSON(env.GHL_STAGES_JSON, {}),
      },
      // Close (close.com). Stage keys map to Close opportunity STATUS ids.
      close: {
        api_key: env.CLOSE_API_KEY || '',
        pipeline_id: env.CLOSE_PIPELINE_ID || '',
        stages: parseJSON(env.CLOSE_STAGES_JSON, {}),
      },
    },

    // Closer-relevant stage order shown in the pipeline kanban (left → right).
    // Stage keys must match keys in crm.ghl.stages (or whatever provider you wire).
    closer_stage_order: csv(env.CLOSER_STAGE_ORDER, [
      'callBooked', 'callCompleted', 'proposalSent', 'closedWon', 'closedLost', 'noShow',
    ]),

    closer_stage_labels: {
      callBooked: 'Call Booked',
      callCompleted: 'Call Completed',
      proposalSent: 'Proposal Sent',
      closedWon: 'Closed Won',
      closedLost: 'Closed Lost',
      noShow: 'No Show',
      registered: 'Registered',
      confirmed: 'Confirmed',
      attended: 'Attended',
      ...parseJSON(env.CLOSER_STAGE_LABELS_JSON, {}),
    },
  };
}

// One stable object, every module holds a reference to it and reads at call time,
// so applySettings() can swap values in place without anyone re-requiring.
const config = build(process.env);

// Re-derive config with saved settings layered over process.env. Called once per
// request by the API entry after the settings store is loaded.
function applySettings(overrides) {
  Object.assign(config, build({ ...process.env, ...(overrides || {}) }));
}

// Every source a closer can pick: the setter sources plus the closer-only extras.
function closerLeadSources() {
  return [...config.lead_sources, ...config.closer_extra_sources.filter(s => !config.lead_sources.includes(s))];
}

// Public config, exposed via /api?action=config so the frontend can self-brand.
// Never include secrets here.
function publicConfig() {
  return {
    brand: config.brand,
    report_roles: config.report_roles,
    currency_symbol: config.brand.currency_symbol,
    lead_sources: config.lead_sources,
    closer_lead_sources: closerLeadSources(),
    closer_booked_by: config.closer_booked_by,
    crm_provider: config.crm.provider,
    closer_stage_order: config.closer_stage_order,
    closer_stage_labels: config.closer_stage_labels,
    // The form's hit/miss hints read these, so moving a target moves the bar everywhere.
    kpi_targets: { ...config.dialler_targets },
    // names only, mention IDs stay server-side
    roster: Object.fromEntries(Object.entries(config.roster).map(([role, ps]) => [role, ps.map(p => p.name)])),
  };
}

// Inbound webhooks (GHL, Tally…) can send any spelling; snap it to the roster.
function canonicalName(role, name) {
  const hit = (config.roster[role] || []).find(p => p.name.toLowerCase() === String(name).trim().toLowerCase());
  return hit ? hit.name : name;
}

module.exports = { config, publicConfig, closerLeadSources, applySettings, canonicalName, ROLES };
