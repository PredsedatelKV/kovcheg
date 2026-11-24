import { perspective } from "./arena-scene.js";
import { RenderBudget } from "./render-budget.js";

const MODELS = new Map([
  ["common", "bronze"], ["rare", "silver"], ["epic", "gold"],
  ["consolation", "bronze"], ["seasonal", "rainbow"], ["legendary", "rainbow"],
  ["winter-ice", "ice"], ["winter-seasonal", "festive"],
]);
const BASE = new URL("../media/kovboxes/", import.meta.url);
const STRIDE = 18;
const TAU = 2 * Math.PI;
const DEFAULT_POSE = { yaw: -.63, pitch: .32, shift: 0, lift: 0 };
const DRAG_AXES = ["yaw", "pitch", "shift", "lift"];

function springStep(state, target, velocity, dt) {
  const damping = 13;
  const frequency = 13;
  const decay = Math.exp(-damping * dt);
  const cos = Math.cos(frequency * dt);
  const sin = Math.sin(frequency * dt);
  let moving = false;
  for (const axis of DRAG_AXES) {
    const displacement = state[axis] - target[axis];
    const offset = (velocity[axis] + damping * displacement) / frequency;
    const next = decay * (displacement * cos + offset * sin);
    const speed = -damping * next + decay * frequency * (offset * cos - displacement * sin);
    if (Math.abs(next) < .001 && Math.abs(speed) < .01) {
      state[axis] = target[axis];
      velocity[axis] = 0;
    } else {
      state[axis] = target[axis] + next;
      velocity[axis] = speed;
      moving = true;
    }
  }
  return moving;
}

function nearestTurn(angle, current) {
  const delta = angle - current;
  return current + Math.atan2(Math.sin(delta), Math.cos(delta));
}
const cache = new Map();
const smooth = (t) => t * t * (3 - 2 * t);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function kovboxModelName(code) {
  return MODELS.get(code);
}

function readMesh(buffer) {
  const data = new DataView(buffer);
  if (data.getUint32(0) !== 0x4b424f58 || data.getUint16(4, true) !== 1) {
    throw new Error("Invalid Kovbox mesh");
  }
  const count = data.getUint16(6, true);
  const radius = data.getFloat32(8, true);
  if (!count || !Number.isFinite(radius) || radius < .5 || radius > 4) throw new Error("Invalid Kovbox bounds");
  let offset = 12;
  const batches = [];
  for (let i = 0; i < count; i++) {
    const vertices = data.getUint32(offset, true);
    const indices = data.getUint32(offset + 4, true);
    offset += 8;
    if (!vertices || vertices > 65536 || !indices || indices % 3) throw new Error("Invalid Kovbox batch");
    const vertexBytes = new Uint8Array(buffer, offset, vertices * STRIDE);
    offset += vertexBytes.byteLength;
    const indexBytes = new Uint8Array(buffer, offset, indices * 2);
    offset += indexBytes.byteLength;
    batches.push({ vertexBytes, indexBytes, indices });
  }
  if (offset !== buffer.byteLength) throw new Error("Invalid Kovbox mesh length");
  return { batches, radius };
}

async function fetchMesh(name) {
  const compressed = typeof DecompressionStream === "function";
  const response = await fetch(new URL(name + (compressed ? ".bin.gz" : ".bin"), BASE));
  if (!response.ok) throw new Error("Kovbox mesh unavailable");
  const body = compressed
    ? new Response(response.body.pipeThrough(new DecompressionStream("gzip")))
    : response;
  return readMesh(await body.arrayBuffer());
}

function loadMesh(name) {
  let entry = cache.get(name);
  cache.delete(name);
  if (!entry) {
    entry = { mesh: null };
    entry.ready = fetchMesh(name)
      .then((mesh) => (entry.mesh = mesh))
      .catch((error) => {
        if (cache.get(name) === entry) cache.delete(name);
        throw error;
      });
  }
  cache.set(name, entry);
  if (cache.size > 2) cache.delete(cache.keys().next().value);
  return entry;
}

