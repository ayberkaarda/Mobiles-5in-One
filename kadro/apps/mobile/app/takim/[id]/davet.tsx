import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { api } from '../../../src/api/instance';
import { type CreateInviteResponse } from '../../../src/api/contracts';
import { FormError } from '../../../src/auth/components';
import { useAsyncAction } from '../../../src/auth/use-async-action';
import { formatDateTime } from '../../../src/i18n/format';
import { meQuery } from '../../../src/query';
import {
  ConfirmAction,
  Notice,
  ResourceState,
  Section,
  SectionHeading,
  TeamScreen,
} from '../../../src/teams/components';
import { teamsApi } from '../../../src/teams/instance';
import { InviteQr } from '../../../src/teams/InviteQr';
import { activeInvites } from '../../../src/teams/invites';
import { useCreateInvite, useRevokeInvite } from '../../../src/teams/mutations';
import { canCreateInvite, canManageInvites } from '../../../src/teams/permissions';
import { teamDetailQuery, teamInvitesQuery } from '../../../src/teams/queries';
import { isShareableInviteUrl, systemShare } from '../../../src/teams/share';
import { useTheme } from '../../../src/theme';
import { Button, Card, ListItem, Text } from '../../../src/ui';

function CreatedInvite({
  invite,
  teamName,
}: {
  readonly invite: CreateInviteResponse;
  readonly teamName: string;
}) {
  const { t, i18n } = useTranslation('teams');
  const theme = useTheme();
  const [shareFailed, setShareFailed] = useState(false);
  const shareable = isShareableInviteUrl(invite.url, invite.code);

  return (
    <Card testID="invite-created">
      <Text variant="footnote" tone="muted" accessibilityLiveRegion="polite">
        {t('invites.onceNotice')}
      </Text>
      <Text variant="label" style={{ marginTop: theme.spacing['3'] }}>
        {t('invites.code')}
      </Text>
      <Text selectable tabular testID="invite-code">
        {invite.code}
      </Text>
      {shareable ? (
        <>
          <Text variant="label" style={{ marginTop: theme.spacing['3'] }}>
            {t('invites.link')}
          </Text>
          <Text selectable tone="link" testID="invite-url">
            {invite.url}
          </Text>
          <View style={{ marginVertical: theme.spacing['4'] }}>
            <InviteQr url={invite.url} label={t('invites.qrLabel')} />
          </View>
        </>
      ) : null}
      <Text variant="footnote" tone="muted" tabular>
        {t('invites.validity', {
          date: formatDateTime(invite.expiresAt, i18n.language),
          number: invite.maxUses,
        })}
      </Text>
      {shareable ? (
        <Button
          label={t('invites.share')}
          onPress={() => {
            setShareFailed(false);
            systemShare
              .share(t('invites.shareMessage', { team: teamName, url: invite.url }))
              .catch(() => setShareFailed(true));
          }}
          testID="invite-share"
          style={{ marginTop: theme.spacing['4'] }}
        />
      ) : null}
      {shareFailed ? (
        <Text
          tone="danger"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={{ marginTop: theme.spacing['2'] }}
        >
          {t('invites.shareFailed')}
        </Text>
      ) : null}
    </Card>
  );
}

/**
 * Invites of a team for its captain and co-captains (ADR-0034): create a link (shown once, with
 * QR code and share sheet), list the active ones, revoke one. The created code lives only in this
 * screen's state, never in a query cache or on disk.
 */
