import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const projectId = env.VITE_BLOCKFROST_PROJECT_ID?.trim()
  const deepseekKey = env.DEEPSEEK_API_KEY?.trim()

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/blockfrost': {
          target: 'https://cardano-mainnet.blockfrost.io',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/blockfrost/, '/api/v0'),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              if (projectId) proxyReq.setHeader('project_id', projectId)
            })
          },
        },
        '/deepseek': {
          target: 'https://api.deepseek.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/deepseek/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              if (deepseekKey) {
                proxyReq.setHeader('Authorization', `Bearer ${deepseekKey}`)
              }
            })
          },
        },
      },
    },
    optimizeDeps: {
      // Keep Evolution out of the prebundle so local patches to cert redeemer
      // indexing (AuthCommitteeHot) are picked up without cache stomping.
      exclude: ['@evolution-sdk/evolution'],
      include: ['effect'],
    },
  }
})
