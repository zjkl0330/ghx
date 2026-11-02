import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version: string
}

export default defineConfig({
  plugins: [react()],
  base: './',
  // 版本号唯一来源是 package.json，构建时注入，避免关于页写死导致与实际包不一致
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
    sourcemap: false,
  },
  server: {
    host: '127.0.0.1',
    port: 5273,
  },
})
