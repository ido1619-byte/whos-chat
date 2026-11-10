// Guess the Chat: page layout, the "How to play" window and Settings.
//
// Added to index.html with one line, just before </body>, after signin.js:
//   <script type="module" src="layout.js?v=3"></script>
//
// - The "?", settings and sign-in buttons sit at the top right of the page.
// - The title and the game sit together in the middle of the screen.
// - "How to play" is a short guide with pictures instead of a list.
// - Settings: sound effects and animations on or off.
// The game itself is not changed; its own buttons keep working underneath.

const KEY_MOTION = "gtc.animations"; // "off" when animations are turned off

const ICON_GEAR =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>';
const ICON_X =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
const ICON_PLAY =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.52.85l10.4-6.5a1 1 0 0 0 0-1.7L9.52 4.65A1 1 0 0 0 8 5.5z" fill="currentColor"/></svg>';

const CSS = `
body.gtc-layout {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  min-height: 100svh;
}
body.gtc-layout > .app {
  flex: 1 0 auto;
  width: 100%;
  display: flex;
  flex-direction: column;
}
body.gtc-layout .top { margin-top: auto; }
body.gtc-layout .gtc-footer { margin-top: auto; padding-top: 32px; }

/* The play triangle sits in the exact middle of its circle
   (the game nudged it 3px to the right). */
body.gtc-layout .play-btn svg { margin-left: 0; }

/* ----- top-right buttons ----- */
.gtc-toolbar {
  flex: none;
  width: 100%;
  max-width: 1500px;
  margin: 0 auto;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 10px;
  padding: 22px max(24px, env(safe-area-inset-right, 0px)) 0 24px;
}
.gtc-toolbar .icon-btn {
  flex: none;
  width: 46px;
  height: 46px;
  display: inline-grid;
  place-items: center;
  padding: 0;
  line-height: 1;
  font-size: 18px;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}
.gtc-toolbar .icon-btn:hover { border-color: var(--faint, #53535f); color: var(--fg, #efeff1); }
.gtc-toolbar .icon-btn svg { display: block; width: 20px; height: 20px; }
.gtc-toolbar #sound-btn { display: none; } /* sound is in Settings now */

/* Signed out: the account button is just the words "Sign in".
   (Signed in, it stays a round picture.) */
.gtc-toolbar #account-btn:not(.signed-in) {
  width: auto;
  height: 46px;
  padding: 0 6px 0 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--muted, #adadb8);
  font-family: var(--font-ui, "Inter", system-ui, sans-serif);
  font-size: 17px;
  font-weight: 500;
  white-space: nowrap;
}
.gtc-toolbar #account-btn:not(.signed-in) svg { display: none; }
.gtc-toolbar #account-btn:not(.signed-in)::after { content: "Sign in"; }
.gtc-toolbar #account-btn:not(.signed-in):hover { color: var(--fg, #efeff1); }

/* ----- shared by the two windows ----- */
.gtc-x {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--muted, #adadb8);
  cursor: pointer;
}
.gtc-x:hover { color: var(--fg, #efeff1); background: var(--raise, #26262c); }
.gtc-title {
  margin: 0;
  font-family: var(--font-display, "Bricolage Grotesque", system-ui, sans-serif);
  font-weight: 800;
  font-size: 34px;
  line-height: 1.1;
  letter-spacing: -0.02em;
  color: var(--fg, #efeff1);
  text-align: center;
}
.gtc-panel {
  border-radius: 14px;
  background: var(--bg, #0e0e10);
}

/* ----- How to play ----- */
#help.gtc-help-ready .modal { position: relative; max-width: 440px; }
#help.gtc-help-ready .modal > :not(.gtc-help) { display: none; }
.gtc-help {
  min-height: 0;
  overflow-y: auto;
  padding: 30px 24px 22px;
  display: grid;
  gap: 16px;
  text-align: center;
}
.gtc-help .gtc-title { font-size: 34px; letter-spacing: -0.02em; } /* beats the game's own .modal-help h2 */
.gtc-help-sub {
  margin: 0 auto;
  max-width: 340px;
  color: var(--muted, #adadb8);
  font-size: 15px;
  line-height: 1.45;
}
.gtc-help .gtc-panel {
  margin-top: 4px;
  padding: 18px;
  display: grid;
  gap: 14px;
  text-align: left;
}
.gtc-help-meter {
  position: relative;
  height: 14px;
  border-radius: 4px;
  overflow: hidden;
  background: var(--raise, #26262c);
}
.gtc-help-meter span { position: absolute; top: 0; bottom: 0; left: 0; }
.gtc-help-meter .open { width: 34%; background: var(--meter-open, #3b2768); }
.gtc-help-meter .fill { width: 14%; background: var(--accent, #9147ff); }
.gtc-help-row {
  display: flex;
  align-items: center;
  gap: 14px;
  font-size: 15px;
  color: var(--fg, #efeff1);
}
/* every picture takes the same width, so the words line up */
.gtc-help-play {
  flex: none;
  margin: 0 14px;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--accent, #9147ff);
  color: #fff;
}
.gtc-help-skip {
  flex: none;
  width: 66px;
  padding: 8px 0;
  text-align: center;
  border-radius: 8px;
  background: var(--accent, #9147ff);
  color: #fff;
  font-weight: 700;
  font-size: 14px;
}
.gtc-help-faces { flex: none; width: 66px; display: flex; justify-content: center; }
.gtc-help-faces i {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 3px solid var(--bg, #0e0e10);
  background: hsl(20 38% 40%);
}
.gtc-help-faces i + i { margin-left: -12px; }
.gtc-help-faces i:nth-child(2) { background: hsl(200 38% 40%); }
.gtc-help-faces i:nth-child(3) { background: hsl(300 38% 40%); }
.gtc-help-row small { display: block; margin-top: 2px; color: var(--muted, #adadb8); font-size: 13px; }
.gtc-help-foot { margin: 0; color: var(--muted, #adadb8); font-size: 14px; }
.gtc-link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--fg, #efeff1);
  font: inherit;
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}

/* ----- Settings ----- */
.gtc-settings .modal {
  position: relative;
  max-width: 380px;
  padding: 30px 24px 24px;
  display: grid;
  gap: 18px;
}
.gtc-settings .gtc-panel { padding: 4px 16px; }
.gtc-set-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 0;
  font-size: 15px;
  font-weight: 500;
  color: var(--fg, #efeff1);
  cursor: pointer;
}
.gtc-set-row + .gtc-set-row { border-top: 1px solid var(--line, #2f2f35); }
.gtc-switch {
  -webkit-appearance: none;
  appearance: none;
  flex: none;
  position: relative;
  width: 44px;
  height: 26px;
  margin: 0;
  border: 1px solid var(--line, #2f2f35);
  border-radius: 999px;
  background: var(--raise, #26262c);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.gtc-switch::before {
  content: "";
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--muted, #adadb8);
  transition: transform 0.15s, background 0.15s;
}
.gtc-switch:checked { background: var(--accent, #9147ff); border-color: var(--accent, #9147ff); }
.gtc-switch:checked::before { transform: translateX(18px); background: #fff; }
.gtc-switch:focus-visible { outline: 2px solid var(--accent-hi, #a970ff); outline-offset: 2px; }

/* ----- phones ----- */
@media (max-width: 440px) {
  .top-row .logo { font-size: clamp(34px, 8vw, 46px); }
  .gtc-toolbar { gap: 8px; padding: 12px 14px 0; }
  .gtc-toolbar .icon-btn { width: 40px; height: 40px; font-size: 16px; }
  .gtc-toolbar .icon-btn svg { width: 18px; height: 18px; }
  .gtc-toolbar #account-btn:not(.signed-in) { height: 40px; font-size: 16px; }
  .gtc-title, .gtc-help .gtc-title { font-size: 30px; }
  .gtc-help { padding: 26px 18px 18px; }
}
`;

