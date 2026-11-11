// Guess the Chat: the Leaderboard.
//
// Added to index.html with one line, just before </body>, after layout.js:
//   <script type="module" src="leaderboard.js?v=1"></script>
//
// - A trophy button next to Stats opens the top 10 players by total points.
// - Only signed-in players are on the board. Each one gets a made-up name (the
//   same kind of names as in the chat) and can roll a new one.
// - A signed-in player outside the top 10 sees their own row under the list, in
//   purple, with their real place.
// - Opened while signed out, the sign-in window shows on top of it. Closing that
//   window (X) leaves the leaderboard to look at.
// - Points come from the daily game while signed in: the day's score is sent after
//   every guess. A day counts at most 10,000 points (also checked by the database
//   rules, see firestore.rules), and only the latest days can be counted.
//
// Uses the sign-in from signin.js (window.gtcAccount). The game itself is not changed.

const KEY_DAILY = "gtc.daily"; // the game's saved daily progress (game.js)
const KEY_REOPEN = "gtc.lbAfterSignIn"; // reopen the leaderboard after signing in from it
const DAY_CAP = 10000; // same as the database rules
const TOP = 10;
const DAY_MS = 86400000;

// Names are saved as positions in these lists (the same words as the chat's
// made-up names). Only ever add words at the END of a list, and then raise the
// matching number in firestore.rules.
const NAME_ADJ = [
  "salty", "cosmic", "sleepy", "crispy", "frozen", "goofy", "lazy", "silent", "spicy", "tiny",
  "big", "based", "rusty", "humble", "feral", "pixel", "night", "shadow", "soggy", "chill",
  "lucky", "mighty", "quiet", "fuzzy", "hyper", "happy", "grumpy", "sneaky", "wild", "golden",
  "icy", "turbo", "mega", "lil", "dr", "mr", "not", "its", "angry", "cracked",
]; // 40
const NAME_NOUN = [
  "walrus", "penguin", "taco", "noodle", "goblin", "waffle", "otter", "pickle", "raccoon", "biscuit",
  "mango", "yeti", "llama", "frog", "panda", "moose", "koala", "burrito", "toast", "ninja",
  "pigeon", "cactus", "shrimp", "tater", "dingo", "bean", "viking", "wizard", "gremlin", "nugget",
  "badger", "falcon", "lemur", "hamster", "pretzel", "muffin", "comet", "rocket", "pebble", "cobra",
  "bagel", "donut", "squid", "turtle", "beetle", "sloth", "ferret", "walnut", "pancake", "gecko",
]; // 50
const NAME_TAG = ["tv", "gg", "lol", "irl", "yt", "fn", "plays", "main", "og", "x", "w"]; // 11
// Styles: 1 = SilentYeti4821, 2 = silent_yeti4821, 4 = yeti_gg4821.
// (0 and 3 are older styles and now show like 1. The rules allow 0 to 4.)
const NAME_STYLES = [1, 2, 4];
// Chat name colors that read well on the dark background.
const NAME_COLORS = [
  "#ff7f50", "#1e90ff", "#9acd32", "#ff69b4", "#daa520", "#5f9ea0",
  "#2fd4a8", "#e88df5", "#ffb347", "#7fb2ff", "#ff6b6b", "#b0e05c",
];

const cap = (w) => w[0].toUpperCase() + w.slice(1);
const int = (v) => (Number.isInteger(v) ? v : -1);

function randomName() {
  const r = (n) => Math.floor(Math.random() * n);
  return {
    a: r(NAME_ADJ.length),
    n: r(NAME_NOUN.length),
    s: NAME_STYLES[r(NAME_STYLES.length)],
    t: r(NAME_TAG.length),
    k: 1 + r(9999), // always a number, so two players rarely get the same name
  };
}

// The name a row's saved positions stand for.
function nameOf(e) {
  const a = NAME_ADJ[int(e.a)];
  const n = NAME_NOUN[int(e.n)];
  const t = NAME_TAG[int(e.t)] || "tv";
  const k = int(e.k) > 0 ? String(int(e.k)) : ""; // 0 means no number
  if (!a || !n) return "player";
  switch (int(e.s)) {
    case 2: return a + "_" + n + k;
    case 4: return n + "_" + t + k;
    default: return cap(a) + cap(n) + k;
  }
}

