import { View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { useTheme } from '../theme';

/**
 * QR code of an invite link (product spec §3 story 2). Dark modules on a white field in both color
 * schemes, with a quiet zone, so phone cameras read it on a dark screen too. Announced as one
 * image with a label; the link itself is shown as text next to it.
 */
export function InviteQr({
  url,
  label,
  size = 200,
}: {
  readonly url: string;
  readonly label: string;
  readonly size?: number;
}) {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      testID="invite-qr"
      style={{
        alignSelf: 'center',
        padding: theme.spacing['4'],
        backgroundColor: '#FFFFFF',
        borderRadius: theme.radius.md,
      }}
    >
      <QRCode value={url} size={size} color="#000000" backgroundColor="#FFFFFF" ecl="M" />
    </View>
  );
}
