const WHEEL_LABELS = ["10", "20", "30", "40", "50", "100", "200", "500", "1 000"];
const SLICE = 360 / WHEEL_LABELS.length;
const PIPS = [[], [4], [0,8], [0,4,8], [0,2,6,8], [0,2,4,6,8], [0,2,3,5,6,8]];
const FACES = [[0,0], [-90,0], [0,-90], [0,90], [90,0], [0,180]];
const STARS = Array.from({length:32}, (_, index) => [(index * 137 + 43) % 811, (index * 53 + 17) % 297, .7 + index % 4 * .4]);
const flights = new WeakMap();

export const dieFace = (value) => PIPS[value].map((pip) => '<i style="grid-column:' + (pip % 3 + 1) +
  ';grid-row:' + (Math.floor(pip / 3) + 1) + '"></i>').join("");
export const multiplier = (value) => "×" + Number(value).toFixed(2).replace(".", ",");

export function wheelBoard() {
  return '<div class="casino-wheel"><canvas width="660" height="660" role="img" aria-label="Колесо рулетки"></canvas>' +
    '<i class="casino-pointer" aria-hidden="true"></i></div>';
}

export function paintWheel(board, selected = -1, won = false) {
  const canvas = board.querySelector("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const center = canvas.width / 2;
  const step = 2 * Math.PI / WHEEL_LABELS.length;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.translate(center, center);
  const brass = ctx.createLinearGradient(-250, -240, 250, 290);
  brass.addColorStop(0, "#825627");
  brass.addColorStop(.28, "#f4deaa");
  brass.addColorStop(.55, "#9b723d");
  brass.addColorStop(.78, "#e7c992");
  brass.addColorStop(1, "#80582f");
  function circle(radius, fill) {
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  }
  circle(326, brass);
  circle(308, "#14231e");
  WHEEL_LABELS.forEach((label, index) => {
    const angle = -Math.PI / 2 + index * step;
    const active = index === selected;
    const sector = ctx.createRadialGradient(0, 0, 85, 0, 0, 294);
    sector.addColorStop(0, active && won ? "#2b7657" : "#10241d");
    sector.addColorStop(1, active ? (won ? "#a5efb8" : "#55836d") :
      ["#307052", "#1d4337", "#235b47"][index % 3]);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 292, angle - step / 2, angle + step / 2);
    ctx.closePath();
    ctx.fillStyle = sector;
    ctx.fill();
    ctx.strokeStyle = active && won ? "#d4ffd8" : "#cda87985";
    ctx.lineWidth = active && won ? 4 : 2;
    ctx.stroke();

    ctx.save();
    ctx.rotate(index * step);
    ctx.fillStyle = active && won ? "#163828" : "#fff5dd";
    ctx.font = "bold " + (label.length > 4 ? 30 : 37) + "px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 0, -222);
    ctx.rotate(step / 2);
    ctx.fillStyle = "#f5db9e";
    ctx.beginPath();
    ctx.arc(0, -317, 3.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
  circle(88, brass);
  circle(74, "#183d31");
  circle(61, "#19382f");
  ctx.font = "47px Georgia";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#f9dfad";
  ctx.fillText("♠", 0, 2);
}

function latePegTimes(start, travel) {
  const timing = [];
  const cubic = (t, a, b) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3;
  // Convert actual peg crossings to time using the wheel animation's easing.
  const last = Math.floor((start + travel - SLICE / 2) / SLICE);
  for (let peg = last - 6; peg <= last; peg += 1) {
    const fraction = ((peg + .5) * SLICE - start) / travel;
    let left = 0;
    let right = 1;
    for (let step = 0; step < 16; step += 1) {
      const t = (left + right) / 2;
      if (cubic(t, .63, 1) < fraction) left = t;
      else right = t;
    }
    const time = cubic((left + right) / 2, .13, .16);
    if (time > .5 && time - (timing.at(-1) ?? 0) >= .05) timing.push(time);
  }
  return timing;
}

export async function spinWheel(board, index, animate, sound) {
  const canvas = board.querySelector("canvas");
  const pointer = board.querySelector(".casino-pointer");
  const start = Number(board.dataset.angle || 0);
  const target = (360 - index * SLICE) % 360;
  const travel = 5 * 360 + (target - start % 360 + 360) % 360;
  const span = 3840;
  const angle = (value) => "rotate(" + value + "deg)";
  paintWheel(board);
  if (animate && canvas.animate) {
    board.dataset.spinning = "";
    const animation = canvas.animate([
      {transform:angle(start)},
      {transform:angle(start + travel)},
    ], {duration:span, easing:"cubic-bezier(.13,.63,.16,1)", fill:"forwards"});
    sound.play("roulette-roll", {duration:span / 1000, level:.72});
    // At speed the pegs blend into the rolling sound. Only the final nudges are audible.
    const nudges = latePegTimes(start, travel);
    const pointerFrames = nudges.flatMap((offset) => [
      {transform:"rotate(0deg)", offset:offset - .014},
      {transform:"rotate(-13deg)", offset},
      {transform:"rotate(0deg)", offset:offset + .025},
    ]);
    if (pointerFrames.length) pointer.animate(pointerFrames, {duration:span});
    nudges.forEach((time, number) => sound.play("roulette-peg", {delay:time * span / 1000, level:.30 + .07 * number}));
    await animation.finished.catch(() => {});
    canvas.style.transform = angle(target);
    animation.cancel();
    delete board.dataset.spinning;
  } else canvas.style.transform = angle(target);
  board.dataset.angle = String(target);
  paintWheel(board, index);
  canvas.setAttribute("aria-label", "Выпал сектор " + WHEEL_LABELS[index]);
}

export function diceBoard() {
  return '<div class="casino-dice-tray"><span class="dice-ripple" aria-hidden="true"></span>' +
    '<div class="dice-toss"><div class="dice-cube" role="img" aria-label="Кубик">' +
    FACES.map((_, index) => '<span class="dice-face" data-face="' + (index + 1) + '" aria-hidden="true">' +
      dieFace(index + 1) + '</span>').join("") + '</div></div></div>';
}

function orientation(pose, turns = 0) {
  const [x, y] = pose;
  return "rotateX(" + (x + 360 * turns) + "deg) rotateY(" + (y + 360 * turns) + "deg)";
}

export async function rollDice(board, roll, animate, sound) {
  const toss = board.querySelector(".dice-toss");
  const cube = board.querySelector(".dice-cube");
  const previous = FACES[Number(board.dataset.roll || 1) - 1];
  const final = FACES[roll - 1];
  cube.setAttribute("aria-label", animate ? "Кубик в движении" : "Кубик");
  if (animate && toss.animate) {
    sound.play("dice-roll", {level:.82});
    sound.play("dice-land", {delay:1.03, level:.84});
    board.dataset.rolling = "";
    const arc = toss.animate([
      {transform:"translate(-61%, 17%) scale(.83)", easing:"cubic-bezier(.25,.66,.31,1)"},
      {transform:"translate(47%, -66%) scale(1.03)", offset:.38, easing:"cubic-bezier(.42,0,.65,.95)"},
      {transform:"translate(13%, 14%) scale(1)", offset:.73, easing:"ease-out"},
      {transform:"translate(5%, -12%) scale(1)", offset:.86, easing:"ease-in"},
      {transform:"translate(0, 0) scale(1) rotateX(-8deg) rotateY(12deg)"},
    ], {duration:1240});
    const twist = cube.animate([
      {transform:orientation(previous)},
      {transform:orientation(final, 2)},
    ], {duration:1240, easing:"cubic-bezier(.17,.55,.26,1)", fill:"forwards"});
    await arc.finished.catch(() => {});
    cube.style.transform = orientation(final);
    twist.cancel();
    delete board.dataset.rolling;
  } else {
    cube.style.transform = orientation(final);
    sound.play("dice-land", {level:.69});
  }
  board.dataset.roll = String(roll);
  cube.setAttribute("aria-label", "Выпало " + roll);
}

export function flightBoard(rocket) {
  return '<div class="casino-flight"><canvas width="840" height="380" aria-hidden="true"></canvas>' +
    '<span class="flight-pulse" aria-hidden="true"></span><span class="casino-flight-rocket" aria-hidden="true">' + rocket +
    '</span><strong data-multiplier>×1,00</strong></div>';
}

export function paintFlight(board, value, crashed = false, animate = false) {
  const canvas = board.querySelector("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const previous = flights.get(board);
  const state = {value, frame:null};
  flights.set(board, state);
  if (previous?.frame != null) cancelAnimationFrame(previous.frame);
  board.classList.toggle("is-crashed", crashed);
  if (animate && !crashed && previous && value > previous.value) {
    const start = performance.now();
    function advance(now) {
      if (!board.isConnected || flights.get(board) !== state) return;
      const progress = Math.min(1, (now - start) / 230);
      state.value = previous.value + (value - previous.value) * progress;
      flightFrame(board, ctx, canvas, state.value, false);
      state.frame = progress < 1 ? requestAnimationFrame(advance) : null;
    }
    state.value = previous.value;
    state.frame = requestAnimationFrame(advance);
  } else flightFrame(board, ctx, canvas, value, crashed);
}

function flightFrame(board, ctx, canvas, value, crashed) {
  const {width, height} = canvas;
  const fraction = Math.max(0, Math.min(1, (value - 1) / 4));
  const originX = 94;
  const originY = height - 51;
  const x = originX + (width - originX - 67) * Math.sqrt(fraction);
  const y = originY - (height - 123) * fraction;
  ctx.clearRect(0, 0, width, height);
  for (const [starX, starY, size] of STARS) {
    ctx.fillStyle = size > 1.5 ? "#b9e5ff8f" : "#86c4ff4e";
    ctx.beginPath();
    ctx.arc(starX, starY, size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = "#759ec447";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(43, originY + 12);
  ctx.lineTo(140, originY + 12);
  ctx.stroke();

  if (fraction > 0) {
    ctx.beginPath();
    ctx.moveTo(originX, originY);
    ctx.quadraticCurveTo(originX + (x - originX) * .64, originY, x, y);
    const tail = ctx.createLinearGradient(originX, originY, x, y);
    tail.addColorStop(0, "#5f95dc35");
    tail.addColorStop(1, crashed ? "#ee9b9c" : "#adf3ff");
    ctx.strokeStyle = crashed ? "#cc697153" : "#589bff50";
    ctx.lineWidth = 16;
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.strokeStyle = tail;
    ctx.lineWidth = 4;
    ctx.stroke();
  }
  board.style.setProperty("--flight-x", 100 * x / width + "%");
  board.style.setProperty("--flight-y", 100 * y / height + "%");
  board.querySelector("[data-multiplier]").textContent = multiplier(value);
}
