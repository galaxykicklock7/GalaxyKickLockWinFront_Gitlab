import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import viteProxyPlugin from './vite-proxy-plugin.js'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), viteProxyPlugin()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: process.env.VITE_BACKEND_URL || 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path,
        configure: (proxy, options) => {
          proxy.on('error', (err, req, res) => {
            console.log('proxy error', err);
          });
          // Proxy logs removed for security
        }
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
})
