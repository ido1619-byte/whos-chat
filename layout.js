// Guess the Chat: page layout.
//
// Added to index.html with one line, just before </body>, after signin.js:
//   <script type="module" src="layout.js?v=1"></script>
//
// - The sound, sign-in and "?" buttons move to the top-right corner of the page.
// - The title and the game sit together in the middle of the screen.
// - The Terms / Privacy / Contact footer stays at the bottom.
// The game itself is not changed; the buttons keep working as before.

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

.gtc-toolbar {
  flex: none;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  padding: 14px max(16px, env(safe-area-inset-right, 0px)) 0 16px;
}
.gtc-toolbar .icon-btn { flex: none; }

/* Signed out: the account button becomes a "Sign in" pill.
   (Signed in, it stays a round picture, as before.) */
.gtc-toolbar #account-btn:not(.signed-in) {
  width: auto;
  height: 36px;
  padding: 0 14px 0 11px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border-radius: 999px;
  border: 1px solid var(--accent, #9147ff);
  color: var(--accent-text, #bf94ff);
  font-family: var(--font-ui, "Inter", system-ui, sans-serif);
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s;
}
.gtc-toolbar #account-btn:not(.signed-in)::after { content: "Sign in"; }
.gtc-toolbar #account-btn:not(.signed-in):hover {
  background: var(--accent, #9147ff);
  color: #fff;
}
.gtc-toolbar #account-btn:not(.signed-in) svg { width: 17px; height: 17px; }

/* The title row no longer holds buttons, so on phones the title can be full size again. */
@media (max-width: 440px) {
  .top-row .logo { font-size: clamp(34px, 8vw, 46px); }
  .gtc-toolbar { padding-top: 10px; }
}
`;

const style = document.createElement("style");
style.textContent = CSS;
document.head.appendChild(style);

const bar = document.createElement("div");
bar.className = "gtc-toolbar";
for (const id of ["sound-btn", "help-btn", "account-btn"]) {
  const button = document.getElementById(id);
  if (button) bar.appendChild(button);
}
document.body.prepend(bar);
document.body.classList.add("gtc-layout");
