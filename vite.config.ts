import { defineConfig } from 'vitest/config';

export default defineConfig({
  appType: 'spa',
  build: {
    target: 'es2022',
    sourcemap: true
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    environment: 'jsdom',
    globals: true,
    coverage: {
      reporter: ['text', 'lcov']
    }
  }
});
