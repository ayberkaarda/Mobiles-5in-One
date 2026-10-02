import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { api } from '../../../src/api/instance';
import { type TeamMember } from '../../../src/api/contracts';
import { FormError } from '../../../src/auth/components';
import { useAsyncAction } from '../../../src/auth/use-async-action';
import { meQuery } from '../../../src/query';
import {
  CachedNotice,
  ConfirmAction,
  Notice,
  ResourceState,
  Section,
  TEAMS_HOME,
  TeamScreen,
} from '../../../src/teams/components';
import { teamsApi } from '../../../src/teams/instance';
import { useLeaveTeam, useRosterBusy } from '../../../src/teams/mutations';
import {
  canLeave,
  canManageInvites,
  canRemoveMember,
  ROLE_ORDER,
  roleChoices,
} from '../../../src/teams/permissions';
import { teamDetailQuery } from '../../../src/teams/queries';
import { useTheme } from '../../../src/theme';
import { Button, ListItem, Text } from '../../../src/ui';

function sortedRoster(members: readonly TeamMember[]): TeamMember[] {
  return [...members].sort(
    (a, b) =>
      ROLE_ORDER[a.role] - ROLE_ORDER[b.role] ||
      a.user.displayName.localeCompare(b.user.displayName, 'tr'),
  );
}

/** Team with its roster (`GET /api/v1/teams/:id`), invites entry and leaving. */
export default function TeamDetailScreen() {
  const { t } = useTranslation('teams');
  const { t: tc } = useTranslation('common');
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const teamId = typeof params.id === 'string' ? params.id : '';
  const leave = useLeaveTeam(teamsApi, teamId);
  // After leaving, the roster is dropped from the cache and must not be fetched again (404)
  // while the screen is on its way out.
  const query = useQuery({
    ...teamDetailQuery(teamsApi, teamId),
    enabled: teamId !== '' && !leave.isSuccess,
  });
  const me = useQuery(meQuery(api));
  const rosterBusy = useRosterBusy(teamId);
  const action = useAsyncAction();

  const team = query.data;
  if (team === undefined) {
    return (
      <TeamScreen testID="team-screen">
        <ResourceState
          status={query.status === 'error' ? 'error' : 'pending'}
          error={query.error}
          onRetry={() => void query.refetch()}
          missingTitle={t('detail.missingTitle')}
          missingMessage={t('detail.missingMessage')}
          testID="team"
        />
      </TeamScreen>
    );
  }

  const myId = me.data?.id ?? null;
  const roleName = (role: TeamMember['role']): string => tc(`teams.role.${role}`);

  const leaveTeam = (): void => {
    if (myId === null) {
      return;
    }
    void action.run(async () => {
      await leave.mutateAsync(myId);
      router.replace(TEAMS_HOME);
    });
  };

  return (
    <TeamScreen title={team.name} testID="team-screen">
      <CachedNotice visible={query.isError} />
      <Section>
        <Text tone="muted" tabular>
          {t('detail.summary', { role: roleName(team.myRole), number: team.memberCount })}
        </Text>
      </Section>
      {team.isProLocked ? (
        <Section>
          <Notice testID="team-locked">{t('detail.locked')}</Notice>
        </Section>
      ) : null}
      {canManageInvites(team.myRole) ? (
        <Section>
          <Button
            label={t('detail.invite')}
            variant="accent"
            onPress={() => router.push(`/takim/${encodeURIComponent(team.id)}/davet`)}
            testID="team-invite"
          />
        </Section>
      ) : null}

      <Text
        variant="title3"
        style={{ paddingHorizontal: theme.spacing['4'], marginBottom: theme.spacing['2'] }}
      >
        {t('detail.roster')}
      </Text>
      <View style={{ marginBottom: theme.spacing['5'] }} testID="team-roster">
        {sortedRoster(team.members).map((member) => {
          const isSelf = member.user.id === myId;
          const target = { role: member.role, isSelf };
          const manageable =
            myId !== null &&
            (roleChoices(team.myRole, target).length > 0 || canRemoveMember(team.myRole, target));
          const position =
            member.user.position === null ? null : t(`member.position.${member.user.position}`);
          return (
            <View
              key={member.user.id}
              style={{ borderBottomWidth: 1, borderBottomColor: theme.colors.border }}
            >
              <ListItem
                title={
                  isSelf
                    ? t('detail.you', { name: member.user.displayName })
                    : member.user.displayName
                }
                subtitle={[roleName(member.role), position].filter(Boolean).join(' · ')}
                accessibilityHint={manageable ? t('detail.memberHint') : undefined}
                disabled={rosterBusy}
                onPress={
                  manageable
                    ? () =>
                        router.push(
                          `/takim/${encodeURIComponent(team.id)}/uye/${encodeURIComponent(member.user.id)}`,
                        )
                    : undefined
                }
                testID={`member-${member.user.id}`}
              />
            </View>
          );
        })}
      </View>

      <Section>
        <FormError error={action.error} />
        {canLeave(team.myRole) ? (
          <ConfirmAction
            label={t('detail.leave')}
            question={t('detail.leaveQuestion', { team: team.name })}
            confirmLabel={t('detail.leaveConfirm')}
            cancelLabel={t('detail.cancel')}
            onConfirm={leaveTeam}
            busy={action.busy}
            disabled={myId === null || rosterBusy}
            testID="team-leave"
          />
        ) : (
          <Notice testID="team-captain-leave">{t('detail.captainCannotLeave')}</Notice>
        )}
      </Section>
    </TeamScreen>
  );
}
