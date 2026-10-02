import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { FormError } from '../../../../../src/auth/components';
import { useAsyncAction } from '../../../../../src/auth/use-async-action';
import {
  ChoiceGroup,
  MatchScreen,
  matchHref,
  RoleError,
  SectionTitle,
} from '../../../../../src/matches/components';
import { type LineupSide } from '../../../../../src/matches/contracts';
import { matchesApi } from '../../../../../src/matches/instance';
import {
  draftToAssignments,
  type LineupDraft,
  sideCapacity,
  sideCount,
  suggestLineup,
} from '../../../../../src/matches/lineup';
import { useMatchBusy, useSetLineup } from '../../../../../src/matches/mutations';
import { canSetLineup } from '../../../../../src/matches/permissions';
import { useMatchScreen } from '../../../../../src/matches/use-match';
import { CachedNotice, Notice, ResourceState, Section } from '../../../../../src/teams/components';
import { useTheme } from '../../../../../src/theme';
import { Button, ListItem, Text } from '../../../../../src/ui';

type Slot = LineupSide | 'bench';

/**
 * Lineup of a match (`PUT /api/v1/matches/:id/lineup`, captain and co-captain while the match is
 * `open` or `locked`; ADR-0035). Staff assign each confirmed player to side A, side B or the
 * bench by tapping; "auto-balance" fills the sides by position as a suggestion; nothing is sent
 * before "save", which replaces the whole lineup. Everyone else sees the sides read-only.
 */
