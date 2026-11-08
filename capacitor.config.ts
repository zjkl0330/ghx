import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'dev.zjkl.ghx',
  appName: 'ghx',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
    backgroundColor: '#0d1117',
    /*
     * 全屏铺满由 MainActivity 自己做（setDecorFitsSystemWindows(false) + 把 insets 写成
     * CSS 变量），所以这里必须把 Capacitor 的自动避让关掉。
     * 设成 auto/force 的话它会直接给 WebView 加四边 margin，内容被整体推离系统栏，
     * 页面再拿一次 insets 就是重复让位，顶部会多出一大块空白。
     */
    adjustMarginsForEdgeToEdge: 'disable',
  },
  server: {
    // 禁止明文 http；不配置 server.url，保证离线可用
    androidScheme: 'https',
  },
}

export default config