const NO_MOTION_CSS =
  "*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}";

function readKey(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}
function writeKey(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch (e) {}
}

const style = document.createElement("style");
style.textContent = CSS;
document.head.appendChild(style);

const noMotion = document.createElement("style");
document.head.appendChild(noMotion);
const motionOn = () => readKey(KEY_MOTION) !== "off";
const applyMotion = () => {
  noMotion.textContent = motionOn() ? "" : NO_MOTION_CSS;
};
applyMotion();

const soundBtn = document.getElementById("sound-btn");
const helpBtn = document.getElementById("help-btn");
const accountBtn = document.getElementById("account-btn");

// ----- top-right buttons -----

const settingsBtn = document.createElement("button");
settingsBtn.type = "button";
settingsBtn.className = "icon-btn gtc-settings-btn";
settingsBtn.setAttribute("aria-label", "Settings");
settingsBtn.innerHTML = ICON_GEAR;

const bar = document.createElement("div");
bar.className = "gtc-toolbar";
for (const button of [soundBtn, helpBtn, settingsBtn, accountBtn]) {
  if (button) bar.appendChild(button);
}
document.body.prepend(bar);
document.body.classList.add("gtc-layout");

// ----- How to play -----
// The game's own window stays (it opens and closes it as before); only what is
// shown inside it changes. The X uses the game's own "Got it" button.

const help = document.getElementById("help");
const helpClose = document.getElementById("help-close");
const helpModal = help && help.querySelector(".modal");

