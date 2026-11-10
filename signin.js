// Guess the Chat: optional "Sign in with Google" that syncs a player's stats
// between devices.
//
// Added to index.html with one line, just before </body>:
//   <script type="module" src="signin.js"></script>
//
// The game itself is not changed. This file only reads and writes the game's
// own browser storage (the stats and the list of played clips), and adds:
//   - an account button next to the "?" button,
//   - the "Join the chat" sign-in window (also shown once after a first game),
//   - an account window (sign out, delete account),
//   - a small footer with Terms, Privacy and Contact.
//
// Images used here sit next to this file: hiii.gif, shout.webp, pogu.png.

const FIREBASE_VERSION = "12.14.0";

// Public web settings of the Firebase project (not a secret).
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBVYaTSFmrT2cqyMUWuAuvDPBUo-qKgAqo",
  authDomain: "guess-the-chat-1f021.firebaseapp.com",
  projectId: "guess-the-chat-1f021",
  storageBucket: "guess-the-chat-1f021.firebasestorage.app",
  messagingSenderId: "581480763764",
  appId: "1:581480763764:web:69bc79da965e5103ba9c21",
};

const CONTACT_EMAIL = "guessthechat.contact@gmail.com";

// The game's own storage keys (see index.html).
const KEY_STATS = "whosechat.stats";
const KEY_PLAYED = "whosechat.played";
// This file's keys.
const KEY_BASE = "gtc.syncBase"; // the stats as they were at this device's last sync: { uid, stats }
const KEY_PROMPTED = "gtc.signinPrompted"; // the sign-in window was shown once after a game
const MAX_PLAYED = 3000; // same cap as the game, and as the database rules

// ---------------------------------------------------------------------------
// Stats merging (pure functions, no page needed)
//
// Each device remembers the stats it last synced ("base"). What it played since
// then is (local - base). That difference is added to what the account already
// has, so games played on two devices both count, and nothing counts twice.

export function emptyStats() {
  return { dist: [], miss: 0, best: 0 };
}

export function normStats(s) {
  const src = s && typeof s === "object" ? s : {};
  const dist = Array.isArray(src.dist) ? src.dist : [];
  return {
    dist: Array.from({ length: dist.length }, (_, i) => Math.max(0, Math.floor(Number(dist[i]) || 0))),
    miss: Math.max(0, Math.floor(Number(src.miss) || 0)),
    best: Math.max(0, Math.floor(Number(src.best) || 0)),
  };
}

// target + max(0, now - since), per guess bucket. Best streak is the larger one.
export function addDelta(target, now, since) {
  const t = normStats(target);
  const n = normStats(now);
  const s = normStats(since);
  const len = Math.max(t.dist.length, n.dist.length, s.dist.length);
  const dist = [];
  for (let i = 0; i < len; i++) {
    dist.push((t.dist[i] || 0) + Math.max(0, (n.dist[i] || 0) - (s.dist[i] || 0)));
  }
  return {
    dist,
    miss: t.miss + Math.max(0, n.miss - s.miss),
    best: Math.max(t.best, n.best),
  };
}

// Clip ids from both lists, newest last, without repeats, capped.
export function mergePlayed(a, b) {
  const out = [];
  const seen = new Set();
  for (const id of [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]) {
    if (typeof id !== "string" || !id) continue;
    if (seen.has(id)) {
      out.splice(out.indexOf(id), 1);
    } else {
      seen.add(id);
    }
    out.push(id);
  }
  return out.slice(-MAX_PLAYED);
}

// ---------------------------------------------------------------------------
// Browser storage

