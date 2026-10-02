import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '../../../../src/api/instance';
import { type TeamMember, type TeamRole } from '../../../../src/api/contracts';
import { FormError } from '../../../../src/auth/components';
import { useAsyncAction } from '../../../../src/auth/use-async-action';
import { formatDateTime } from '../../../../src/i18n/format';
import { meQuery } from '../../../../src/query';
import {
  ConfirmAction,
  Notice,
  ResourceState,
  Section,
  TeamScreen,
} from '../../../../src/teams/components';
import { teamsApi } from '../../../../src/teams/instance';
import {
  useChangeMemberRole,
  useRemoveMember,
  useRosterBusy,
} from '../../../../src/teams/mutations';
import { canRemoveMember, roleChoices } from '../../../../src/teams/permissions';
import { teamDetailQuery } from '../../../../src/teams/queries';
import { useTheme } from '../../../../src/theme';
import { Button, Card, ErrorState, Text } from '../../../../src/ui';

function param(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : '';
}

/**
 * One member of the roster with what the viewer may do: role change and captaincy transfer
 * (captain, ADR-0008), removal (captain: anyone else, co-captain: players). The server decides;
 * these controls only follow the authorization matrix §3.3.
 */
export default function MemberScreen() {
  const { t, i18n } = useTranslation('teams');
  const { t: tc } = useTranslation('common');
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[]; userId?: string | string[] }>();
  const teamId = param(params.id);
  const userId = param(params.userId);
  const query = useQuery({ ...teamDetailQuery(teamsApi, teamId), enabled: teamId !== '' });
  const me = useQuery(meQuery(api));
  const changeRole = useChangeMemberRole(teamsApi, teamId);
  const remove = useRemoveMember(teamsApi, teamId);
  const rosterBusy = useRosterBusy(teamId);
  const action = useAsyncAction();
  const found = query.data?.members.find((entry) => entry.user.id === userId);
  // The removal drops the row from the roster before the server answers; until the screen goes
  // back, it keeps showing the member instead of "not found".
  const [removing, setRemoving] = useState<TeamMember | null>(null);

  const team = query.data;
  if (team === undefined) {
    return (
      <TeamScreen testID="member-screen">
        <ResourceState
          status={query.status === 'error' ? 'error' : 'pending'}
          error={query.error}
          onRetry={() => void query.refetch()}
          missingTitle={t('detail.missingTitle')}
          missingMessage={t('detail.missingMessage')}
          testID="member"
        />
      </TeamScreen>
    );
  }

  const member = found ?? removing ?? undefined;
  if (member === undefined) {
    return (
      <TeamScreen testID="member-screen">
        <ErrorState
          title={t('member.missingTitle')}
          message={t('member.missingMessage')}
          testID="member-missing"
        />
      </TeamScreen>
    );
  }

  const name = member.user.displayName;
  const target = { role: member.role, isSelf: me.data?.id === member.user.id };
  // Nothing is offered until the viewer's own id is known: the captain must never see controls
  // for their own row.
  const known = me.data !== undefined;
  const choices = known ? roleChoices(team.myRole, target) : [];
  const removable = known && canRemoveMember(team.myRole, target);
  const busy = action.busy || rosterBusy;

  const setRole = (role: TeamRole): void => {
    void action.run(async () => {
      await changeRole.mutateAsync({ userId: member.user.id, role });
    });
  };

  const removeMember = (): void => {
    setRemoving(member);
    void action.run(async () => {
      // The roster drops the row at once; the screen goes back after the server confirms.
      try {
        await remove.mutateAsync(member.user.id);
      } catch (error) {
        setRemoving(null);
        throw error;
      }
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace(`/takim/${encodeURIComponent(team.id)}`);
      }
    });
  };

  return (
    <TeamScreen title={name} testID="member-screen">
      <Section>
        <Card>
          <Text testID="member-role">
            {t('member.role', { role: tc(`teams.role.${member.role}`) })}
          </Text>
          {member.user.position === null ? null : (
            <Text tone="muted" style={{ marginTop: theme.spacing['1'] }}>
              {t(`member.position.${member.user.position}`)}
            </Text>
          )}
          <Text variant="footnote" tone="muted" style={{ marginTop: theme.spacing['1'] }}>
            {t('member.joined', { date: formatDateTime(member.joinedAt, i18n.language) })}
          </Text>
        </Card>
      </Section>
      <Section>
        <FormError error={action.error} />
        {choices.length === 0 && !removable ? (
          <Notice testID="member-no-actions">{t('member.noActions')}</Notice>
        ) : null}
        {choices
          .filter((role) => role !== 'captain')
          .map((role) => (
            <Button
              key={role}
              label={role === 'co_captain' ? t('member.makeCoCaptain') : t('member.makePlayer')}
              variant="secondary"
              disabled={busy}
              onPress={() => setRole(role)}
              testID={`member-make-${role}`}
              style={{ marginBottom: theme.spacing['3'] }}
            />
          ))}
        {choices.includes('captain') ? (
          <ConfirmAction
            label={t('member.transfer')}
            question={t('member.transferQuestion', { name })}
            confirmLabel={t('member.transferConfirm')}
            cancelLabel={t('member.cancel')}
            onConfirm={() => setRole('captain')}
            disabled={busy}
            testID="member-transfer"
          />
        ) : null}
        {removable ? (
          <ConfirmAction
            label={t('member.remove')}
            question={t('member.removeQuestion', { name })}
            confirmLabel={t('member.removeConfirm')}
            cancelLabel={t('member.cancel')}
            onConfirm={removeMember}
            disabled={busy}
            variant="danger"
            testID="member-remove"
          />
        ) : null}
      </Section>
    </TeamScreen>
  );
}
