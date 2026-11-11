#!/usr/bin/env node
// Collects fresh Twitch clips for the streamers in config.json and saves the
// chat that was on screen during each clip. A clip (and its chat) is removed
// again once its full stream is no longer on Twitch.
// Chatter names are swapped for made-up ones before anything is saved (see
// "Chatter names" below); the streamers in config.json keep their real names.
//
//   node collector/collect.mjs              normal run (what GitHub runs every day)
//   node collector/collect.mjs --dry        show what would be added, write nothing
//   node collector/collect.mjs --only=xqc   run for one streamer
//   node collector/collect.mjs --test=<clip link or id>   print the chat of one clip
//
// Needs TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET (from dev.twitch.tv/console).
// No packages to install: plain Node 18 or newer.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Twitch's own website uses this public client id and query to show "Chat Replay"
// on VODs. There is no official API for VOD chat. If Twitch changes this, the
// two values can be overridden with environment variables without editing code.
const GQL_URL = "https://gql.twitch.tv/gql";
const GQL_CLIENT_ID = process.env.TWITCH_GQL_CLIENT_ID || "kimne78kx3ncx6brgo4mv6wki5h1ko";
const COMMENTS_HASH =
  process.env.TWITCH_GQL_COMMENTS_HASH || "b70a3591ff0f4e0313d126c6a1502d79a1c02baebb288227c582044aa76adf6a";

const DAY = 24 * 60 * 60 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// HTTP

async function request(url, init, label) {
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(url, init);
    } catch (err) {
      if (attempt >= 4) throw new Error(`${label}: ${err.message}`);
      await sleep(1000 * attempt);
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 4) throw new Error(`${label}: HTTP ${res.status}`);
      const reset = Number(res.headers.get("ratelimit-reset"));
      const wait = reset ? reset * 1000 - Date.now() : 1500 * attempt;
      await sleep(Math.min(Math.max(wait, 1000), 60000));
      continue;
    }
    return res;
  }
}