const VERTEX = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec3 aColor;
attribute vec3 aEmission;
attribute vec3 aMaterial;
uniform mat4 uProjection;
uniform vec4 uPose;
uniform vec3 uPlacement;
varying vec3 vPosition;
varying vec3 vNormal;
varying vec3 vLocal;
varying vec3 vColor;
varying vec3 vEmission;
varying vec3 vMaterial;
void main() {
  float yc = cos(uPose.x), ys = sin(uPose.x);
  mat3 yaw = mat3(yc,0.,-ys, 0.,1.,0., ys,0.,yc);
  float pc = cos(uPose.y), ps = sin(uPose.y);
  mat3 pitch = mat3(1.,0.,0., 0.,pc,ps, 0.,-ps,pc);
  float rc = cos(uPose.z), rs = sin(uPose.z);
  mat3 roll = mat3(rc,rs,0., -rs,rc,0., 0.,0.,1.);
  mat3 rotation = roll * pitch * yaw;
  vLocal = aPosition / 8192.;
  vPosition = rotation * (vLocal * uPose.w) + vec3(uPlacement.xy, -uPlacement.z);
  vNormal = rotation * aNormal;
  vColor = aColor;
  vEmission = aEmission;
  vMaterial = aMaterial;
  gl_Position = uProjection * vec4(vPosition, 1.);
}`;

const FRAGMENT = `
precision mediump float;
uniform float uLight;
varying vec3 vPosition;
varying vec3 vNormal;
varying vec3 vLocal;
varying vec3 vColor;
varying vec3 vEmission;
varying vec3 vMaterial;
void main() {
  vec3 n = normalize(vNormal);
  vec3 view = normalize(-vPosition);
  vec3 base = vColor * vColor;
  vec3 reflection = reflect(-view, n);
  float rough = max(.12, vMaterial.x);
  float metal = vMaterial.y;
  vec3 key = vec3(-.48,.69,.54);
  vec3 fill = vec3(.68,-.44,.59);
  float facing = max(0., dot(n, view));
  float bounce = .19 + .11 * (.5 + n.y * .5);
  float diffuse = bounce + .69 * max(0., dot(n, key)) + .19 * max(0., dot(n, fill));
  float softbox = pow(max(0., dot(reflection, key)), mix(28.,7.,rough));
  float strip = pow(max(0., dot(reflection, fill)), mix(24.,6.,rough));
  float edge = (1. - facing) * (1. - facing);
  float studio = .09 * smoothstep(-.24,.75,reflection.y);
  vec3 sheen = mix(vec3(.130,.143,.169), .19 + base * .75, metal);
  vec3 color = base * diffuse * (1. - metal * .18);
  color += sheen * (.96 * softbox * vec3(1.0,.88,.74) + .57 * strip * vec3(.66,.82,1.0) + edge * .22 + studio);
  if (vMaterial.z > .002) {
    float crystal = sin(vLocal.x * 39. + vLocal.y * 12.) + sin(vLocal.y * 34. + vLocal.z * 29.);
    color *= 1. + smoothstep(1.42,1.9,crystal) * .28;
  }
  color += vEmission * vEmission * (.85 + uLight);
  color *= 1. + uLight * .31;
  gl_FragColor = vec4(sqrt(color / (.91 + color * .47)), 1.);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  const message = gl.getShaderInfoLog(shader);
  gl.deleteShader(shader);
  throw new Error(message || "Could not compile Kovbox shader");
}

class KovboxRenderer {
  constructor(gl, mesh) {
    this.gl = gl;
    this.radius = mesh.radius;
    this.budget = new RenderBudget(matchMedia("(pointer: coarse)").matches ||
      Boolean(document.documentElement.dataset.kovTelegram));
    const program = gl.createProgram();
    const shaders = [];
    try {
      shaders.push(compile(gl, gl.VERTEX_SHADER, VERTEX));
      shaders.push(compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
      for (const shader of shaders) gl.attachShader(program, shader);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("Could not prepare Kovbox shading");
    } catch (error) {
      gl.deleteProgram(program);
      throw error;
    } finally {
      for (const shader of shaders) gl.deleteShader(shader);
    }
    this.program = program;
    this.projection = gl.getUniformLocation(program, "uProjection");
    this.pose = gl.getUniformLocation(program, "uPose");
    this.placement = gl.getUniformLocation(program, "uPlacement");
    this.light = gl.getUniformLocation(program, "uLight");
    this.attributes = [
      [gl.getAttribLocation(program, "aPosition"), gl.SHORT, false, 0],
      [gl.getAttribLocation(program, "aNormal"), gl.BYTE, true, 6],
      [gl.getAttribLocation(program, "aColor"), gl.UNSIGNED_BYTE, true, 9],
      [gl.getAttribLocation(program, "aEmission"), gl.UNSIGNED_BYTE, true, 12],
      [gl.getAttribLocation(program, "aMaterial"), gl.UNSIGNED_BYTE, true, 15],
    ];
    this.batches = mesh.batches.map(({ vertexBytes, indexBytes, indices }) => {
      const vertex = gl.createBuffer();
      const index = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vertex);
      gl.bufferData(gl.ARRAY_BUFFER, vertexBytes, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indexBytes, gl.STATIC_DRAW);
      return { vertex, index, indices };
    });
    gl.useProgram(program);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    for (const [position] of this.attributes) gl.enableVertexAttribArray(position);
  }

