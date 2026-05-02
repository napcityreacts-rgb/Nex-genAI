import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.nexusai.assistant',
  appName: 'Nex-genAI',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
};

export default config;
