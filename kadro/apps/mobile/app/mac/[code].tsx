import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { TeamScreen } from '../../src/teams/components';
import { isInviteCode } from '../../src/teams/invite-code';
import { InviteJoin } from '../../src/teams/InviteJoin';
import { ErrorState } from '../../src/ui';

/**
 * Invite link target: `https://<web origin>/mac/<code>` and `kadro://mac/<code>` (ADR-0034; the
 * web landing page has the same path). A malformed code is rejected here without a request.
 */
export default function InviteLinkScreen() {
  const { t } = useTranslation('teams');
  const params = useLocalSearchParams<{ code?: string | string[] }>();
  const code = typeof params.code === 'string' ? params.code : '';

  return (
    <TeamScreen title={t('invite.title')} testID="invite-link-screen">
      {isInviteCode(code) ? (
        <InviteJoin code={code} />
      ) : (
        <ErrorState
          title={t('invite.invalidTitle')}
          message={t('invite.invalidMessage')}
          testID="invite-malformed"
        />
      )}
    </TeamScreen>
  );
}
