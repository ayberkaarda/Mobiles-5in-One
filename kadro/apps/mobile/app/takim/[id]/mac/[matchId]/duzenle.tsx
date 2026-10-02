import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { FormError } from '../../../../../src/auth/components';
import { useAsyncAction } from '../../../../../src/auth/use-async-action';
import { MatchScreen, matchHref, RoleError } from '../../../../../src/matches/components';
import { type MatchMemberView } from '../../../../../src/matches/contracts';
import { changedFields } from '../../../../../src/matches/edit';
import { dateInput, liraInput, timeInput } from '../../../../../src/matches/form';
import { matchesApi } from '../../../../../src/matches/instance';
import {
  MatchForm,
  type MatchFormInitial,
  type MatchFormValues,
} from '../../../../../src/matches/MatchForm';
import { useMatchBusy, useUpdateMatch } from '../../../../../src/matches/mutations';
import { canEditMatch, termsFrozen } from '../../../../../src/matches/permissions';
import { useMatchScreen } from '../../../../../src/matches/use-match';
import { Notice, ResourceState, Section } from '../../../../../src/teams/components';
import { SkeletonList } from '../../../../../src/ui';

function initialValues(match: MatchMemberView): MatchFormInitial {
  return {
    venue:
      match.venue === null
        ? { kind: 'text', text: match.venueText ?? '' }
        : { kind: 'directory', id: match.venue.id, name: match.venue.name },
    date: dateInput(match.startsAt),
    time: timeInput(match.startsAt),
    format: match.format,
    slots: String(match.slots),
    fee: liraInput(match.feeTotalMinor),
  };
}

/** Edit a match (captain and co-captain; `draft`, `open` and `locked`, ADR-0004). */
export default function EditMatchScreen() {
  const { t } = useTranslation('matches');
  const router = useRouter();
  const { matchId, teamId, query, match, role, roleLoading, roleError, retryRole } =
    useMatchScreen();
  const update = useUpdateMatch(matchesApi, matchId, teamId);
  const busy = useMatchBusy(matchId);
  const action = useAsyncAction();
  const back = matchHref(teamId, matchId);

  if (match === undefined) {
    return (
      <MatchScreen title={t('edit.title')} back={back} testID="edit-match-screen">
        <ResourceState
          status={query.status === 'error' ? 'error' : 'pending'}
          error={query.error}
          onRetry={() => void query.refetch()}
          missingTitle={t('detail.missingTitle')}
          missingMessage={t('detail.missingMessage')}
          testID="edit-match"
        />
      </MatchScreen>
    );
  }
  if (roleLoading) {
    return (
      <MatchScreen title={t('edit.title')} back={back} testID="edit-match-screen">
        <SkeletonList rows={3} accessibilityLabel={t('edit.title')} />
      </MatchScreen>
    );
  }
  if (roleError !== null) {
    // A captain offline without a saved team must not be told they may not edit.
    return (
      <MatchScreen title={t('edit.title')} back={back} testID="edit-match-screen">
        <RoleError error={roleError} onRetry={retryRole} />
      </MatchScreen>
    );
  }
  if (match.projection !== 'member' || !canEditMatch(role, match.status)) {
    return (
      <MatchScreen title={t('edit.title')} back={back} testID="edit-match-screen">
        <Section>
          <Notice testID="edit-match-not-allowed">{t('edit.notAllowed')}</Notice>
        </Section>
      </MatchScreen>
    );
  }

  const frozen = termsFrozen(match);
  const leave = (): void => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(back);
    }
  };
  const save = (values: MatchFormValues): void => {
    const body = changedFields(match, values, frozen);
    if (body === null) {
      leave();
      return;
    }
    void action.run(async () => {
      await update.mutateAsync(body);
      leave();
    });
  };

  return (
    <MatchScreen
      title={t('edit.title')}
      subtitle={match.team.name}
      back={back}
      testID="edit-match-screen"
    >
      <Section>
        <FormError error={action.error} />
      </Section>
      <MatchForm
        initial={initialValues(match)}
        termsLocked={frozen}
        storedStartsAt={match.startsAt}
        busy={action.busy || busy}
        actions={[{ label: t('edit.save'), testID: 'edit-match-save', onSubmit: save }]}
      />
    </MatchScreen>
  );
}
