// === Perform Mode — Fullscreen Auto-Scrolling Tab View ===
// Simple continuous scroll at a configurable speed (seconds per line).

let performModeActive = false;
let performScrollDelay = parseFloat(localStorage.getItem('perform_scroll_delay') || '4');
let performScrolling = false;
let performWaiting = false;       // countdown before scrolling starts
let performWaitStart = 0;
let performWaitDuration = 0;
let performAnimFrame = null;
let performLastTime = 0;
let performScrollAccum = 0;
let performLineHeight = 24;
let performOverlay = null;
let performKeyHandler = null;

// --- Font Size Calculation ---

const calculatePerformFontSize = () => {
  const padding = 32;
  const availableWidth = window.innerWidth - padding;
  const totalChars = lineLength + 6; // +2 for string labels "e|", +4 for right margin

  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;' +
    'font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;';
  probe.textContent = '0';
  document.body.appendChild(probe);

  let lo = 8, hi = 64;
  while (hi - lo > 0.5) {
    const mid = (lo + hi) / 2;
    probe.style.fontSize = mid + 'px';
    const charWidth = probe.getBoundingClientRect().width;
    if (charWidth * totalChars <= availableWidth) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  probe.remove();
  return Math.floor(lo);
};

// --- Render Content ---

const renderPerformContent = (fontSize) => {
  const container = document.createElement('div');
  container.className = 'perform-content';
  container.style.fontSize = fontSize + 'px';

  const strings = ['e|', 'B|', 'G|', 'D|', 'A|', 'E|'];

  blocks.forEach((block, idx) => {
    if (block.type === 'tab') {
      const pre = document.createElement('pre');
      pre.className = 'perform-tab-block';
      let text = '';
      for (let i = 0; i < 6; i++) {
        text += '<span class="perform-label">' + strings[i] + '</span>' + escapeHtml(block.data[i].join('')) + '\n';
      }
      pre.innerHTML = text;
      container.appendChild(pre);
    } else if (block.type === 'text') {
      const isSingleLine = !block.data.includes('\n');
      const nextBlock = blocks[idx + 1];
      const isDocked = isSingleLine && nextBlock && isTabBlock(nextBlock);

      const div = document.createElement('div');
      div.className = 'perform-text-block' + (isDocked ? ' perform-docked' : '');
      div.textContent = block.data;
      container.appendChild(div);
    }
  });

  const spacer = document.createElement('div');
  spacer.style.height = '80vh';
  container.appendChild(spacer);

  return container;
};

// escapeHtml is provided by rendering.js

// --- Auto-Scroll Engine ---

const performScrollTick = (timestamp) => {
  if (!performModeActive || !performScrolling) return;

  // --- Waiting phase: countdown before scrolling ---
  if (performWaiting) {
    if (performWaitStart === 0) performWaitStart = timestamp;
    const elapsed = timestamp - performWaitStart;
    const progress = Math.min(1, elapsed / performWaitDuration);
    updateWaitBar(progress);

    if (elapsed >= performWaitDuration) {
      performWaiting = false;
      hideWaitBar();
      performLastTime = 0;
    }
    performAnimFrame = requestAnimationFrame(performScrollTick);
    return;
  }

  // --- Normal scrolling ---
  if (performLastTime === 0) {
    performLastTime = timestamp;
    performAnimFrame = requestAnimationFrame(performScrollTick);
    return;
  }

  const delta = (timestamp - performLastTime) / 1000;
  performLastTime = timestamp;

  const scroller = performOverlay?.querySelector('.perform-scroller');
  if (!scroller) return;

  const pxPerSec = performLineHeight / performScrollDelay;
  performScrollAccum += pxPerSec * delta;
  const px = Math.floor(performScrollAccum);

  if (px >= 1) {
    scroller.scrollTop += px;
    performScrollAccum -= px;
  }

  if (scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight) {
    performScrolling = false;
    updatePerformControls();
    return;
  }

  if (performScrolling) {
    performAnimFrame = requestAnimationFrame(performScrollTick);
  }
};

const startPerformScroll = () => {
  if (performScrolling) return;
  performScrolling = true;
  performLastTime = 0;
  performScrollAccum = 0;

  // Calculate visible lines and wait for half the time to scroll them
  const scroller = performOverlay?.querySelector('.perform-scroller');
  const controlsHeight = 56;
  const visibleHeight = (scroller?.clientHeight || 400) - controlsHeight;
  const visibleLines = visibleHeight / performLineHeight;
  performWaitDuration = (visibleLines / 2) * performScrollDelay * 1000;
  performWaitStart = 0;
  performWaiting = true;
  showWaitBar();

  performAnimFrame = requestAnimationFrame(performScrollTick);
  updatePerformControls();
};

const stopPerformScroll = () => {
  performScrolling = false;
  performWaiting = false;
  hideWaitBar();
  if (performAnimFrame) {
    cancelAnimationFrame(performAnimFrame);
    performAnimFrame = null;
  }
  updatePerformControls();
};

const togglePerformScroll = () => {
  performScrolling ? stopPerformScroll() : startPerformScroll();
};

const adjustPerformSpeed = (delta) => {
  performScrollDelay = Math.round(Math.max(0.5, Math.min(20, performScrollDelay + delta)) * 10) / 10;
  localStorage.setItem('perform_scroll_delay', String(performScrollDelay));
  updatePerformControls();
};

const performResetToTop = () => {
  const scroller = performOverlay?.querySelector('.perform-scroller');
  if (!scroller) return;
  stopPerformScroll();
  scroller.scrollTop = 0;
};

const performToggleFullscreen = () => {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else if (performOverlay) {
    performOverlay.requestFullscreen().catch(() => {});
  }
};

// --- Wait Bar (progress bar above controls) ---

const showWaitBar = () => {
  if (!performOverlay) return;
  let bar = performOverlay.querySelector('.perform-wait-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'perform-wait-bar';
    bar.innerHTML = '<div class="perform-wait-fill"></div>';
    performOverlay.appendChild(bar);
  }
  const fill = bar.querySelector('.perform-wait-fill');
  if (fill) fill.style.width = '0%';
};

const updateWaitBar = (progress) => {
  if (!performOverlay) return;
  const fill = performOverlay.querySelector('.perform-wait-fill');
  if (fill) fill.style.width = (progress * 100) + '%';
};

const hideWaitBar = () => {
  if (!performOverlay) return;
  const bar = performOverlay.querySelector('.perform-wait-bar');
  if (bar) bar.remove();
};

const skipWait = () => {
  if (!performWaiting) return;
  performWaiting = false;
  updateWaitBar(1);
  hideWaitBar();
  performLastTime = 0;
};

// --- Controls UI ---

const updatePerformControls = () => {
  if (!performOverlay) return;
  const playBtn = performOverlay.querySelector('.perform-play-btn');
  const speedDisplay = performOverlay.querySelector('.perform-speed-display');
  if (playBtn) playBtn.textContent = performScrolling ? '⏸' : '▶';
  if (speedDisplay) speedDisplay.textContent = performScrollDelay + 's';
};

const buildPerformControls = () => {
  const bar = document.createElement('div');
  bar.className = 'perform-controls';

  bar.innerHTML = `
    <button class="perform-ctrl-btn perform-reset-btn" title="Back to top">⏮</button>
    <button class="perform-ctrl-btn perform-play-btn" title="Play/Pause (Space)">${performScrolling ? '⏸' : '▶'}</button>
    <button class="perform-ctrl-btn perform-speed-dec" title="Faster (−)">−</button>
    <span class="perform-speed-label"><span class="perform-speed-display">${performScrollDelay}s</span>/line</span>
    <button class="perform-ctrl-btn perform-speed-inc" title="Slower (+)">+</button>
    <button class="perform-ctrl-btn perform-fullscreen-btn" title="Fullscreen (F)">⛶</button>
    <button class="perform-ctrl-btn perform-exit-btn" title="Exit (Esc)">✕</button>
  `;

  bar.querySelector('.perform-play-btn').addEventListener('click', (e) => { e.stopPropagation(); togglePerformScroll(); });
  bar.querySelector('.perform-speed-dec').addEventListener('click', (e) => { e.stopPropagation(); adjustPerformSpeed(-0.5); });
  bar.querySelector('.perform-speed-inc').addEventListener('click', (e) => { e.stopPropagation(); adjustPerformSpeed(0.5); });
  bar.querySelector('.perform-reset-btn').addEventListener('click', (e) => { e.stopPropagation(); performResetToTop(); });
  bar.querySelector('.perform-fullscreen-btn').addEventListener('click', (e) => { e.stopPropagation(); performToggleFullscreen(); });
  bar.querySelector('.perform-exit-btn').addEventListener('click', (e) => { e.stopPropagation(); exitPerformMode(); });

  return bar;
};

// --- Enter / Exit ---

const enterPerformMode = () => {
  if (performModeActive) return;
  performModeActive = true;

  const fontSize = calculatePerformFontSize();

  performOverlay = document.createElement('div');
  performOverlay.className = 'perform-overlay';

  const scroller = document.createElement('div');
  scroller.className = 'perform-scroller';
  scroller.appendChild(renderPerformContent(fontSize));
  performOverlay.appendChild(scroller);
  performOverlay.appendChild(buildPerformControls());

  document.body.appendChild(performOverlay);

  // Skip wait timer on manual scroll
  scroller.addEventListener('scroll', () => { if (performWaiting) skipWait(); }, { passive: true });

  // Compute line height from rendered content
  const sampleLine = performOverlay.querySelector('.perform-text-block') ||
                     performOverlay.querySelector('.perform-tab-block');
  if (sampleLine) {
    const style = getComputedStyle(sampleLine);
    performLineHeight = parseFloat(style.lineHeight) || (fontSize * 1.4);
  } else {
    performLineHeight = fontSize * 1.4;
  }

  // Keyboard handler
  performKeyHandler = (e) => {
    if (!performModeActive) return;
    switch (e.key) {
      case ' ':        e.preventDefault(); togglePerformScroll(); break;
      case 'Escape':   e.preventDefault(); exitPerformMode(); break;
      case '+': case '=': e.preventDefault(); adjustPerformSpeed(0.5); break;
      case '-':        e.preventDefault(); adjustPerformSpeed(-0.5); break;
      case 'f': case 'F': e.preventDefault(); performToggleFullscreen(); break;
      case 'ArrowUp': case 'ArrowLeft':
        e.preventDefault(); scroller.scrollTop -= performLineHeight * 3; break;
      case 'ArrowDown': case 'ArrowRight':
        e.preventDefault(); scroller.scrollTop += performLineHeight * 3; break;
    }
  };
  document.addEventListener('keydown', performKeyHandler);

  // Resize handler
  performOverlay._resizeHandler = () => {
    if (!performModeActive) return;
    const newFontSize = calculatePerformFontSize();
    const contentEl = performOverlay.querySelector('.perform-content');
    if (contentEl) contentEl.style.fontSize = newFontSize + 'px';
    performLineHeight = newFontSize * 1.4;
  };
  window.addEventListener('resize', performOverlay._resizeHandler);
};

const exitPerformMode = () => {
  if (!performModeActive) return;
  performModeActive = false;

  stopPerformScroll();

  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }

  if (performKeyHandler) {
    document.removeEventListener('keydown', performKeyHandler);
    performKeyHandler = null;
  }

  if (performOverlay) {
    if (performOverlay._resizeHandler) {
      window.removeEventListener('resize', performOverlay._resizeHandler);
    }
    performOverlay.remove();
    performOverlay = null;
  }

  focusKeyboard();
};
