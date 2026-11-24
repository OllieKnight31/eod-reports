// Google Sheets adapter. Two tabs: CLOSER OUTCOMES + SETTER ACTIVITY.
// Tab schema is auto-extended on first read, drop the spreadsheet ID into env
// and the tabs/headers materialize automatically on first form submission.

const { google } = require('googleapis');
const { config } = require('./config');

// Schema definitions, column ORDER is the source of truth.
// To add a column: append to the headers array. ensureTab() will widen the
// existing sheet on next call. Never insert in the middle.
const CLOSER_OUTCOMES_HEADERS = [
  'Timestamp', 'Date', 'Closer', 'Lead Source', 'Lead Source Detail', 'Setter',
  'Prospect Email', 'Prospect Name',
  'Outcome', 'Package Sold', 'Ticket Price', 'Payment Type', 'Payment Received',
  'Lost Reason', 'Follow-up Date', 'Objections', 'Notes',
  'CRM Contact ID', 'Recording URL',
  'Dialler',
];

const CLOSER_COL = {
  ts: 0, date: 1, closer: 2, lead_source: 3, lead_source_detail: 4, setter: 5,
  prospect_email: 6, prospect_name: 7,
  outcome: 8, package: 9, ticket: 10, pay_type: 11, pay_received: 12,
  lost_reason: 13, followup_date: 14, objections: 15, notes: 16,
  crm_contact_id: 17, recording_url: 18,
  dialler: 19,
};

const SETTER_ACTIVITY_HEADERS = [
  'Timestamp', 'Date', 'Setter', 'Lead Source', 'Lead Source Detail',
  'Profile Visits', 'New Followers', 'Total Followers', 'Qualified Followers (ICP)',
  'Messages Sent', 'Outbounds', 'Inbounds', 'Follow Ups',
  'Links Sent', 'Calls Proposed', 'Calls Booked',
  'No Shows', 'Cancellations',
  'Hottest Lead', 'Lead Quality', 'Hit KPIs', 'Notes',
  // Links Sent above is the sum of these three
  'Booking Links', 'Community Invites', 'Resource/VSL Links',
];

const SETTER_COL = {
  ts: 0, date: 1, setter: 2, lead_source: 3, lead_source_detail: 4,
  profile_visits: 5, new_followers: 6, total_followers: 7, qualified_followers: 8,
  messages_sent: 9, outbounds: 10, inbounds: 11, followups: 12,
  links_sent: 13, calls_proposed: 14, calls_booked: 15,
  no_shows: 16, cancellations: 17,
  hottest_lead: 18, lead_quality: 19, hit_kpis: 20, notes: 21,
  booking_links: 22, community_invites: 23, resource_links: 24,
};

// Dialler EOD. Column order is the source of truth, append only, never insert.
const DIALLER_ACTIVITY_HEADERS = [
  'Timestamp', 'Date', 'Dialler',
  'Dials', 'Conversations', 'Leads Triaged', 'All Triaged With Notes',
  'Speed To Lead (mins)',
  'Set Calls Due', 'Set Calls Showed', 'Set Show Rate %',
  'Triaged Calls Due', 'Triaged Calls Showed', 'Triaged Show Rate %',
  'Set Calls Booked', 'Triaged Calls Booked', 'Booked To Closer',
  'KPIs Hit', 'KPIs Missed', 'Notes',
];

const DIALLER_COL = {
  ts: 0, date: 1, dialler: 2,
  dials: 3, conversations: 4, leads_triaged: 5, all_triaged_notes: 6,
  speed_to_lead: 7,
  set_due: 8, set_showed: 9, set_show_rate: 10,
  triaged_due: 11, triaged_showed: 12, triaged_show_rate: 13,
  set_booked: 14, triaged_booked: 15, booked_to_closer: 16,
  kpis_hit: 17, kpis_missed: 18, notes: 19,
};

const CLOSER_NO_CALLS_HEADERS = ['Timestamp', 'Date', 'Closer', 'Notes'];

let cachedClient = null;
let cachedKey = null;

