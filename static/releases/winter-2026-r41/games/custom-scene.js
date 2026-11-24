import { readStaticBytes } from "../startup-assets.js";
import { compile, KovboxRenderer, MODEL_ROTATION_GLSL, readMesh } from "./kovbox-view.js";

const root = new URL("../media/custom/", import.meta.url);
let assets;
let models;
let lightDirectory;

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
      readStaticBytes(new URL("lights.json", root)),
    ]).then(async ([directory, data, lights]) => {
      const unpacked = compressed
        ? await new Response(new Response(data).body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()
        : data;
      const decoder = new TextDecoder();
      const entries = JSON.parse(decoder.decode(directory));
      lightDirectory = JSON.parse(decoder.decode(lights));
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

const LIGHT_CODES = ["tree_garland_aurora", "tree_lights_gold"];
const GLOW_VERTEX = `
attribute vec3 aPosition;
attribute vec3 aTint;
uniform mat4 uProjection;
uniform vec4 uPose;
uniform float uDistance;
uniform float uSize;
uniform float uTime;
varying vec3 vTint;
varying float vPulse;
${MODEL_ROTATION_GLSL}
void main() {
  vec3 place = modelRotation(uPose) * aPosition + vec3(0., 0., -uDistance + .076);
  gl_Position = uProjection * vec4(place, 1.);
  vTint = aTint;
  vPulse = .83 + .17 * sin(uTime * 2.45 + dot(aPosition, vec3(6.3,8.7,5.9)));
  gl_PointSize = clamp(uSize / -place.z * vPulse, 4., 41.);
}`;
const GLOW_FRAGMENT = `
precision mediump float;
varying vec3 vTint;
varying float vPulse;
void main() {
  float r = length(gl_PointCoord - vec2(.5)) * 2.;
  float halo = exp(-5.1*r*r) * (1. - smoothstep(.68,1.,r));
  float center = exp(-142.*r*r);
  gl_FragColor = vec4(mix(vTint, vec3(1.,.98,.91), center*.83), halo * vPulse * .61);
}`;

class GarlandGlow {
  constructor(gl) {
    this.gl = gl;
    this.program = gl.createProgram();
    const vertex = compile(gl, gl.VERTEX_SHADER, GLOW_VERTEX);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, GLOW_FRAGMENT);
    gl.attachShader(this.program, vertex);
    gl.attachShader(this.program, fragment);
    gl.linkProgram(this.program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      gl.deleteProgram(this.program);
      throw new Error("Could not link garland glow");
    }
    this.buffer = gl.createBuffer();
    this.position = gl.getAttribLocation(this.program, "aPosition");
    this.tint = gl.getAttribLocation(this.program, "aTint");
    this.projection = gl.getUniformLocation(this.program, "uProjection");
    this.pose = gl.getUniformLocation(this.program, "uPose");
    this.distance = gl.getUniformLocation(this.program, "uDistance");
    this.size = gl.getUniformLocation(this.program, "uSize");
    this.time = gl.getUniformLocation(this.program, "uTime");
    this.count = 0;
  }

  select(codes) {
    const { gl } = this;
    const lights = LIGHT_CODES.filter(code => codes.includes(code)).flatMap(code => lightDirectory?.[code] || []);
    this.count = lights.length;
    if (!this.count) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lights.flat()), gl.STATIC_DRAW);
  }

  draw(renderer, state, elapsed) {
    if (!this.count) return;
    const { gl } = this;
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.projection, false, renderer.cameraProjection);
    gl.uniform4f(this.pose, state.yaw, state.pitch, 0, 1);
    gl.uniform1f(this.distance, renderer.distance);
    gl.uniform1f(this.size, gl.drawingBufferHeight * .43);
    gl.uniform1f(this.time, elapsed);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(this.position);
    gl.enableVertexAttribArray(this.tint);
    gl.vertexAttribPointer(this.position, 3, gl.FLOAT, false, 24, 0);
    gl.vertexAttribPointer(this.tint, 3, gl.FLOAT, false, 24, 12);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.drawArrays(gl.POINTS, 0, this.count);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.disableVertexAttribArray(this.position);
    gl.disableVertexAttribArray(this.tint);
  }

  dispose() {
    this.gl.deleteBuffer(this.buffer);
    this.gl.deleteProgram(this.program);
  }
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
  const state = { yaw: -.55, pitch: base === "tree" ? .09 : .13, lift: 0, shift: 0, light: base === "tree" ? .39 : .24, scale: 1, roll: 0 };
  const reduced = document.documentElement.classList.contains("motion-lite") ||
    matchMedia("(prefers-reduced-motion: reduce)").matches;
  let selected = codes;
  let renderer, glow, drag, frame, lastFrame;
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
    glow?.dispose();
    if (gl && !gl.isContextLost()) gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  function wake() {
    if (!frame && renderer && !signal.aborted) frame = requestAnimationFrame(draw);
  }

  function draw(now) {
    frame = undefined;
    if (!host.isConnected) return dispose();
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (!width || !height) return;
    const moving = Math.abs(targetYaw - state.yaw) + Math.abs(targetPitch - state.pitch) > .001;
    const step = moving && !reduced ? .28 : 1;
    state.yaw += (targetYaw - state.yaw) * step;
    state.pitch += (targetPitch - state.pitch) * step;
    const elapsed = reduced || !interactive ? 0 : (now / 1000) % 240;
    const lit = glow?.count > 0;
    state.auroraLight = selected.includes(LIGHT_CODES[0]) ? .92 + .12 * Math.sin(elapsed*1.8) : 0;
    state.amberLight = selected.includes(LIGHT_CODES[1]) ? 1.07 + .10 * Math.sin(elapsed*2.1) : 0;
    renderer.draw(width, height, state, Math.min(.12, (now - (lastFrame || now)) / 1000));
    lastFrame = now;
    glow?.draw(renderer,state,elapsed);
    if (interactive && (moving || lit) && !reduced && !document.hidden) wake();
  }

  function setDecorations(next) {
    selected = next;
    if (!renderer) return;
    renderer.selectBatches([base, ...new Set(selected)].flatMap(code => models.get(code)?.batches || []));
    glow?.select(selected);
    wake();
  }

  function show() {
    if (signal.aborted || !host.isConnected || !models?.has(base) || gl.isContextLost()) return;
    try {
      const bounds = models.get(base);
      renderer = new KovboxRenderer(gl, { radius: base === "tree" ? 2.99 : bounds.radius + .07, batches: [] });
      if (base === "tree") {
        try { glow = new GarlandGlow(gl); } catch (error) { console.warn("Гирлянды без свечения", error); }
      }
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
    glow = null;
    fallback();
  }, { signal });
  canvas.addEventListener("webglcontextrestored", show, { signal });
  document.addEventListener("visibilitychange", wake, { signal });

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
