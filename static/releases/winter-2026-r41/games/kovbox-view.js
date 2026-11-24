import { perspective } from "./arena-scene.js";
import { RenderBudget } from "./render-budget.js";
import { readStaticBytes } from "../startup-assets.js";

const MODELS = new Map([
  ["common", "bronze"], ["rare", "silver"], ["epic", "gold"],
  ["consolation", "bronze"], ["seasonal", "rainbow"], ["legendary", "rainbow"],
  ["winter-ice", "ice"], ["winter-seasonal", "festive"],
]);
const BASE = new URL("../media/kovboxes/", import.meta.url);
const BASE_STRIDE = 18;
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
const ease = (t) => t * t * t * (10 + t * (-15 + 6 * t));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function kovboxModelName(code) {
  return MODELS.get(code);
}

export function readMesh(buffer) {
  const data = new DataView(buffer);
  const version = data.getUint16(4, true);
  const stride = version === 3 ? 22 : BASE_STRIDE;
  if (data.getUint32(0) !== 0x4b424f58 || (version !== 2 && version !== 3)) {
    throw new Error("Invalid Kovbox mesh");
  }
  const count = data.getUint16(6, true);
  const radius = data.getFloat32(8, true);
  if (!count || !Number.isFinite(radius) || radius < .01 || radius > 4) throw new Error("Invalid Kovbox bounds");
  let offset = 12;
  const batches = [];
  for (let i = 0; i < count; i++) {
    const vertices = data.getUint32(offset, true);
    const indices = data.getUint32(offset + 4, true);
    offset += 8;
    if (!vertices || vertices > 65536 || !indices || indices % 3) throw new Error("Invalid Kovbox batch");
    const vertexBytes = new Uint8Array(buffer, offset, vertices * stride);
    offset += vertexBytes.byteLength;
    const indexBytes = new Uint8Array(buffer, offset, indices * 2);
    offset += indexBytes.byteLength;
    batches.push({ vertexBytes, indexBytes, indices, stride });
  }
  if (offset !== buffer.byteLength) throw new Error("Invalid Kovbox mesh length");
  return { batches, radius };
}