function readJSON(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch (e) {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {}
}

function removeKey(key) {
  try {
    localStorage.removeItem(key);
  } catch (e) {}
}

// ---------------------------------------------------------------------------
// Page (started at the end of this file, once the icons and styles below exist)

function init() {
  const asset = (name) => new URL(name, import.meta.url).href;

  let fb = null; // Firebase pieces once loaded
  let user = null; // the signed-in Firebase user, or null
  let openWindow = null; // the window element that is open, or null

  // ----- styles -----

  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  // ----- account button next to "?" -----

  const helpBtn = document.getElementById("help-btn");
  const accountBtn = document.createElement("button");
  accountBtn.type = "button";
  accountBtn.id = "account-btn";
  accountBtn.className = "icon-btn gtc-account-btn";
  if (helpBtn && helpBtn.parentElement) {
    helpBtn.parentElement.classList.add("gtc-side-row");
    helpBtn.parentElement.insertBefore(accountBtn, helpBtn);
  } else {
    accountBtn.classList.add("gtc-floating");
    document.body.appendChild(accountBtn);
  }
  accountBtn.addEventListener("click", () => (user ? openAccount() : openSignIn()));
  renderAccountButton();

  function renderAccountButton() {
    accountBtn.textContent = "";
    if (user) {
      const label = "Your account" + (user.displayName ? " (" + user.displayName + ")" : "");
      accountBtn.setAttribute("aria-label", label);
      accountBtn.title = label;
      accountBtn.appendChild(avatarFor(user, 28));
      accountBtn.classList.add("signed-in");
    } else {
      accountBtn.setAttribute("aria-label", "Sign in");
      accountBtn.title = "Sign in";
      accountBtn.innerHTML = ICON_PERSON;
      accountBtn.classList.remove("signed-in");
    }
  }

  function avatarFor(u, size) {
    const box = document.createElement("span");
    box.className = "gtc-avatar";
    box.style.setProperty("--size", size + "px");
    const initial = () => {
      box.textContent = ((u.displayName || u.email || "?").trim()[0] || "?").toUpperCase();
    };
    if (u.photoURL) {
      const img = document.createElement("img");
      img.src = u.photoURL;
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      img.onerror = () => {
        img.remove();
        initial();
      };
      box.appendChild(img);
    } else {
      initial();
    }
    return box;
  }

  // ----- footer -----

  const app = document.querySelector(".app") || document.body;
  const footer = document.createElement("footer");
  footer.className = "gtc-footer";
  footer.innerHTML =
    '<span>Fan project · Not affiliated with Twitch or any streamer</span>' +
    '<nav><a href="terms.html">Terms</a><span aria-hidden="true">·</span>' +
    '<a href="privacy.html">Privacy</a><span aria-hidden="true">·</span>' +
    '<a href="mailto:' + CONTACT_EMAIL + '">Contact</a></nav>';
  app.appendChild(footer);

  // ----- windows -----

  const overlay = document.createElement("div");
  overlay.className = "gtc-overlay";
  overlay.hidden = true;
  document.body.appendChild(overlay);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeWindow();
  });

  // While a window is open, keys belong to it, not to the game behind it.
  window.addEventListener(
    "keydown",
    (e) => {
      if (!openWindow) return;
      e.stopPropagation();
      if (e.key === "Escape") closeWindow();
    },
    true,
  );

  function showWindow(win) {
    overlay.textContent = "";
    overlay.appendChild(win);
    overlay.hidden = false;
    openWindow = win;
    const focusable = win.querySelector("[data-autofocus]") || win.querySelector("button");
    if (focusable) focusable.focus({ preventScroll: true });
  }

  function closeWindow() {
    overlay.hidden = true;
    overlay.textContent = "";
    openWindow = null;
  }

  function closeButton() {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "gtc-close";
    b.setAttribute("aria-label", "Close");
    b.innerHTML = ICON_CLOSE;
    b.addEventListener("click", closeWindow);
    return b;
  }

  function errorLine(win) {
    return win.querySelector(".gtc-error");
  }

  function showError(win, text) {
    const el = errorLine(win);
    if (!el) return;
    el.textContent = text;
    el.hidden = !text;
  }

  // The "Join the chat" window.
  function openSignIn() {
    const win = document.createElement("div");
    win.className = "gtc-window";
    win.setAttribute("role", "dialog");
    win.setAttribute("aria-modal", "true");
    win.setAttribute("aria-labelledby", "gtc-signin-title");
    win.innerHTML =
      '<div class="gtc-banner"><img src="' + asset("hiii.gif") + '" alt=""></div>' +
      '<div class="gtc-body">' +
      '<h2 class="gtc-title" id="gtc-signin-title">Join the chat</h2>' +
      '<div class="gtc-chat">' +
      '<div class="gtc-msg system">Welcome to the chat room!</div>' +
      '<div class="gtc-msg typed"><span class="gtc-name" style="color:#1e90ff">nightcactus48</span>: sign in so ur streak doesn\'t die ' +
      '<img class="gtc-emote" src="' + asset("shout.webp") + '" alt="" title="shouting"></div>' +
      '<div class="gtc-msg typed"><span class="gtc-name" style="color:#ff7f50">ChillMoose5832</span>: stats on every device ' +
      '<img class="gtc-emote" src="' + asset("pogu.png") + '" alt="PogU" title="PogU"></div>' +
      "</div>" +
      '<button class="gtc-google" type="button" data-autofocus>' + ICON_GOOGLE + "<span>Continue with Google</span></button>" +
      '<p class="gtc-error" role="alert" hidden></p>' +
      '<p class="gtc-note">Optional. You can keep playing without an account. ' +
      '<a href="privacy.html">Privacy</a></p>' +
      "</div>";
    win.prepend(closeButton());
    const google = win.querySelector(".gtc-google");
    google.addEventListener("click", () => signIn(win, google));
    showWindow(win);
  }

  // The window for a signed-in player.
  function openAccount() {
    const win = document.createElement("div");
    win.className = "gtc-window gtc-account";
    win.setAttribute("role", "dialog");
    win.setAttribute("aria-modal", "true");
    win.setAttribute("aria-labelledby", "gtc-account-title");
    win.innerHTML =
      '<div class="gtc-body">' +
      '<div class="gtc-who"></div>' +
      '<h2 class="gtc-title small" id="gtc-account-title"></h2>' +
      '<p class="gtc-sub"></p>' +
      '<p class="gtc-sync">Your stats sync across your devices.</p>' +
      '<button class="gtc-outline" type="button" data-action="signout" data-autofocus>Sign out</button>' +
      '<button class="gtc-danger" type="button" data-action="delete">Delete account</button>' +
      '<p class="gtc-error" role="alert" hidden></p>' +
      "</div>";
    win.prepend(closeButton());
    win.querySelector(".gtc-who").appendChild(avatarFor(user, 64));
    win.querySelector(".gtc-title").textContent = user.displayName || "Signed in";
    win.querySelector(".gtc-sub").textContent = user.email || "";
    win.querySelector('[data-action="signout"]').addEventListener("click", async () => {
      await sync();
      try {
        await fb.signOut(fb.auth);
      } catch (e) {}
      closeWindow();
      toast("Signed out. Your stats stay on this device.");
    });
    const del = win.querySelector('[data-action="delete"]');
    let armed = false;
    del.addEventListener("click", async () => {
      if (!armed) {
        armed = true;
        del.textContent = "Click again to delete your account";
        del.classList.add("armed");
        return;
      }
      del.disabled = true;
      del.textContent = "Deleting…";
      try {
        await deleteAccount();
        closeWindow();
        toast("Your account and synced stats were deleted.");
      } catch (e) {
        console.warn("Guess the Chat: delete failed", e);
        del.disabled = false;
        del.textContent = "Delete account";
        del.classList.remove("armed");
        armed = false;
        showError(win, "Could not delete the account. Please try again.");
      }
    });
    showWindow(win);
  }

  // A short message at the bottom of the screen.
  let toastTimer = null;
  function toast(text) {
    let el = document.querySelector(".gtc-toast");
    if (!el) {
      el = document.createElement("div");
      el.className = "gtc-toast";
      el.setAttribute("role", "status");
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
  }

  // ----- Firebase -----

  const fbReady = (async () => {
    try {
      const base = "https://www.gstatic.com/firebasejs/" + FIREBASE_VERSION + "/";
      const [appMod, authMod, dbMod] = await Promise.all([
        import(base + "firebase-app.js"),
        import(base + "firebase-auth.js"),
        import(base + "firebase-firestore.js"),
      ]);
      const fbApp = appMod.initializeApp(FIREBASE_CONFIG);
      fb = {
        auth: authMod.getAuth(fbApp),
        db: dbMod.getFirestore(fbApp),
        GoogleAuthProvider: authMod.GoogleAuthProvider,
        signInWithPopup: authMod.signInWithPopup,
        signInWithRedirect: authMod.signInWithRedirect,
        reauthenticateWithPopup: authMod.reauthenticateWithPopup,
        deleteUser: authMod.deleteUser,
        signOut: authMod.signOut,
        doc: dbMod.doc,
        deleteDoc: dbMod.deleteDoc,
        runTransaction: dbMod.runTransaction,
        serverTimestamp: dbMod.serverTimestamp,
      };
      authMod.onAuthStateChanged(fb.auth, (u) => {
        user = u || null;
        renderAccountButton();
        if (user) sync();
      });
      authMod.getRedirectResult(fb.auth).catch(() => {});
      return fb;
    } catch (e) {
      console.warn("Guess the Chat: sign-in could not load", e);
      return null;
    }
  })();

  async function signIn(win, button) {
    showError(win, "");
    button.disabled = true;
    const label = button.querySelector("span");
    label.textContent = "Signing in…";
    const done = () => {
      button.disabled = false;
      label.textContent = "Continue with Google";
    };
    if (!(await fbReady)) {
      done();
      showError(win, "Sign-in isn't available right now. Please try again later.");
      return;
    }
    const provider = new fb.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    try {
      await fb.signInWithPopup(fb.auth, provider);
      closeWindow();
      toast("Signed in. Your stats now sync.");
    } catch (e) {
      const code = (e && e.code) || "";
      if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") {
        try {
          await fb.signInWithRedirect(fb.auth, provider);
          return;
        } catch (e2) {}
      }
      done();
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return;
      console.warn("Guess the Chat: sign-in failed", e);
      showError(win, "Could not sign in. Please try again.");
    }
  }

  async function deleteAccount() {
    const u = fb.auth.currentUser;
    if (!u) return;
    await fb.deleteDoc(fb.doc(fb.db, "players", u.uid));
    try {
      await fb.deleteUser(u);
    } catch (e) {
      if (e && e.code === "auth/requires-recent-login") {
        await fb.reauthenticateWithPopup(u, new fb.GoogleAuthProvider());
        await fb.deleteUser(u);
      } else {
        throw e;
      }
    }
    removeKey(KEY_BASE);
  }

  // ----- sync -----

  let syncing = false;
  let syncAgain = false;
  let lastSync = 0;

  async function sync() {
    if (!fb || !user) return;
    if (syncing) {
      syncAgain = true;
      return;
    }
    syncing = true;
    const uid = user.uid;
    try {
      const ref = fb.doc(fb.db, "players", uid);
      const localAtStart = normStats(readJSON(KEY_STATS, null));
      const playedAtStart = readJSON(KEY_PLAYED, []);
      const baseRec = readJSON(KEY_BASE, null);
      const base = baseRec && baseRec.uid === uid ? normStats(baseRec.stats) : emptyStats();

      const merged = await fb.runTransaction(fb.db, async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.exists() ? snap.data() : {};
        const stats = addDelta(data.stats, localAtStart, base);
        const played = mergePlayed(data.played, playedAtStart);
        tx.set(ref, { stats, played, updated: fb.serverTimestamp() });
        return { stats, played };
      });

      // Anything played while the sync was running is kept and sent next time.
      const localNow = readJSON(KEY_STATS, null);
      writeJSON(KEY_STATS, addDelta(merged.stats, localNow, localAtStart));
      writeJSON(KEY_PLAYED, mergePlayed(merged.played, readJSON(KEY_PLAYED, [])));
      writeJSON(KEY_BASE, { uid, stats: merged.stats });
      lastSync = Date.now();
    } catch (e) {
      console.warn("Guess the Chat: sync failed", e);
    } finally {
      syncing = false;
      if (syncAgain) {
        syncAgain = false;
        sync();
      }
    }
  }

  // ----- watching the game -----

  const result = document.getElementById("result");
  const summary = document.getElementById("summary");
  let syncTimer = null;
  if (result) {
    let wasHidden = result.hidden;
    new MutationObserver(() => {
      const hidden = result.hidden;
      if (hidden === wasHidden) return;
      wasHidden = hidden;
      if (!hidden) {
        // A guess was just made and saved by the game: send it.
        clearTimeout(syncTimer);
        syncTimer = setTimeout(sync, 1200);
      } else if (summary && !summary.hidden && !user && !readJSON(KEY_PROMPTED, false)) {
        // The player closed the last result of a game: offer sign-in once.
        writeJSON(KEY_PROMPTED, true);
        setTimeout(() => {
          if (!user && !openWindow) openSignIn();
        }, 500);
      }
    }).observe(result, { attributes: true, attributeFilter: ["hidden"] });
  }

  // Coming back to the tab: pick up games played on another device.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && user && Date.now() - lastSync > 30000) sync();
  });
}

