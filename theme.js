// Guess the Chat: light theme (for when "Dark theme" is turned off in Settings).
//
// Added to index.html with one line, inside <head>, just before </head>:
//   <script src="theme.js?v=1"></script>
// It loads before the page shows, so a light page never flashes dark first.
// The switch itself is in Settings (layout.js). The choice is saved in this browser.

(function () {
  var css =
    "html.gtc-light{" +
    "--bg:#f7f7f8;--panel:#ffffff;--chat:#ffffff;--raise:#efeff1;--line:#dedee3;" +
    "--fg:#0e0e10;--muted:#53535f;--faint:#adadb8;" +
    "--accent:#9147ff;--accent-hi:#772ce8;--accent-text:#772ce8;--on-accent:#ffffff;" +
    "--good:#1f9d58;--bad:#d93a44;--meter-open:#ddd0fb;" +
    "--chip:#f1ebff;--chip-line:#d9c9fb;--chip-fg:#5c16c5;" +
    "--cover:rgba(247,247,248,.88);--scrim:rgba(14,14,16,.55);" +
    "color-scheme:light}" +
    // Chatters' name colors are picked for a dark background; darken them a little.
    "html.gtc-light .msg .name{filter:brightness(.78) saturate(1.25)}";
  var style = document.createElement("style");
  style.id = "gtc-theme";
  style.textContent = css;
  document.head.appendChild(style);
  try {
    if (localStorage.getItem("gtc.theme") === "light") document.documentElement.classList.add("gtc-light");
  } catch (e) {}
})();
