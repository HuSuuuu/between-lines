import { defineConfig } from 'vitest/config';
export default defineConfig({
  base: './',
  build: { target: 'es2022', assetsInlineLimit: 0 },
  server: { strictPort: true },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