export default function TeamInvitesScreen() {
  const { t, i18n } = useTranslation('teams');
  const theme = useTheme();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const teamId = typeof params.id === 'string' ? params.id : '';
  const teamQuery = useQuery({ ...teamDetailQuery(teamsApi, teamId), enabled: teamId !== '' });
  const team = teamQuery.data;
  const staff = team !== undefined && canManageInvites(team.myRole);
  const invitesQuery = useQuery({ ...teamInvitesQuery(teamsApi, teamId), enabled: staff });
  const me = useQuery(meQuery(api));
  const create = useCreateInvite(teamsApi, teamId);
  const revoke = useRevokeInvite(teamsApi, teamId);
  const createAction = useAsyncAction();
  const revokeAction = useAsyncAction();
  const [created, setCreated] = useState<CreateInviteResponse | null>(null);

  if (team === undefined) {
    return (
      <TeamScreen title={t('invites.title')} testID="invites-screen">
        <ResourceState
          status={teamQuery.status === 'error' ? 'error' : 'pending'}
          error={teamQuery.error}
          onRetry={() => void teamQuery.refetch()}
          missingTitle={t('detail.missingTitle')}
          missingMessage={t('detail.missingMessage')}
          testID="invites-team"
        />
      </TeamScreen>
    );
  }

  if (!staff) {
    return (
      <TeamScreen title={t('invites.title')} testID="invites-screen">
        <Section>
          <Notice testID="invites-staff-only">{t('invites.staffOnly')}</Notice>
        </Section>
      </TeamScreen>
    );
  }

  const createInvite = (): void => {
    void createAction.run(async () => {
      setCreated(await create.mutateAsync());
    });
  };

  const active = activeInvites(invitesQuery.data?.items ?? []);

  return (
    <TeamScreen title={t('invites.title')} testID="invites-screen">
      <Section>
        <Text tone="muted">{t('invites.intro')}</Text>
      </Section>
      <Section>
        {canCreateInvite(team) ? (
          <>
            {me.data?.emailVerified === false ? (
              <View style={{ marginBottom: theme.spacing['3'] }}>
                <Notice testID="invites-unverified">{t('invites.unverified')}</Notice>
              </View>
            ) : null}
            <FormError error={createAction.error} />
            <Button
              label={created === null ? t('invites.create') : t('invites.createAnother')}
              variant={created === null ? 'primary' : 'secondary'}
              loading={createAction.busy}
              onPress={createInvite}
              testID="invites-create"
            />
          </>
        ) : (
          <Notice testID="invites-locked">{t('invites.locked')}</Notice>
        )}
      </Section>
      {created === null ? null : (
        <Section>
          <CreatedInvite invite={created} teamName={team.name} />
        </Section>
      )}

      <SectionHeading>{t('invites.active')}</SectionHeading>
      {invitesQuery.data === undefined ? (
        <ResourceState
          status={invitesQuery.status === 'error' ? 'error' : 'pending'}
          error={invitesQuery.error}
          onRetry={() => void invitesQuery.refetch()}
          missingTitle={t('detail.missingTitle')}
          missingMessage={t('detail.missingMessage')}
          testID="invites-list"
        />
      ) : (
        <View testID="invites-list">
          <Section>
            <FormError error={revokeAction.error} />
          </Section>
          {active.length === 0 ? (
            <Section>
              <Text tone="muted" testID="invites-empty">
                {t('invites.activeEmpty')}
              </Text>
            </Section>
          ) : (
            active.map((invite) => (
              <View
                key={invite.id}
                style={{ borderBottomWidth: 1, borderBottomColor: theme.colors.border }}
              >
                <ListItem
                  title={t('invites.activeItem', {
                    date: formatDateTime(invite.expiresAt, i18n.language),
                    uses: invite.uses,
                    max: invite.maxUses,
                  })}
                  testID={`invite-${invite.id}`}
                />
                <View style={{ paddingHorizontal: theme.spacing['4'] }}>
                  <ConfirmAction
                    label={t('invites.revoke')}
                    question={t('invites.revokeQuestion')}
                    confirmLabel={t('invites.revokeConfirm')}
                    cancelLabel={t('invites.cancel')}
                    onConfirm={() =>
                      void revokeAction.run(async () => {
                        await revoke.mutateAsync(invite.id);
                      })
                    }
                    busy={revoke.isPending && revoke.variables === invite.id}
                    disabled={revokeAction.busy}
                    testID={`invite-revoke-${invite.id}`}
                  />
                </View>
              </View>
            ))
          )}
        </View>
      )}
    </TeamScreen>
  );
}
