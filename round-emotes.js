// Guess the Chat: a random emote in the result window after each round.
//
// Added to index.html with one line, just before </body>:
//   <script type="module" src="round-emotes.js?v=1"></script>
//
// The game itself is not changed. When the result window opens, this file puts
// a big emote above the title and turns the colored header into a full-width
// banner behind the text only: green when the guess was right, red when wrong.
// The emote is picked at random, and never the same one twice in a row.
//
// To add or remove emotes, edit the two lists below. The images sit next to
// this file.

const WIN_EMOTES = ["win-1.webp", "win-2.webp", "win-3.webp", "win-4.webp"];
const LOSE_EMOTES = ["lose-1.webp", "lose-2.webp", "lose-3.webp", "lose-4.webp"];

const CSS = `
#result-head.gtc-emote-head {
  padding: 22px 0 0;
  display: grid;
  justify-items: center;
  gap: 16px;
  background: radial-gradient(ellipse 60% 70% at 50% 40%, rgba(47, 179, 107, 0.22), transparent 70%);
}
#result-head.gtc-emote-head.bad {
  background: radial-gradient(ellipse 60% 70% at 50% 40%, rgba(226, 71, 79, 0.22), transparent 70%);
}
#result-head.gtc-emote-head h2 {
  width: 100%;
  padding: 14px 20px;
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

/* Smaller screens: keep room for the clip below. */
@media (max-width: 520px), (max-height: 760px) {
  .gtc-round-emote { height: 110px; }
  #result-head.gtc-emote-head { padding-top: 16px; gap: 12px; }
}

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
  }

  // The game fills in the window and then shows it: add the emote at that moment.
  let wasHidden = result.hidden;
  new MutationObserver(() => {
    if (result.hidden === wasHidden) return;
    wasHidden = result.hidden;
    if (!result.hidden) showEmote();
  }).observe(result, { attributes: true, attributeFilter: ["hidden"] });
}
