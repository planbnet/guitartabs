// Perform mode: fullscreen, auto-scrolling, read-only view of the document.

import { STRING_COUNT, STRING_LABELS } from "../core/constants.js";
import { isTabBlock, isTextBlock, isDockedTextBlock } from "../core/model.js";
import { state } from "../core/store.js";
import { escapeHtml, focusKeyboard } from "./dom.js";

let active = false;
let scrollDelay = parseFloat(localStorage.getItem("perform_scroll_delay") || "4");
let scrolling = false;
let waiting = false; // countdown before scrolling starts
let waitStart = 0;
let waitDuration = 0;
let animFrame = null;
let lastTime = 0;
let scrollAccum = 0;
let lineHeight = 24;
let overlay = null;
let keyHandler = null;
let resizeHandler = null;

export const isPerformActive = () => active;

// Largest monospace font size where a full line fits the viewport width.
const calculateFontSize = () => {
  const padding = 32;
  const availableWidth = window.innerWidth - padding;
  const totalChars = state.lineLength + 6; // string labels + right margin

  const probe = document.createElement("span");
  probe.style.cssText =
    "position:absolute;visibility:hidden;white-space:pre;" +
    "font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;";
  probe.textContent = "0";
  document.body.appendChild(probe);

  let lo = 8;
  let hi = 64;
  while (hi - lo > 0.5) {
    const mid = (lo + hi) / 2;
    probe.style.fontSize = `${mid}px`;
    const charWidth = probe.getBoundingClientRect().width;
    if (charWidth * totalChars <= availableWidth) lo = mid;
    else hi = mid;
  }

  probe.remove();
  return Math.floor(lo);
};

const renderContent = (fontSize) => {
  const container = document.createElement("div");
  container.className = "perform-content";
  container.style.fontSize = `${fontSize}px`;

  state.blocks.forEach((block, idx) => {
    if (isTabBlock(block)) {
      const pre = document.createElement("pre");
      pre.className = "perform-tab-block";
      let text = "";
      for (let i = 0; i < STRING_COUNT; i++) {
        text += `<span class="perform-label">${STRING_LABELS[i]}</span>${escapeHtml(block.data[i].join(""))}\n`;
      }
      pre.innerHTML = text;
      container.appendChild(pre);
    } else if (isTextBlock(block)) {
      const div = document.createElement("div");
      div.className =
        "perform-text-block" + (isDockedTextBlock(state.blocks, idx) ? " perform-docked" : "");
      div.textContent = block.data;
      container.appendChild(div);
    }
  });

  const spacer = document.createElement("div");
  spacer.className = "perform-end-spacer";
  container.appendChild(spacer);

  return container;
};

// --- Auto-scroll engine ---

const scroller = () => overlay?.querySelector(".perform-scroller");

const scrollTick = (timestamp) => {
  if (!active || !scrolling) return;

  if (waiting) {
    if (waitStart === 0) waitStart = timestamp;
    const elapsed = timestamp - waitStart;
    updateWaitBar(Math.min(1, elapsed / waitDuration));
    if (elapsed >= waitDuration) {
      waiting = false;
      hideWaitBar();
      lastTime = 0;
    }
    animFrame = requestAnimationFrame(scrollTick);
    return;
  }

  if (lastTime === 0) {
    lastTime = timestamp;
    animFrame = requestAnimationFrame(scrollTick);
    return;
  }

  const delta = (timestamp - lastTime) / 1000;
  lastTime = timestamp;

  const el = scroller();
  if (!el) return;

  scrollAccum += (lineHeight / scrollDelay) * delta;
  const px = Math.floor(scrollAccum);
  if (px >= 1) {
    el.scrollTop += px;
    scrollAccum -= px;
  }

  if (el.scrollTop >= el.scrollHeight - el.clientHeight) {
    scrolling = false;
    updateControls();
    return;
  }

  if (scrolling) animFrame = requestAnimationFrame(scrollTick);
};

const startScroll = () => {
  if (scrolling) return;
  scrolling = true;
  lastTime = 0;
  scrollAccum = 0;

  // Give the reader half a screen's worth of time before moving.
  const controlsHeight = 56;
  const visibleHeight = (scroller()?.clientHeight || 400) - controlsHeight;
  waitDuration = (visibleHeight / lineHeight / 2) * scrollDelay * 1000;
  waitStart = 0;
  waiting = true;
  showWaitBar();

  animFrame = requestAnimationFrame(scrollTick);
  updateControls();
};

const stopScroll = () => {
  scrolling = false;
  waiting = false;
  hideWaitBar();
  if (animFrame) {
    cancelAnimationFrame(animFrame);
    animFrame = null;
  }
  updateControls();
};

const toggleScroll = () => (scrolling ? stopScroll() : startScroll());

const adjustSpeed = (delta) => {
  scrollDelay = Math.round(Math.max(0.5, Math.min(20, scrollDelay + delta)) * 10) / 10;
  localStorage.setItem("perform_scroll_delay", String(scrollDelay));
  updateControls();
};

const resetToTop = () => {
  const el = scroller();
  if (!el) return;
  stopScroll();
  el.scrollTop = 0;
};

const toggleFullscreen = () => {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    overlay?.requestFullscreen().catch(() => {});
  }
};

// --- Wait bar ---

const showWaitBar = () => {
  if (!overlay) return;
  let bar = overlay.querySelector(".perform-wait-bar");
  if (!bar) {
    bar = document.createElement("div");
    bar.className = "perform-wait-bar";
    bar.innerHTML = '<div class="perform-wait-fill"></div>';
    overlay.appendChild(bar);
  }
  updateWaitBar(0);
};

