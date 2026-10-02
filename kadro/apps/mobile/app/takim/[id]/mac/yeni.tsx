import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { FormError } from '../../../../src/auth/components';
import { useAsyncAction } from '../../../../src/auth/use-async-action';
import { MatchScreen, matchHref, teamMatchesHref } from '../../../../src/matches/components';
import { type CreateMatchRequest } from '../../../../src/matches/contracts';
import { matchesApi } from '../../../../src/matches/instance';
import {
  EMPTY_MATCH_FORM,
  MatchForm,
  type MatchFormValues,
} from '../../../../src/matches/MatchForm';
import { useCreateMatch } from '../../../../src/matches/mutations';
import { canCreateMatch } from '../../../../src/matches/permissions';
import { Notice, ResourceState, Section } from '../../../../src/teams/components';
import { teamsApi } from '../../../../src/teams/instance';
import { teamDetailQuery } from '../../../../src/teams/queries';
import { useVenuePrefill } from '../../../../src/venues/prefill';

function createBody(values: MatchFormValues, status: 'draft' | 'open'): CreateMatchRequest {
  return {
    ...(values.venue.kind === 'directory'
      ? { venueId: values.venue.id }
      : { venueText: values.venue.text }),
    startsAt: values.startsAt,
    format: values.format,
    feeTotalMinor: values.feeTotalMinor,
    slots: values.slots,
    status,
  };
}

/**
 * Create a match (`POST /api/v1/teams/:id/matches`, captain and co-captain of a team that is not
 * read-only). Saved as a draft (players do not see it as open yet) or published as open.
 */
export default function CreateMatchScreen() {
  const { t } = useTranslation('matches');
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[]; venue?: string | string[] }>();
  const teamId = typeof params.id === 'string' ? params.id : '';
  // "Bu sahada maç kur" passes a venue id; its name comes from the cached venue data, never the URL.
  const initial = useVenuePrefill(EMPTY_MATCH_FORM, params.venue);
  const team = useQuery({ ...teamDetailQuery(teamsApi, teamId), enabled: teamId !== '' });
  const create = useCreateMatch(matchesApi, teamId);
  const action = useAsyncAction();
  const back = teamMatchesHref(teamId);

  if (team.data === undefined) {
    return (
      <MatchScreen title={t('create.title')} back={back} testID="create-match-screen">
        <ResourceState
          status={team.status === 'error' ? 'error' : 'pending'}
          error={team.error}
          onRetry={() => void team.refetch()}
          missingTitle={t('team.missingTitle')}
          missingMessage={t('team.missingMessage')}
          testID="create-match"
        />
      </MatchScreen>
    );
  }

  if (!canCreateMatch(team.data)) {
    return (
      <MatchScreen title={t('create.title')} back={back} testID="create-match-screen">
        <Section>
          <Notice testID="create-match-not-allowed">
            {team.data.isProLocked ? t('team.locked') : t('create.staffOnly')}
          </Notice>
        </Section>
      </MatchScreen>
    );
  }

  const save = (values: MatchFormValues, status: 'draft' | 'open'): void => {
    // One request per press series: a repeated POST would create a second match.
    void action.run(async () => {
      const match = await create.mutateAsync(createBody(values, status));
      router.replace(matchHref(teamId, match.id));
    });
  };

  return (
    <MatchScreen
      title={t('create.title')}
      subtitle={team.data.name}
      back={back}
      testID="create-match-screen"
    >
      <Section>
        <FormError error={action.error} />
      </Section>
      <MatchForm
        initial={initial}
        busy={action.busy}
        actions={[
          {
            label: t('create.publish'),
            testID: 'create-match-publish',
            onSubmit: (values) => save(values, 'open'),
          },
          {
            label: t('create.draft'),
            variant: 'secondary',
            testID: 'create-match-draft',
            onSubmit: (values) => save(values, 'draft'),
          },
        ]}
      />
    </MatchScreen>
  );
}