export default function LineupScreen() {
  const { t } = useTranslation('matches');
  const { t: tt } = useTranslation('teams');
  const theme = useTheme();
  const { matchId, teamId, query, match, myUserId, role, roleError, retryRole } = useMatchScreen();
  const save = useSetLineup(matchesApi, matchId, teamId);
  const busy = useMatchBusy(matchId);
  const action = useAsyncAction();
  // `null` while the stored lineup is shown unchanged.
  const [draft, setDraft] = useState<Map<string, LineupSide | null> | null>(null);
  const back = matchHref(teamId, matchId);

  if (match === undefined) {
    return (
      <MatchScreen title={t('lineup.title')} back={back} testID="lineup-screen">
        <ResourceState
          status={query.status === 'error' ? 'error' : 'pending'}
          error={query.error}
          onRetry={() => void query.refetch()}
          missingTitle={t('detail.missingTitle')}
          missingMessage={t('detail.missingMessage')}
          testID="lineup"
        />
      </MatchScreen>
    );
  }

  const confirmed = match.participants
    .filter((row) => row.status === 'in')
    .map((row) => ({
      id: row.user.id,
      name: row.user.displayName,
      position: row.user.position,
      side: row.side,
    }));
  const stored: LineupDraft = new Map(confirmed.map((row) => [row.id, row.side]));
  const current: LineupDraft = draft ?? stored;
  const editable = match.projection === 'member' && canSetLineup(role, match.status);
  const capacity = match.projection === 'member' ? sideCapacity(match.slots) : null;
  const confirmedIds = confirmed.map((row) => row.id);
  const dirty =
    draft !== null &&
    confirmedIds.some((id) => (draft.get(id) ?? null) !== (stored.get(id) ?? null));
  const disabled = busy || action.busy;
  const label = (id: string, name: string): string =>
    id === myUserId ? t('participants.you', { name }) : name;

  const assign = (userId: string, slot: Slot): void => {
    const next = new Map(current);
    next.set(userId, slot === 'bench' ? null : slot);
    setDraft(next);
  };

  const autoBalance = (): void => {
    const next = new Map<string, LineupSide | null>(confirmedIds.map((id) => [id, null]));
    for (const { userId, side } of suggestLineup(
      confirmed.map((row) => ({ userId: row.id, position: row.position })),
      match.projection === 'member' ? match.slots : confirmed.length,
    )) {
      next.set(userId, side);
    }
    setDraft(next);
  };

  const submit = (): void => {
    void action.run(async () => {
      await save.mutateAsync(draftToAssignments(current, confirmedIds));
      setDraft(null);
    });
  };

  const sideTitle = (side: Slot): string =>
    side === 'bench'
      ? t('lineup.bench')
      : capacity === null
        ? t('lineup.side', { side })
        : t('lineup.sideCount', {
            side,
            number: sideCount(current, side),
            capacity,
          });

  return (
    <MatchScreen
      title={t('lineup.title')}
      subtitle={match.team.name}
      back={back}
      testID="lineup-screen"
    >
      <CachedNotice visible={query.isError} />
      {roleError === null ? null : <RoleError error={roleError} onRetry={retryRole} />}
      {confirmed.length === 0 ? (
        <Section>
          <Notice testID="lineup-empty">{t('lineup.empty')}</Notice>
        </Section>
      ) : editable ? (
        <>
          <Section>
            <Text tone="muted">{t('lineup.editHint')}</Text>
            <Text tabular style={{ marginTop: theme.spacing['2'] }} testID="lineup-counts">
              {`${sideTitle('A')} · ${sideTitle('B')}`}
            </Text>
          </Section>
          {confirmed.map((row) => {
            const slot: Slot = current.get(row.id) ?? 'bench';
            const full = (side: LineupSide): boolean =>
              capacity !== null && slot !== side && sideCount(current, side) >= capacity;
            const name = label(row.id, row.name);
            return (
              <Section key={row.id}>
                <Text variant="label">{name}</Text>
                {row.position === null ? null : (
                  <Text variant="footnote" tone="muted">
                    {tt(`member.position.${row.position}`)}
                  </Text>
                )}
                <View style={{ marginTop: theme.spacing['2'] }}>
                  <ChoiceGroup
                    label={t('lineup.assign', { name })}
                    options={(['A', 'B', 'bench'] as const).map((value) => ({
                      value,
                      label: value === 'bench' ? t('lineup.bench') : value,
                      accessibilityLabel: t('lineup.assignOption', {
                        name,
                        side:
                          value === 'bench' ? t('lineup.bench') : t('lineup.side', { side: value }),
                      }),
                      disabled: value !== 'bench' && full(value),
                    }))}
                    selected={slot}
                    onSelect={(value) => assign(row.id, value)}
                    disabled={disabled}
                    testID={`lineup-${row.id}`}
                  />
                </View>
              </Section>
            );
          })}
          <Section>
            <FormError error={action.error} />
            {dirty ? (
              <Text tone="muted" accessibilityLiveRegion="polite" testID="lineup-dirty">
                {t('lineup.unsaved')}
              </Text>
            ) : null}
            <Button
              label={t('lineup.autoBalance')}
              variant="secondary"
              disabled={disabled}
              onPress={autoBalance}
              testID="lineup-auto"
              style={{ marginTop: theme.spacing['3'] }}
            />
            <Button
              label={t('lineup.save')}
              loading={action.busy}
              disabled={busy}
              onPress={submit}
              testID="lineup-save"
              style={{ marginTop: theme.spacing['3'] }}
            />
          </Section>
        </>
      ) : (
        (['A', 'B', 'bench'] as const).map((side) => {
          const players = confirmed.filter((row) => (row.side ?? 'bench') === side);
          return (
            <View key={side} testID={`lineup-side-${side}`}>
              <SectionTitle>{sideTitle(side)}</SectionTitle>
              {players.length === 0 ? (
                <Section>
                  <Text tone="muted">{t('lineup.sideEmpty')}</Text>
                </Section>
              ) : (
                players.map((row) => (
                  <ListItem
                    key={row.id}
                    title={label(row.id, row.name)}
                    subtitle={
                      row.position === null ? undefined : tt(`member.position.${row.position}`)
                    }
                    testID={`lineup-player-${row.id}`}
                  />
                ))
              )}
            </View>
          );
        })
      )}
      {!editable && confirmed.length > 0 ? (
        <Section>
          <Text variant="footnote" tone="muted" testID="lineup-readonly">
            {t('lineup.readOnly')}
          </Text>
        </Section>
      ) : null}
    </MatchScreen>
  );
}
