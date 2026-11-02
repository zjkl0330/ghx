import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'dev.zjkl.ghx',
  appName: 'ghx',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
    backgroundColor: '#0d1117',
  },
  server: {
    // 禁止明文 http；不配置 server.url，保证离线可用
    androidScheme: 'https',
  },
}

export default config
