// Notification fan-out. Each channel ('setter' | 'dialler' | 'closer' | 'scorecard') can
// be delivered four ways, in any mix, see config.js:
//   • Discord webhook URL        • Slack webhook URL
//   • Discord bot token + channel ID   • Slack bot token + channel ID
// Unset targets are silently skipped. Failures don't throw.
//
// Public API matches the old discord.js: notifySetter(payload), notifyCloser(payload).
// Payload shape is Discord-flavored (title, description, color (int), fields,
// timestamp); the Slack adapter translates internally.

const { config } = require('./config');

// Translate a Discord-flavored embed → Slack Block Kit + attachment color.
// Reports are written with Discord markdown (**bold**); Slack's bold is a single *.
const slackMd = (text) => String(text).replace(/\*\*(.+?)\*\*/g, '*$1*');

function embedToSlackPayload(embed) {
  const colorHex = '#' + ((Number(embed.color) || 0x95A5A6).toString(16).padStart(6, '0'));
  const blocks = [];

  if (embed.title) {
    blocks.push({
      type: 'header',
      text: { type: 'plain_text', text: String(embed.title).slice(0, 150), emoji: true },
    });
  }
  if (embed.description) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: slackMd(embed.description).slice(0, 3000) },
    });
  }
  if (Array.isArray(embed.fields) && embed.fields.length) {
    // Slack section blocks accept max 10 fields each. Chunk if needed.
    for (let i = 0; i < embed.fields.length; i += 10) {
      const chunk = embed.fields.slice(i, i + 10);
      blocks.push({
        type: 'section',
        fields: chunk.map(f => ({
          type: 'mrkdwn',
          text: `*${String(f.name).slice(0, 250)}*\n${slackMd(f.value).slice(0, 1900)}`,
        })),
      });
    }
  }
  if (embed.timestamp) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `_${String(embed.timestamp).replace('T', ' ').slice(0, 19)} UTC_` }],
    });
  }

  return {
    text: String(embed.title || 'Notification'),  // fallback for mobile previews
    attachments: [{
      color: colorHex,
      blocks,
      fallback: String(embed.title || ''),
    }],
  };
}

// ── Bot-token delivery ──────────────────────────────────────────────────────
const SLACK_API = 'https://slack.com/api';
const DISCORD_API = 'https://discord.com/api/v10';

// Slack answers 200 with { ok:false, error } on failure, so read the body.
async function slackBotPost(token, channelId, payload) {
  try {
    const resp = await fetch(`${SLACK_API}/chat.postMessage`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ channel: channelId, ...payload }),
      signal: AbortSignal.timeout(7000),
    });
    const data = await resp.json().catch(() => ({}));
    if (data.ok) return { provider: 'slack-bot', status: 'ok' };
    return { provider: 'slack-bot', status: 'error', error: data.error || `http ${resp.status}` };
  } catch (e) {
    return { provider: 'slack-bot', status: 'error', error: e.message };
  }
}

async function discordBotPost(token, channelId, payload) {
  try {
    const resp = await fetch(`${DISCORD_API}/channels/${encodeURIComponent(channelId)}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(7000),
    });
    if (resp.ok) return { provider: 'discord-bot', status: 'ok' };
    const data = await resp.json().catch(() => ({}));
    return { provider: 'discord-bot', status: 'error', http: resp.status, error: data.message || '' };
  } catch (e) {
    return { provider: 'discord-bot', status: 'error', error: e.message };
  }
}

async function postWebhook(provider, url, payload) {
  try {
    const resp = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(7000),
    });
    return { provider, status: resp.ok ? 'ok' : 'error', http: resp.status };
  } catch (e) {
    return { provider, status: 'error', error: e.message };
  }
}

// Every way a channel can currently be reached, as [provider, send(slackPayload, discordPayload)].
function targets(channel) {
  const t = config.notify[channel] || {};
  const { slack_bot_token, discord_bot_token } = config.notify;
  const out = [];
  if (t.discord) out.push(['discord', (s, d) => postWebhook('discord', t.discord, d)]);
  if (t.slack)   out.push(['slack',   (s) => postWebhook('slack', t.slack, s)]);
  if (t.discord_channel && discord_bot_token) out.push(['discord', (s, d) => discordBotPost(discord_bot_token, t.discord_channel, d)]);
  if (t.slack_channel && slack_bot_token)     out.push(['slack',   (s) => slackBotPost(slack_bot_token, t.slack_channel, s)]);
  return out;
}

// Which providers a channel reaches, lets callers format a mention per provider.
function providers(channel) {
  return [...new Set(targets(channel).map(([p]) => p))];
}

async function deliver(channel, slackPayload, discordPayload, only) {
  const list = targets(channel).filter(([p]) => !only || p === only);
  if (!list.length) return { status: 'skipped', reason: 'no channel connected' };
  const settled = await Promise.allSettled(list.map(([, send]) => send(slackPayload, discordPayload)));
  const results = settled.map(r => r.status === 'fulfilled' ? r.value : { status: 'error', error: r.reason?.message });
  return { status: results.every(r => r.status === 'ok') ? 'ok' : 'partial', results };
}

// Rich report, a Discord-flavoured embed, translated for Slack.
async function notify(channel, embed, only) {
  return deliver(channel, embedToSlackPayload(embed), { embeds: [embed] }, only);
}

// Plain text with provider-specific markup (mentions, links differ between the two).
async function notifyText(channel, { slack, discord }) {
  return deliver(channel, { text: slack }, { content: discord });
}

async function notifySetter(embed) { return notify('setter', embed); }
async function notifyCloser(embed) { return notify('closer', embed); }
async function notifyDialler(embed) { return notify('dialler', embed); }
async function notifyScorecard(embed) { return notify('scorecard', embed); }

module.exports = { notify, notifyText, providers, notifySetter, notifyCloser, notifyDialler, notifyScorecard, SLACK_API, DISCORD_API };