  draw(width, height, state, delta) {
    const gl = this.gl;
    const changed = this.budget.observe(delta, delta < .05);
    if (changed || width !== this.width || height !== this.height) {
      this.width = width;
      this.height = height;
      const ratio = this.budget.ratio(width, height, devicePixelRatio, 1.8, 510000);
      gl.canvas.width = Math.max(1, Math.round(width * ratio));
      gl.canvas.height = Math.max(1, Math.round(height * ratio));
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      const fov = .43;
      const aspect = width / height;
      const fill = .97 * Math.min(1, aspect);
      this.distance = this.radius / Math.sin(Math.atan(Math.tan(fov / 2) * fill));
      gl.uniformMatrix4fv(this.projection, false, perspective(fov, aspect, .2, 60));
    }
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniform4f(this.pose, state.yaw, state.pitch, state.roll, state.scale);
    gl.uniform3f(this.placement, state.shift, state.lift, this.distance);
    gl.uniform1f(this.light, state.light);
    for (const { vertex, index, indices } of this.batches) {
      gl.bindBuffer(gl.ARRAY_BUFFER, vertex);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
      for (const [position, type, normalized, offset] of this.attributes) {
        gl.vertexAttribPointer(position, 3, type, normalized, STRIDE, offset);
      }
      gl.drawElements(gl.TRIANGLES, indices, gl.UNSIGNED_SHORT, 0);
    }
  }

  dispose() {
    const gl = this.gl;
    for (const { vertex, index } of this.batches) {
      gl.deleteBuffer(vertex);
      gl.deleteBuffer(index);
    }
    gl.deleteProgram(this.program);
  }
}

