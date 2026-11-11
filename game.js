// Guess the Chat: the game itself (loading clips, the chat replay, rounds,
// results, the daily game and its countdown).
//
// Loaded from index.html with one line, after the game settings and sample data:
//   <script src="game.js?v=2"></script>
// The game settings (GAME_CONFIG) stay in index.html.

// Loads the clip pool. Uses the collected data in data/ when it exists,
// otherwise falls back to the sample chat in data/sample-data.js.
(function () {
  async function getJSON(url) {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(url + " returned " + res.status);
    return res.json();
  }

  async function loadLive(path) {
    const [index, roster] = await Promise.all([
      getJSON(path + "index.json"),
      getJSON(path + "streamers.json"),
    ]);
    const streamers = (roster.streamers || []).filter((s) => s && s.login);
    const known = new Set(streamers.map((s) => s.login));
    const clips = (index.clips || []).filter((c) => c && c.id && known.has(c.s));
    if (!clips.length || streamers.length < 2) throw new Error("no collected clips yet");
    return {
      mode: "live",
      streamers,
      clips,
      getClip: (id) => getJSON(path + "clips/" + encodeURIComponent(id) + ".json"),
    };
  }

  function loadSample() {
    const sample = window.SAMPLE_DATA;
    if (!sample) throw new Error("No clips found. Run the collector or add data/sample-data.js.");
    const byId = new Map(sample.clips.map((c) => [c.id, c]));
    return {
      mode: "sample",
      streamers: sample.streamers,
      clips: sample.clips.map((c) => ({ id: c.id, s: c.s })),
      getClip: async (id) => byId.get(id),
    };
  }

  window.GameData = {
    async load(path) {
      if (window.GAME_PREVIEW) return loadSample();
      try {
        return await loadLive(path);
      } catch (err) {
        return loadSample();
      }
    },
  };
})();