async function getJSON(url, init = {}, label = String(url)) {
  const res = await request(url, init, label);
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (e) {
    body = null;
  }
  if (!res.ok) {
    const err = new Error(`${label}: HTTP ${res.status} ${text.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

async function tryJSON(url) {
  try {
    return await getJSON(url);
  } catch (e) {
    return null;
  }
}

function chunks(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------------------
// Official Twitch API (Helix)

class Helix {
  constructor(clientId, clientSecret) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.token = null;
  }

  async login() {
    const body = await getJSON(
      "https://id.twitch.tv/oauth2/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: "client_credentials",
        }),
      },
      "Twitch login",
    );
    if (!body || !body.access_token) throw new Error("Twitch login: no access token in the reply");
    this.token = body.access_token;
  }

  async get(endpoint, params) {
    const url = new URL("https://api.twitch.tv/helix/" + endpoint);
    for (const [k, v] of params) url.searchParams.append(k, v);
    return getJSON(
      url,
      { headers: { "Client-Id": this.clientId, Authorization: "Bearer " + this.token } },
      "Twitch API /" + endpoint,
    );
  }

  async users(logins) {
    const out = new Map();
    for (const group of chunks(logins, 100)) {
      const body = await this.get("users", group.map((l) => ["login", l]));
      for (const u of body.data || []) out.set(u.login.toLowerCase(), u);
    }
    return out;
  }

  async clips(broadcasterId, since, until, maxPages) {
    const all = [];
    let after = null;
    for (let page = 0; page < maxPages; page++) {
      const params = [
        ["broadcaster_id", broadcasterId],
        ["started_at", since.toISOString()],
        ["ended_at", until.toISOString()],
        ["first", "100"],
      ];
      if (after) params.push(["after", after]);
      const body = await this.get("clips", params);
      all.push(...(body.data || []));
      after = body.pagination && body.pagination.cursor;
      if (!after) break;
    }
    return all;
  }

  // Returns a map of clip id -> clip for the ids that still exist, or null on error.
  async existingClips(ids) {
    const found = new Map();
    try {
      for (const group of chunks(ids, 100)) {
        const body = await this.get("clips", group.map((id) => ["id", id]));
        for (const c of body.data || []) found.set(c.id, c);
      }
      return found;
    } catch (e) {
      return null;
    }
  }

  // Returns the set of stream (VOD) ids that are no longer on Twitch, or null on error.
  // Twitch answers 404 for a whole request if any one id is gone, so a group that
  // gets 404 is split in half until the missing ones are found.
  async missingVideos(ids) {
    const missing = new Set();
    const check = async (group) => {
      try {
        const body = await this.get("videos", group.map((id) => ["id", id]));
        const found = new Set((body.data || []).map((v) => String(v.id)));
        for (const id of group) if (!found.has(id)) missing.add(id);
      } catch (e) {
        if (e.status !== 404) throw e;
        if (group.length === 1) {
          missing.add(group[0]);
          return;
        }
        const half = Math.ceil(group.length / 2);
        await check(group.slice(0, half));
        await check(group.slice(half));
      }
    };
    try {
      for (const group of chunks(ids, 100)) await check(group);
      return missing;
    } catch (e) {
      return null;
    }
  }

  async badges(broadcasterId) {
    const map = new Map();
    try {
      const body = broadcasterId
        ? await this.get("chat/badges", [["broadcaster_id", broadcasterId]])
        : await this.get("chat/badges/global", []);
      for (const set of body.data || []) {
        for (const v of set.versions || []) {
          map.set(set.set_id + "/" + v.id, v.image_url_2x || v.image_url_1x);
        }
      }
    } catch (e) {}
    return map;
  }
}

// ---------------------------------------------------------------------------
// 7TV / BetterTTV / FrankerFaceZ emotes (they arrive as plain words in Twitch chat)

function sevenTvUrl(e) {
  const host = e && e.data && e.data.host;
  if (host && host.url) return (host.url.startsWith("//") ? "https:" : "") + host.url + "/2x.webp";
  return "https://cdn.7tv.app/emote/" + e.id + "/2x.webp";
}

function addEmotes(map, list, toUrl) {
  for (const e of list || []) {
    const name = e.name || e.code;
    if (name && !map.has(name)) map.set(name, toUrl(e));
  }
}

const bttvUrl = (e) => "https://cdn.betterttv.net/emote/" + e.id + "/2x";
const ffzUrl = (e) => (e.images && (e.images["2x"] || e.images["1x"])) || "https://cdn.frankerfacez.com/emote/" + e.id + "/2";

async function globalThirdPartyEmotes() {
  const [stv, bttv, ffz] = await Promise.all([
    tryJSON("https://7tv.io/v3/emote-sets/global"),
    tryJSON("https://api.betterttv.net/3/cached/emotes/global"),
    tryJSON("https://api.betterttv.net/3/cached/frankerfacez/emotes/global"),
  ]);
  return { stv: (stv && stv.emotes) || [], bttv: bttv || [], ffz: ffz || [] };
}

// Channel emotes win over global ones with the same name, 7TV first.
async function channelEmotes(twitchUserId, globals) {
  const [stv, bttv, ffz] = await Promise.all([
    tryJSON("https://7tv.io/v3/users/twitch/" + twitchUserId),
    tryJSON("https://api.betterttv.net/3/cached/users/twitch/" + twitchUserId),
    tryJSON("https://api.betterttv.net/3/cached/frankerfacez/users/twitch/" + twitchUserId),
  ]);
  const map = new Map();
  addEmotes(map, stv && stv.emote_set && stv.emote_set.emotes, sevenTvUrl);
  addEmotes(map, bttv && bttv.channelEmotes, bttvUrl);
  addEmotes(map, bttv && bttv.sharedEmotes, bttvUrl);
  addEmotes(map, ffz, ffzUrl);
  addEmotes(map, globals.stv, sevenTvUrl);
  addEmotes(map, globals.bttv, bttvUrl);
  addEmotes(map, globals.ffz, ffzUrl);
  return map;
}

// ---------------------------------------------------------------------------
// VOD chat (Twitch's chat replay)

class ChatError extends Error {}

async function chatPage(videoId, offset) {
  const body = [
    {
      operationName: "VideoCommentsByOffsetOrCursor",
      variables: { videoID: String(videoId), contentOffsetSeconds: Math.max(0, Math.floor(offset)) },
      extensions: { persistedQuery: { version: 1, sha256Hash: COMMENTS_HASH } },
    },
  ];
  const reply = await getJSON(
    GQL_URL,
    {
      method: "POST",
      headers: { "Client-Id": GQL_CLIENT_ID, "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(body),
    },
    "Twitch chat replay",
  );
  const item = Array.isArray(reply) ? reply[0] : reply;
  if (item && item.errors && item.errors.length) {
    throw new ChatError("Twitch chat replay: " + item.errors.map((e) => e.message).join("; "));
  }
  const video = item && item.data && item.data.video;
  if (!video) return { missing: true, edges: [], hasNext: false };
  const comments = video.comments;
  return {
    edges: (comments && comments.edges) || [],
    hasNext: !!(comments && comments.pageInfo && comments.pageInfo.hasNextPage),
  };
}

// Reads every chat message between `start` and `end` seconds of the VOD.
async function fetchChat(videoId, start, end) {
  const seen = new Map();
  let offset = start;
  for (let guard = 0; offset <= end && guard < 150; guard++) {
    const page = await chatPage(videoId, offset);
    if (page.missing) return null;
    let maxOffset = -1;
    for (const edge of page.edges) {
      const n = edge && edge.node;
      if (!n || typeof n.contentOffsetSeconds !== "number") continue;
      maxOffset = Math.max(maxOffset, n.contentOffsetSeconds);
      if (n.contentOffsetSeconds < start || n.contentOffsetSeconds > end) continue;
      if (!seen.has(n.id)) seen.set(n.id, n);
    }
    if (!page.edges.length || !page.hasNext) break;
    // Twitch pages by whole seconds and repeats messages across pages; the map removes repeats.
    offset = maxOffset > offset ? maxOffset : offset + 1;
    await sleep(120);
  }
  return [...seen.values()];
}

const twitchEmoteUrl = (id) => "https://static-cdn.jtvnw.net/emoticons/v2/" + id + "/default/dark/2.0";

function toParts(fragments, emotes) {
  const parts = [];
  let text = "";
  const flush = () => {
    if (text) parts.push(text);
    text = "";
  };
  for (const f of fragments || []) {
    const raw = (f && f.text) || "";
    const emoteId = f && f.emote && (f.emote.emoteID || f.emote.id);
    if (emoteId) {
      flush();
      parts.push({ e: raw.trim(), u: twitchEmoteUrl(emoteId) });
      continue;
    }
    for (const token of raw.split(/(\s+)/)) {
      const url = token && emotes.get(token);
      if (url) {
        flush();
        parts.push({ e: token, u: url });
      } else {
        text += token;
      }
    }
  }
  flush();
  return parts;
}

// ---------------------------------------------------------------------------
// Chatter names
//
// Every chatter gets a made-up name, and every @mention is changed to match, so
// the saved chat is not a public record of who wrote what. Names are random for
// each clip: the same person gets a different name in a different clip. The
// streamers in config.json and the bots in ignoreUsers keep their real names.

const NAME_ADJ = [
  "salty", "cosmic", "sleepy", "crispy", "frozen", "goofy", "lazy", "silent", "spicy", "tiny",
  "big", "based", "rusty", "humble", "feral", "pixel", "night", "shadow", "soggy", "chill",
  "lucky", "mighty", "quiet", "fuzzy", "hyper", "happy", "grumpy", "sneaky", "wild", "golden",
  "icy", "turbo", "mega", "lil", "dr", "mr", "not", "its", "angry", "cracked",
];
const NAME_NOUN = [
  "walrus", "penguin", "taco", "noodle", "goblin", "waffle", "otter", "pickle", "raccoon", "biscuit",
  "mango", "yeti", "llama", "frog", "panda", "moose", "koala", "burrito", "toast", "ninja",
  "pigeon", "cactus", "shrimp", "tater", "dingo", "bean", "viking", "wizard", "gremlin", "nugget",
  "badger", "falcon", "lemur", "hamster", "pretzel", "muffin", "comet", "rocket", "pebble", "cobra",
  "bagel", "donut", "squid", "turtle", "beetle", "sloth", "ferret", "walnut", "pancake", "gecko",
];
const NAME_TAG = ["tv", "gg", "lol", "irl", "yt", "fn", "plays", "main", "og", "x", "w"];

function fakeName(rng) {
  const pick = (list) => list[Math.floor(rng() * list.length)];
  const cap = (s) => s[0].toUpperCase() + s.slice(1);
  const num = () => String(Math.floor(rng() * (rng() < 0.5 ? 100 : 10000)));
  const a = pick(NAME_ADJ);
  const n = pick(NAME_NOUN);
  switch (Math.floor(rng() * 6)) {
    case 0: return a + n + num();
    case 1: return cap(a) + cap(n);
    case 2: return a + "_" + n;
    case 3: return cap(a) + cap(n) + num();
    case 4: return n + "_" + pick(NAME_TAG) + (rng() < 0.5 ? num() : "");
    default: return (a + n).toUpperCase() + (rng() < 0.5 ? num() : "");
  }
}

// Changes the names in one clip's messages (in place) and returns them.
// `keep` holds lowercase names that stay as they are. A message may carry a
// temporary `_login` (the chatter's Twitch login) so that mentions, which use
// the login, get the same made-up name as the display name; it is removed here.
export function anonymize(messages, keep = new Set(), rng = Math.random) {
  const names = new Map();
  const used = new Set(keep);
  const nameFor = (real) => {
    const key = String(real || "").toLowerCase();
    if (!key || keep.has(key)) return null;
    let fake = names.get(key);
    if (!fake) {
      do {
        fake = fakeName(rng);
      } while (used.has(fake.toLowerCase()));
      used.add(fake.toLowerCase());
      names.set(key, fake);
    }
    return fake;
  };

  // Chatters first, so a person's @mentions point at the name they post under.
  for (const m of messages) {
    const fake = nameFor(m._login || m.u);
    if (fake) {
      if (m._login) names.set(String(m.u).toLowerCase(), fake);
      m.u = fake;
    }
    delete m._login;
  }

  // Then @mentions in the text (a mentioned person who did not chat gets a name too).
  for (const m of messages) {
    if (!Array.isArray(m.m)) continue;
    m.m = m.m.map((part) =>
      typeof part === "string"
        ? part.replace(/@([A-Za-z0-9_]+)/g, (all, name) => {
            const fake = nameFor(name);
            return fake ? "@" + fake : all;
          })
        : part,
    );
  }
  return messages;
}

// Names that are never changed: the streamers in the game and the known bots.
function keptNames(cfg) {
  return new Set(
    [...(cfg.streamers || []), ...(cfg.ignoreUsers || [])].map((s) => String(s).toLowerCase().trim()).filter(Boolean),
  );
}

// Swaps the names in clips that were saved before names were hidden.
// Each file is changed once; it is marked with "anon": 1 afterwards.
export async function anonymizeSavedClips(clipsDir, keep, { dry = false } = {}) {
  let files;
  try {
    files = (await fs.readdir(clipsDir)).filter((f) => f.endsWith(".json"));
  } catch (e) {
    return 0;
  }
  let changed = 0;
  for (const f of files) {
    const file = path.join(clipsDir, f);
    const rec = await readJSON(file, null);
    if (!rec || rec.anon || !Array.isArray(rec.messages)) continue;
    rec.messages = anonymize(rec.messages, keep);
    rec.anon = 1;
    changed++;
    if (!dry) await fs.writeFile(file, JSON.stringify(rec));
  }
  return changed;
}

// Turns raw chat replay comments into the game's message format, with times in
// seconds from the start of the clip, and with made-up chatter names.
export function convertChat(nodes, clip, ctx) {
  const start = clip.vod_offset;
  // Twitch gives whole seconds. The send time (createdAt) adds the fraction, so
  // messages inside the same second keep their real spacing and order.
  const bases = nodes
    .map((n) => Date.parse(n.createdAt) - n.contentOffsetSeconds * 1000)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const base = bases.length ? bases[Math.floor(bases.length * 0.05)] : null;

  const out = [];
  for (const n of nodes) {
    const login = ((n.commenter && n.commenter.login) || "").toLowerCase();
    if (!n.commenter || ctx.ignore.has(login)) continue;
    const whole = n.contentOffsetSeconds - start;
    let t = whole;
    const sent = Date.parse(n.createdAt);
    if (base !== null && Number.isFinite(sent)) {
      const frac = (sent - base) / 1000 - n.contentOffsetSeconds;
      t = whole + Math.min(Math.max(frac, 0), 0.99);
    }
    if (t < 0 || t >= ctx.chatSeconds) continue;

    const msg = n.message || {};
    const parts = toParts(msg.fragments, ctx.emotes);
    if (!parts.length) continue;
    const entry = { t: Math.round(t * 100) / 100, u: n.commenter.displayName || n.commenter.login, m: parts };
    if (msg.userColor) entry.c = msg.userColor;
    const badges = (msg.userBadges || [])
      .map((b) => b && ctx.badges.get(b.setID + "/" + b.version))
      .filter(Boolean)
      .slice(0, 3);
    if (badges.length) entry.b = badges;
    entry._sent = Number.isFinite(sent) ? sent : 0;
    entry._login = login;
    out.push(entry);
  }
  out.sort((a, b) => a.t - b.t || a._sent - b._sent);
  for (const m of out) delete m._sent;
  return anonymize(out, ctx.keep || new Set());
}

// ---------------------------------------------------------------------------
// Files

async function readJSON(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (e) {
    return fallback;
  }
}

async function writeIndex(file, clips) {
  const lines = clips.map((c) => JSON.stringify(c));
  const text = '{\n"updated": ' + JSON.stringify(new Date().toISOString()) + ',\n"clips": [\n' + lines.join(",\n") + "\n]\n}\n";
  await fs.writeFile(file, text);
}

// ---------------------------------------------------------------------------
// Main run

function parseArgs(argv) {
  const opts = { dry: false, only: null, test: null };
  for (const a of argv) {
    if (a === "--dry") opts.dry = true;
    else if (a.startsWith("--only=")) opts.only = a.slice(7).toLowerCase();
    else if (a.startsWith("--test=")) opts.test = a.slice(7);
  }
  return opts;
}

function credentials() {
  const id = process.env.TWITCH_CLIENT_ID;
  const secret = process.env.TWITCH_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error(
      "TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET are not set. Add them as repository secrets (see README).",
    );
  }
  return [id, secret];
}

const round1 = (n) => Math.round(n * 10) / 10;

// Settings with defaults, so an older config.json keeps working.
function settings(cfg) {
  return {
    maxChat: cfg.maxChatSeconds || 60,
    minDuration: cfg.minDurationSeconds || 0,
    maxDuration: cfg.maxDurationSeconds || 60,
    firstSeconds: cfg.firstRevealSeconds || 1,
    minFirst: cfg.minMessagesInFirstReveal ?? 1,
    minMessages: cfg.minMessages || 0,
    runMinutes: cfg.maxRunMinutes || 30,
    minViews: cfg.minViews || 0,
    minViewsBy: lowerKeys(cfg.minViewsByStreamer),
    minAgeDays: cfg.minClipAgeDays || 0,
  };
}

function lowerKeys(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj && typeof obj === "object" ? obj : {})) out[k.toLowerCase().trim()] = Number(v) || 0;
  return out;
}

// The fewest views a clip of this streamer needs: their own number in
// minViewsByStreamer if they have one, otherwise minViews.
export const minViewsFor = (login, set) => set.minViewsBy[login] ?? set.minViews;

// Clips must be at least minClipAgeDays old, so they've had time to collect views.
export const oldEnough = (clip, set, now) =>
  !set.minAgeDays || Date.parse(clip.created_at) <= now.getTime() - set.minAgeDays * DAY;

export { settings };

// Seconds of chat to save for a clip: its whole length, up to the cap.
const chatLengthFor = (clip, set) => Math.min(set.maxChat, round1(clip.duration || 30));

// Clips must be inside the allowed length range. Twitch lengths are not exact
// (a "30 second" clip can be 30.2), so allow half a second either way.
const lengthOk = (clip, set) => {
  const d = clip.duration || 30;
  return d >= set.minDuration - 0.5 && d <= set.maxDuration + 0.5;
};

export async function testClip(input, { log = console.log, root = path.resolve(HERE, "..") } = {}) {
  const cfg = JSON.parse(await fs.readFile(path.join(root, "collector", "config.json"), "utf8"));
  const set = settings(cfg);
  const helix = new Helix(...credentials());
  await helix.login();
  const match = /(?:clips\.twitch\.tv\/(?:embed\?clip=)?|\/clip\/)([\w-]+)/.exec(input);
  const id = match ? match[1] : input.trim();
  const found = await helix.existingClips([id]);
  const clip = found && found.get(id);
  if (!clip) throw new Error("Clip " + id + " was not found on Twitch.");
  log(`Clip: ${clip.title} (${clip.broadcaster_name}, ${clip.view_count} views)`);
  if (!clip.video_id || clip.vod_offset == null) {
    log("This clip's VOD is gone, so its chat can no longer be read.");
    return;
  }
  const chatTo = chatLengthFor(clip, set);
  const nodes = await fetchChat(clip.video_id, clip.vod_offset, clip.vod_offset + Math.ceil(chatTo));
  if (!nodes) {
    log("Twitch did not return the VOD for this clip.");
    return;
  }
  const emotes = await channelEmotes(clip.broadcaster_id, await globalThirdPartyEmotes());
  const messages = convertChat(nodes, clip, {
    emotes,
    badges: new Map(),
    ignore: new Set((cfg.ignoreUsers || []).map((u) => u.toLowerCase())),
    keep: keptNames(cfg),
    chatSeconds: chatTo,
  });
  log(`Clip length ${clip.duration}s. ${messages.length} messages in ${chatTo} seconds of chat. First 15:`);
  for (const m of messages.slice(0, 15)) {
    const text = m.m.map((p) => (typeof p === "string" ? p : "[" + p.e + "]")).join("");
    log(`  ${m.t.toFixed(2).padStart(6)}s  ${m.u}: ${text}`);
  }
}

export async function collect({ root = path.resolve(HERE, ".."), dry = false, only = null, log = console.log } = {}) {
  const cfg = JSON.parse(await fs.readFile(path.join(root, "collector", "config.json"), "utf8"));
  const set = settings(cfg);
  // Stop early and save, so GitHub's time limit never throws away a run's work.
  const deadline = Date.now() + set.runMinutes * 60 * 1000;
  let outOfTime = false;
  const timeLeft = () => {
    if (!outOfTime && Date.now() > deadline) {
      outOfTime = true;
      log(`! Reached the ${set.runMinutes} minute limit. Saving now; the next run continues.`);
    }
    return !outOfTime;
  };
  const dataDir = path.join(root, "data");
  const clipsDir = path.join(dataDir, "clips");
  if (!dry) await fs.mkdir(clipsDir, { recursive: true });

  const keep = keptNames(cfg);

  // 0. Hide the chatter names in clips saved before names were hidden.
  //    Needs no Twitch connection, so it runs first.
  const renamed = await anonymizeSavedClips(clipsDir, keep, { dry });
  if (renamed) log(`Hid the chatter names in ${renamed} saved clips.`);

  const helix = new Helix(...credentials());
  await helix.login();

  const logins = [...new Set(cfg.streamers.map((s) => String(s).toLowerCase().trim()).filter(Boolean))];
  const users = await helix.users(logins);
  for (const l of logins) if (!users.has(l)) log(`! Twitch has no channel named "${l}". Check the spelling in config.json.`);

  const indexFile = path.join(dataDir, "index.json");
  const rejectedFile = path.join(dataDir, "rejected.json");
  const index = await readJSON(indexFile, { clips: [] });
  const rejected = await readJSON(rejectedFile, {});
  let pool = (index.clips || []).filter((c) => c && c.id);

  // 1. Drop clips that were deleted on Twitch (their video would not play),
  //    clips whose full stream is gone from Twitch (so its chat is gone there too),
  //    clips outside the allowed length range, and clips with too few views.
  //    New clips take their place in step 2.
  let removedDeleted = 0;
  let removedLength = 0;
  let removedStream = 0;
  let removedViews = 0;
  let streamNote = "";
  let existing = null;
  if (pool.length) {
    existing = await helix.existingClips(pool.map((c) => c.id));
    if (existing) {
      const gone = pool.filter((c) => !existing.has(c.id));
      const wrongLength = pool.filter((c) => existing.has(c.id) && !lengthOk(existing.get(c.id), set));
      for (const c of [...gone, ...wrongLength]) {
        if (!dry) await fs.rm(path.join(clipsDir, c.id + ".json"), { force: true });
      }
      removedDeleted = gone.length;
      removedLength = wrongLength.length;
      pool = pool.filter((c) => existing.has(c.id) && lengthOk(existing.get(c.id), set));
      for (const c of pool) c.v = existing.get(c.id).view_count; // keep view counts current
      // Below the views threshold (for example after it was raised): remove.
      // A removed clip can come back later if it gains views.
      const fewViews = pool.filter((c) => (c.v || 0) < minViewsFor(c.s, set));
      for (const c of fewViews) {
        if (!dry) await fs.rm(path.join(clipsDir, c.id + ".json"), { force: true });
      }
      removedViews = fewViews.length;
      pool = pool.filter((c) => (c.v || 0) >= minViewsFor(c.s, set));

      // The full stream (VOD) is gone from Twitch, so its chat is gone there too:
      // remove the clip here as well. Each saved clip remembers its stream id.
      const vodOf = new Map();
      for (const c of pool) {
        const rec = await readJSON(path.join(clipsDir, c.id + ".json"), null);
        if (rec && rec.vod) vodOf.set(c.id, String(rec.vod));
      }
      const missing = vodOf.size ? await helix.missingVideos([...new Set(vodOf.values())]) : new Set();
      if (!missing) {
        streamNote = "Could not check which streams are gone this run.";
        log("! " + streamNote);
      } else {
        const streamGone = pool.filter((c) => vodOf.has(c.id) && missing.has(vodOf.get(c.id)));
        // Streams expire a few at a time. If Twitch suddenly says most are gone,
        // something is off on Twitch's side: keep everything and try again next run.
        if (streamGone.length > Math.max(5, pool.length / 2)) {
          streamNote = `Twitch said ${streamGone.length} of ${pool.length} streams are gone, which looks wrong, so none were removed.`;
          log("! " + streamNote);
        } else {
          for (const c of streamGone) {
            if (!dry) await fs.rm(path.join(clipsDir, c.id + ".json"), { force: true });
          }
          removedStream = streamGone.length;
          const goneIds = new Set(streamGone.map((c) => c.id));
          pool = pool.filter((c) => !goneIds.has(c.id));
        }
      }
    } else {
      log("! Could not check for deleted clips this run. Skipping that step.");
    }
  }

  // 2. Find new clips.
  const have = new Set(pool.map((c) => c.id));
  const globalBadges = await helix.badges(null);
  const globals = await globalThirdPartyEmotes();
  const ignore = new Set((cfg.ignoreUsers || []).map((u) => u.toLowerCase()));
  const until = new Date();
  const since = new Date(until.getTime() - cfg.lookbackDays * DAY);
  const today = until.toISOString().slice(0, 10);

  const summary = [];
  let chatTries = 0;
  let chatFails = 0;
  let failStreak = 0;
  let lastChatError = null;
  let chatBroken = false;

  // Reads a clip's chat. Returns the messages, null if the VOD is gone, or
  // undefined if Twitch's chat replay failed (counted, and retried next run).
  async function readChat(login, clip, chatTo, emotes, badges) {
    chatTries++;
    let nodes;
    try {
      nodes = await fetchChat(clip.video_id, clip.vod_offset, clip.vod_offset + Math.ceil(chatTo));
      failStreak = 0;
    } catch (err) {
      chatFails++;
      failStreak++;
      lastChatError = err;
      log(`! ${login} ${clip.id}: ${err.message}`);
      if (failStreak >= 3) {
        chatBroken = true;
        log("! Chat replay failed 3 times in a row. Stopping for this run.");
      }
      return undefined;
    }
    if (!nodes) return null;
    return convertChat(nodes, clip, { emotes, badges, ignore, keep, chatSeconds: chatTo });
  }

  for (const login of logins) {
    const user = users.get(login);
    if (!user || (only && only !== login)) continue;
    const row = { login, found: 0, added: 0, noChat: 0, quiet: 0, longer: 0 };
    summary.push(row);

    let badges = null;
    let emotes = null;
    const loadExtras = async () => {
      if (!badges) badges = new Map([...globalBadges, ...(await helix.badges(user.id))]);
      if (!emotes) emotes = await channelEmotes(user.id, globals);
    };

    // 2a. Clips saved before chat covered the whole clip: save the rest of their chat.
    if (existing) {
      for (const c of pool.filter((p) => p.s === login)) {
        if (chatBroken || !timeLeft()) break;
        const info = existing.get(c.id);
        if (!info) continue;
        const file = path.join(clipsDir, c.id + ".json");
        const rec = await readJSON(file, null);
        if (!rec) continue;
        const dur = round1(info.duration || 30);
        const want = chatLengthFor(info, set);
        const saved = rec.chatTo ?? 30; // older runs always saved 30 seconds
        if (rec.dur === dur && saved >= want - 0.05) continue; // already complete

        let changed = rec.dur !== dur;
        rec.dur = dur;
        if (saved >= want - 0.05) {
          rec.chatTo = want;
          changed = true;
        } else {
          rec.chatTo = saved;
          if (info.video_id && info.vod_offset != null) {
            await loadExtras();
            const messages = await readChat(login, info, want, emotes, badges);
            if (messages && messages.length >= rec.messages.length) {
              rec.messages = messages;
              rec.anon = 1;
              rec.chatTo = want;
              rec.vod = info.video_id;
              rec.vod_offset = info.vod_offset;
              row.longer++;
              changed = true;
            }
            await sleep(120);
          }
        }
        if (changed && !dry) await fs.writeFile(file, JSON.stringify(rec));
      }
    }

    let clips;
    try {
      clips = await helix.clips(user.id, since, until, cfg.maxClipPagesPerStreamer || 3);
    } catch (err) {
      log(`! ${login}: could not list clips (${err.message})`);
      continue;
    }
    row.found = clips.length;
    const inPool = pool.filter((c) => c.s === login).length;
    const limit = Math.max(cfg.newClipsPerStreamerPerRun, (cfg.startingClipsPerStreamer || 0) - inPool);
    const candidates = clips
      .filter(
        (c) =>
          !have.has(c.id) &&
          !rejected[c.id] &&
          c.view_count >= minViewsFor(login, set) &&
          oldEnough(c, set, until) &&
          lengthOk(c, set),
      )
      .sort((a, b) => b.view_count - a.view_count);

    for (const clip of candidates) {
      if (row.added >= limit || chatBroken || !timeLeft()) break;
      if (!clip.video_id || clip.vod_offset == null) {
        row.noChat++; // VOD deleted, or the stream is still live; try again tomorrow
        continue;
      }
      await loadExtras();

      const chatTo = chatLengthFor(clip, set);
      const messages = await readChat(login, clip, chatTo, emotes, badges);
      if (messages === undefined) continue;
      if (messages === null) {
        row.noChat++;
        continue;
      }

      // The chat must have enough messages overall, and in the part shown before any skip.
      const early = messages.filter((m) => m.t < set.firstSeconds).length;
      if (messages.length < set.minMessages || early < set.minFirst) {
        row.quiet++;
        rejected[clip.id] = { why: "quiet chat", n: messages.length, on: today };
        continue;
      }

      const record = {
        id: clip.id,
        s: login,
        title: clip.title,
        views: clip.view_count,
        created: clip.created_at,
        url: clip.url,
        vod: clip.video_id,
        vod_offset: clip.vod_offset,
        dur: round1(clip.duration || 30),
        chatTo,
        collected: until.toISOString(),
        anon: 1,
        messages,
      };
      if (!dry) await fs.writeFile(path.join(clipsDir, clip.id + ".json"), JSON.stringify(record));
      pool.push({ id: clip.id, s: login, v: clip.view_count, d: clip.created_at });
      have.add(clip.id);
      row.added++;
      log(`+ ${login}: "${clip.title}" (${clip.view_count} views, ${messages.length} messages)`);
      await sleep(150);
    }
  }

  // 3. Keep each streamer under the cap by dropping their least viewed clips.
  let removedCap = 0;
  if (cfg.maxClipsPerStreamer) {
    const keepClips = [];
    for (const login of new Set(pool.map((c) => c.s))) {
      const mine = pool.filter((c) => c.s === login).sort((a, b) => b.v - a.v);
      keepClips.push(...mine.slice(0, cfg.maxClipsPerStreamer));
      for (const c of mine.slice(cfg.maxClipsPerStreamer)) {
        removedCap++;
        if (!dry) await fs.rm(path.join(clipsDir, c.id + ".json"), { force: true });
      }
    }
    pool = keepClips;
  }

  // 4. Forget rejections older than the lookback window (those clips are never fetched again anyway).
  const cutoff = new Date(until.getTime() - (cfg.lookbackDays + 7) * DAY).toISOString().slice(0, 10);
  for (const [id, r] of Object.entries(rejected)) if (!r.on || r.on < cutoff) delete rejected[id];

  // 5. Save.
  const roster = logins
    .filter((l) => users.has(l))
    .map((l) => {
      const u = users.get(l);
      return { login: l, name: u.display_name || u.login, avatar: u.profile_image_url || null };
    });
  pool.sort((a, b) => (a.s === b.s ? b.v - a.v : a.s < b.s ? -1 : 1));
  if (!dry) {
    await writeIndex(indexFile, pool);
    await fs.writeFile(path.join(dataDir, "rejected.json"), JSON.stringify(rejected, null, 0) + "\n");
    await fs.writeFile(
      path.join(dataDir, "streamers.json"),
      JSON.stringify({ updated: until.toISOString(), streamers: roster }, null, 2) + "\n",
    );
  }

  const added = summary.reduce((n, r) => n + r.added, 0);
  const longer = summary.reduce((n, r) => n + r.longer, 0);
  log("");
  log("streamer            found  added  no chat  quiet  full chat  in pool");
  for (const r of summary) {
    const total = pool.filter((c) => c.s === r.login).length;
    log(
      r.login.padEnd(18) +
        String(r.found).padStart(7) +
        String(r.added).padStart(7) +
        String(r.noChat).padStart(9) +
        String(r.quiet).padStart(7) +
        String(r.longer).padStart(11) +
        String(total).padStart(9),
    );
  }
  log(
    `\nAdded ${added} clips. Saved the full chat for ${longer} older clips. ` +
      `Removed ${removedDeleted} deleted, ${removedStream} whose stream is gone from Twitch, ${removedLength} too short or too long, ${removedViews} with too few views, and ${removedCap} over the cap. ` +
      (renamed ? `Hid chatter names in ${renamed} saved clips. ` : "") +
      (streamNote ? streamNote + " " : "") +
      `Pool: ${pool.length}.`,
  );
  if (outOfTime) log("Stopped at the time limit. The next run picks up where this one stopped.");
  if (dry) log("Dry run: nothing was written.");

  if (process.env.GITHUB_STEP_SUMMARY && !dry) {
    const md = [
      `### Clip collection ${today}`,
      "",
      `Added **${added}** clips. Saved the full chat for **${longer}** older clips. Pool: **${pool.length}**. ` +
        `Removed ${removedDeleted} deleted, ${removedStream} whose stream is gone from Twitch, ${removedLength} too short or too long, ${removedViews} with too few views, ${removedCap} over the cap.` +
        (renamed ? ` Hid chatter names in ${renamed} saved clips.` : "") +
        (streamNote ? " " + streamNote : "") +
        (outOfTime ? " Stopped at the time limit; the next run continues." : ""),
      "",
      "| Streamer | Found | Added | No chat | Quiet | Full chat saved | In pool |",
      "|---|---|---|---|---|---|---|",
      ...summary.map(
        (r) =>
          `| ${r.login} | ${r.found} | ${r.added} | ${r.noChat} | ${r.quiet} | ${r.longer} | ${pool.filter((c) => c.s === r.login).length} |`,
      ),
    ].join("\n");
    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, md + "\n");
  }

  if (chatTries > 0 && chatFails === chatTries) {
    throw new Error(
      "Could not read chat for any clip. Twitch may have changed its chat replay. Last error: " +
        (lastChatError && lastChatError.message),
    );
  }
  return { added, pool: pool.length, summary };
}

// Run from the command line.
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const opts = parseArgs(process.argv.slice(2));
  const job = opts.test ? testClip(opts.test) : collect(opts);
  job.catch((err) => {
    console.error("\nFailed: " + err.message);
    process.exit(1);
  });
}
