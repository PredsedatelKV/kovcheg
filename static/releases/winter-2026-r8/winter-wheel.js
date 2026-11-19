const wreath = new URL("./media/wheel.webp", import.meta.url).pathname;
const sectors = [
  ["#d5f1ff", "#82b9de"], ["#d8f4e8", "#87bcaa"], ["#ffe7b4", "#e7ae73"],
  ["#ffc5bc", "#e8847d"], ["#edc6e2", "#c68ebd"], ["#dcd0fc", "#9f8bc5"],
  ["#c4d6fd", "#849bce"], ["#c4d1f0", "#7385b4"],
];

export function wheelMarkup(count) {
  const radius = 465;
  const center = radius;
  const arc = (angle) => [
    center + radius * Math.sin(angle),
    center - radius * Math.cos(angle),
  ].map((n) => n.toFixed(3)).join(",");
  const step = 2 * Math.PI / count;
  const fills = sectors.map(([highlight, shade], i) =>
    `<radialGradient id="wheel-ink-${i}" cx="39%" cy="34%" r="78%">
      <stop stop-color="${highlight}"/><stop offset="1" stop-color="${shade}"/>
    </radialGradient>`,
  ).join("");
  const slices = Array.from({ length: count }, (_, i) => count === 1
    ? `<circle cx="${center}" cy="${center}" r="${radius}" fill="url(#wheel-ink-0)"/>`
    : `<path d="M${center},${center} L${arc(i * step)} A${radius},${radius} 0 0 1 ${arc((i + 1) * step)} Z"
        fill="url(#wheel-ink-${i % sectors.length})" stroke="#fff5eb" stroke-width="3.25"/>`
  ).join("");

  return `<div class="winter-wheel-art" aria-hidden="true">
    <svg class="winter-wheel-rotor" viewBox="0 0 930 930" focusable="false">
      <defs>${fills}</defs>${slices}
    </svg>
    <img class="winter-wheel-wreath" src="${wreath}" alt="" decoding="async">
  </div>`;
}

export function rotateWheel(el, index, count) {
  const reduced = document.documentElement.classList.contains("motion-lite") ||
    matchMedia("(prefers-reduced-motion: reduce)").matches;
  const previous = Number(el.dataset.rotation || 0);
  const stop = (360 - (index + 0.5) * (360 / count)) % 360;
  const current = previous % 360;
  const next = previous + 5 * 360 + ((stop + 360 - current) % 360);
  const time = reduced ? 0 : 3750;
  el.style.transition = time ? "transform 3.75s cubic-bezier(.14,.73,.15,1)" : "none";
  el.style.transform = "rotate(" + next + "deg)";
  el.dataset.rotation = String(next);
  return new Promise(resolve => setTimeout(resolve, time + 32));
}
