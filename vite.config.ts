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
    /*
     * 目标压到 es2017 而不是 es2020。
     *
     * es2020 会把 `?.` 与 `??` 原样留在产物里，那需要 Chrome 80 才认；
     * 没有 Google Play 的安卓机 WebView 常年停在 60~80，语法一报错整个
     * bundle 一行都不执行 —— 表现就是「启动图撤掉后一片黑」，用户只能
     * 描述成闪退。es2017（Chrome 55）把这批语法全部降级成三元与逻辑或，
     * 代价只是几 KB 体积。
     *
     * 运行时 API（如 crypto.randomUUID）不在这里管，那是 src/lib/uuid.ts 的事。
     */
    target: 'es2017',
    sourcemap: false,
  },
  server: {
    host: '127.0.0.1',
    port: 5273,
  },
})
