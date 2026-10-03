import { encodeQr, qrPathData } from '../../lib/admin/qr';
import styles from './admin.module.css';

const QUIET_ZONE = 4;

/**
 * The enrollment URI as an inline SVG QR code, encoded in the page (ADR-0068): the secret is
 * never sent to a QR service, and the symbol is plain React elements (no markup string).
 */
export function QrCode({ value, label }: { readonly value: string; readonly label: string }) {
  const matrix = encodeQr(value);
  const extent = matrix.size + QUIET_ZONE * 2;
  return (
    <svg
      className={styles.qr}
      role="img"
      aria-label={label}
      viewBox={`0 0 ${extent} ${extent}`}
      shapeRendering="crispEdges"
      xmlns="http://www.w3.org/2000/svg"
      data-qr-version={matrix.version}
    >
      <rect width={extent} height={extent} fill="#ffffff" />
      <path d={qrPathData(matrix, QUIET_ZONE)} fill="#000000" />
    </svg>
  );
}
