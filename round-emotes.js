// Guess the Chat: a random emote in the result window after each round.
//
// Added to index.html with one line, just before </body>:
//   <script type="module" src="round-emotes.js?v=3"></script>
//
// The game itself is not changed. When the result window opens, this file puts
// a big emote above the title and turns the colored header into a full-width
// banner behind the text only: green when the guess was right, red when wrong.
// The emote is picked at random, and never the same one twice in a row.
//
// To add or remove emotes, edit the two lists below. The images sit next to
// this file.

const WIN_EMOTES = ["win-1.webp", "win-2.webp", "win-3.webp", "win-4.webp", "win-5.webp"];
const LOSE_EMOTES = ["lose-1.webp", "lose-2.webp", "lose-3.webp", "lose-4.webp", "lose-5.webp"];

const CSS = `
#result-head.gtc-emote-head {
  padding: 16px 0 0;
  display: grid;
  justify-items: center;
  gap: 12px;
  background: radial-gradient(ellipse 60% 70% at 50% 40%, rgba(47, 179, 107, 0.22), transparent 70%);
}
#result-head.gtc-emote-head.bad {
  background: radial-gradient(ellipse 60% 70% at 50% 40%, rgba(226, 71, 79, 0.22), transparent 70%);
}
#result-head.gtc-emote-head h2 {
  width: 100%;
  padding: 11px 20px;
  background: var(--good, #2fb36b);
}
#result-head.gtc-emote-head.bad h2 { background: var(--bad, #e2474f); }

.gtc-round-emote {
  display: block;
  height: 150px;
  width: auto;
  max-width: calc(100% - 40px);
  object-fit: contain;
  border-radius: 16px;
  filter: drop-shadow(0 10px 18px rgba(0, 0, 0, 0.5));
  animation: gtc-emote-pop 0.4s cubic-bezier(0.3, 1.6, 0.6, 1) both;
}
@keyframes gtc-emote-pop { from { transform: scale(0.4); opacity: 0; } }

/* Room for the emote, so the whole window fits without scrolling:
   on computers, "It was ..." and the Skips/Points/Streak boxes share one row,
   and the "Your guesses" bars are a little thinner. */
@media (min-width: 720px) {
  #result .modal-body { grid-template-columns: minmax(0, 1fr) auto; }
  #result .modal-body > * { grid-column: 1 / -1; }
  #result .modal-body > .reveal { grid-column: 1; }
  #result .modal-body > .result-stats { grid-column: 2; align-self: center; min-width: 300px; }
}
#result .modal-body { gap: 12px; padding-top: 16px; padding-bottom: 16px; }
#result .modal-foot { padding-top: 12px; padding-bottom: 12px; }
#result .dist-rows { gap: 3px; }
#result .dist-bar { height: 16px; line-height: 16px; font-size: 11px; }

@media (prefers-reduced-motion: reduce) {
  .gtc-round-emote { animation: none; }
}
`;

const result = document.getElementById("result");
const head = document.getElementById("result-head");

if (result && head) {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const asset = (name) => new URL(name, import.meta.url).href;

  // Load the images early so they show the moment a round ends.
  for (const name of [...WIN_EMOTES, ...LOSE_EMOTES]) new Image().src = asset(name);

  const last = { win: -1, lose: -1 };
  function pick(list, kind) {
    if (list.length < 2) return list[0];
    let i;
    do {
      i = Math.floor(Math.random() * list.length);
    } while (i === last[kind]);
    last[kind] = i;
    return list[i];
  }

  function showEmote() {
    const won = !head.classList.contains("bad");
    const list = won ? WIN_EMOTES : LOSE_EMOTES;
    if (!list.length) return;
    head.classList.add("gtc-emote-head");
    const old = head.querySelector(".gtc-round-emote");
    if (old) old.remove();
    const img = document.createElement("img");
    img.className = "gtc-round-emote";
    img.src = asset(pick(list, won ? "win" : "lose"));
    img.alt = "";
    img.decoding = "async";
    img.onerror = () => img.remove();
    head.prepend(img);
    fit();
  }

  // Shrinks the emote (never below EMOTE_MIN) until the window fits the screen
  // without scrolling. On a tall screen it stays at full size.
  const EMOTE_MAX = 150;
  const EMOTE_MIN = 64;
  function fit() {
    const img = head.querySelector(".gtc-round-emote");
    const body = result.querySelector(".modal-body");
    if (!img || !body || result.hidden) return;
    img.style.height = EMOTE_MAX + "px";
    for (let pass = 0; pass < 2; pass++) {
      const extra = body.scrollHeight - body.clientHeight;
      if (extra <= 0) break;
      const now = img.offsetHeight || EMOTE_MAX; // offsetHeight ignores the pop animation's scale
      img.style.height = Math.max(EMOTE_MIN, Math.floor(now - extra)) + "px";
    }
  }

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(fit, 120);
  });

  // The game fills in the window and then shows it: add the emote at that moment.
  let wasHidden = result.hidden;
  new MutationObserver(() => {
    if (result.hidden === wasHidden) return;
    wasHidden = result.hidden;
    if (!result.hidden) showEmote();
  }).observe(result, { attributes: true, attributeFilter: ["hidden"] });
}
