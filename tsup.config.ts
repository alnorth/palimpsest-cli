import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.tsx'],
  format: ['esm'],
  conditions: ['source'],
  target: 'node24',
  clean: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
})
