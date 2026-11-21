/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative base + HashRouter: the build works from any static host and any sub-path.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2020',
    sourcemap: true,
  },
  server: {
    host: true,
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