const updateWaitBar = (progress) => {
  const fill = overlay?.querySelector(".perform-wait-fill");
  if (fill) fill.style.width = `${progress * 100}%`;
};

const hideWaitBar = () => {
  overlay?.querySelector(".perform-wait-bar")?.remove();
};

const skipWait = () => {
  if (!waiting) return;
  waiting = false;
  hideWaitBar();
  lastTime = 0;
};

// --- Controls ---

const updateControls = () => {
  if (!overlay) return;
  const playBtn = overlay.querySelector(".perform-play-btn");
  const speedDisplay = overlay.querySelector(".perform-speed-display");
  if (playBtn) playBtn.textContent = scrolling ? "⏸" : "▶";
  if (speedDisplay) speedDisplay.textContent = `${scrollDelay}s`;
};

const buildControls = () => {
  // The stage is always dark, so the controls get their own dark theme scope.
  const theme = document.createElement("jelly-theme");
  theme.setAttribute("mode", "dark");

  const bar = document.createElement("div");
  bar.className = "perform-controls";
  bar.innerHTML = `
    <jelly-icon-button class="perform-reset-btn" size="small" shape="circle" variant="graphite" label="Back to top" title="Back to top">⏮</jelly-icon-button>
    <jelly-icon-button class="perform-play-btn" size="small" shape="circle" variant="mint" label="Play/Pause" title="Play/Pause (Space)">${scrolling ? "⏸" : "▶"}</jelly-icon-button>
    <jelly-icon-button class="perform-speed-dec" size="small" shape="circle" variant="graphite" label="Faster" title="Faster (−)">−</jelly-icon-button>
    <span class="perform-speed-label"><span class="perform-speed-display">${scrollDelay}s</span>/line</span>
    <jelly-icon-button class="perform-speed-inc" size="small" shape="circle" variant="graphite" label="Slower" title="Slower (+)">+</jelly-icon-button>
    <jelly-icon-button class="perform-fullscreen-btn" size="small" shape="circle" variant="graphite" label="Fullscreen" title="Fullscreen (F)">⛶</jelly-icon-button>
    <jelly-icon-button class="perform-exit-btn" size="small" shape="circle" variant="rose" label="Exit" title="Exit (Esc)">✕</jelly-icon-button>
  `;

  const wire = (selector, fn) => {
    bar.querySelector(selector).addEventListener("click", (e) => {
      e.stopPropagation();
      fn();
    });
  };
  wire(".perform-play-btn", toggleScroll);
  wire(".perform-speed-dec", () => adjustSpeed(-0.5));
  wire(".perform-speed-inc", () => adjustSpeed(0.5));
  wire(".perform-reset-btn", resetToTop);
  wire(".perform-fullscreen-btn", toggleFullscreen);
  wire(".perform-exit-btn", exitPerformMode);

  theme.appendChild(bar);
  return theme;
};

// --- Enter / exit ---

export const enterPerformMode = () => {
  if (active) return;
  active = true;

  const fontSize = calculateFontSize();

  overlay = document.createElement("div");
  overlay.className = "perform-overlay";

  const scrollerEl = document.createElement("div");
  scrollerEl.className = "perform-scroller";
  scrollerEl.appendChild(renderContent(fontSize));
  overlay.appendChild(scrollerEl);
  overlay.appendChild(buildControls());

  document.body.appendChild(overlay);

  // Manual scrolling skips the countdown.
  scrollerEl.addEventListener("scroll", () => { if (waiting) skipWait(); }, { passive: true });

  const sampleLine =
    overlay.querySelector(".perform-text-block") || overlay.querySelector(".perform-tab-block");
  lineHeight = sampleLine
    ? parseFloat(getComputedStyle(sampleLine).lineHeight) || fontSize * 1.4
    : fontSize * 1.4;

  keyHandler = (e) => {
    if (!active) return;
    switch (e.key) {
      case " ": e.preventDefault(); toggleScroll(); break;
      case "Escape": e.preventDefault(); exitPerformMode(); break;
      case "+": case "=": e.preventDefault(); adjustSpeed(0.5); break;
      case "-": e.preventDefault(); adjustSpeed(-0.5); break;
      case "f": case "F": e.preventDefault(); toggleFullscreen(); break;
      case "ArrowUp": case "ArrowLeft":
        e.preventDefault(); scrollerEl.scrollTop -= lineHeight * 3; break;
      case "ArrowDown": case "ArrowRight":
        e.preventDefault(); scrollerEl.scrollTop += lineHeight * 3; break;
    }
  };
  document.addEventListener("keydown", keyHandler);

  resizeHandler = () => {
    if (!active) return;
    const newFontSize = calculateFontSize();
    const contentEl = overlay.querySelector(".perform-content");
    if (contentEl) contentEl.style.fontSize = `${newFontSize}px`;
    lineHeight = newFontSize * 1.4;
  };
  window.addEventListener("resize", resizeHandler);
};

export const exitPerformMode = () => {
  if (!active) return;
  active = false;

  stopScroll();

  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }

  if (keyHandler) {
    document.removeEventListener("keydown", keyHandler);
    keyHandler = null;
  }
  if (resizeHandler) {
    window.removeEventListener("resize", resizeHandler);
    resizeHandler = null;
  }
  overlay?.remove();
  overlay = null;

  focusKeyboard();
};
