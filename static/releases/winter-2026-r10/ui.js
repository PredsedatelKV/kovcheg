const iconRoot = new URL("./media/", import.meta.url).pathname;
const iconNames = new Set(["mark","home","arcade","koverna","battlepass","profile","chat","menu","gift","wheel","news","arrow","back","settings","telegram","snow","coin","snowflake","xp","book","scales","admin"]);
export const icon = (name) => '<img class="ui-icon" src="' + iconRoot + (iconNames.has(name) ? name : "mark") + '.png" alt="" aria-hidden="true" draggable="false">';
export const escapeText = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const sectionIntro = (name, title, description, symbol = name) => '<section class="page-header winter-intro ' + name + '-intro"><div><h1>' + title + '</h1><p class="subtitle">' + description + '</p></div><div class="intro-art">' + icon(symbol) + '</div></section>';
