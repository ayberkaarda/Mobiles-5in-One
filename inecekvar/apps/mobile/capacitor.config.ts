import type { CapacitorConfig } from '@capacitor/cli';

// Public values only: no keys or secrets belong in this file (spec section 6.1).
const config: CapacitorConfig = {
  appId: 'app.inecekvar.mobile',
  appName: 'İnecek Var',
  webDir: '../../dist/apps/mobile/browser',
  server: {
    androidScheme: 'https',
  },
};

export default config;
