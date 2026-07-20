// Theme plumbing: keeps the browser-chrome color in sync with the resolved
// Jelly theme (auto light/dark).

import { isDarkMode, onThemeChange } from "../vendor/jelly.js";

const THEME_COLORS = { light: "#f4f5f7", dark: "#101318" };

const updateMetaThemeColor = () => {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  meta.setAttribute("content", isDarkMode() ? THEME_COLORS.dark : THEME_COLORS.light);
};

export const initTheme = () => {
  updateMetaThemeColor();
  onThemeChange(updateMetaThemeColor);
};
