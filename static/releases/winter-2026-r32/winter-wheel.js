const original = new URL("./media/wheel-original.png", import.meta.url).pathname;
const sectors = [
  ["#d5f1ff", "#82b9de"], ["#d8f4e8", "#87bcaa"], ["#ffe7b4", "#e7ae73"],
  ["#ffc5bc", "#e8847d"], ["#edc6e2", "#c68ebd"], ["#dcd0fc", "#9f8bc5"],
  ["#c4d6fd", "#849bce"], ["#c4d1f0", "#7385b4"],
];

// All layers share the original 1254px canvas. No independent image scaling.
// The painted rim is slightly asymmetric, so trace its aperture instead of
// erasing it with a circle. The rotor itself turns about the medallion axis.
const CX = 624;
const CY = 605.5;
const R = 480;
const aperture = "M624 151 C874 151 1077 352 1077 605 C1077 858 876 1069 624 1069 C367 1069 159 859 159 605 C159 354 367 151 624 151Z";
const needle = "M541 24H712V52L643 189Q628 208 614 190L541 54Z";
const ribbon = "M442 1094L467 1050Q493 1019 535 1036Q568 1047 595 1068L649 1068Q679 1049 704 1039Q749 1022 779 1048L806 1099V1254H442Z";
let instance = 0;

export function wheelMarkup(count) {
  count = Number.isInteger(count) && count > 0 ? count : 1;
  const key = "winter-wheel-" + (++instance);
  const arc = (angle) => [
    CX + R * Math.sin(angle),
    CY - R * Math.cos(angle),
  ].map((n) => n.toFixed(3)).join(",");
  const step = 2 * Math.PI / count;
  const fills = sectors.map(([highlight, shade], i) =>
    `<radialGradient id="${key}-ink-${i}" cx="39%" cy="34%" r="78%">
      <stop stop-color="${highlight}"/><stop offset="1" stop-color="${shade}"/>
    </radialGradient>`,
  ).join("");
  const slices = Array.from({ length: count }, (_, i) => count === 1
    ? `<circle cx="${CX}" cy="${CY}" r="${R}" fill="url(#${key}-ink-0)"/>`
    : `<path d="M${CX},${CY} L${arc(i * step)} A${R},${R} 0 0 1 ${arc((i + 1) * step)} Z"
        fill="url(#${key}-ink-${i % sectors.length})" stroke="#fff5eb" stroke-width="3.25"/>`
  ).join("");
  return `<div class="winter-wheel-art" aria-hidden="true">
    <svg class="winter-wheel-scene" viewBox="0 0 1254 1254" focusable="false">
      <defs>
        ${fills}
        <clipPath id="${key}-aperture"><path d="${aperture}" transform="translate(624 605.5) scale(1.008) translate(-624 -605.5)"/></clipPath>
        <clipPath id="${key}-hub"><circle cx="${CX}" cy="${CY}" r="94.2"/></clipPath>
        <radialGradient id="${key}-hub-rim">
          <stop offset=".96" stop-color="#bdc6dd"/><stop offset="1" stop-color="#7d8ba8"/>
        </radialGradient>
        <mask id="${key}-frame" maskUnits="userSpaceOnUse" x="0" y="0" width="1254" height="1254" style="mask-type:luminance">
          <rect width="1254" height="1254" fill="white"/>
          <path d="${aperture}" fill="black" stroke="black" stroke-width="2"/>
          <path d="${needle}" fill="white"/>
          <path d="${ribbon}" fill="white"/>
        </mask>
      </defs>
      <g clip-path="url(#${key}-aperture)">
        <g class="winter-wheel-rotor">${slices}</g>
      </g>
      <image class="winter-wheel-frame" href="${original}" width="1254" height="1254" mask="url(#${key}-frame)"/>
      <circle cx="${CX}" cy="${CY}" r="95.3" fill="url(#${key}-hub-rim)"/>
      <image class="winter-wheel-hub" href="${original}" width="1254" height="1254" clip-path="url(#${key}-hub)"/>
    </svg>
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
