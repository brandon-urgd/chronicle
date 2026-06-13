import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    // Run test files sequentially to prevent jsdom contamination
    // between property-based tests (100 iterations) and other test files
    fileParallelism: false,
  },
})