// Twitch-style chat that replays saved messages on their real timestamps.
// A message looks like: { t: 3.42, u: "name", c: "#FF7F50", b: [badgeUrl], m: [parts] }
// where each part is either a text string or an emote { e: "KEKW", u: imageUrl }.
(function () {
  const DEFAULT_COLORS = [
    "#FF0000", "#0000FF", "#008000", "#B22222", "#FF7F50", "#9ACD32", "#FF4500", "#2E8B57",
    "#DAA520", "#D2691E", "#5F9EA0", "#1E90FF", "#FF69B4", "#8A2BE2", "#00FF7F",
  ];
  const CHAT_BG = [24, 24, 27]; // matches --chat in style.css
  const colorCache = new Map();

  function hashName(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function parseHex(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function luminance([r, g, b]) {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }

  function contrast(a, b) {
    const la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  // Twitch lightens dark name colors so they stay readable on dark chat. Same idea here.
  function readableColor(hex, name) {
    const key = (hex || "") + "|" + (hex ? "" : name);
    if (colorCache.has(key)) return colorCache.get(key);
    let rgb = parseHex(hex) || parseHex(DEFAULT_COLORS[hashName(name || "") % DEFAULT_COLORS.length]);
    let step = 0;
    while (contrast(rgb, CHAT_BG) < 4.2 && step < 12) {
      rgb = rgb.map((v) => Math.round(v + (255 - v) * 0.15));
      step++;
    }
    const out = "rgb(" + rgb.join(",") + ")";
    colorCache.set(key, out);
    return out;
  }

  function appendText(parent, text) {
    // Bold @mentions the way Twitch does.
    const pieces = text.split(/(@[A-Za-z0-9_]+)/);
    for (const piece of pieces) {
      if (!piece) continue;
      if (piece[0] === "@" && piece.length > 1) {
        const s = document.createElement("span");
        s.className = "mention";
        s.textContent = piece;
        parent.appendChild(s);
      } else {
        parent.appendChild(document.createTextNode(piece));
      }
    }
  }

  function renderMessage(msg) {
    const row = document.createElement("div");
    row.className = "msg";

    if (msg.b && msg.b.length) {
      for (const url of msg.b) {
        const img = document.createElement("img");
        img.className = "badge";
        img.src = url;
        img.alt = "";
        img.loading = "lazy";
        img.decoding = "async";
        row.appendChild(img);
      }
    }

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = msg.u;
    name.style.color = readableColor(msg.c, msg.u);
    row.appendChild(name);
    row.appendChild(document.createTextNode(": "));

    const body = document.createElement("span");
    body.className = "body";
    for (const part of msg.m || []) {
      if (typeof part === "string") {
        appendText(body, part);
      } else if (part && part.u) {
        const img = document.createElement("img");
        img.className = "emote";
        img.src = part.u;
        img.alt = part.e;
        img.title = part.e;
        img.decoding = "async";
        img.onerror = () => {
          const t = document.createElement("span");
          t.className = "emote-word";
          t.textContent = part.e;
          img.replaceWith(t);
        };
        body.appendChild(img);
      } else if (part && part.e) {
        // Emote without an image (sample data): show its name in an emote chip.
        const t = document.createElement("span");
        t.className = "emote-word";
        t.textContent = part.e;
        body.appendChild(t);
      }
    }
    row.appendChild(body);
    return row;
  }

  class ChatView {
    // root: element containing .chat-list and .chat-bar
    constructor(root, opts = {}) {
      this.root = root;
      this.list = root.querySelector(".chat-list");
      this.bar = root.querySelector(".chat-bar");
      this.state = root.querySelector(".chat-state");
      this.messages = [];
      this.index = 0;
      this.head = 0;
      this.target = 0;
      this.raf = null;
      this.onStop = null;
      this.stick = true;
      this.tick = this.tick.bind(this);

      this.list.addEventListener("scroll", () => {
        const gap = this.list.scrollHeight - this.list.scrollTop - this.list.clientHeight;
        this.stick = gap < 32;
        this.updateBar();
      });
      if (this.bar) {
        this.bar.addEventListener("click", () => {
          if (this.raf) this.scrollToBottom();
        });
      }
    }

    load(messages) {
      this.stop();
      this.messages = (messages || []).slice().sort((a, b) => a.t - b.t);
      this.reset();
    }

    reset() {
      this.stop();
      this.index = 0;
      this.head = 0;
      this.target = 0;
      this.list.textContent = "";
      const welcome = document.createElement("div");
      welcome.className = "msg system";
      welcome.textContent = "Welcome to the chat room!";
      this.list.appendChild(welcome);
      this.stick = true;
      this.setMode("idle");
      if (this.onProgress) this.onProgress(0);
    }

    // Play in real time from where the chat is now until `seconds`, then pause.
    playUntil(seconds, onStop) {
      this.target = Math.max(this.target, seconds);
      if (onStop) this.onStop = onStop;
      this.stick = true;
      this.scrollToBottom();
      this.setMode("live");
      if (!this.raf) {
        this.last = performance.now();
        this.raf = requestAnimationFrame(this.tick);
      }
    }

    tick(now) {
      // Cap the step so a background tab does not dump seconds of chat at once.
      const dt = Math.min((now - this.last) / 1000, 0.25);
      this.last = now;
      this.head = Math.min(this.head + dt, this.target);
      this.flush();
      if (this.onProgress) this.onProgress(this.head);
      if (this.head >= this.target) {
        this.raf = null;
        this.setMode("paused");
        if (this.stick) this.scrollToBottom();
        const cb = this.onStop;
        this.onStop = null;
        if (cb) cb();
        return;
      }
      this.raf = requestAnimationFrame(this.tick);
    }

    flush() {
      let added = 0;
      const frag = document.createDocumentFragment();
      while (this.index < this.messages.length && this.messages[this.index].t <= this.head) {
        frag.appendChild(renderMessage(this.messages[this.index++]));
        added++;
      }
      if (added) {
        this.list.appendChild(frag);
        if (this.stick) this.scrollToBottom();
        else this.updateBar();
      }
    }

    stop() {
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = null;
      this.onStop = null;
    }

    freeze() {
      this.stop();
      this.setMode("paused");
    }

    scrollToBottom() {
      this.list.scrollTop = this.list.scrollHeight;
      this.stick = true;
      this.updateBar();
    }

    setMode(mode) {
      this.mode = mode;
      this.root.dataset.mode = mode;
      if (this.state) {
        this.state.textContent = mode === "live" ? "Live" : mode === "paused" ? "Paused" : "";
      }
      this.updateBar();
    }

    updateBar() {
      if (!this.bar) return;
      if (this.mode === "live" && !this.stick) {
        this.bar.hidden = false;
        this.bar.textContent = "More messages below";
        this.bar.classList.add("clickable");
      } else {
        this.bar.hidden = true;
      }
    }
  }

  window.ChatView = ChatView;
})();

(function () {
  const cfg = window.GAME_CONFIG;
  const MAX_SKIPS = cfg.revealSeconds.length - 1;
  const $ = (id) => document.getElementById(id);

  // ---------- small helpers ----------

  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v ? JSON.parse(v) : fallback;
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (e) {}
    },
  };
  const KEY_STATS = "whosechat.stats";
  const KEY_PLAYED = "whosechat.played";
  const KEY_SOUND = "whosechat.sound";
  const KEY_DAILY = "gtc.daily";

  // ---------- sounds ----------
  // Short tones made in the browser (no audio files): a tick for presses,
  // a rising three-note chime for a correct guess, a falling tone for a miss.
  const Sfx = (() => {
    let ctx = null;
    let master = null;
    let on = store.get(KEY_SOUND, true) !== false;

    function audio() {
      if (!ctx) {
        const C = window.AudioContext || window.webkitAudioContext;
        if (!C) return null;
        ctx = new C();
        master = ctx.createGain();
        master.gain.value = cfg.soundVolume ?? 0.6;
        master.connect(ctx.destination);
      }
      if (ctx.state === "suspended") ctx.resume();
      return ctx;
    }

    // One note. f1 makes the pitch slide; hold keeps it at full volume before it fades.
    function note(c, { type = "triangle", f0, f1, at = 0, dur, peak = 0.25, attack = 0.006, hold = 0 }) {
      const t = c.currentTime + at;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(f0, t);
      if (f1) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(peak, t + attack);
      if (hold) gain.gain.setValueAtTime(peak, t + attack + hold);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(master);
      osc.start(t);
      osc.stop(t + dur + 0.03);
    }

    function play(notes) {
      if (!on) return;
      const c = audio();
      if (c) notes.forEach((n) => note(c, n));
    }

    const tick = (at = 0) => ({ type: "sine", f0: 668, at, dur: 0.035, peak: 0.16, attack: 0.003 });

    return {
      get on() {
        return on;
      },
      toggle() {
        on = !on;
        store.set(KEY_SOUND, on);
        if (on) play([tick()]);
        return on;
      },
      click() {
        play([tick()]);
      },
      // The result sound follows the click by 0.3 s.
      win() {
        play([
          tick(),
          { f0: 622, at: 0.3, dur: 0.055, peak: 0.22, hold: 0.03 },
          { f0: 784, at: 0.34, dur: 0.085, peak: 0.22, hold: 0.05 },
          { f0: 932, at: 0.41, dur: 0.22, peak: 0.24, hold: 0.02 },
        ]);
      },
      miss() {
        play([
          tick(),
          { f0: 470, f1: 255, at: 0.3, dur: 0.13, peak: 0.28 },
          { f0: 346, at: 0.48, dur: 0.17, peak: 0.28, hold: 0.05 },
        ]);
      },
    };
  })();

  const rand = (n) => Math.floor(Math.random() * n);
  const pick = (arr) => arr[rand(arr.length)];
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = rand(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  const fmt = (n) => n.toLocaleString("en-US");

  // ---------- daily game ----------
  // One game a day, with clips picked for this player (preferring clips they
  // haven't played before). A new game starts at midnight in the player's own
  // time zone. Today's clips and progress are saved, so a refresh continues where
  // the player stopped, with the same clips.

  function dayKey(date) {
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return date.getFullYear() + "-" + m + "-" + d;
  }
  function shiftDay(key, days) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  }
  function hash32(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }
  // Random numbers that come out the same every time for the same seed.
  function seeded(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function seededShuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  const today = dayKey(new Date());
  let dailySeed = ""; // this player's random number for today
  let dailyOrder = []; // usable clips, in today's order for this player
  let dailyPicks = []; // the clip for each round

  function planDay(saved) {
    const same = saved && saved.day === today && saved.seed;
    dailySeed = same ? saved.seed : Math.random().toString(36).slice(2) + Date.now().toString(36);
    const rank = (list) =>
      list
        .map((c) => ({ c, k: hash32(dailySeed + "|" + c.id) }))
        .sort((x, y) => x.k - y.k || (x.c.id < y.c.id ? -1 : 1))
        .map((x) => x.c);
    // Clips this player hasn't played come first.
    const played = new Set(store.get(KEY_PLAYED, []));
    dailyOrder = [...rank(data.clips.filter((c) => !played.has(c.id))), ...rank(data.clips.filter((c) => played.has(c.id)))];

    // Today's clips were already chosen on this device: keep them.
    if (same && Array.isArray(saved.picks)) {
      const byId = new Map(data.clips.map((c) => [c.id, c]));
      dailyPicks = saved.picks.map((id) => byId.get(id)).filter(Boolean).slice(0, ROUNDS);
      if (dailyPicks.length === ROUNDS) return;
    } else {
      dailyPicks = [];
    }
    // Five different streamers when there are enough of them.
    const streamers = new Set(dailyOrder.map((c) => c.s)).size;
    const used = new Set(dailyPicks.map((c) => c.s));
    for (const c of dailyOrder) {
      if (dailyPicks.length >= ROUNDS) break;
      if (dailyPicks.includes(c)) continue;
      const prev = dailyPicks[dailyPicks.length - 1];
      if (streamers >= ROUNDS ? used.has(c.s) : prev && prev.s === c.s) continue;
      dailyPicks.push(c);
      used.add(c.s);
    }
    for (const c of dailyOrder) {
      if (dailyPicks.length >= ROUNDS) break;
      if (!dailyPicks.includes(c)) dailyPicks.push(c);
    }
  }

  function saveDaily(current) {
    store.set(KEY_DAILY, {
      day: today,
      seed: dailySeed,
      picks: dailyPicks.map((c) => c.id),
      score: session.score,
      streak: session.streak,
      history: session.history.map((h) => ({ s: h.streamer.login, correct: h.correct, skips: h.skips, points: h.points })),
      done: session.history.length >= ROUNDS,
      current: current || null, // the round in progress: its clip and skips used
    });
  }

  let countdownTimer = null;
  function startCountdown() {
    const box = $("next-game");
    const el = $("next-countdown");
    if (!box || !el) return;
    const [y, m, d] = today.split("-").map(Number);
    const target = new Date(y, m - 1, d + 1); // the player's next midnight
    box.hidden = false;
    const tick = () => {
      const ms = target - Date.now();
      if (ms <= 0) {
        clearInterval(countdownTimer);
        box.textContent = "";
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "primary-btn";
        btn.textContent = "Play today's game";
        btn.addEventListener("click", () => location.reload());
        box.appendChild(btn);
        return;
      }
      const t = Math.floor(ms / 1000);
      el.textContent = [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60]
        .map((n) => String(n).padStart(2, "0"))
        .join(":");
    };
    tick();
    clearInterval(countdownTimer);
    countdownTimer = setInterval(tick, 1000);
  }

  function hue(text) {
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (h * 33 + text.charCodeAt(i)) % 360;
    return h;
  }

  function avatar(streamer, size) {
    const el = document.createElement("span");
    el.className = "avatar";
    if (size) el.style.setProperty("--size", size + "px");
    const initials = () => {
      el.textContent = (streamer.name || streamer.login).replace(/[^A-Za-z0-9]/g, "").slice(0, 1).toUpperCase();
      el.style.background = "hsl(" + hue(streamer.login) + " 38% 34%)";
    };
    if (streamer.avatar) {
      const img = document.createElement("img");
      img.src = streamer.avatar;
      img.alt = "";
      img.decoding = "async";
      img.onerror = () => {
        img.remove();
        initials();
      };
      el.appendChild(img);
    } else {
      initials();
    }
    return el;
  }

  // ---------- state ----------

  let data = null;
  let byLogin = new Map();
  let clipsByStreamer = new Map();
  const ROUNDS = Math.max(1, cfg.roundsPerGame || 5);
  const session = { score: 0, round: 1, streak: 0, history: [], over: false };
  const roundLabel = () => session.round + "/" + ROUNDS;
  const isLastRound = () => session.round >= ROUNDS;
  let round = null;
  let upcoming = null;
  let lastStreamer = null;
  let guessTimer = null;

  const chat = new ChatView($("chat"));
  const replayChat = new ChatView($("result-chat"));
  chat.onProgress = (head) => updateMeter(head);

  // ---------- clip length and skip stops ----------

  // Seconds of chat this clip has: the clip's length, or less if only part of
  // its chat could be saved. Older saved clips without a length have 30 seconds.
  function clipLength(clip) {
    const chatTo = clip.chatTo || 30;
    return clip.dur ? Math.min(clip.dur, chatTo) : chatTo;
  }

  // The stops in seconds, never past the end of the clip's chat.
  function stopsFor(len) {
    return cfg.revealSeconds.map((t) => Math.min(t, len));
  }

  // ---------- progress meter ----------
  // The bar spans the round (up to the last stop); ticks mark where each skip stops.

  function buildMeter(r) {
    const clip = $("meter-clip");
    clip.querySelectorAll(".meter-tick").forEach((el) => el.remove());
    const span = r.stops[r.stops.length - 1];
    for (const t of new Set(r.stops.slice(0, -1))) {
      if (t >= span) continue;
      const tick = document.createElement("i");
      tick.className = "meter-tick";
      tick.style.left = (t / span) * 100 + "%";
      clip.appendChild(tick);
    }
    openMeter(0);
    updateMeter(0);
  }

  function openMeter(stage) {
    if (!round) return;
    $("meter-open").style.width = (round.stops[stage] / round.span) * 100 + "%";
  }

  function updateMeter(head) {
    if (!round) return;
    const pct = Math.min(100, (head / round.span) * 100) + "%";
    $("meter-fill").style.width = pct;
    $("meter-marker").style.left = pct;
  }

  // ---------- rounds ----------

  function markPlayed(id) {
    const list = store.get(KEY_PLAYED, []).filter((x) => x !== id);
    list.push(id);
    store.set(KEY_PLAYED, list.slice(-3000));
  }

  // Messages that name the streamer give the answer away (for example a bot's
  // "... gifting 5 subs to caseoh_'s community!"). They're hidden while guessing;
  // the result window replays the clip with the full chat.
  function namesOf(streamer) {
    const names = new Set();
    for (const raw of [streamer.login, streamer.name]) {
      const n = String(raw || "").toLowerCase().replace(/\s+/g, "");
      if (n.length >= 3) names.add(n);
      const trimmed = n.replace(/^_+|_+$/g, "");
      if (trimmed.length >= 3) names.add(trimmed);
    }
    return [...names];
  }
  function hideAnswer(messages, streamer) {
    const names = namesOf(streamer);
    return messages.filter((m) => {
      const text = (m.m || [])
        .filter((part) => typeof part === "string")
        .join(" ")
        .toLowerCase();
      return !names.some((n) => text.includes(n));
    });
  }

  // Round n (1, 2, ...) of today's game. If its clip can't be loaded, the next
  // clip in today's order is used instead.
  async function prepareRound(n) {
    const candidates = [dailyPicks[n - 1], ...dailyOrder.filter((c) => !dailyPicks.includes(c))].filter(Boolean);
    for (let attempt = 0; attempt < Math.min(6, candidates.length); attempt++) {
      const meta = candidates[attempt];
      const login = meta.s;
      let clip = null;
      try {
        clip = await data.getClip(meta.id);
      } catch (e) {
        clip = null;
      }
      const correct = byLogin.get(login);
      if (!clip || !clip.messages || !clip.messages.length || !correct) continue;
      const guessMessages = hideAnswer(clip.messages, correct);
      if (!guessMessages.length) continue;

      // The other streamers to pick from stay the same after a refresh.
      const rng = seeded(hash32(dailySeed + "|choices|" + meta.id));
      const others = seededShuffle(data.streamers.filter((s) => s.login !== login), rng).slice(0, cfg.choices - 1);
      const len = clipLength(clip);
      const stops = stopsFor(len);
      return {
        clip,
        guessMessages,
        len,
        stops,
        span: stops[stops.length - 1],
        correct,
        choices: seededShuffle([correct, ...others], rng),
        stage: 0,
        phase: "ready",
      };
    }
    throw new Error("Could not load a clip.");
  }

  function showRound(r) {
    round = r;
    lastStreamer = r.correct.login;
    buildMeter(r);
    chat.load(r.guessMessages);

    const wrap = $("choices");
    wrap.textContent = "";
    wrap.className = "choices waiting";
    r.choices.forEach((s, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "choice";
      b.dataset.login = s.login;
      b.setAttribute("aria-label", s.name + " (key " + (i + 1) + ")");
      b.appendChild(avatar(s));
      const name = document.createElement("span");
      name.className = "choice-name";
      name.textContent = s.name;
      b.appendChild(name);
      b.addEventListener("click", () => guess(s.login, b));
      wrap.appendChild(b);
    });

    renderSkips(0);
    $("skip-btn").disabled = true;
    $("stat-round").textContent = roundLabel();
  }

  function showStartCover(text) {
    $("chat-start").hidden = false;
    $("start-text").textContent = text;
    $("play-btn").disabled = !round;
  }

  function startRound(quiet) {
    if (!round || round.phase !== "ready") return;
    round.phase = "playing";
    if (quiet !== true) Sfx.click();
    $("chat-start").hidden = true;
    $("choices").className = "choices live";
    $("skip-btn").disabled = MAX_SKIPS === 0 || round.stage >= MAX_SKIPS;
    chat.playUntil(round.stops[round.stage]);
    saveDaily({ id: round.clip.id, stage: round.stage });
  }

  function renderSkips(used) {
    const left = MAX_SKIPS - used;
    $("skips-label").textContent = left === 0 ? "No skips left" : left === 1 ? "1 skip left" : left + " skips left";
  }

  function skip() {
    if (!round || round.phase !== "playing" || round.stage >= MAX_SKIPS) return;
    Sfx.click();
    round.stage++;
    renderSkips(round.stage);
    openMeter(round.stage);
    if (round.stage >= MAX_SKIPS) $("skip-btn").disabled = true;
    chat.playUntil(round.stops[round.stage]);
    saveDaily({ id: round.clip.id, stage: round.stage });
  }

  function guess(login, button) {
    if (!round || round.phase !== "playing") return;
    round.phase = "done";
    chat.freeze();
    $("skip-btn").disabled = true;

    const correct = login === round.correct.login;
    if (correct) Sfx.win();
    else Sfx.miss();
    const points = correct ? cfg.points[round.stage] || 0 : cfg.wrongPoints;
    session.score += points;
    session.streak = correct ? session.streak + 1 : 0;

    const stats = store.get(KEY_STATS, { dist: [], miss: 0, best: 0 });
    if (correct) stats.dist[round.stage] = (stats.dist[round.stage] || 0) + 1;
    else stats.miss = (stats.miss || 0) + 1;
    stats.best = Math.max(stats.best || 0, session.streak);
    store.set(KEY_STATS, stats);
    markPlayed(round.clip.id);

    const wrap = $("choices");
    wrap.className = "choices";
    button.classList.add("picked", correct ? "is-right" : "is-wrong");
    if (!correct) {
      const right = wrap.querySelector('[data-login="' + CSS.escape(round.correct.login) + '"]');
      if (right) right.classList.add("is-right");
    }

    bump("stat-score", fmt(session.score));
    bump("stat-streak", fmt(session.streak));

    session.history.push({ streamer: round.correct, correct, skips: round.stage, points });
    saveDaily(null);
    const result = { correct, points, picked: byLogin.get(login), stats };
    if (!isLastRound()) upcoming = prepareRound(session.round + 1).catch(() => null);
    guessTimer = setTimeout(() => openResult(result), 650);
  }

  function bump(id, text) {
    const el = $(id);
    if (el.textContent === text) return;
    el.textContent = text;
    el.classList.remove("bump");
    void el.offsetWidth;
    el.classList.add("bump");
  }

  // ---------- result window ----------

  let revealTimers = [];

  function clearReveal() {
    revealTimers.forEach(clearTimeout);
    revealTimers = [];
    replayChat.stop();
    const frame = $("player-video").querySelector("iframe");
    if (frame) frame.remove();
  }

  function canEmbed() {
    return data.mode === "live" && /^https?:$/.test(location.protocol) && !!location.hostname;
  }

  function playReveal() {
    clearReveal();
    const r = round;
    const msgs = r.clip.messages;
    // 0 plays the whole clip; a number stops clip and chat after that many seconds.
    const limit = cfg.resultClipSeconds > 0 ? cfg.resultClipSeconds : 0;
    const secs = limit || r.clip.chatTo || r.len;
    $("player-cover").hidden = true;
    replayChat.load(msgs);

    const finish = limit
      ? () => {
          const frame = $("player-video").querySelector("iframe");
          if (frame) frame.remove(); // stops the video and its sound
          $("player-empty").hidden = true;
          $("player-cover").hidden = false;
        }
      : null;

    if (canEmbed()) {
      $("player-empty").hidden = true;
      const frame = document.createElement("iframe");
      frame.allow = "autoplay; fullscreen";
      frame.title = "Twitch clip";
      frame.src =
        "https://clips.twitch.tv/embed?clip=" + encodeURIComponent(r.clip.id) +
        "&parent=" + encodeURIComponent(location.hostname) +
        "&autoplay=true&muted=false";
      let started = false;
      const start = () => {
        if (started) return;
        started = true;
        revealTimers.push(setTimeout(() => replayChat.playUntil(secs, finish), cfg.clipChatDelayMs));
      };
      frame.addEventListener("load", start);
      revealTimers.push(setTimeout(start, 6000)); // in case load never fires
      $("player-video").appendChild(frame);
    } else {
      const empty = $("player-empty");
      empty.hidden = false;
      empty.innerHTML =
        data.mode === "live"
          ? "<div><strong>The clip plays on the live site</strong>Open the game from its web address to watch it here.</div>"
          : "<div><strong>Clip video goes here</strong>Real clips play here once the collector has run.</div>";
      replayChat.playUntil(secs, finish);
    }
  }

  function renderDistribution(stats, highlight) {
    const rows = $("dist-rows");
    rows.textContent = "";
    const values = [];
    for (let i = 0; i <= MAX_SKIPS; i++) values.push({ label: String(i), n: stats.dist[i] || 0, now: highlight === i });
    values.push({ label: "X", n: stats.miss || 0, now: highlight === "miss", miss: true });
    const max = Math.max(1, ...values.map((v) => v.n));
    for (const v of values) {
      const row = document.createElement("div");
      row.className = "dist-row";
      const label = document.createElement("span");
      label.textContent = v.label;
      const bar = document.createElement("div");
      bar.className = "dist-bar" + (v.now ? " now" : "") + (v.miss ? " miss" : "");
      bar.style.width = Math.max(6, (v.n / max) * 100) + "%";
      bar.textContent = v.n;
      row.append(label, bar);
      rows.appendChild(row);
    }
  }

  function openResult(res) {
    const r = round;
    const head = $("result-head");
    head.className = "modal-head" + (res.correct ? "" : " bad");
    $("result-title").textContent = res.correct ? "You got it" : "Not this time";

    const av = $("result-avatar");
    av.textContent = "";
    av.appendChild(avatar(r.correct, 56));
    const name = $("result-name");
    name.textContent = r.correct.name;
    if (data.mode === "live") name.href = "https://www.twitch.tv/" + r.correct.login;
    else name.removeAttribute("href");

    $("result-picked").hidden = res.correct;
    if (!res.correct && res.picked) {
      const pa = $("picked-avatar");
      pa.textContent = "";
      pa.appendChild(avatar(res.picked, 24));
      $("picked-name").textContent = res.picked.name;
    }

    $("r-skips").textContent = r.stage;
    $("r-points").textContent = res.points > 0 ? "+" + fmt(res.points) : "0";
    $("r-streak").textContent = fmt(session.streak);

    const title = $("clip-title");
    const link = $("clip-link");
    if (r.clip.sample) {
      title.textContent = "Sample chat written for testing. It is not a real chat log.";
      link.hidden = true;
    } else {
      title.textContent = "";
      const t = document.createElement("strong");
      t.textContent = r.clip.title || "Untitled clip";
      title.append("Clip: ", t);
      if (r.clip.views) title.append("  (" + fmt(r.clip.views) + " views)");
      link.hidden = false;
      link.href = r.clip.url || "https://clips.twitch.tv/" + r.clip.id;
    }

    renderDistribution(res.stats, res.correct ? r.stage : "miss");
    // After the last round the summary is already waiting behind this window.
    if (isLastRound()) showSummary();
    $("next-btn").textContent = isLastRound() ? "Close" : "Next round";
    $("result").hidden = false;
    $("next-btn").focus({ preventScroll: true });
    playReveal();
  }

  // ---------- game summary ----------

  function showSummary() {
    session.over = true;
    const rows = $("summary-rows");
    rows.textContent = "";
    session.history.forEach((h, i) => {
      const row = document.createElement("div");
      row.className = "sum-row " + (h.correct ? "good" : "bad");
      row.style.animationDelay = i * 70 + "ms";

      const num = document.createElement("span");
      num.className = "sum-num";
      num.textContent = i + 1;

      const who = document.createElement("span");
      who.className = "sum-who";
      who.appendChild(avatar(h.streamer, 28));
      const name = document.createElement("span");
      name.className = "sum-name";
      name.textContent = h.streamer.name;
      who.appendChild(name);

      const detail = document.createElement("span");
      detail.className = "sum-detail";
      detail.textContent = h.correct
        ? (h.skips === 1 ? "1 skip" : h.skips + " skips") + "  +" + fmt(h.points)
        : "Missed";

      row.append(num, who, detail);
      rows.appendChild(row);
    });
    $("summary-score").textContent = fmt(session.score);
    $("summary").hidden = false;
    document.querySelector(".board").classList.add("over");
    startCountdown();
  }

  function shareText() {
    const right = session.history.filter((h) => h.correct).length;
    const squares = session.history.map((h) => (h.correct ? "🟩" : "🟥")).join("");
    const [y, m, d] = today.split("-").map(Number);
    const date = new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const lines = ["Guess the Chat " + date + "  " + right + "/" + session.history.length + "  " + fmt(session.score) + " pts", squares];
    if (/^https?:$/.test(location.protocol)) lines.push(location.origin + location.pathname);
    return lines.join("\n");
  }

  let shareTimer = null;
  async function share() {
    const btn = $("share-btn");
    const text = shareText();
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch (e) {
      // Older browsers: copy through a hidden text box.
      const box = document.createElement("textarea");
      box.value = text;
      box.setAttribute("readonly", "");
      box.style.position = "fixed";
      box.style.opacity = "0";
      document.body.appendChild(box);
      box.select();
      try {
        ok = document.execCommand("copy");
      } catch (err) {}
      box.remove();
    }
    Sfx.click();
    btn.textContent = ok ? "Copied" : "Could not copy";
    clearTimeout(shareTimer);
    shareTimer = setTimeout(() => (btn.textContent = "Share"), 1800);
  }

  async function nextRound() {
    if ($("result").hidden) return;
    clearReveal();
    $("result").hidden = true;
    if (session.over) return; // the summary is showing
    session.round++;
    $("stat-round").textContent = roundLabel();
    showStartCover("Loading chat");
    $("play-btn").disabled = true;
    let r = upcoming ? await upcoming : null;
    upcoming = null;
    if (!r) {
      try {
        r = await prepareRound(session.round);
      } catch (e) {
        showStartCover("Could not load the next chat. Refresh the page to try again.");
        return;
      }
    }
    showRound(r);
    startRound();
  }

  // ---------- help ----------

  function openHelp() {
    $("help").hidden = false;
    $("help-close").focus({ preventScroll: true });
  }
  function closeHelp() {
    $("help").hidden = true;
  }

  // ---------- input ----------

  $("play-btn").addEventListener("click", startRound);
  $("skip-btn").addEventListener("click", skip);
  $("next-btn").addEventListener("click", nextRound);
  const replay = () => {
    Sfx.click();
    playReveal();
  };
  $("replay-btn").addEventListener("click", replay);
  $("replay-again").addEventListener("click", replay);
  $("help-btn").addEventListener("click", openHelp);
  $("share-btn").addEventListener("click", share);
  // Results does nothing yet.

  function renderSoundButton() {
    const btn = $("sound-btn");
    btn.setAttribute("aria-pressed", String(!Sfx.on));
    btn.setAttribute("aria-label", Sfx.on ? "Mute sounds" : "Turn sounds on");
    btn.title = Sfx.on ? "Mute sounds (M)" : "Turn sounds on (M)";
    btn.classList.toggle("off", !Sfx.on);
  }
  function toggleSound() {
    Sfx.toggle();
    renderSoundButton();
  }
  $("sound-btn").addEventListener("click", toggleSound);
  renderSoundButton();
  $("help-close").addEventListener("click", closeHelp);
  $("help").addEventListener("click", (e) => {
    if (e.target === $("help")) closeHelp();
  });

  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const onButton = e.target instanceof HTMLElement && e.target.closest("button, a");
    if (e.key === "m" || e.key === "M") {
      toggleSound();
      return;
    }
    if (!$("help").hidden) {
      if (e.key === "Escape") closeHelp();
      return;
    }
    if (!$("result").hidden) {
      if (e.key === "Enter" && !onButton) {
        e.preventDefault();
        nextRound();
      }
      return;
    }
    if (!round) return;
    if (e.key === "Enter" && !onButton && round.phase === "ready") {
      e.preventDefault();
      startRound();
    } else if (e.key === "s" || e.key === "S") {
      if (round.phase === "ready") startRound();
      else skip();
    } else if (/^[1-9]$/.test(e.key) && round.phase === "playing") {
      const btn = $("choices").children[Number(e.key) - 1];
      if (btn) guess(btn.dataset.login, btn);
    }
  });

  // ---------- start ----------

  async function init() {
    $("help-skips").textContent = MAX_SKIPS;
    $("help-rounds").textContent = ROUNDS;
    $("stat-round").textContent = roundLabel();
    renderSkips(0);
    try {
      data = await GameData.load(cfg.dataPath);
    } catch (e) {
      showStartCover(e.message);
      return;
    }
    byLogin = new Map(data.streamers.map((s) => [s.login, s]));
    clipsByStreamer = new Map();
    for (const c of data.clips) {
      if (!clipsByStreamer.has(c.s)) clipsByStreamer.set(c.s, []);
      clipsByStreamer.get(c.s).push(c);
    }
    $("sample-tag").hidden = data.mode !== "sample";

    // Warm the avatar cache so picks never pop in.
    data.streamers.forEach((s) => {
      if (s.avatar) new Image().src = s.avatar;
    });

    // Continue today's game if it was started on this device.
    const saved = store.get(KEY_DAILY, null);
    planDay(saved);
    let resume = null;
    if (saved && saved.day === today && Array.isArray(saved.history)) {
      session.history = saved.history.slice(0, ROUNDS).map((h) => ({
        streamer: byLogin.get(h.s) || { login: h.s, name: h.s },
        correct: !!h.correct,
        skips: h.skips || 0,
        points: h.points || 0,
      }));
      session.score = saved.score || 0;
      session.streak = saved.streak || 0;
      session.round = Math.min(ROUNDS, session.history.length + 1);
      resume = saved.current;
    }
    $("stat-score").textContent = fmt(session.score);
    $("stat-streak").textContent = fmt(session.streak);
    $("stat-round").textContent = roundLabel();

    // Already played today: show the results and the countdown.
    if (session.history.length >= ROUNDS) {
      showSummary();
      return;
    }
    if (!(saved && saved.day === today)) saveDaily(null); // remember today's clips right away

    try {
      const r = await prepareRound(session.round);
      if (resume && resume.id === r.clip.id && resume.stage > 0) r.stage = Math.min(resume.stage, MAX_SKIPS);
      showRound(r);
      if (r.stage) {
        renderSkips(r.stage);
        openMeter(r.stage);
      }
      showStartCover(
        session.history.length || r.stage
          ? "Press play to continue today's game."
          : "Whose chat is this? Press play, then pick the streamer.",
      );
    } catch (e) {
      showStartCover("Could not load a chat. Refresh the page to try again.");
    }
  }

  init();
})();
