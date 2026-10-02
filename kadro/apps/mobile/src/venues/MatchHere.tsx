import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { api } from '../api/instance';
import { teamsQuery } from '../query';
import { Notice, ResourceState } from '../teams/components';
import { useTheme } from '../theme';
import { Button } from '../ui';
import { matchAtVenueHref } from './links';
import { matchTeams } from './permissions';

/**
 * "Bu sahada maç kur": opens the create-match screen of a team in which the viewer is captain or
 * co-captain (and the team is not read-only), with this venue chosen. One such team opens
 * directly, several ask which one. If the teams cannot be loaded, the viewer gets a retry, not a
 * "you are not staff" message.
 */
export function MatchHere({ venueId }: { readonly venueId: string }) {
  const { t } = useTranslation('venues');
  const theme = useTheme();
  const router = useRouter();
  const teams = useInfiniteQuery(teamsQuery(api));
  const [choosing, setChoosing] = useState(false);

  if (teams.data === undefined) {
    return (
      <ResourceState
        status={teams.status === 'error' ? 'error' : 'pending'}
        error={teams.error}
        onRetry={() => void teams.refetch()}
        missingTitle={t('matchHere.teamsMissing')}
        missingMessage={t('matchHere.teamsMissing')}
        testID="match-here-teams"
      />
    );
  }

  const staffTeams = matchTeams(teams.data.pages.flatMap((page) => page.items));
  const [only] = staffTeams;
  if (only === undefined) {
    return <Notice testID="match-here-none">{t('matchHere.none')}</Notice>;
  }
  if (staffTeams.length === 1) {
    return (
      <Button
        label={t('matchHere.label')}
        accessibilityHint={t('matchHere.hintTeam', { team: only.name })}
        onPress={() => router.push(matchAtVenueHref(only.id, venueId))}
        testID="match-here"
      />
    );
  }
  return (
    <View>
      <Button
        label={t('matchHere.label')}
        accessibilityHint={t('matchHere.hintChoose')}
        variant={choosing ? 'secondary' : 'primary'}
        onPress={() => setChoosing((value) => !value)}
        testID="match-here"
      />
      {choosing ? (
        <View style={{ marginTop: theme.spacing['3'], gap: theme.spacing['2'] }}>
          {staffTeams.map((team) => (
            <Button
              key={team.id}
              label={t('matchHere.forTeam', { team: team.name })}
              variant="secondary"
              onPress={() => router.push(matchAtVenueHref(team.id, venueId))}
              testID={`match-here-${team.id}`}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}
