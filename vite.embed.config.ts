import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const rootDir = fileURLToPath(new URL('.', import.meta.url))

// "GLPYTHON_CHANNEL=dev npm run build:embed": the dev channel's embed
// (deployed to /glpython-editor/dev/ from the dev branch), which shows a
// «dev» badge so that nobody shares it with learners by mistake.
const channel = process.env.GLPYTHON_CHANNEL === 'dev' ? 'dev' : 'live'

export default defineConfig({
  root: `${rootDir}embed`,
  base: './',
  plugins: [react()],
  define: {
    __GLPYTHON_CHANNEL__: JSON.stringify(channel),
  },
  build: {
    outDir: `${rootDir}dist-embed`,
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        embed: resolve(rootDir, 'embed/index.html'),
        demo: resolve(rootDir, 'embed/demo.html'),
      },
    },
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
})