if (helpModal && helpClose) {
  const box = document.createElement("div");
  box.className = "gtc-help";
  box.innerHTML =
    '<button class="gtc-x" type="button" aria-label="Close">' + ICON_X + "</button>" +
    '<h2 class="gtc-title" id="gtc-help-title">How to Play</h2>' +
    '<p class="gtc-help-sub">Read a Twitch chat and guess whose stream it&nbsp;is. <span class="n-rounds">5</span> rounds a game.</p>' +
    '<div class="gtc-panel">' +
    '<div class="gtc-help-meter" aria-hidden="true"><span class="open"></span><span class="fill"></span></div>' +
    '<div class="gtc-help-row"><span class="gtc-help-play">' + ICON_PLAY + "</span><span>Play the chat</span></div>" +
    '<div class="gtc-help-row"><span class="gtc-help-skip">Skip</span><span>See more chat (<span class="n-skips">4</span> a round)</span></div>' +
    '<div class="gtc-help-row"><span class="gtc-help-faces" aria-hidden="true"><i></i><i></i><i></i></span><span>Pick the streamer<small>Fewer skips, more points</small></span></div>' +
    "</div>" +
    '<p class="gtc-help-foot"><button class="gtc-link" type="button">Sign in</button> to keep your stats on every device</p>';
  helpModal.prepend(box);
  helpModal.setAttribute("aria-labelledby", "gtc-help-title");
  help.classList.add("gtc-help-ready");

  // The game writes the real numbers into its own window; copy them over.
  const gameNumber = (selector, fallback) => {
    const el = help.querySelector(selector);
    const n = el ? parseInt(el.textContent, 10) : NaN;
    return n > 0 ? n : fallback;
  };
  const refresh = () => {
    box.querySelector(".n-rounds").textContent = gameNumber("#help-rounds, .help-rounds", 5);
    box.querySelector(".n-skips").textContent = gameNumber("#help-skips, .help-skips", 4);
    const signedIn = accountBtn && accountBtn.classList.contains("signed-in");
    box.querySelector(".gtc-help-foot").hidden = !accountBtn || signedIn;
  };
  refresh();
  new MutationObserver(() => {
    if (!help.hidden) refresh();
  }).observe(help, { attributes: true, attributeFilter: ["hidden"] });

  box.querySelector(".gtc-x").addEventListener("click", () => helpClose.click());
  box.querySelector(".gtc-link").addEventListener("click", () => {
    helpClose.click();
    if (accountBtn) accountBtn.click();
  });
}

// ----- Settings -----

const settings = document.createElement("div");
settings.className = "overlay gtc-settings";
settings.hidden = true;
settings.innerHTML =
  '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="gtc-settings-title">' +
  '<button class="gtc-x" type="button" aria-label="Close">' + ICON_X + "</button>" +
  '<h2 class="gtc-title" id="gtc-settings-title">Settings</h2>' +
  '<div class="gtc-panel">' +
  '<label class="gtc-set-row" data-row="sound"><span>Sound effects</span><input class="gtc-switch" type="checkbox" role="switch" data-set="sound"></label>' +
  '<label class="gtc-set-row"><span>Animations</span><input class="gtc-switch" type="checkbox" role="switch" data-set="motion"></label>' +
  "</div></div>";
document.body.appendChild(settings);

const soundSwitch = settings.querySelector('[data-set="sound"]');
const motionSwitch = settings.querySelector('[data-set="motion"]');

// Sound uses the game's own (now hidden) sound button, so the game keeps
// remembering the choice, and the M key keeps working.
const soundOn = () => !(soundBtn && soundBtn.classList.contains("off"));
const syncSettings = () => {
  soundSwitch.checked = soundOn();
  motionSwitch.checked = motionOn();
};
if (soundBtn) {
  new MutationObserver(syncSettings).observe(soundBtn, { attributes: true, attributeFilter: ["class"] });
} else {
  settings.querySelector('[data-row="sound"]').hidden = true;
}

soundSwitch.addEventListener("change", () => {
  if (soundBtn && soundSwitch.checked !== soundOn()) soundBtn.click();
  syncSettings();
});
motionSwitch.addEventListener("change", () => {
  writeKey(KEY_MOTION, motionSwitch.checked ? null : "off");
  applyMotion();
});

function openSettings() {
  syncSettings();
  settings.hidden = false;
  soundSwitch.focus({ preventScroll: true });
}
function closeSettings() {
  settings.hidden = true;
  settingsBtn.focus({ preventScroll: true });
}

settingsBtn.addEventListener("click", openSettings);
settings.querySelector(".gtc-x").addEventListener("click", closeSettings);
settings.addEventListener("click", (e) => {
  if (e.target === settings) closeSettings();
});
// While Settings is open, keys don't reach the game (no skipping by accident).
window.addEventListener(
  "keydown",
  (e) => {
    if (settings.hidden) return;
    if (e.key === "Escape") closeSettings();
    e.stopPropagation();
  },
  true,
);