// ---------------------------------------------------------------------------
// Icons

const ICON_PERSON =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="8.5" r="3.6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4.8 19.5c1.2-3.3 4-5 7.2-5s6 1.7 7.2 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

const ICON_CLOSE =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';

const ICON_GOOGLE =
  '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';

// ---------------------------------------------------------------------------
// Styles (use the game's colors from index.html)

const CSS = `
.gtc-side-row { display: flex; align-items: center; gap: 8px; }
.gtc-account-btn { display: grid; place-items: center; padding: 0; overflow: hidden; }
.gtc-account-btn.signed-in { border-color: var(--accent, #9147ff); }
.gtc-floating { position: fixed; top: 12px; right: 12px; z-index: 10; }

/* On phones the header holds one more button, so the title and buttons shrink a little. */
@media (max-width: 440px) {
  .top-row .logo { font-size: clamp(22px, 6.6vw, 34px); }
  .top-row .icon-btn { width: 34px; height: 34px; }
  .gtc-side-row { gap: 6px; }
}
@media (max-width: 370px) {
  .top-row .icon-btn { width: 32px; height: 32px; }
}

.gtc-avatar {
  --size: 28px;
  width: var(--size);
  height: var(--size);
  border-radius: 50%;
  overflow: hidden;
  display: grid;
  place-items: center;
  background: var(--raise, #26262c);
  color: var(--fg, #efeff1);
  font-weight: 700;
  font-size: calc(var(--size) * 0.42);
}
.gtc-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }

.gtc-footer {
  margin-top: 48px;
  display: grid;
  justify-items: center;
  gap: 4px;
  color: var(--muted, #adadb8);
  font-size: 12px;
  text-align: center;
  opacity: 0.8;
}
.gtc-footer nav { display: flex; gap: 8px; }
.gtc-footer a { color: inherit; text-decoration: none; }
.gtc-footer a:hover { color: var(--fg, #efeff1); text-decoration: underline; text-underline-offset: 3px; }

.gtc-overlay {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  padding: 16px;
  background: var(--scrim, rgba(0, 0, 0, 0.78));
  animation: gtc-fade 0.2s ease;
}
.gtc-overlay[hidden] { display: none; }

.gtc-window {
  position: relative;
  width: min(100%, 440px);
  max-height: 100%;
  overflow: auto;
  background: var(--panel, #18181b);
  border: 1px solid var(--line, #2f2f35);
  border-radius: 14px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
  color: var(--fg, #efeff1);
  animation: gtc-rise 0.25s ease;
}
.gtc-account { width: min(100%, 360px); }

.gtc-banner { position: relative; aspect-ratio: 3 / 1; background: #000; }
.gtc-banner img { display: block; width: 100%; height: 100%; object-fit: cover; }
.gtc-banner::after {
  content: "";
  position: absolute;
  inset: auto 0 0 0;
  height: 40%;
  background: linear-gradient(to bottom, transparent, var(--panel, #18181b));
}

.gtc-close {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 2;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 50%;
  background: rgba(14, 14, 16, 0.7);
  color: var(--fg, #efeff1);
  display: grid;
  place-items: center;
  cursor: pointer;
}
.gtc-close:hover { background: rgba(14, 14, 16, 0.9); }

.gtc-body { padding: 4px 20px 20px; display: grid; gap: 14px; }
.gtc-account .gtc-body { padding-top: 28px; justify-items: center; text-align: center; gap: 10px; }

.gtc-title {
  margin: 0;
  text-align: center;
  font-family: var(--font-display, "Bricolage Grotesque", "Inter", system-ui, sans-serif);
  font-weight: 800;
  font-size: 30px;
  letter-spacing: -0.02em;
  line-height: 1.1;
}
.gtc-title.small { font-size: 22px; }
.gtc-sub { margin: -6px 0 0; color: var(--muted, #adadb8); font-size: 13px; overflow-wrap: anywhere; }
.gtc-sync { margin: 4px 0 6px; color: var(--muted, #adadb8); font-size: 13px; }

.gtc-chat {
  border: 1px solid var(--line, #2f2f35);
  border-radius: 10px;
  background: var(--bg, #0e0e10);
  padding: 8px 0;
  min-height: 112px;
}
.gtc-msg { padding: 4px 14px; font-size: 14px; line-height: 22px; overflow-wrap: anywhere; }
.gtc-msg.system { color: var(--muted, #adadb8); font-size: 13px; }
.gtc-name { font-weight: 700; }
.gtc-emote { height: 32px; width: auto; margin: -8px 1px; vertical-align: middle; }
/* Visible by default. The fade-in only runs where animations are allowed, so a
   device with animations turned off still shows everything. */
.gtc-msg.typed { animation: gtc-pop 0.3s ease both; }
.gtc-msg.typed:nth-child(2) { animation-delay: 0.6s; }
.gtc-msg.typed:nth-child(3) { animation-delay: 1.4s; }

/* Google button: dark style from Google's sign-in button guidelines */
.gtc-google {
  width: 100%;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 0 16px;
  border: 1px solid #8e918f;
  border-radius: 22px;
  background: #131314;
  color: #e3e3e3;
  font-family: "Roboto", var(--font-ui, system-ui, sans-serif);
  font-weight: 500;
  font-size: 15px;
  cursor: pointer;
  animation: gtc-up 0.3s ease 2s both;
  transition: background 0.15s;
}
.gtc-google:hover:not(:disabled) { background: #1f1f21; }
.gtc-google:disabled { cursor: default; opacity: 0.7; }
.gtc-google svg { width: 20px; height: 20px; flex: none; }

.gtc-note {
  margin: -4px 0 0;
  text-align: center;
  color: var(--faint, #53535f);
  font-size: 12px;
  animation: gtc-up 0.3s ease 2.2s both;
}
.gtc-note a { color: var(--muted, #adadb8); }

.gtc-error { margin: -4px 0 0; text-align: center; color: #ff8a8f; font-size: 13px; }
.gtc-error[hidden] { display: none; }

.gtc-outline,
.gtc-danger {
  width: 100%;
  padding: 11px 16px;
  border-radius: 9px;
  font-weight: 700;
  font-size: 14px;
  cursor: pointer;
}
.gtc-outline { border: 1px solid var(--line, #2f2f35); background: transparent; color: var(--fg, #efeff1); }
.gtc-outline:hover { border-color: var(--faint, #53535f); background: var(--raise, #26262c); }
.gtc-danger { border: 0; background: transparent; color: #ff8a8f; font-weight: 600; }
.gtc-danger:hover:not(:disabled) { background: rgba(226, 71, 79, 0.12); }
.gtc-danger.armed { background: var(--bad, #e2474f); color: #fff; }

.gtc-toast {
  position: fixed;
  left: 50%;
  bottom: max(20px, env(safe-area-inset-bottom, 0px));
  z-index: 50;
  max-width: calc(100% - 32px);
  padding: 10px 18px;
  border-radius: 999px;
  border: 1px solid var(--line, #2f2f35);
  background: var(--raise, #26262c);
  color: var(--fg, #efeff1);
  font-size: 13px;
  font-weight: 600;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  opacity: 0;
  transform: translate(-50%, 12px);
  pointer-events: none;
  transition: opacity 0.2s, transform 0.2s;
}
.gtc-toast.show { opacity: 1; transform: translate(-50%, 0); }

@keyframes gtc-fade { from { opacity: 0; } }
@keyframes gtc-rise { from { opacity: 0; transform: translateY(12px) scale(0.98); } }
@keyframes gtc-pop { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes gtc-up { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }

@media (prefers-reduced-motion: reduce) {
  .gtc-overlay, .gtc-window, .gtc-msg.typed, .gtc-google, .gtc-note {
    animation-duration: 0.01ms !important;
    animation-delay: 0s !important;
  }
}
`;

if (typeof document !== "undefined") init();
