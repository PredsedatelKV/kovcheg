const paths = {
  mark: '<path d="m12 2 9 5v10l-9 5-9-5V7l9-5Z"/><path d="m3 7 9 5 9-5M12 12v10M7.5 4.5l9 5"/>',
  home: '<path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M9 21v-7h6v7"/>',
  arcade: '<path d="M7 7h10a4 4 0 0 1 4 3.4l1 5a2.8 2.8 0 0 1-4.6 2.7L15 16H9l-2.4 2.1A2.8 2.8 0 0 1 2 15.4l1-5A4 4 0 0 1 7 7Z"/><path d="M8 10v4m-2-2h4m5 0h.01m3 1h.01"/>',
  koverna: '<path d="M4 9v11h16V9M3 9l2-5h14l2 5M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M10 20v-5h4v5"/>',
  battlepass: '<path d="M5 3h14v17l-7-4-7 4Z"/><path d="m12 6 .9 2.1 2.1.2-1.6 1.5.4 2.2-1.8-1.1-1.8 1.1.4-2.2L9 8.3l2.1-.2Z"/>',
  profile: '<circle cx="12" cy="8" r="3.5"/><path d="M4.5 21v-1.5a5 5 0 0 1 5-5h5a5 5 0 0 1 5 5V21"/>',
  chat: '<path d="M20 11a8 8 0 0 1-8 8H5l1.4-3A8 8 0 1 1 20 11Z"/><path d="M8.5 11h.01m3.5 0h.01m3.5 0h.01"/>',
  menu: '<path d="M5 6h14M5 12h14M5 18h14"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v8h14v-8m-7-4v12m0-12H8a2 2 0 1 1 2-2l2 2Zm0 0h4a2 2 0 1 0-2-2l-2 2Z"/>',
  wheel: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/><path d="M12 4v6m0 4v6M4 12h6m4 0h6"/>',
  news: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6m-6 4h4"/>',
  arrow: '<path d="m9 6 6 6-6 6"/>',
  back: '<path d="m15 6-6 6 6 6"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2" fill="var(--surface)"/><circle cx="15" cy="17" r="2" fill="var(--surface)"/>',
  telegram: '<path d="m3 10 18-7-4 18-5-5-3 3 .5-6L17 7l-9 5Z"/>',
  snow: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9 4.7l3 2 3-2M9 19.3l3-2 3 2"/>',
  coin: '<circle cx="12" cy="12" r="8"/><path d="M10 8v8m5-8-5 4 5 4"/>',
};
export const icon = (name) => '<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (paths[name] || paths.mark) + '</svg>';
export const escapeText = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const sectionIntro = (name, title, description, symbol = name) => '<section class="page-header winter-intro ' + name + '-intro"><div><h1>' + title + '</h1><p class="subtitle">' + description + '</p></div><div class="intro-art">' + icon(symbol) + '</div></section>';
