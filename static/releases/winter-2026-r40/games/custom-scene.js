import { readStaticBytes } from "../startup-assets.js";
import { KovboxRenderer, readMesh } from "./kovbox-view.js";

const root = new URL("../media/custom/", import.meta.url);
let assets;
let models;

export function hasCustomModel(code) {
  return models?.has(code) || false;
}

export function customThumbnail(code) {
  return new URL("thumb/" + encodeURIComponent(code) + ".webp", root).pathname;
}

export function prepareCustomModels() {
  if (!assets) {
    const compressed = typeof DecompressionStream === "function";
    assets = Promise.all([
      readStaticBytes(new URL("models.json", root)),
      readStaticBytes(new URL(compressed ? "models.bin.gz" : "models.bin", root)),
    ]).then(async ([directory, data]) => {
      const unpacked = compressed
        ? await new Response(new Response(data).body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()
        : data;
      const entries = JSON.parse(new TextDecoder().decode(directory));
      models = new Map(Object.entries(entries).map(([code, [offset, length]]) =>
        [code, readMesh(unpacked.slice(offset, offset + length))]));
      return models;
    }).catch((error) => {
      assets = undefined;
      throw error;
    });
  }
  return assets;
}

export function mountCustomScene(host, { base, codes = [], interactive = false } = {}) {
  const canvas = document.createElement("canvas");
  const notice = document.createElement("p");
  notice.className = "custom-scene-notice";
  notice.hidden = true;
  canvas.setAttribute("aria-hidden", "true");
  host.replaceChildren(canvas, notice);
  const gl = canvas.getContext("webgl", { alpha: true, antialias: true, powerPreference: "default" });
  const listeners = new AbortController();
  const { signal } = listeners;
  const state = { yaw: -.55, pitch: base === "tree" ? .09 : .13, lift: 0, shift: 0, light: .24, scale: 1, roll: 0 };
  const reduced = document.documentElement.classList.contains("motion-lite") ||
    matchMedia("(prefers-reduced-motion: reduce)").matches;
  let selected = codes;
  let renderer, drag, frame;
  let targetYaw = state.yaw;
  let targetPitch = state.pitch;

  const resize = new ResizeObserver(wake);
  resize.observe(host);
  const scope = host.closest(".modal-overlay")?.parentNode || host.closest("#view") || host.parentNode;
  const detach = new MutationObserver(() => {
    if (!host.isConnected) dispose();
  });
  detach.observe(scope, { childList: true, subtree: true });

  function fallback() {
    canvas.hidden = true;
    notice.hidden = false;
    notice.textContent = "Не удалось показать 3D";
  }

  function dispose() {
    if (signal.aborted) return;
    listeners.abort();
    resize.disconnect();
    detach.disconnect();
    cancelAnimationFrame(frame);
    renderer?.dispose();
    if (gl && !gl.isContextLost()) gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  function wake() {
    if (!frame && renderer && !signal.aborted) frame = requestAnimationFrame(draw);
  }

  function draw() {
    frame = undefined;
    if (!host.isConnected) return dispose();
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (!width || !height) return;
    const moving = Math.abs(targetYaw - state.yaw) + Math.abs(targetPitch - state.pitch) > .001;
    const step = moving && !reduced ? .28 : 1;
    state.yaw += (targetYaw - state.yaw) * step;
    state.pitch += (targetPitch - state.pitch) * step;
    renderer.draw(width, height, state, .016);
    if (moving && !reduced) wake();
  }

  function setDecorations(next) {
    selected = next;
    if (!renderer) return;
    renderer.selectBatches([base, ...new Set(selected)].flatMap(code => models.get(code)?.batches || []));
    wake();
  }

  function show() {
    if (signal.aborted || !host.isConnected || !models?.has(base) || gl.isContextLost()) return;
    try {
      const bounds = models.get(base);
      renderer = new KovboxRenderer(gl, { radius: base === "tree" ? 2.99 : bounds.radius + .07, batches: [] });
      canvas.hidden = false;
      notice.hidden = true;
      setDecorations(selected);
    } catch (error) {
      console.warn("Не удалось открыть 3D-примерочную", error);
      fallback();
    }
  }

  if (!gl) {
    fallback();
    dispose();
    return { setDecorations, dispose };
  }

  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    cancelAnimationFrame(frame);
    frame = undefined;
    renderer = null;
    fallback();
  }, { signal });
  canvas.addEventListener("webglcontextrestored", show, { signal });

  if (interactive) {
    host.addEventListener("pointerdown", (event) => {
      if (!renderer || !event.isPrimary || event.button !== 0) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, yaw: targetYaw, pitch: targetPitch };
      host.setPointerCapture(event.pointerId);
    }, { signal });
    host.addEventListener("pointermove", (event) => {
      if (drag?.id !== event.pointerId) return;
      targetYaw = drag.yaw + (event.clientX - drag.x) * .011;
      targetPitch = Math.max(-.37, Math.min(.53, drag.pitch + (event.clientY - drag.y) * .004));
      wake();
    }, { signal });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      host.addEventListener(type, (event) => { if (drag?.id === event.pointerId) drag = undefined; }, { signal });
    }
    host.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      targetYaw += event.key === "ArrowRight" ? .29 : -.29;
      wake();
    }, { signal });
  }

  if (models) show();
  else prepareCustomModels().then(show).catch(fallback);
  return { setDecorations, dispose };
}
