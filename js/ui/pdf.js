// PDF export via the browser's print pipeline (Save as PDF).
//
// Renders the document as clean black-on-white monospace text and prints it.
// Content is grouped so a tab block never splits across a page break, and
// stays with its docked line above and a single annotation line below.

import { STRING_COUNT, STRING_LABELS } from "../core/constants.js";
import { isTabBlock, isTextBlock } from "../core/model.js";
import { escapeHtml } from "./dom.js";

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Fira Code", monospace';

// A4 portrait printable width (mm) with our page margin.
const PAGE_WIDTH_MM = 210;
const PAGE_MARGIN_MM = 12;
const PX_PER_MM = 96 / 25.4;

const isSingleLineText = (block) => isTextBlock(block) && !block.data.includes("\n");

// Group blocks into units that must not split across a page. A tab block binds
// to a single text line directly above it (its docked chord/lyric line) and to
// a single text line directly below it, unless that line is itself docked to a
// following tab.
export const buildPdfGroups = (blocks) => {
  const groups = [];
  let i = 0;
  while (i < blocks.length) {
    if (isTabBlock(blocks[i])) {
      const group = [i];
      if (isSingleLineText(blocks[i + 1]) && !isTabBlock(blocks[i + 2])) {
        group.push(i + 1);
      }
      groups.push(group);
      i = group[group.length - 1] + 1;
    } else if (isSingleLineText(blocks[i]) && isTabBlock(blocks[i + 1])) {
      const group = [i, i + 1];
      if (isSingleLineText(blocks[i + 2]) && !isTabBlock(blocks[i + 3])) {
        group.push(i + 2);
      }
      groups.push(group);
      i = group[group.length - 1] + 1;
    } else {
      groups.push([i]);
      i += 1;
    }
  }
  return groups;
};

// Advance width of one monospace character as a fraction of font-size.
const measureCharRatio = () => {
  const probe = document.createElement("span");
  probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font-size:100px;font-family:${MONO}`;
  probe.textContent = "0000000000";
  document.body.appendChild(probe);
  const ratio = probe.getBoundingClientRect().width / 10 / 100;
  probe.remove();
  return ratio || 0.6;
};

// Largest font size (px) at which a full tab line fits the page width.
const fitFontSize = (lineLength) => {
  const printablePx = (PAGE_WIDTH_MM - 2 * PAGE_MARGIN_MM) * PX_PER_MM;
  const cols = lineLength + 3; // "e|" prefix + a little right slack
  const fs = printablePx / (cols * measureCharRatio());
  return Math.max(8, Math.min(14, fs));
};

const renderBlockHtml = (block) => {
  if (isTabBlock(block)) {
    let lines = "";
    for (let i = 0; i < STRING_COUNT; i++) {
      lines += `<span class="pdf-label">${STRING_LABELS[i]}</span>${escapeHtml(block.data[i].join(""))}\n`;
    }
    return `<pre class="pdf-tab">${lines}</pre>`;
  }
  return `<pre class="pdf-text">${escapeHtml(block.data)}</pre>`;
};

// Render the document and open the print dialog. `lineLength` sizes the font so
// a full tab line fits the page; `title` (optional) is printed as a heading.
export const exportToPdf = (blocks, { lineLength = 80, title = null } = {}) => {
  const fs = fitFontSize(lineLength);
  const titleFs = Math.max(14, Math.round(fs * 1.4));

  const groupsHtml = buildPdfGroups(blocks)
    .map((group) => `<div class="pdf-group">${group.map((idx) => renderBlockHtml(blocks[idx])).join("")}</div>`)
    .join("");

  // Injected only for the duration of the print; the print-root is hidden on
  // screen and revealed (with everything else hidden) inside @media print.
  const style = document.createElement("style");
  style.id = "pdf-print-style";
  style.textContent = `
    @media print {
      @page { size: A4 portrait; margin: ${PAGE_MARGIN_MM}mm; }
      html, body { background: #fff !important; }
      body > *:not(#pdf-print-root) { display: none !important; }
      #pdf-print-root { display: block !important; }
    }
    #pdf-print-root { color: #111; font-family: ${MONO}; font-size: ${fs}px; line-height: 1.35; }
    #pdf-print-root .pdf-doc-title { font-family: system-ui, -apple-system, sans-serif; font-weight: 700; font-size: ${titleFs}px; margin-bottom: 12px; color: #000; }
    #pdf-print-root .pdf-group { break-inside: avoid; page-break-inside: avoid; margin: 0 0 14px; }
    #pdf-print-root pre { font-family: inherit; font-size: inherit; margin: 0; }
    #pdf-print-root pre.pdf-tab { white-space: pre; }
    #pdf-print-root pre.pdf-text { white-space: pre-wrap; color: #14315e; font-weight: 600; margin-bottom: 2px; }
    #pdf-print-root .pdf-label { color: #666; }
  `;

  const root = document.createElement("div");
  root.id = "pdf-print-root";
  root.style.display = "none";
  root.innerHTML =
    (title ? `<div class="pdf-doc-title">${escapeHtml(title)}</div>` : "") + groupsHtml;

  document.head.appendChild(style);
  document.body.appendChild(root);

  const cleanup = () => {
    root.remove();
    style.remove();
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);

  window.print();

  // Safety net for browsers that don't fire afterprint.
  setTimeout(cleanup, 60000);
};
