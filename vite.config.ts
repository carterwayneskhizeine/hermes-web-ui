import { defineConfig, createLogger } from 'vite'
import vue from '@vitejs/plugin-vue'
import type { ProxyOptions } from 'vite'
import { resolve } from 'path'
import pkg from './package.json'

const logger = createLogger()
const originalError = logger.error.bind(logger)
logger.error = (msg, opts) => {
  if (typeof msg === 'string' && msg.includes('ECONNREFUSED')) return
  originalError(msg, opts)
}

const BACKEND = 'http://127.0.0.1:8648'

function createProxyConfig(): ProxyOptions {
  return {
    target: BACKEND,
    changeOrigin: true,
    configure: (proxy) => {
      proxy.on('error', (err: any, _req, res: any) => {
        if (err.code === 'ECONNREFUSED') {
          if (res && !res.headersSent) {
            res.writeHead(503)
            res.end()
          }
          return
        }
        console.error('[proxy error]', err.message)
      })
      proxy.on('proxyReq', (proxyReq) => {
        proxyReq.removeHeader('origin')
        proxyReq.removeHeader('referer')
      })
      proxy.on('proxyRes', (proxyRes) => {
        proxyRes.headers['cache-control'] = 'no-cache'
        proxyRes.headers['x-accel-buffering'] = 'no'
      })
    },
  }
}

export default defineConfig({
  root: 'packages/client',
  customLogger: logger,
  plugins: [vue()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'packages/client/src'),
    },
  },
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
  optimizeDeps: {
    include: ['monaco-editor'],
  },
  server: {
    port: 8649,
    proxy: {
      '/api': createProxyConfig(),
      '/v1': createProxyConfig(),
      '/health': createProxyConfig(),
      '/upload': createProxyConfig(),
      '/webhook': createProxyConfig(),
      '/socket.io': {
        target: BACKEND,
        ws: true,
      },
    },
  },
})
