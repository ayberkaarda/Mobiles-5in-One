import { encodeQr, penalty, qrPath } from './qr-code';

// Reference matrices from an independent encoder (segno 1.6.6, level M, byte mode, with the
// ISO/IEC 18004 7.4.10 padding rule), packed row by row into hex. Produced once for ADR-0041.
const V1_MASKS = [
  'fe33fc15d06e90bb7495dbadaec13907faafe00000aa489463a087c47e9b7822312a00611bf926f04042baeb25d2adaea5ab04392fed738',
  'fee3fc13506ea4bb7435dba0aec15107faafe00a00a3192ec90a12912a31d287647f004bb3fa73b04ae8ba3e75d0072eb0ff04938fe8268',
  'fe53fc11106ea8bb75a5dbabaec17507faafe01300be2be24b4309fc9d1140c1bf12806f23f8a8d053ccba88add64e2ebd490401cfeb4b0',
  'fed3fc17d06e92bb75a5dba62ec10107faafe01800b7425a4b4324ca46a39ba1bf12804297fb1e1053ccba53c5d523aebd4904b71fed900',
  'fe93fc13106e86bb75d5dbafaec15507faafe014008befc9c57beaf2a4093106a363004caffa4b5044d0bacfb5d076ee937104700fef3a8',
  'fe63fc17106ea8bb7565dba3aec11507faafe01b0082ae738c5f49fc9d31c2c7647f004fa3f8a8d04fbdba08add0462e90ff0483cfeb4b0',
  'fee3fc17106ea0bb7465dbaaaec10d07faafe00b009f8cbb8c5f40d80f29a347647f004caffa3a905fbdba9ae5d5c02e90ff048fffe9020',
  'fe33fc10d06e94bb7495dba7aec17107faafe0040096dd0463a0958d5ad25cb2312a007353f96fd05042ba4fb5d63fee85ab04700fec570',
];
const V8_AUTO =
  'fe5eaa4444bfc12b0882f7d06e9c86e45a6bb74346dcc025dba7bc3fe482ec1673919e9107faaaaaaaaafe004bfc65d8' +
  '0096acdffb295052d1d9ee422064c915410c537488ebb529e92c62538eba8badc5103e4164d65f825fe8911b72c3ea88' +
  '8b31129dfd87cdeb3ce327506b8860dfae13baf4fa0ea6503e9b7e312c0da48744a70f2206480bbe3e9fa5b7e751a474' +
  '5e5d109aa4a2bdbba8b447d910d246d7e9c0fa06beb0ad3ce3d39036e437be3c834aa422336815e7ad13079abad7a3ce' +
  '76b42e54eb4bcc5582d85a88a82dddaadad6aefe85887b06e523330e07bc3b0fdac209cefb22832b011e6653705ab2e2' +
  '69f9fb30e2e32517f4daff804a3512a1c6ff92ddae416af054a7c689b14ba41f7ff2ffadd6978d208346e9d727436cb7' +
  '04ad7501ae90fea5f3aeeee98';

const V8_URI =
  'otpauth://totp/%C4%B0necek%20Var:moderator.e2e%40example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=%C4%B0necek%20Var';

function hex(modules: readonly (readonly boolean[])[]): string {
  const bits = modules.map((row) => row.map((dark) => (dark ? '1' : '0')).join('')).join('');
  let out = '';
  for (let i = 0; i < bits.length; i += 4)
    out += parseInt(bits.slice(i, i + 4).padEnd(4, '0'), 2).toString(16);
  return out;
}

describe('QR encoder', () => {
  it.each(V1_MASKS.map((expected, mask) => [mask, expected] as const))(
    'matches the reference for version 1, mask %i',
    (mask, expected) => {
      const matrix = encodeQr('HELLO-QR', { mask });
      expect(matrix.version).toBe(1);
      expect(matrix.size).toBe(21);
      expect(hex(matrix.modules)).toBe(expected);
    },
  );

  it('matches the reference for an otpauth URI (version 8, version bits, four blocks)', () => {
    const matrix = encodeQr(V8_URI);
    expect(matrix.version).toBe(8);
    expect(matrix.mask).toBe(7);
    expect(hex(matrix.modules)).toBe(V8_AUTO);
  });

  it('chooses the lowest-penalty mask', () => {
    const chosen = encodeQr('HELLO-QR');
    const scores = Array.from({ length: 8 }, (_, mask) =>
      penalty(encodeQr('HELLO-QR', { mask }).modules),
    );
    expect(chosen.mask).toBe(scores.indexOf(Math.min(...scores)));
    expect(chosen.mask).toBe(4);
  });

  it('draws one path of unit squares inside a quiet zone, from integers only', () => {
    const drawing = qrPath(encodeQr('HELLO-QR'));
    expect(drawing.viewBox).toBe('0 0 29 29');
    expect(drawing.d).toMatch(/^(M\d+ \d+h1v1h-1z)+$/);
    expect(drawing.d.startsWith('M4 4h1v1h-1z')).toBe(true);
  });

  it('refuses data beyond version 40 and invalid masks', () => {
    expect(() => encodeQr('x'.repeat(2332))).toThrow('QR data too long');
    expect(() => encodeQr('x', { mask: 8 })).toThrow('Invalid QR mask');
    expect(encodeQr('x'.repeat(2331)).version).toBe(40);
  });
});
