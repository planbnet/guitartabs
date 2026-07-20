import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
  },
  resolve: {
    alias: [
      // The browser gets LZString/vexchords/CHORDS_DB from classic vendor
      // scripts via js/vendor/globals.js; tests substitute the npm lz-string.
      {
        find: /^.*vendor\/globals\.js$/,
        replacement: fileURLToPath(new URL('./test/vendor-globals.js', import.meta.url)),
      },
    ],
  },
});
