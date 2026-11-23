export const TREE_SLOTS = ["tree_garland", "tree_toys", "tree_snow", "tree_gifts"];
export const TREE_LABELS = {tree_garland:"Гирлянды", tree_toys:"Игрушки", tree_snow:"Снег", tree_gifts:"Подарки"};
const tree = new URL("../media/tree.webp", import.meta.url).pathname;

export function renderTree(loadout = {}) {
  const lamps = [[86,76],[111,85],[124,106],[86,117],[63,132],[93,145],[131,152],[145,173],[112,185],[71,189]];
  const colors = ["#ffe19b","#f4a8ac","#a8d8ff","#b4eed8"];
  const lights = loadout.tree_garland ? `
    <path d="M82 71Q139 94 98 110T66 136Q74 151 133 152T129 181Q106 198 66 188"
      stroke="#d4c48b" stroke-width="1.4" fill="none"/>
    ${lamps.map(([x,y],i)=>`<circle class="tree-lamp" cx="${x}" cy="${y}" r="2.7" fill="${colors[i%4]}" style="--light:${colors[i%4]}"/>`).join("")}` : "";
  const toys = loadout.tree_toys ? [[98,61],[83,94],[119,126],[72,162],[111,170],[141,191]].map(([x,y],i)=>`
    <path d="M${x} ${y-6}v5" stroke="#c2dfef" stroke-width="1"/>
    <circle cx="${x}" cy="${y}" r="5" fill="${i%2?"#72b0db":"#d9eaff"}" stroke="#fff" stroke-width=".8"/>
    <circle cx="${x-1.5}" cy="${y-2}" r="1.2" fill="white"/>`).join("") : "";
  const snow = loadout.tree_snow ? `<g fill="none" stroke="#f7fcff" stroke-width="5" stroke-linecap="round">
    <path d="M90 60q8 6 20 2M73 105q10 9 25 3M113 128q12 6 20 0M56 166q11 7 27 1M125 185q15 5 27-2"/>
    </g>` : "";
  const gifts = loadout.tree_gifts ? `<g stroke-width="1.2" stroke-linejoin="round">
    <path d="M45 211h33v23H45z" fill="#87bfe3" stroke="#deeffb"/><path d="M59 211h5v23h-5z" fill="#edf9ff"/>
    <path d="M121 210h29v26h-29z" fill="#c77582" stroke="#ffced3"/><path d="M133 210h5v26h-5z" fill="#ffe4a6"/>
    <path d="M81 221h26v18H81z" fill="#96cab5" stroke="#e8fff2"/><path d="M91 221h5v18h-5z" fill="#fff4ce"/>
    <path d="M134 210q-16-10-12-12t14 12q10-16 14-12t-14 12M60 211q-16-13-14-15t16 15q13-17 16-13t-16 13" stroke="#f2e2ac" fill="none"/>
    </g>` : "";
  return `<svg class="custom-tree" viewBox="0 0 200 250" role="img" aria-label="Ваша ёлочка">
    <image href="${tree}" x="0" y="0" width="200" height="250" preserveAspectRatio="xMidYMax meet"/>
    ${lights}${toys}${snow}${gifts}
  </svg>`;
}