function colorOf(e) {
  const i = Math.abs(int(e.a) * 7 + int(e.n) * 13 + int(e.s) * 3);
  return NAME_COLORS[i % NAME_COLORS.length];
}

// ---------------------------------------------------------------------------
// Days and the daily game's score

function localDayKey(date) {
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}
// "2026-11-11" -> days since 1970-01-01 (the number the database rules check).
function dayNumber(key) {
  const [y, m, d] = key.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

function readJSON(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch (e) {
    return fallback;
  }
}
function session(key, value) {
  try {
    if (value === undefined) return sessionStorage.getItem(key);
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch (e) {}
  return null;
}

// This device's daily game, if it's recent enough to count: { day, score }.
// "Recent enough" matches the database rules: a day that hasn't fully passed
// anywhere on Earth yet.
function currentGame() {
  const daily = readJSON(KEY_DAILY, null);
  if (!daily || typeof daily.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(daily.day)) return null;
  const day = dayNumber(daily.day);
  const today = dayNumber(localDayKey(new Date()));
  if (day > today || day <= Date.now() / DAY_MS - 1.45) return null;
  const score = Math.max(0, Math.min(DAY_CAP, Math.floor(Number(daily.score) || 0)));
  return { day, score };
}

// ---------------------------------------------------------------------------
// Page

const acct = typeof window !== "undefined" ? window.gtcAccount : null;

function init() {
  const fmt = (n) => (Number(n) || 0).toLocaleString("en-US");

  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  // ----- trophy button, next to Stats -----

  const button = document.createElement("button");
  button.type = "button";
  button.className = "icon-btn gtc-lb-btn";
  button.id = "leaderboard-btn";
  button.setAttribute("aria-label", "Leaderboard");
  button.title = "Leaderboard";
  button.innerHTML = ICON_TROPHY;
  const statsBtn = document.getElementById("stats-btn");
  const toolbar = document.querySelector(".gtc-toolbar");
  if (statsBtn) statsBtn.after(button);
  else if (toolbar) toolbar.appendChild(button);
  else return;

  // ----- window -----

  const box = document.createElement("div");
  box.className = "overlay gtc-lb";
  box.id = "leaderboard";
  box.hidden = true;
  box.innerHTML =
    '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="gtc-lb-title">' +
    '<button class="gtc-x" type="button" aria-label="Close">' + ICON_X + "</button>" +
    '<h2 class="gtc-title" id="gtc-lb-title">Leaderboard</h2>' +
    '<p class="gtc-lb-sub">Top players of all time</p>' +
    '<div class="gtc-lb-board" aria-live="polite"></div>' +
    '<div class="gtc-lb-foot"></div>' +
    "</div>";
  document.body.appendChild(box);
  const board = box.querySelector(".gtc-lb-board");
  const foot = box.querySelector(".gtc-lb-foot");
  const closeBtn = box.querySelector(".gtc-x");

  let loadId = 0; // ignores an older load that finishes after a newer one

  function open() {
    box.hidden = false;
    closeBtn.focus({ preventScroll: true });
    refresh();
    acct.authReady.then((user) => {
      if (box.hidden || user || acct.user) return;
      // Signed out: offer sign-in on top. If the sign-in leaves the page (Google's
      // page in the same tab), the leaderboard opens again on the way back.
      session(KEY_REOPEN, "1");
      acct.openSignIn({ sub: "Sign in to get your name on the leaderboard." });
    });
  }

  function close() {
    box.hidden = true;
    session(KEY_REOPEN, null);
    button.focus({ preventScroll: true });
  }

  button.addEventListener("click", open);
  closeBtn.addEventListener("click", close);
  box.addEventListener("click", (e) => {
    if (e.target === box) close();
  });
  // While the leaderboard is open, keys don't reach the game. (When the sign-in
  // window is open on top, signin.js handles the key first and stops it there.)
  document.addEventListener(
    "keydown",
    (e) => {
      if (box.hidden) return;
      if (e.key === "Escape") close();
      e.stopPropagation();
    },
    true,
  );

  // ----- loading -----

  async function refresh() {
    const id = ++loadId;
    renderLoading();
    try {
      const fb = await acct.ready;
      if (!fb) throw new Error("Firebase didn't load");
      await acct.authReady;
      const user = acct.user;
      const S = fb.store;
      const col = S.collection(fb.db, "leaderboard");

      // The player's own row first, so the list includes today's latest points.
      let me = null;
      if (user) me = await saveEntry().catch((e) => (console.warn("Guess the Chat: leaderboard save failed", e), null));

      const snap = await S.getDocs(S.query(col, S.orderBy("points", "desc"), S.limit(TOP)));
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

      let myRank = null;
      if (user && me && !rows.some((r) => r.id === user.uid)) {
        const count = await S.getCountFromServer(S.query(col, S.where("points", ">", Number(me.points) || 0)));
        myRank = Math.max(TOP + 1, count.data().count + 1);
      }
      if (id !== loadId) return;
      render({ rows, user, me, myRank });
    } catch (e) {
      console.warn("Guess the Chat: leaderboard failed to load", e);
      if (id !== loadId) return;
      board.innerHTML = '<p class="gtc-lb-empty">Couldn\'t load the leaderboard. Please try again later.</p>';
      renderFoot(acct.user, null);
    }
  }

  // Creates or updates the signed-in player's row and returns it.
  // `rename` also picks a new made-up name.
  async function saveEntry(rename = false) {
    const fb = await acct.ready;
    const user = acct.user;
    if (!fb || !user) return null;
    const S = fb.store;
    const ref = S.doc(fb.db, "leaderboard", user.uid);
    const game = currentGame();
    return S.runTransaction(fb.db, async (tx) => {
      const snap = await tx.get(ref);
      const old = snap.exists() ? snap.data() : null;
      let next;
      if (!old) {
        // First time on the board: today's game counts, older games don't.
        const today = dayNumber(localDayKey(new Date()));
        const day = game ? game.day : today;
        const pts = game ? game.score : 0;
        next = { ...randomName(), points: pts, day, dayPoints: pts };
      } else {
        next = {
          a: old.a, n: old.n, s: old.s, t: old.t, k: old.k,
          points: old.points, day: old.day, dayPoints: old.dayPoints,
        };
        let changed = false;
        if (rename) {
          Object.assign(next, randomName());
          changed = true;
        }
        if (game && game.day === old.day && game.score > old.dayPoints) {
          // More points today: only the difference is added.
          next.points = old.points - old.dayPoints + game.score;
          next.dayPoints = game.score;
          changed = true;
        } else if (game && game.day > old.day && game.score > 0) {
          // A new day.
          next.points = old.points + game.score;
          next.day = game.day;
          next.dayPoints = game.score;
          changed = true;
        }
        if (!changed) return old;
      }
      next.updated = S.serverTimestamp();
      tx.set(ref, next);
      return next;
    });
  }

  // ----- drawing -----

  function renderLoading() {
    board.textContent = "";
    const list = document.createElement("ol");
    list.className = "gtc-lb-list";
    for (let i = 0; i < 6; i++) {
      const li = document.createElement("li");
      li.className = "gtc-lb-row gtc-lb-skel";
      li.innerHTML = '<span class="gtc-lb-rank">' + (i + 1) + '</span><span class="gtc-lb-bar"></span><span class="gtc-lb-bar short"></span>';
      list.appendChild(li);
    }
    board.appendChild(list);
    foot.textContent = "";
  }

  function row(entry, rank, isMe) {
    const li = document.createElement(isMe && rank > TOP ? "div" : "li");
    li.className = "gtc-lb-row" + (isMe ? " me" : "");
    const r = document.createElement("span");
    r.className = "gtc-lb-rank" + (rank <= 3 ? " r" + rank : "");
    r.textContent = fmt(rank);
    const name = document.createElement("span");
    name.className = "gtc-lb-name";
    const text = document.createElement("span");
    text.className = "gtc-lb-name-text";
    text.textContent = nameOf(entry);
    if (!isMe) text.style.color = colorOf(entry);
    name.appendChild(text);
    if (isMe) {
      const you = document.createElement("span");
      you.className = "gtc-lb-you";
      you.textContent = "You";
      name.appendChild(you);
    }
    const pts = document.createElement("span");
    pts.className = "gtc-lb-pts";
    pts.textContent = fmt(entry.points);
    li.append(r, name, pts);
    if (isMe) li.setAttribute("aria-label", "You, place " + rank + ", " + fmt(entry.points) + " points");
    return li;
  }

  function render({ rows, user, me, myRank }) {
    board.textContent = "";
    if (!rows.length && !me) {
      board.innerHTML = '<p class="gtc-lb-empty">No one is on the board yet. Sign in and play to be the first!</p>';
    } else {
      const list = document.createElement("ol");
      list.className = "gtc-lb-list";
      rows.forEach((entry, i) => list.appendChild(row(entry, i + 1, !!user && entry.id === user.uid)));
      board.appendChild(list);
      if (me && myRank) {
        const gap = document.createElement("div");
        gap.className = "gtc-lb-gap";
        gap.setAttribute("aria-hidden", "true");
        gap.textContent = "•••";
        board.append(gap, row(me, myRank, true));
      }
    }
    renderFoot(user, me);
  }

  function renderFoot(user, me) {
    foot.textContent = "";
    if (!user) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "gtc-lb-join";
      b.textContent = "Sign in to join the leaderboard";
      b.addEventListener("click", () => {
        session(KEY_REOPEN, "1");
        acct.openSignIn({ sub: "Sign in to get your name on the leaderboard." });
      });
      foot.appendChild(b);
      return;
    }
    if (!me) return;
    // The player's name is already in their purple row; only the button is needed.
    const reroll = document.createElement("button");
    reroll.type = "button";
    reroll.className = "gtc-lb-reroll";
    reroll.innerHTML = ICON_DICE + "<span>New name</span>";
    reroll.addEventListener("click", async () => {
      reroll.disabled = true;
      try {
        await saveEntry(true);
        await refresh();
      } catch (e) {
        console.warn("Guess the Chat: new name failed", e);
        reroll.disabled = false;
        acct.toast("Couldn't change the name. Please try again.");
      }
    });
    reroll.title = "Get a new random name";
    foot.append(reroll);
  }

  // ----- keeping the board up to date -----

  // After each guess (the game saves the day's score, then shows the result).
  const result = document.getElementById("result");
  let saveTimer = null;
  const saveSoon = () => {
    if (!acct.user) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveEntry().catch((e) => console.warn("Guess the Chat: leaderboard save failed", e));
    }, 900);
  };
  if (result) {
    let wasHidden = result.hidden;
    new MutationObserver(() => {
      if (result.hidden === wasHidden) return;
      wasHidden = result.hidden;
      if (!result.hidden) saveSoon();
    }).observe(result, { attributes: true, attributeFilter: ["hidden"] });
  }

  // Signing in or out.
  window.addEventListener("gtc:auth", () => {
    if (!box.hidden) refresh();
    else saveSoon();
  });

  // Back from Google's sign-in page, after signing in from the leaderboard.
  if (session(KEY_REOPEN) === "1") {
    acct.authReady.then((user) => {
      session(KEY_REOPEN, null);
      if (user && box.hidden) open();
    });
  }
}