function getClient() {
  const key = config.sheet.service_account_key;
  // Credentials can change at runtime via /settings, rebuild when they do.
  if (cachedClient && cachedKey === key) return cachedClient;
  if (!key || !config.sheet.spreadsheet_id) return null;
  let creds;
  try { creds = typeof key === 'string' ? JSON.parse(key) : key; }
  catch (e) { console.error('[sheets] Bad GOOGLE_SERVICE_ACCOUNT_KEY JSON:', e.message); return null; }

  // Service-account auth (preferred) OR authorized_user OAuth (fallback).
  let auth;
  if (creds.type === 'service_account') {
    auth = new google.auth.JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  } else {
    // authorized_user: construct with client id/secret so the refresh_token can
    // mint access tokens headless. (Bare new OAuth2().setCredentials() can't refresh.)
    auth = new google.auth.OAuth2(creds.client_id, creds.client_secret);
    auth.setCredentials({ refresh_token: creds.refresh_token, access_token: creds.access_token });
  }

  cachedClient = google.sheets({ version: 'v4', auth });
  cachedKey = key;
  return cachedClient;
}

function colLetter(n) {
  let s = '', v = n;
  while (v > 0) { const r = (v - 1) % 26; s = String.fromCharCode(65 + r) + s; v = Math.floor((v - 1) / 26); }
  return s;
}

async function ensureTab(tabName, headers) {
  const sheets = getClient();
  if (!sheets) return;
  const id = config.sheet.spreadsheet_id;
  try {
    const cur = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `'${tabName}'!1:1` });
    const have = cur.data.values?.[0] || [];
    if (have.length === 0 || have.length < headers.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: id,
        range: `'${tabName}'!A1:${colLetter(headers.length)}1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [headers] },
      });
    }
  } catch (e) {
    if (e.message && e.message.includes('Unable to parse range')) {
      // Tab missing, create it.
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: id,
        requestBody: { requests: [{ addSheet: { properties: { title: tabName, gridProperties: { rowCount: 5000, columnCount: headers.length } } } }] },
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId: id,
        range: `'${tabName}'!A1:${colLetter(headers.length)}1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [headers] },
      });
    } else {
      console.error('[sheets] ensureTab error:', e.message);
    }
  }
}

async function readRange(tabName, range) {
  const sheets = getClient();
  if (!sheets) return [];
  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: config.sheet.spreadsheet_id,
      range: `'${tabName}'!${range}`,
    });
    return resp.data.values || [];
  } catch (e) {
    // A tab that hasn't been created yet (nobody has filed that report) just means no rows.
    if (!/Unable to parse range/i.test(e.message)) console.error('[sheets] readRange error:', e.message);
    return [];
  }
}

async function appendRow(tabName, row) {
  const sheets = getClient();
  if (!sheets) return false;
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: config.sheet.spreadsheet_id,
      range: `'${tabName}'!A1`,
      // RAW (not USER_ENTERED): keep dates as literal ISO text ("2026-06-13") so
      // the dashboard's string-based date-range filter is locale-proof. USER_ENTERED
      // coerces dates to serials that can read back locale-formatted (e.g. 6/13/2026)
      // and break `date <= end` comparisons.
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });
    return true;
  } catch (e) {
    console.error('[sheets] appendRow error:', e.message);
    return false;
  }
}

async function ensureCloserTab()  { return ensureTab(config.sheet.tabs.closer_outcomes, CLOSER_OUTCOMES_HEADERS); }
async function ensureSetterTab()  { return ensureTab(config.sheet.tabs.setter_activity, SETTER_ACTIVITY_HEADERS); }
async function ensureDiallerTab() { return ensureTab(config.sheet.tabs.dialler_activity, DIALLER_ACTIVITY_HEADERS); }
async function ensureCloserNoCallsTab() { return ensureTab(config.sheet.tabs.closer_no_calls, CLOSER_NO_CALLS_HEADERS); }

module.exports = {
  CLOSER_OUTCOMES_HEADERS, CLOSER_COL,
  SETTER_ACTIVITY_HEADERS, SETTER_COL,
  DIALLER_ACTIVITY_HEADERS, DIALLER_COL,
  ensureCloserTab, ensureSetterTab, ensureDiallerTab, ensureCloserNoCallsTab,
  readRange, appendRow,
  isConfigured: () => Boolean(getClient()),
};
