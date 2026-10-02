import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { api } from '../api/instance';
import { ApiError } from '../api/errors';
import { FormError } from '../auth/components';
import { useAsyncAction } from '../auth/use-async-action';
import { meQuery } from '../query';
import { useTheme } from '../theme';
import { Button, Card, Text } from '../ui';
import { Notice, ResourceState, Section, TEAMS_HOME } from './components';
import { teamsApi } from './instance';
import { useAcceptInvite } from './mutations';
import { invitePreviewQuery } from './queries';

/**
 * Preview and acceptance of one invite (`GET invites/:code`, `POST invites/:code/accept`,
 * ADR-0034). The preview shows only what the contract exposes (name, badge, member count); invalid,
 * expired, revoked and exhausted codes look the same (404) and are final, so no retry is offered.
 */
export function InviteJoin({ code }: { readonly code: string }) {
  const { t } = useTranslation('teams');
  const theme = useTheme();
  const router = useRouter();
  const preview = useQuery({ ...invitePreviewQuery(teamsApi, code), retry: false });
  const me = useQuery(meQuery(api));
  const accept = useAcceptInvite(teamsApi);
  const action = useAsyncAction();

  const join = (): void => {
    void action.run(async () => {
      const { team } = await accept.mutateAsync(code);
      router.replace(`/takim/${encodeURIComponent(team.id)}`);
    });
  };

  if (preview.data === undefined) {
    return (
      <ResourceState
        status={preview.status === 'error' ? 'error' : 'pending'}
        error={preview.error}
        onRetry={() => void preview.refetch()}
        missingTitle={t('invite.invalidTitle')}
        missingMessage={t('invite.invalidMessage')}
        testID="invite"
      />
    );
  }

  const { team } = preview.data;
  const failure = action.error;
  const alreadyMember = failure instanceof ApiError && failure.code === 'already_participant';
  const gone = failure instanceof ApiError && failure.status === 404;

  return (
    <View testID="invite-preview">
      <Section>
        <Card>
          <Text variant="title2">{team.name}</Text>
          <Text tone="muted" tabular style={{ marginTop: theme.spacing['1'] }}>
            {t('invite.members', { number: team.memberCount })}
          </Text>
        </Card>
      </Section>
      {me.data?.emailVerified === false ? (
        <Section>
          <Notice testID="invite-unverified">{t('invite.unverified')}</Notice>
        </Section>
      ) : null}
      <Section>
        {alreadyMember ? (
          <>
            <Text accessibilityRole="alert" accessibilityLiveRegion="polite" testID="invite-member">
              {t('invite.alreadyMember')}
            </Text>
            <Button
              label={t('invite.openTeams')}
              onPress={() => router.replace(TEAMS_HOME)}
              style={{ marginTop: theme.spacing['4'] }}
            />
          </>
        ) : gone ? (
          <Text accessibilityRole="alert" accessibilityLiveRegion="polite" testID="invite-gone">
            {t('invite.invalidMessage')}
          </Text>
        ) : (
          <>
            <FormError error={failure} />
            <Button
              label={t('invite.accept')}
              accessibilityHint={t('invite.acceptHint')}
              loading={action.busy}
              onPress={join}
              testID="invite-accept"
            />
          </>
        )}
      </Section>
    </View>
  );
}
