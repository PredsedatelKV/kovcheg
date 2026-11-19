const wreath = new URL("./media/wheel.webp", import.meta.url).pathname;
const colors = ["#b3d9ef","#b9dfd5","#f2d49c","#efa99f","#dfbadc","#bcb3e5","#a6b9ef","#8fa6ce","#b7cef7"];
export const wheelMarkup = (count) => {
  const arc = (angle) => {
    const radians = (angle - Math.PI / 2);
    return (180 + 158 * Math.cos(radians)).toFixed(2) + "," + (180 + 158 * Math.sin(radians)).toFixed(2);
  };
  const slices = Array.from({length:count},(_,i) => {
    const step = 2 * Math.PI / count;
    return count === 1 ? '<circle cx="180" cy="180" r="158" fill="' + colors[0] + '"/>'
      : '<path d="M180,180 L' + arc(i*step) + ' A158,158 0 0 1 ' + arc((i+1)*step) +
        ' Z" fill="' + colors[i%colors.length] + '" stroke="#ffffffdc" stroke-width="2.5"/>';
  }).join("");
  return '<div class="winter-wheel-art" aria-hidden="true"><img class="winter-wheel-wreath" src="' +
    wreath + '" alt=""><svg class="winter-wheel-rotor" viewBox="0 0 360 360" focusable="false">' +
    slices + '</svg><i class="winter-wheel-needle"></i><i class="winter-wheel-hub">❄</i></div>';
};

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