// ---------------------------------------------------------------------------
// Icons and styles (the game's colors, so the light theme works too)

const ICON_TROPHY =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v1.5A3.5 3.5 0 0 1 16.6 10M7 5H4v1.5A3.5 3.5 0 0 0 7.4 10"/><path d="M12 14v3.5M8.5 20.5h7M9.5 20.5c0-1.7 1.1-3 2.5-3s2.5 1.3 2.5 3"/></svg>';
const ICON_X =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
const ICON_DICE =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="9" cy="9" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="15" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="9" r="1.2" fill="currentColor" stroke="none"/><circle cx="9" cy="15" r="1.2" fill="currentColor" stroke="none"/></svg>';

const CSS = `
.gtc-lb .modal {
  position: relative;
  max-width: 440px;
  padding: 30px 24px 22px;
  display: grid;
  gap: 16px;
  overflow-y: auto;
}
.gtc-lb-sub { margin: -8px 0 0; text-align: center; color: var(--muted, #adadb8); font-size: 14px; }
.gtc-lb-board { padding: 6px; border-radius: 14px; background: var(--bg, #0e0e10); }
.gtc-lb-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.gtc-lb-row {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-height: 42px;
  padding: 0 14px 0 4px;
  border-radius: 9px;
  font-size: 15px;
  color: var(--fg, #efeff1);
}
.gtc-lb-rank {
  text-align: center;
  font-family: var(--font-display, "Bricolage Grotesque", system-ui, sans-serif);
  font-weight: 800;
  font-size: 16px;
  color: var(--muted, #adadb8);
  font-variant-numeric: tabular-nums;
}
.gtc-lb-rank.r1 { color: #f5c542; }
.gtc-lb-rank.r2 { color: #c9ced6; }
.gtc-lb-rank.r3 { color: #d9925b; }
.gtc-lb-name { min-width: 0; display: flex; align-items: center; gap: 8px; font-weight: 700; }
.gtc-lb-name-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gtc-lb-pts { font-weight: 700; font-variant-numeric: tabular-nums; }
.gtc-lb-row.me { background: var(--accent, #9147ff); color: var(--on-accent, #fff); }
.gtc-lb-row.me .gtc-lb-rank { color: var(--on-accent, #fff); }
.gtc-lb-you {
  flex: none;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.22);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.gtc-lb-gap { padding: 4px 0 2px; text-align: center; color: var(--faint, #53535f); letter-spacing: 4px; line-height: 1; }
.gtc-lb-empty { margin: 0; padding: 28px 14px; text-align: center; color: var(--muted, #adadb8); font-size: 14px; line-height: 1.5; }
.gtc-lb-skel .gtc-lb-rank { color: var(--faint, #53535f); }
.gtc-lb-bar { height: 12px; width: 62%; border-radius: 6px; background: var(--raise, #26262c); animation: gtc-lb-pulse 1.2s ease-in-out infinite alternate; }
.gtc-lb-bar.short { width: 52px; }
@keyframes gtc-lb-pulse { from { opacity: 0.5; } to { opacity: 1; } }

.gtc-lb-foot:empty { display: none; }
.gtc-lb-foot { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 6px 12px; font-size: 14px; color: var(--muted, #adadb8); }
.gtc-lb-foot b { color: var(--fg, #efeff1); font-weight: 700; }
.gtc-lb-reroll {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border: 1px solid var(--line, #2f2f35);
  border-radius: 8px;
  background: transparent;
  color: var(--fg, #efeff1);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.gtc-lb-reroll:hover:not(:disabled) { border-color: var(--faint, #53535f); background: var(--raise, #26262c); }
.gtc-lb-reroll:disabled { opacity: 0.6; cursor: default; }
.gtc-lb-join {
  width: 100%;
  padding: 12px 16px;
  border: 0;
  border-radius: 9px;
  background: var(--accent, #9147ff);
  color: var(--on-accent, #fff);
  font: inherit;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
}
.gtc-lb-join:hover { background: var(--accent-hi, #a970ff); }

/* Chat name colors are picked for the dark theme; darken them a little in light. */
html.gtc-light .gtc-lb-row:not(.me) .gtc-lb-name-text { filter: brightness(0.78) saturate(1.25); }
html.gtc-light .gtc-lb-row:not(.me) .gtc-lb-rank.r1 { color: #c48f00; }
html.gtc-light .gtc-lb-row:not(.me) .gtc-lb-rank.r2 { color: #858c97; }
html.gtc-light .gtc-lb-row:not(.me) .gtc-lb-rank.r3 { color: #b0662c; }

@media (max-width: 440px) {
  .gtc-lb .modal { padding: 26px 16px 18px; }
  .gtc-lb-row { font-size: 14px; padding-right: 12px; }
}
`;

// Started here, once the icons and styles above exist.
if (acct && typeof document !== "undefined") init();