async function fetchMesh(name) {
  const compressed = typeof DecompressionStream === "function";
  const bytes = await readStaticBytes(new URL(name + (compressed ? ".bin.gz" : ".bin"), BASE));
  const buffer = compressed
    ? await new Response(new Response(bytes).body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()
    : bytes;
  return readMesh(buffer);
}

export function prepareKovboxMeshes() {
  return Promise.allSettled([...new Set(MODELS.values())].map((name) => loadMesh(name).ready));
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
  return entry;
}

export const MODEL_ROTATION_GLSL = `
mat3 modelRotation(vec4 pose) {
  float yc = cos(pose.x), ys = sin(pose.x);
  mat3 yaw = mat3(yc,0.,-ys, 0.,1.,0., ys,0.,yc);
  float pc = cos(pose.y), ps = sin(pose.y);
  mat3 pitch = mat3(1.,0.,0., 0.,pc,ps, 0.,-ps,pc);
  float rc = cos(pose.z), rs = sin(pose.z);
  mat3 roll = mat3(rc,rs,0., -rs,rc,0., 0.,0.,1.);
  return roll * pitch * yaw;
}
`;

const VERTEX = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec3 aColor;
attribute vec3 aEmission;
attribute vec3 aMaterial;
attribute vec4 aDecorLight;
uniform mat4 uProjection;
uniform vec4 uPose;
uniform vec3 uPlacement;
varying vec3 vPosition;
varying vec3 vNormal;
varying vec3 vLocal;
varying vec3 vColor;
varying vec3 vEmission;
varying vec3 vMaterial;
varying vec4 vDecorLight;
${MODEL_ROTATION_GLSL}
void main() {
  mat3 rotation = modelRotation(uPose);
  vLocal = aPosition / 8192.;
  vPosition = rotation * (vLocal * uPose.w) + vec3(uPlacement.xy, -uPlacement.z);
  vNormal = rotation * aNormal;
  vColor = aColor;
  vEmission = aEmission;
  vMaterial = aMaterial;
  vDecorLight = aDecorLight;
  gl_Position = uProjection * vec4(vPosition, 1.);
}`;

const FRAGMENT = `
precision mediump float;
uniform float uLight;
uniform float uWhiteout;
uniform float uCoreGlow;
uniform vec2 uGarlandLight;
varying vec3 vPosition;
varying vec3 vNormal;
varying vec3 vLocal;
varying vec3 vColor;
varying vec3 vEmission;
varying vec3 vMaterial;
varying vec4 vDecorLight;
// Rectangular studio lights reflected across the bevels and polished faces.
float panel(vec3 ray, vec3 direction, vec3 axis, float width, float softness) {
  float angle = dot(ray, direction);
  float edge = abs(dot(ray, axis));
  return smoothstep(.68 - softness, .94, angle) *
    (1. - smoothstep(width, width + softness, edge));
}
void main() {
  vec3 n = normalize(vNormal);
  vec3 view = normalize(-vPosition);
  vec3 base = vColor * vColor;
  float luminance = dot(base, vec3(.21,.72,.07));
  base = max(vec3(.0), mix(vec3(luminance), base, 1.20));
  float materialBits = vMaterial.z * 255.;
  float ice = step(127.5, materialBits);
  float occlusion = clamp((materialBits - ice * 128.) / 127., .13, 1.);
  vec3 ray = reflect(-view, n);
  float rough = max(.12, vMaterial.x);
  float metal = vMaterial.y;
  vec3 key = vec3(-.46,.64,.615);
  vec3 fill = vec3(.71,.26,.654);
  vec3 rim = vec3(.32,.79,-.522);
  vec3 warm = vec3(1.,.84,.64);
  vec3 cool = vec3(.61,.82,1.);
  float keyLight = max(0., dot(n, key));
  float fillLight = max(0., dot(n, fill));
  float rimLight = max(0., dot(n, rim));
  float facing = max(0., dot(n, view));
  float grazing = (1. - facing) * (1. - facing);
  float softness = .075 + rough * .38;
  float softbox = panel(ray, key, vec3(.80,.59,-.01), .23, softness);
  float strip = panel(ray, fill, vec3(.32,-.93,.02), .09, softness);
  float top = smoothstep(.39,.99,ray.y);
  float bouncePanel = panel(ray, vec3(-.74,-.46,.49), vec3(.50,-.86,-.03), .15, .19 + rough * .34);
  vec3 bounce = vec3(.16,.19,.26) + .12 * max(0., n.y);
  vec3 direct = warm * (keyLight * 1.08) + cool * (fillLight * .55 + rimLight * .30);
  vec3 diffuse = bounce * occlusion + direct * mix(.40, 1., occlusion);
  vec3 metalTint = mix(vec3(.072), mix(base, sqrt(base), .48), metal);
  vec3 fresnel = metalTint + (1. - metalTint) * (grazing * .26);
  vec3 studio = vec3(.11,.15,.23) + warm * (1.64 * softbox + .31 * top) + cool * (1.36 * strip + .52 * bouncePanel);
  vec3 color = base * diffuse * (1. - metal * .20) + fresnel * studio * mix(.25, 1., occlusion);
  color += cool * (.14 * rimLight * grazing * occlusion);
  if (ice > .5) {
    float crystal = sin(vLocal.x * 39. + vLocal.y * 12.) + sin(vLocal.y * 34. + vLocal.z * 29.);
    color += cool * smoothstep(1.46,1.91,crystal) * (.08 + grazing * .14);
  }
  vec3 strips = vEmission * vEmission;
  float saturation = max(max(base.r, base.g), base.b) - min(min(base.r, base.g), base.b);
  float inlay = smoothstep(.06,.32,saturation) * (1. - .32 * grazing);
  color += strips * (1.04 + uLight * .66 + uCoreGlow * 1.9);
  color += base * inlay * uCoreGlow * (.87 + softbox * .21);
  vec3 glow = vDecorLight.rgb * uGarlandLight.x + vDecorLight.a * vec3(1.,.56,.18) * uGarlandLight.y;
  color += glow * (vec3(.31) + sqrt(base) * .73) * (1.12 + .29 * grazing);
  color *= 1. + uLight * .23;
  vec3 film = color * (1. + color * .52) / (.87 + color * (1.22 + color * .52));
  gl_FragColor = vec4(mix(sqrt(film), vec3(.97,.992,1.), uWhiteout), 1.);
}`;

export function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  const message = gl.getShaderInfoLog(shader);
  gl.deleteShader(shader);
  throw new Error(message || "Could not compile Kovbox shader");
}

export class KovboxRenderer {
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
    this.whiteout = gl.getUniformLocation(program, "uWhiteout");
    this.coreGlow = gl.getUniformLocation(program, "uCoreGlow");
    this.garlandLight = gl.getUniformLocation(program, "uGarlandLight");
    this.decorLight = gl.getAttribLocation(program, "aDecorLight");
    this.attributes = [
      [gl.getAttribLocation(program, "aPosition"), gl.SHORT, false, 0],
      [gl.getAttribLocation(program, "aNormal"), gl.BYTE, true, 6],
      [gl.getAttribLocation(program, "aColor"), gl.UNSIGNED_BYTE, true, 9],
      [gl.getAttribLocation(program, "aEmission"), gl.UNSIGNED_BYTE, true, 12],
      [gl.getAttribLocation(program, "aMaterial"), gl.UNSIGNED_BYTE, true, 15],
    ];
    this.uploaded = new Map();
    this.selectBatches(mesh.batches);
    gl.useProgram(program);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    for (const [position] of this.attributes) gl.enableVertexAttribArray(position);
  }

  selectBatches(batches) {
    const gl = this.gl;
    this.batches = batches.map((batch) => {
      if (this.uploaded.has(batch)) return this.uploaded.get(batch);
      const { vertexBytes, indexBytes, indices, stride } = batch;
      const vertex = gl.createBuffer();
      const index = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vertex);
      gl.bufferData(gl.ARRAY_BUFFER, vertexBytes, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indexBytes, gl.STATIC_DRAW);
      const uploaded = { vertex, index, indices, stride };
      this.uploaded.set(batch, uploaded);
      return uploaded;
    });
  }

  draw(width, height, state, delta) {
    const gl = this.gl;
    gl.useProgram(this.program);
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
      this.cameraProjection = perspective(fov, aspect, .2, 60);
      gl.uniformMatrix4fv(this.projection, false, this.cameraProjection);
    }
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniform4f(this.pose, state.yaw, state.pitch, state.roll, state.scale);
    gl.uniform3f(this.placement, state.shift, state.lift, this.distance);
    gl.uniform1f(this.light, state.light);
    gl.uniform1f(this.whiteout, state.whiteout || 0);
    gl.uniform1f(this.coreGlow, state.coreGlow || 0);
    gl.uniform2f(this.garlandLight, state.auroraLight || 0, state.amberLight || 0);
    for (const [position] of this.attributes) gl.enableVertexAttribArray(position);
    for (const { vertex, index, indices, stride } of this.batches) {
      gl.bindBuffer(gl.ARRAY_BUFFER, vertex);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
      for (const [position, type, normalized, offset] of this.attributes) {
        gl.vertexAttribPointer(position, 3, type, normalized, stride, offset);
      }
      if (stride > BASE_STRIDE) {
        gl.enableVertexAttribArray(this.decorLight);
        gl.vertexAttribPointer(this.decorLight, 4, gl.UNSIGNED_BYTE, true, stride, BASE_STRIDE);
      } else {
        gl.disableVertexAttribArray(this.decorLight);
        gl.vertexAttrib4f(this.decorLight, 0, 0, 0, 0);
      }
      gl.drawElements(gl.TRIANGLES, indices, gl.UNSIGNED_SHORT, 0);
    }
  }

  dispose() {
    const gl = this.gl;
    for (const { vertex, index } of this.uploaded.values()) {
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
  const state = { ...DEFAULT_POSE, ...pose, light: interactive ? .34 : .14, coreGlow: interactive ? .48 : .42, scale: 1, roll: 0 };
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
        yaw: drag.yaw + 2.48 * Math.tanh(x * .96),
        pitch: drag.pitch + 1.65 * Math.tanh(y * 1.34),
        shift: .19 * Math.tanh(x),
        lift: -.17 * Math.tanh(y),
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
    spin(duration, kind) {
      if (!motion || signal.aborted) return wait(duration);
      const opening = kind !== "charge";
      const legendary = kind === "legendary";
      const startYaw = state.yaw;
      const startPitch = state.pitch;
      animate(duration, (t) => {
        if (legendary) {
          const progress = t ** 2.62;
          const wakeup = Math.sin(Math.PI * Math.min(t * 5, 1));
          const rise = Math.sin(t * Math.PI);
          const orbit = progress * TAU * 8.1;
          state.yaw = startYaw + orbit - wakeup * .26;
          state.pitch = startPitch + (.13 + .25 * rise) * Math.sin(orbit * .40) - wakeup * .17;
          state.roll = Math.sin(orbit * .52) * (.05 + .19 * rise);
          state.lift = rise * .35 + t * .16 - wakeup * .19;
          state.scale = 1 + .056 * rise + .053 * ease(t);
          state.light = .44 * progress + 1.24 * ease(Math.max(0, (t - .60) / .40));
          state.whiteout = ease(Math.max(0, (t - .63) / .37)) * .985;
          return;
        }
        const windup = t < .19 ? Math.sin(Math.PI * t / .19) : 0;
        const rise = Math.sin(Math.PI * t);
        const swing = Math.sin(t * TAU) * rise;
        const turn = opening ? TAU * 1.08 * ease(t) : 1.28 * rise * rise;
        state.yaw = startYaw + turn - windup * (opening ? .30 : .19);
        state.pitch = startPitch - windup * .18 + swing * (opening ? .36 : .20);
        state.roll = swing * (opening ? -.26 : -.12);
        state.lift = rise * (opening ? .23 : .10) - windup * .24;
        state.scale = 1 + rise * (opening ? .058 : .023) - windup * .035;
        state.light = opening ? ease(t) * 1.35 : rise * .33;
      });
      return wait(duration);
    },
  };
}
