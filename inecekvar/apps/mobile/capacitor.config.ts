import type { CapacitorConfig } from '@capacitor/cli';

// Public values only: no keys or secrets belong in this file (spec section 6.1).
const config: CapacitorConfig = {
  appId: 'app.inecekvar.mobile',
  appName: 'İnecek Var',
  webDir: '../../dist/apps/mobile/browser',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    // The app chrome is lacivert in both schemes: light status and navigation bar icons.
    SystemBars: { style: 'DARK' },
  },
};

export default config;
