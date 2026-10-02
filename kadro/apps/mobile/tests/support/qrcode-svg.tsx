import { createElement } from 'react';

/**
 * Test double of `react-native-qrcode-svg` (its sources are untranspiled JSX that Node cannot
 * load). Renders a host element carrying the encoded value, so tests can assert the QR payload.
 */
export default function QRCode(props: { value?: string; size?: number }) {
  return createElement('QRCode', { testID: 'qr-code', value: props.value, size: props.size });
}
