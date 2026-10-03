import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { FormError } from '../../../../../src/auth/components';
import { useAsyncAction } from '../../../../../src/auth/use-async-action';
import { OpenCallEntry } from '../../../../../src/calls/components';
import { formatDateTime, formatLira } from '../../../../../src/i18n/format';
import {
  ChoiceGroup,
  MATCHES_HOME,
  Fact,
  kickoffTime,
  MatchScreen,
  matchHref,
  RoleError,
  SectionTitle,
  teamMatchesHref,
} from '../../../../../src/matches/components';
import {
  type MatchDetail,
  type MatchStatusTarget,
  type RsvpChoice,
  type RsvpStatus,
} from '../../../../../src/matches/contracts';
import { matchesApi } from '../../../../../src/matches/instance';
import {
  myRsvpStatus,
  useDeleteMatch,
  useMatchBusy,
  useSetRsvp,
  useUpdateMatch,
  useVoteMvp,
} from '../../../../../src/matches/mutations';
import {
  canEditMatch,
  canVoteMvp,
  isStaff,
  mvpWindowOpen,
  paymentsWritable,
  removalKind,
  rsvpChanges,
  rsvpChoices,
  statusTargets,
} from '../../../../../src/matches/permissions';
import { useMatchScreen } from '../../../../../src/matches/use-match';
import { useNow } from '../../../../../src/matches/use-now';
import {
  CachedNotice,
  ConfirmAction,
  Notice,
  ResourceState,
  Section,
} from '../../../../../src/teams/components';
import { useTheme } from '../../../../../src/theme';
import {
  Button,
  Card,
  KitNumber,
  ListItem,
  Numeral,
  SegmentedControl,
  Text,
} from '../../../../../src/ui';

const RSVP_ORDER: readonly RsvpChoice[] = ['in', 'maybe', 'out'];
const GROUP_ORDER: readonly RsvpStatus[] = ['in', 'waitlist', 'maybe', 'out'];

interface Row {
  readonly id: string;
  readonly name: string;
  readonly position: string | null;
  readonly status: RsvpStatus;
  readonly side: 'A' | 'B' | null;
}

function rows(match: MatchDetail): Row[] {
  return match.participants.map((row) => ({
    id: row.user.id,
    name: row.user.displayName,
    position: row.user.position,
    status: row.status,
    side: row.side,
  }));
}

/**
 * One match (`GET /api/v1/matches/:id`): facts, the viewer's RSVP (optimistic, with exact
 * rollback), the participants, the MVP vote after the match, and for staff the edit, status and
 * cancel controls (authorization matrix §3.4). A guest sees the guest projection: no fee total,
 * no payment flags.
 */
