import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '../../src/api/instance';
import { FormError } from '../../src/auth/components';
import { useAsyncAction } from '../../src/auth/use-async-action';
import { meQuery } from '../../src/query';
import { Notice, ResourceState, Section, TeamScreen } from '../../src/teams/components';
import { teamsApi } from '../../src/teams/instance';
import { useCreateTeam } from '../../src/teams/mutations';
import { TEAM_LIMITS, teamNameIssue } from '../../src/teams/validation';
import { useTheme } from '../../src/theme';
import { Button, TextField } from '../../src/ui';

const NAME_PARAMS = { min: TEAM_LIMITS.nameMin, max: TEAM_LIMITS.nameMax } as const;

/**
 * Create a team (`POST /api/v1/teams`); the user becomes its captain. The district comes from the
 * profile: there is no district list endpoint for a picker yet (see ADR-0050).
 */
export default function CreateTeamScreen() {
  const { t } = useTranslation('teams');
  const theme = useTheme();
  const router = useRouter();
  const me = useQuery(meQuery(api));
  const create = useCreateTeam(teamsApi);
  const action = useAsyncAction();
  const [name, setName] = useState('');
  const [issue, setIssue] = useState<string | null>(null);

  const districtId = me.data?.districtId ?? null;

  const submit = (): void => {
    if (districtId === null) {
      return;
    }
    const nameIssue = teamNameIssue(name);
    setIssue(nameIssue);
    if (nameIssue !== null) {
      return;
    }
    // One request per press series: a repeated POST would create a second team.
    void action.run(async () => {
      const team = await create.mutateAsync({ name: name.trim(), districtId });
      router.replace(`/takim/${encodeURIComponent(team.id)}`);
    });
  };

  if (me.data === undefined) {
    return (
      <TeamScreen title={t('create.title')} testID="create-team-screen">
        <ResourceState
          status={me.status === 'error' ? 'error' : 'pending'}
          error={me.error}
          onRetry={() => void me.refetch()}
          missingTitle={t('create.title')}
          missingMessage={t('create.noDistrict')}
          testID="create-team"
        />
      </TeamScreen>
    );
  }

  return (
    <TeamScreen title={t('create.title')} testID="create-team-screen">
      <Section>
        <Notice>{t('create.subtitle')}</Notice>
      </Section>
      {me.data.emailVerified ? null : (
        <Section>
          <Notice testID="create-team-unverified">{t('create.unverified')}</Notice>
        </Section>
      )}
      <Section>
        <FormError error={action.error} />
        <TextField
          label={t('create.name')}
          helperText={t('create.nameHint', NAME_PARAMS)}
          value={name}
          onChangeText={(value) => {
            setName(value);
            if (issue !== null) {
              setIssue(null);
            }
          }}
          error={issue === null ? null : t(issue, NAME_PARAMS)}
          editable={!action.busy}
          maxLength={TEAM_LIMITS.nameMax + 20}
          autoCapitalize="words"
          returnKeyType="go"
          onSubmitEditing={submit}
          testID="team-name"
        />
        {districtId === null ? (
          <>
            <Notice testID="create-team-no-district">{t('create.noDistrict')}</Notice>
            <Button
              label={t('create.openProfile')}
              variant="secondary"
              onPress={() => router.push('/profil')}
              style={{ marginTop: theme.spacing['3'] }}
            />
          </>
        ) : (
          <>
            <Notice>{t('create.districtFromProfile')}</Notice>
            <Button
              label={t('create.submit')}
              loading={action.busy}
              onPress={submit}
              testID="create-team-submit"
              style={{ marginTop: theme.spacing['4'] }}
            />
          </>
        )}
      </Section>
    </TeamScreen>
  );
}