// One view per open card or stage. Geometry is uploaded once and reused for
// every angle. With the box at rest the viewer does not schedule frames.
export function mountKovboxView(host, { code, pose, interactive = false, reduceMotion = false } = {}) {
  const name = kovboxModelName(code);
  if (!name) return null;
  const motion = !reduceMotion && !matchMedia("(prefers-reduced-motion: reduce)").matches;
  host.dataset.model = name;
  const poster = host.querySelector("img");
  const previousImage = poster?.getAttribute("src");
  if (poster) {
    poster.addEventListener("error", () => {
      if (previousImage) poster.src = previousImage;
    }, { once: true });
    poster.src = new URL(name + "-still.webp", BASE).href;
    poster.draggable = false;
  }
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  host.append(canvas);
  const gl = canvas.getContext("webgl", { alpha: true, antialias: true, powerPreference: "default" });
  if (!gl) return null;

  const listeners = new AbortController();
  const { signal } = listeners;
  const state = { ...DEFAULT_POSE, ...pose, light: 0, scale: 1, roll: 0 };
  const velocity = { yaw: 0, pitch: 0, shift: 0, lift: 0 };
  let renderer, mesh, frame, animation, lastFrame, drag, target;
  let width = host.clientWidth;
  let height = host.clientHeight;
  let live = false;
  const resize = new ResizeObserver(([entry]) => {
    width = entry.contentRect.width;
    height = entry.contentRect.height;
    wake();
  });
  const surface = host.closest(".modal-overlay, .lootbox-chest-overlay") || host;
  const disconnect = new MutationObserver(() => {
    if (!host.isConnected) dispose();
  });
  disconnect.observe(surface.parentNode, { childList: true });

  function wake() {
    if (renderer && !frame && !signal.aborted) frame = requestAnimationFrame(draw);
  }

  function draw(now) {
    frame = 0;
    if (!host.isConnected) return dispose();
    if (!width || !height) return;
    const delta = (now - (lastFrame || now)) / 1000;
    if (target && !springStep(state, target, velocity, Math.min(delta || .016, .05))) target = null;
    if (animation) {
      const progress = Math.min(1, Math.max(0, (now - animation.start) / animation.duration));
      animation.update(progress);
      if (progress === 1) animation = null;
    }
    renderer.draw(width, height, state, delta);
    lastFrame = now;
    if (!live) {
      live = true;
      host.classList.add("is-live");
      if (interactive) host.tabIndex = 0;
    }
    if (animation || target) wake();
  }

  function animate(duration, update) {
    target = null;
    animation = { start: performance.now(), duration, update };
    wake();
  }

  function drift(yaw, pitch, duration) {
    const fromYaw = state.yaw;
    const fromPitch = state.pitch;
    animate(duration, (t) => {
      const eased = 1 - (1 - t) ** 3;
      state.yaw = fromYaw + yaw * eased;
      state.pitch = fromPitch + pitch * eased;
    });
  }

  function dispose() {
    if (signal.aborted) return;
    listeners.abort();
    cancelAnimationFrame(frame);
    resize.disconnect();
    disconnect.disconnect();
    renderer?.dispose();
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  function initialise() {
    if (!mesh || signal.aborted || gl.isContextLost()) return;
    try {
      renderer = new KovboxRenderer(gl, mesh);
      wake();
    } catch (error) {
      console.warn("Не удалось показать 3D-ковбокс", error);
      dispose();
    }
  }
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    cancelAnimationFrame(frame);
    frame = 0;
    live = false;
    renderer = null;
    host.classList.remove("is-live");
    host.removeAttribute("tabindex");
  }, { signal });
  canvas.addEventListener("webglcontextrestored", initialise, { signal });
  resize.observe(host);

  if (interactive) {
    host.addEventListener("pointerdown", (event) => {
      if (!live || !event.isPrimary || event.button !== 0) return;
      animation = null;
      target = null;
      for (const axis of DRAG_AXES) velocity[axis] = 0;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, yaw: state.yaw, pitch: state.pitch };
      host.setPointerCapture(event.pointerId);
      host.classList.add("is-dragging");
    }, { signal });

    host.addEventListener("pointermove", (event) => {
      if (drag?.id !== event.pointerId) return;
      const size = Math.max(135, Math.min(width, height));
      const x = (event.clientX - drag.x) / size;
      const y = (event.clientY - drag.y) / size;
      const next = {
        yaw: drag.yaw + x * 4.3,
        pitch: drag.pitch + y * 3.8,
        shift: Math.tanh(x * 1.5) * .26,
        lift: -Math.tanh(y * 1.5) * .22,
      };
      if (motion) target = next;
      else Object.assign(state, next);
      wake();
    }, { signal });

    function endDrag(event) {
      if (drag?.id !== event.pointerId) return;
      drag = null;
      host.classList.remove("is-dragging");
      const rest = {
        ...DEFAULT_POSE,
        yaw: nearestTurn(DEFAULT_POSE.yaw, state.yaw),
        pitch: nearestTurn(DEFAULT_POSE.pitch, state.pitch),
      };
      if (motion) target = rest;
      else Object.assign(state, rest);
      wake();
    }
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      host.addEventListener(type, endDrag, { signal });
    }
    host.addEventListener("keydown", (event) => {
      const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const direction = directions[event.key];
      if (!live || !direction) return;
      event.preventDefault();
      drift(direction[0] * .33, direction[1] * .33, motion ? 190 : 1);
    }, { signal });
  }

  function setMesh(loaded) {
    if (!host.isConnected || signal.aborted) return;
    mesh = loaded;
    initialise();
    if (interactive && motion && !drag) {
      state.yaw -= .22;
      state.pitch += .06;
      target = DEFAULT_POSE;
    }
  }
  const entry = loadMesh(name);
  if (entry.mesh) setMesh(entry.mesh);
  else entry.ready.then(setMesh).catch((error) => {
    if (signal.aborted) return;
    console.warn("Не удалось загрузить модель ковбокса", error);
    dispose();
  });

  return {
    pose: () => ({ yaw: state.yaw % TAU, pitch: state.pitch % TAU }),
    dispose,
    spin(duration, opening) {
      if (!motion || signal.aborted) return wait(duration);
      const startYaw = state.yaw;
      const startPitch = state.pitch;
      animate(duration, (t) => {
        const travel = smooth(Math.max(0, (t - .11) / .89));
        const anticipation = t < .21 ? Math.sin(Math.PI * t / .21) * (1 - travel) : 0;
        const rise = Math.sin(Math.PI * t);
        state.yaw = startYaw + TAU * (opening ? 1.65 : 1) * travel - anticipation * .16;
        state.pitch = startPitch + Math.sin(t * TAU) * (opening ? .36 : .16);
        state.roll = Math.sin(t * TAU) * (opening ? .15 : .08);
        state.lift = rise * (opening ? .24 : .075) - anticipation * .09;
        state.scale = 1 + rise * (opening ? .045 : .025);
        state.light = rise * (opening ? .66 : .28);
      });
      return wait(duration);
    },
  };
}