export default function MatchDetailScreen() {
  const { t, i18n } = useTranslation('matches');
  const { t: tt } = useTranslation('teams');
  const theme = useTheme();
  const router = useRouter();
  // After a draft is deleted its cached copy is dropped; it must not be fetched again (404)
  // while the screen is on its way out.
  const [deleted, setDeleted] = useState(false);
  const { matchId, teamId, query, match, myUserId, role, roleError, retryRole } = useMatchScreen({
    enabled: !deleted,
  });
  const rsvp = useSetRsvp(matchesApi, matchId, teamId);
  const update = useUpdateMatch(matchesApi, matchId, teamId);
  const remove = useDeleteMatch(matchesApi, matchId, teamId);
  const vote = useVoteMvp(matchesApi, matchId, teamId);
  const busy = useMatchBusy(matchId);
  const action = useAsyncAction();
  const [votee, setVotee] = useState<string | null>(null);
  const now = useNow();

  if (match === undefined) {
    return (
      // Unknown projection yet: the tab is a safe fallback (a guest's team list answers 404).
      <MatchScreen back={MATCHES_HOME} testID="match-screen">
        <ResourceState
          status={query.status === 'error' ? 'error' : 'pending'}
          error={query.error}
          onRetry={() => void query.refetch()}
          missingTitle={t('detail.missingTitle')}
          missingMessage={t('detail.missingMessage')}
          testID="match"
        />
      </MatchScreen>
    );
  }

  const member = match.projection === 'member' ? match : null;
  const myStatus = myRsvpStatus(match);
  const choices = rsvpChoices(match, now);
  const participants = rows(match);
  const nameOf = (id: string): string =>
    participants.find((row) => row.id === id)?.name ?? t('mvp.unknownPlayer');
  const venue = match.venue?.name ?? match.venueText ?? '';
  const targets = statusTargets(role, match, now);
  const removal = removalKind(role, match.status);
  const disabled = busy || action.busy;

  const choose = (choice: RsvpChoice): void => {
    if (!rsvpChanges(myStatus, choice)) {
      return;
    }
    rsvp.mutate({ choice, myUserId });
  };

  const setStatus = (status: MatchStatusTarget): void => {
    void action.run(async () => {
      await update.mutateAsync({ status });
    });
  };

  const removeMatch = (): void => {
    void action.run(async () => {
      const { outcome } = await remove.mutateAsync(undefined, {
        onSuccess: (result) => setDeleted(result.outcome === 'deleted'),
      });
      if (outcome === 'deleted') {
        router.replace(teamMatchesHref(teamId));
      }
    });
  };

  const castVote = (): void => {
    if (votee === null) {
      return;
    }
    void action.run(async () => {
      await vote.mutateAsync(votee);
    });
  };

  const positionLabel = (position: string | null): string | null =>
    position === null ? null : tt(`member.position.${position}`);
  const sideLabel = (side: 'A' | 'B' | null): string | null =>
    side === null ? null : t('lineup.sideShort', { side });

  return (
    <MatchScreen
      title={formatDateTime(match.startsAt, i18n.language)}
      subtitle={match.team.name}
      // A guest cannot open the team's match list (404), so "back" leads to the tab.
      back={match.projection === 'guest' ? MATCHES_HOME : teamMatchesHref(teamId)}
      testID="match-screen"
    >
      <CachedNotice visible={query.isError} />
      {/* Squad sheet header: kick-off and the confirmed count in kit figures. The facts card
          below says the same in words, so this block is hidden from screen readers. */}
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        testID="match-hero"
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          paddingHorizontal: theme.layout.gutter,
          marginBottom: theme.spacing['4'],
        }}
      >
        <View>
          <Text variant="label" tone={match.status === 'open' ? 'primary' : 'muted'}>
            {t(`status.${match.status}`)}
          </Text>
          <Numeral value={kickoffTime(match.startsAt, i18n.language)} variant="score" />
        </View>
        {member === null ? null : (
          <View style={{ alignItems: 'flex-end' }}>
            <Numeral value={`${member.counts.in}/${member.slots}`} variant="score" />
            <Text variant="caption" tone="muted">
              {t('detail.squad')}
            </Text>
          </View>
        )}
      </View>
      <Section>
        <Card>
          <View style={{ gap: theme.spacing['2'] }}>
            <Fact
              label={t('detail.status')}
              value={t(`status.${match.status}`)}
              testID="match-status"
            />
            <Fact label={t('detail.venue')} value={venue} />
            <Fact label={t('detail.format')} value={match.format} />
            {member === null ? null : (
              <>
                <Fact
                  label={t('detail.squad')}
                  value={t('detail.squadValue', {
                    confirmed: member.counts.in,
                    slots: member.slots,
                  })}
                  testID="match-squad"
                />
                {member.counts.waitlist > 0 ? (
                  <Fact
                    label={t('detail.waitlist')}
                    value={String(member.counts.waitlist)}
                    testID="match-waitlist"
                  />
                ) : null}
                <Fact
                  label={t('detail.fee')}
                  value={formatLira(member.feeTotalMinor, i18n.language)}
                  testID="match-fee"
                />
              </>
            )}
            {match.sharePerPlayerMinor === null ? null : (
              <Fact
                label={t('detail.share')}
                value={formatLira(match.sharePerPlayerMinor, i18n.language)}
              />
            )}
            {match.myShareMinor === null ? null : (
              <Fact
                label={t('detail.myShare')}
                value={formatLira(match.myShareMinor, i18n.language)}
                testID="match-my-share"
              />
            )}
          </View>
        </Card>
      </Section>

      <SectionTitle>{t('rsvp.title')}</SectionTitle>
      <Section>
        <Text testID="rsvp-current" accessibilityLiveRegion="polite">
          {myStatus === null
            ? t('rsvp.none')
            : t('rsvp.mine', { status: t(`rsvp.state.${myStatus}`) })}
        </Text>
        {myStatus === 'waitlist' ? (
          <View style={{ marginTop: theme.spacing['2'] }}>
            <Notice testID="rsvp-waitlist">{t('rsvp.waitlistNotice')}</Notice>
          </View>
        ) : null}
        {choices.length === 0 ? (
          <View style={{ marginTop: theme.spacing['2'] }}>
            <Notice testID="rsvp-closed">
              {match.status === 'open' || match.status === 'locked'
                ? t('rsvp.startedNotice')
                : t('rsvp.closedNotice')}
            </Notice>
          </View>
        ) : (
          <View style={{ marginTop: theme.spacing['3'] }}>
            {match.status === 'locked' ? (
              <View style={{ marginBottom: theme.spacing['2'] }}>
                <Notice testID="rsvp-locked">{t('rsvp.lockedNotice')}</Notice>
              </View>
            ) : null}
            <SegmentedControl<RsvpChoice>
              label={t('rsvp.title')}
              options={RSVP_ORDER.map((value) => ({
                value,
                label: t(`rsvp.choice.${value}`),
                tone: value,
                disabled: !choices.includes(value),
              }))}
              selected={myStatus === 'waitlist' ? 'in' : (myStatus as RsvpChoice | null)}
              onSelect={choose}
              disabled={disabled}
              testID="rsvp"
            />
          </View>
        )}
        <View style={{ marginTop: theme.spacing['3'] }}>
          <FormError error={rsvp.error} />
        </View>
      </Section>

      {match.status === 'played' ? (
        <>
          <SectionTitle>{t('mvp.title')}</SectionTitle>
          <Section>
            {mvpWindowOpen(match, now) ? (
              match.mvp !== null && match.mvp.myVoteeId !== null ? (
                <Notice testID="mvp-voted">
                  {t('mvp.voted', { name: nameOf(match.mvp.myVoteeId) })}
                </Notice>
              ) : canVoteMvp(match, myStatus, match.mvp?.myVoteeId ?? null, now) ? (
                <View testID="mvp-vote">
                  <Text tone="muted" style={{ marginBottom: theme.spacing['2'] }}>
                    {t('mvp.hint', {
                      date: formatDateTime(match.mvpVoteClosesAt ?? '', i18n.language),
                    })}
                  </Text>
                  <ChoiceGroup
                    label={t('mvp.candidates')}
                    options={participants
                      .filter((row) => row.status === 'in' && row.id !== myUserId)
                      .map((row) => ({ value: row.id, label: row.name }))}
                    selected={votee}
                    onSelect={setVotee}
                    disabled={disabled || myUserId === null}
                    testID="mvp-candidates"
                  />
                  <View style={{ marginTop: theme.spacing['3'] }}>
                    <ConfirmAction
                      label={t('mvp.submit')}
                      question={t('mvp.question', { name: votee === null ? '' : nameOf(votee) })}
                      confirmLabel={t('mvp.confirm')}
                      cancelLabel={t('common.cancel')}
                      onConfirm={castVote}
                      busy={vote.isPending}
                      disabled={disabled || votee === null}
                      variant="primary"
                      testID="mvp-submit"
                    />
                  </View>
                </View>
              ) : (
                <Notice testID="mvp-not-eligible">{t('mvp.notEligible')}</Notice>
              )
            ) : match.mvp === null ||
              match.mvp.winnerIds === null ||
              match.mvp.winnerIds.length === 0 ? (
              <Notice testID="mvp-none">{t('mvp.none')}</Notice>
            ) : (
              <Card testID="mvp-winners">
                <Text accessibilityRole="header" variant="label">
                  {t('mvp.winners')}
                </Text>
                {match.mvp.winnerIds.map((id) => (
                  <Text key={id} style={{ marginTop: theme.spacing['1'] }}>
                    {nameOf(id)}
                  </Text>
                ))}
              </Card>
            )}
          </Section>
        </>
      ) : null}

      <Section>
        <FormError error={action.error} />
        <Button
          label={t('detail.lineup')}
          variant="secondary"
          onPress={() => router.push(matchHref(teamId, matchId, 'dizilis'))}
          testID="match-lineup"
          style={{ marginBottom: theme.spacing['3'] }}
        />
        {member !== null && paymentsWritable(member.status) ? (
          <Button
            label={t('detail.payments')}
            variant="secondary"
            onPress={() => router.push(matchHref(teamId, matchId, 'odemeler'))}
            testID="match-payments"
            style={{ marginBottom: theme.spacing['3'] }}
          />
        ) : null}
      </Section>

      {roleError !== null ? (
        <RoleError error={roleError} onRetry={retryRole} />
      ) : isStaff(role) ? (
        <>
          <SectionTitle>{t('manage.title')}</SectionTitle>
          <Section>
            {canEditMatch(role, match.status) ? (
              <Button
                label={t('manage.edit')}
                variant="secondary"
                disabled={disabled}
                onPress={() => router.push(matchHref(teamId, matchId, 'duzenle'))}
                testID="match-edit"
                style={{ marginBottom: theme.spacing['3'] }}
              />
            ) : null}
            <OpenCallEntry match={match} />
            {targets
              .filter((target) => target !== 'played')
              .map((target) => (
                <Button
                  key={target}
                  label={
                    target === 'locked'
                      ? t('manage.lock')
                      : match.status === 'draft'
                        ? t('manage.publish')
                        : t('manage.reopen')
                  }
                  disabled={disabled}
                  loading={update.isPending && update.variables?.status === target}
                  onPress={() => setStatus(target)}
                  testID={`match-to-${target}`}
                  style={{ marginBottom: theme.spacing['3'] }}
                />
              ))}
            {targets.includes('played') ? (
              <ConfirmAction
                label={t('manage.played')}
                question={t('manage.playedQuestion')}
                confirmLabel={t('manage.playedConfirm')}
                cancelLabel={t('common.cancel')}
                onConfirm={() => setStatus('played')}
                busy={update.isPending && update.variables?.status === 'played'}
                disabled={disabled}
                variant="primary"
                testID="match-to-played"
              />
            ) : null}
            {removal === null ? null : (
              <ConfirmAction
                label={removal === 'delete' ? t('manage.delete') : t('manage.cancel')}
                question={
                  removal === 'delete' ? t('manage.deleteQuestion') : t('manage.cancelQuestion')
                }
                confirmLabel={
                  removal === 'delete' ? t('manage.deleteConfirm') : t('manage.cancelConfirm')
                }
                cancelLabel={t('common.cancel')}
                onConfirm={removeMatch}
                busy={remove.isPending}
                disabled={disabled}
                variant="danger"
                testID="match-remove"
              />
            )}
          </Section>
        </>
      ) : null}

      <SectionTitle>{t('participants.title')}</SectionTitle>
      <View style={{ marginBottom: theme.spacing['5'] }} testID="match-participants">
        {participants.length === 0 ? (
          <Section>
            <Text tone="muted">{t('participants.empty')}</Text>
          </Section>
        ) : (
          GROUP_ORDER.map((status) => {
            const group = participants.filter((row) => row.status === status);
            if (group.length === 0) {
              return null;
            }
            return (
              <View key={status} testID={`participants-${status}`}>
                <Text
                  variant="label"
                  tone="muted"
                  accessibilityRole="header"
                  style={{
                    paddingHorizontal: theme.spacing['4'],
                    paddingTop: theme.spacing['3'],
                  }}
                >
                  {t('participants.group', {
                    status: t(`participants.status.${status}`),
                    number: group.length,
                  })}
                </Text>
                {group.map((row, index) => (
                  <ListItem
                    key={row.id}
                    // Confirmed players carry the kit number of the lineup screen.
                    leading={status === 'in' ? <KitNumber number={index + 1} /> : undefined}
                    divider
                    title={
                      row.id === myUserId ? t('participants.you', { name: row.name }) : row.name
                    }
                    subtitle={
                      [positionLabel(row.position), sideLabel(row.side)]
                        .filter((part): part is string => part !== null)
                        .join(', ') || undefined
                    }
                    testID={`participant-${row.id}`}
                  />
                ))}
              </View>
            );
          })
        )}
      </View>
    </MatchScreen>
  );
}
