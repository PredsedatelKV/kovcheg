import { escapeText, icon } from "./ui.js";

export function carouselMarkup(items) {
  const loop = items.length > 1;
  const slide = (item, index, ghost = false) => {
    const art = '<img src="' + escapeText(item.image_url) + '" alt=""' +
      (item.featured ? ' loading="eager"' : ' loading="lazy"') + ' decoding="async">' +
      (item.featured ? '<span class="carousel-feature-title" aria-hidden="true">' + escapeText(item.title) + '</span>' : "");
    if (ghost) return '<div class="carousel-slide" aria-hidden="true">' + art + '</div>';
    const label = escapeText(item.title?.trim() || "Открыть объявление");
    if (item.action_type === "url" && /^https?:\/\//i.test(item.action_target)) {
      return `<a class="carousel-slide" href="${escapeText(item.action_target)}" target="_blank"
        rel="noopener noreferrer" data-carousel-action="${index}" aria-label="${label}">${art}</a>`;
    }
    return `<button class="carousel-slide" type="button" data-carousel-action="${index}" aria-label="${label}">${art}</button>`;
  };
  return `<section class="winter-carousel" aria-label="Новости и объявления">
    <div class="winter-carousel-track">${loop ? slide(items.at(-1), -1, true) : ""}${items.map((item, index) => slide(item, index)).join("")}${loop ? slide(items[0], -1, true) : ""}</div>
    ${loop ? `<div class="carousel-dots"><span class="carousel-progress" aria-hidden="true"></span><button class="carousel-arrow" type="button" data-step="-1" aria-label="Предыдущее объявление">${icon("back")}</button>${items.map((_,i) => `<button type="button" class="carousel-dot" data-index="${i}" aria-label="Объявление ${i+1}"></button>`).join("")}<button type="button" class="carousel-arrow" data-step="1" aria-label="Следующее объявление">${icon("arrow")}</button></div>` : ""}
  </section>`;
}

export function mountCarousel(panel, items, open, { autoAdvance = true } = {}) {
  const track = panel.querySelector(".winter-carousel-track");
  const dots = [...panel.querySelectorAll(".carousel-dot")];
  const loop = items.length > 1;
  const controller = new AbortController();
  const {signal} = controller;
  let autoplay, settleTimer, resize, active = false, dragging = false, moving = false, index = 0, pending = null;
  const reduced = () => document.documentElement.classList.contains("motion-lite") || matchMedia("(prefers-reduced-motion: reduce)").matches;
  const place = (physical, smooth) => track.scrollTo({ left: physical * track.clientWidth, behavior: smooth ? "smooth" : "auto" });
  function setDots() {
    const physical = track.clientWidth ? track.scrollLeft / track.clientWidth : index + 1;
    const position = physical < 1 ? (1 - physical) * (items.length - 1)
      : physical > items.length ? (items.length + 1 - physical) * (items.length - 1) : physical - 1;
    panel.style.setProperty("--carousel-progress", Math.max(0, Math.min(items.length - 1, position)));
    panel.style.setProperty("--carousel-dot-center", (items.length - 1) / 2);
    const visible = ((Math.round(physical) - 1) % items.length + items.length) % items.length;
    dots.forEach((dot, i) => dot.setAttribute("aria-current", i === visible ? "true" : "false"));
  }

  function schedule() {
    clearTimeout(autoplay);
    if (autoAdvance && active && !document.hidden && !dragging && !moving && !reduced() && !panel.matches(":hover,:focus-within")) {
      autoplay = setTimeout(() => step(1), 4500);
    }
  }
  function settle() {
    if (!active || !track.clientWidth || dragging) return;
    const physical = Math.round(track.scrollLeft / track.clientWidth);
    index = (physical + items.length - 1) % items.length;
    if (physical === 0 || physical === items.length + 1) place(index + 1, false);
    setDots();
    moving = false;
    const queued = pending;
    pending = null;
    if (queued !== null) {
      step(queued.index == null ? queued.delta : queued.index - index);
    } else schedule();
  }
  function step(direction) {
    if (moving || direction === 0) return;
    clearTimeout(autoplay);
    moving = true;
    place(index + 1 + direction, !reduced());
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settle, 850);
  }

  panel.addEventListener("click", event => {
    const slide = event.target.closest("[data-carousel-action]");
    if (slide?.matches("a")) {
      const web = window.Telegram?.WebApp;
      if (web?.initData && web.openLink && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        web.openLink(slide.href);
      }
    } else if (slide) {
      const item = items[Number(slide.dataset.carouselAction)];
      if (item) open(item);
    }
    const button = event.target.closest("[data-step],[data-index]");
    if (!button || !loop) return;
    const choice = button.dataset.step != null ? { delta:Number(button.dataset.step) } : { index:Number(button.dataset.index) };
    if (moving) pending = choice;
    else step(choice.index == null ? choice.delta : choice.index - index);
  }, {signal});

  if (loop) {
    track.classList.add("loops");
    track.addEventListener("scroll", () => {
      setDots();
      clearTimeout(settleTimer);
      settleTimer = setTimeout(settle, 140);
    }, {passive:true, signal});
    track.addEventListener("scrollend", settle, {signal});
    track.addEventListener("pointerdown", () => { dragging = true; clearTimeout(autoplay); }, {passive:true, signal});
    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      clearTimeout(settleTimer);
      settleTimer = setTimeout(settle, 180);
    };
    window.addEventListener("pointerup", endDrag, {passive:true, signal});
    window.addEventListener("pointercancel", endDrag, {passive:true, signal});
    for (const event of ["focusout","pointerleave"]) panel.addEventListener(event, schedule, {signal});
    document.addEventListener("visibilitychange", schedule, {signal});
    resize = new ResizeObserver(() => {
      if (active && track.clientWidth) place(index + 1, false);
    });
    resize.observe(track);
  }
  const show = () => {
    active = true;
    if (!loop) return;
    place(index + 1, false);
    setDots();
    schedule();
  };
  const hide = () => {
    active = false;
    moving = dragging = false;
    pending = null;
    clearTimeout(autoplay);
    clearTimeout(settleTimer);
  };
  return { show, hide, dispose() { hide(); resize?.disconnect(); controller.abort(); } };
}
