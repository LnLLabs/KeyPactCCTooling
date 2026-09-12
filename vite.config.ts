import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Passthrough only — client supplies project_id / Authorization from Settings.
      '/blockfrost': {
        target: 'https://cardano-mainnet.blockfrost.io',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/blockfrost/, '/api/v0'),
      },
      '/deepseek': {
        target: 'https://api.deepseek.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/deepseek/, ''),
      },
    },
  },
  optimizeDeps: {
    // Keep Evolution out of the prebundle so local patches to cert redeemer
    // indexing (AuthCommitteeHot) are picked up without cache stomping.
    exclude: ['@evolution-sdk/evolution'],
    include: ['effect'],
  },
})
