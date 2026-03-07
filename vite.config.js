import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import viteProxyPlugin from './vite-proxy-plugin.js'

// Try to import obfuscator plugin if installed
let obfuscatorPlugin = null;
try {
  const { default: obfuscator } = await import('vite-plugin-javascript-obfuscator');
  obfuscatorPlugin = obfuscator({
    options: {
      compact: true,
      controlFlowFlattening: true,
      controlFlowFlatteningThreshold: 0.75,
      deadCodeInjection: true,
      deadCodeInjectionThreshold: 0.4,
      debugProtection: false, // Disable to avoid blocking dev tools
      debugProtectionInterval: 0,
      disableConsoleOutput: true,
      identifierNamesGenerator: 'hexadecimal',
      log: false,
      numbersToExpressions: true,
      renameGlobals: false,
      selfDefending: true,
      simplify: true,
      splitStrings: true,
      splitStringsChunkLength: 10,
      stringArray: true,
      stringArrayCallsTransform: true,
      stringArrayEncoding: ['base64'],
      stringArrayIndexShift: true,
      stringArrayRotate: true,
      stringArrayShuffle: true,
      stringArrayWrappersCount: 2,
      stringArrayWrappersChainedCalls: true,
      stringArrayWrappersParametersMaxCount: 4,
      stringArrayWrappersType: 'function',
      stringArrayThreshold: 0.75,
      transformObjectKeys: true,
      unicodeEscapeSequence: false
    }
  });
} catch (e) {
  console.log('⚠️  javascript-obfuscator not installed. Code will be minified but not obfuscated.');
  console.log('   Run: npm install --save-dev vite-plugin-javascript-obfuscator');
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(), 
    viteProxyPlugin(),
    ...(obfuscatorPlugin ? [obfuscatorPlugin] : [])
  ],
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
    sourcemap: false, // Disable sourcemaps in production
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks: undefined, // Single bundle for better obfuscation
        entryFileNames: 'assets/[name].[hash].js',
        chunkFileNames: 'assets/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash].[ext]'
      }
    }
  },
  esbuild: {
    drop: ['console', 'debugger'], // Remove console.log and debugger in production
    legalComments: 'none' // Remove all comments
  }
})
