const cabin = new URL("../media/cabin.webp", import.meta.url).pathname;
const santa = new URL("../media/santa.webp", import.meta.url).pathname;

export function winterPassScene(part) {
  if (part === "sky") return `<div class="winter-pass-sky" aria-hidden="true">
    <div class="winter-sleigh"><img src="${santa}" alt=""></div>
  </div>`;
  return `<div class="winter-pass-finish" aria-label="Зимний домик в конце пути">
    <div class="cabin-steam" aria-hidden="true"><i></i><i></i><i></i></div>
    <img src="${cabin}" alt="Заснеженный домик с тёплым светом в окнах среди елей">
  </div>`;
}

export function mountWinterScene(root) {
  root._winterSceneDispose?.();
  const view = document.getElementById("view");
  let frame;
  const update = () => {
    frame = null;
    if (!root.getClientRects().length) return;
    const y = view.getBoundingClientRect().top - root.getBoundingClientRect().top + 75;
    root.style.setProperty("--pass-visible-top", Math.min(Math.max(75, y), Math.max(75, root.offsetHeight - 390)) + "px");
  };
  const scroll = () => { if (!frame) frame = requestAnimationFrame(update); };
  view.addEventListener("scroll", scroll, { passive: true });
  const stopShow = window.kov.onTabShow("battlepass", scroll);
  root._winterSceneDispose = () => {
    view.removeEventListener("scroll", scroll);
    stopShow();
    if (frame) cancelAnimationFrame(frame);
  };
  scroll();
}
