import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ApiError } from '../../../src/api/errors';
import { FormError } from '../../../src/auth/components';
import {
  ApplicationList,
  CallFacts,
  DistrictPicker,
  levelLabel,
  positionLabel,
} from '../../../src/calls/components';
import { type Level, type OpenCall, type Position } from '../../../src/calls/contracts';
import {
  availableExpiries,
  defaultExpiry,
  districtLabel,
  EXPIRY_CHOICES,
  type ExpiryChoice,
  expiryInstant,
  LEVEL_OPTIONS,
  missingIssue,
  POSITION_OPTIONS,
} from '../../../src/calls/form';
import { callsApi } from '../../../src/calls/instance';
import { useCloseCall, useMatchCallBusy, usePublishCall } from '../../../src/calls/mutations';
import {
  callActive,
  isStaffRole,
  maxMissingCount,
  publishBlocker,
} from '../../../src/calls/permissions';
import { callHref } from '../../../src/calls/links';
import {
  callKeys,
  districtsQuery,
  findListedCallForMatch,
  matchCallQuery,
} from '../../../src/calls/queries';
import { formatDateTime } from '../../../src/i18n/format';
import { ChoiceGroup, MatchScreen, matchHref, SectionTitle } from '../../../src/matches/components';
import { type MatchMemberView } from '../../../src/matches/contracts';
import { useMatchScreen } from '../../../src/matches/use-match';
import { useNow } from '../../../src/matches/use-now';
import { ConfirmAction, Notice, ResourceState, Section } from '../../../src/teams/components';
import { teamsApi } from '../../../src/teams/instance';
import { teamDetailQuery } from '../../../src/teams/queries';
import { useTheme } from '../../../src/theme';
import { Button, Numeral, SkeletonList, Text } from '../../../src/ui';

const ANY = 'any';

/**
 * The kept call while it still takes applications: stored as `open`, before its end, and the
 * match itself still `open` (a lock, cancel or played status closes the call on the server,
 * footnote 21). `null` otherwise.
 */
function liveCall(
  call: OpenCall | null | undefined,
  match: Pick<MatchMemberView, 'status' | 'startsAt'>,
  now: number,
): OpenCall | null {
  return call !== null &&
    call !== undefined &&
    call.status === 'open' &&
    match.status === 'open' &&
    callActive({ expiresAt: call.expiresAt, startsAt: match.startsAt }, now)
    ? call
    : null;
}

/** Publish form: missing count, position, level, district (optional) and expiry. */
function PublishForm({
  match,
  teamId,
  disabled,
  onConflict,
}: {
  readonly match: MatchMemberView;
  readonly teamId: string;
  readonly disabled: boolean;
  readonly onConflict: () => void;
}) {
  const { t } = useTranslation('opencalls');
  const theme = useTheme();
  const districts = useQuery(districtsQuery(callsApi));
  const publish = usePublishCall(callsApi, match.id, teamId);
  const now = useNow();
  const max = maxMissingCount(match);
  const [missing, setMissing] = useState<number | null>(Math.min(1, max));
  const [position, setPosition] = useState<Position | null>(null);
  const [level, setLevel] = useState<Level>('regular');
  const [district, setDistrict] = useState<string | null>(null);
  const [expiry, setExpiry] = useState<ExpiryChoice | null>(null);
  const [issue, setIssue] = useState<string | null>(null);
  const expiries = availableExpiries(match.startsAt, now);
  const chosenExpiry = expiry ?? defaultExpiry(match.startsAt, now);

  const submit = (): void => {
    const missingProblem = missingIssue(missing, max);
    if (missingProblem !== null) {
      setIssue(t(missingProblem, { max }));
      return;
    }
    if (chosenExpiry === null || !expiries.includes(chosenExpiry)) {
      setIssue(t('validation.expiryInvalid'));
      return;
    }
    setIssue(null);
    publish.mutate(
      {
        missingCount: missing ?? 1,
        position,
        level,
        ...(district === null ? {} : { districtId: district }),
        expiresAt: new Date(expiryInstant(match.startsAt, chosenExpiry)).toISOString(),
      },
      {
        onError: (error) => {
          if (error instanceof ApiError && error.code === 'open_call_exists') {
            onConflict();
          }
        },
      },
    );
  };

  const inactive = disabled || publish.isPending;
  return (
    <View testID="publish-form" style={{ gap: theme.spacing['4'] }}>
      <View>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: theme.spacing['3'],
            marginBottom: theme.spacing['2'],
          }}
        >
          <Text variant="label" style={{ flexShrink: 1 }}>
            {t('publish.missing', { max })}
          </Text>
          {missing === null ? null : (
            // Preview of the count as the list will draw it; the radio group carries the value.
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <Numeral value={missing} variant="score" outlined />
            </View>
          )}
        </View>
        <ChoiceGroup
          label={t('publish.missingGroup')}
          options={Array.from({ length: max }, (_, index) => String(index + 1)).map((value) => ({
            value,
            label: value,
          }))}
          selected={missing === null ? null : String(missing)}
          onSelect={(value) => setMissing(Number(value))}
          disabled={inactive}
          testID="publish-missing"
        />
      </View>
      <View>
        <Text variant="label" style={{ marginBottom: theme.spacing['2'] }}>
          {t('facts.position')}
        </Text>
        <ChoiceGroup
          label={t('facts.position')}
          options={[ANY, ...POSITION_OPTIONS].map((value) => ({
            value,
            label: positionLabel(t, value === ANY ? null : (value as Position)),
          }))}
          selected={position ?? ANY}
          onSelect={(value) => setPosition(value === ANY ? null : (value as Position))}
          disabled={inactive}
          testID="publish-position"
        />
      </View>
      <View>
        <Text variant="label" style={{ marginBottom: theme.spacing['2'] }}>
          {t('facts.level')}
        </Text>
        <ChoiceGroup
          label={t('facts.level')}
          options={LEVEL_OPTIONS.map((value) => ({ value, label: levelLabel(t, value) }))}
          selected={level}
          onSelect={setLevel}
          disabled={inactive}
          testID="publish-level"
        />
      </View>
      <DistrictPicker
        districts={districts}
        selected={district}
        onSelect={setDistrict}
        noneLabel={t('district.default')}
        disabled={inactive}
        testID="publish-district"
      />
      <View>
        <Text variant="label" style={{ marginBottom: theme.spacing['2'] }}>
          {t('publish.expiry')}
        </Text>
        <ChoiceGroup
          label={t('publish.expiry')}
          options={EXPIRY_CHOICES.map((value) => ({
            value,
            label: t(`publish.expiryChoice.${value}`),
            disabled: !expiries.includes(value),
          }))}
          selected={chosenExpiry}
          onSelect={setExpiry}
          disabled={inactive}
          testID="publish-expiry"
        />
      </View>
      <View>
        {issue === null ? null : (
          <Text tone="danger" accessibilityRole="alert" testID="publish-issue">
            {issue}
          </Text>
        )}
        <FormError error={publish.error} />
        <Button
          label={t('publish.submit')}
          variant="accent"
          loading={publish.isPending}
          disabled={disabled}
          onPress={submit}
          testID="publish-submit"
        />
      </View>
    </View>
  );
}

/**
 * The open call of one match for its captain and co-captains (authorization matrix §3.5
 * footnotes 19, 21, 30): publish a call, see and decide its applications, close it. The app keeps
 * the call (in memory) from the publish / close answer, because the match response does not carry
 * it; a call published from another device is recognized through the server's `open_call_exists`
 * answer or a cached list entry, the publish form is then hidden, and the call can be opened from
 * the list or closed by match id.
 */
export default function MatchCallScreen() {
  const { t, i18n } = useTranslation('opencalls');
  const theme = useTheme();
  const client = useQueryClient();
  const router = useRouter();
  const { matchId, teamId, query, match, role, roleLoading } = useMatchScreen();
  const member = match?.projection === 'member' ? match : null;
  const team = useQuery({ ...teamDetailQuery(teamsApi, teamId), enabled: member !== null });
  const stored = useQuery({ ...matchCallQuery(client, matchId), enabled: matchId !== '' });
  const districts = useQuery(districtsQuery(callsApi));
  const close = useCloseCall(callsApi, matchId);
  const busy = useMatchCallBusy(matchId);
  const now = useNow();
  // Set when the server says the match already has an open call this device does not know.
  const [conflict, setConflict] = useState(false);

  if (match === undefined) {
    return (
      <MatchScreen back={matchHref(teamId, matchId)} testID="match-call-screen">
        <ResourceState
          status={query.status === 'error' ? 'error' : 'pending'}
          error={query.error}
          onRetry={() => void query.refetch()}
          missingTitle={t('manage.matchMissingTitle')}
          missingMessage={t('manage.matchMissingMessage')}
          testID="match-call"
        />
      </MatchScreen>
    );
  }

  const header = {
    title: t('manage.title'),
    subtitle: `${match.team.name}, ${formatDateTime(match.startsAt, i18n.language)}`,
    back: matchHref(match.team.id, matchId),
  };

  if (member === null || (!roleLoading && !isStaffRole(role))) {
    return (
      <MatchScreen {...header} testID="match-call-screen">
        <Section>
          <Notice testID="match-call-not-staff">{t('manage.notStaff')}</Notice>
        </Section>
      </MatchScreen>
    );
  }
  if (roleLoading || team.data === undefined) {
    return (
      <MatchScreen {...header} testID="match-call-screen">
        <SkeletonList
          accessibilityLabel={t('manage.loading')}
          rows={3}
          testID="match-call-loading"
        />
      </MatchScreen>
    );
  }

  const call = stored.data;
  const live = liveCall(call, member, now);
  // A live call this device did not publish (another staff member or device): known from the
  // server's `open_call_exists`, or recognized in the cached public lists. The publish form stays
  // hidden; the call can be opened from the list (decisions) or closed by match id.
  const listed = live === null ? findListedCallForMatch(client, member) : undefined;
  const listedIsKept =
    listed !== undefined && call !== null && call !== undefined && call.id === listed.id;
  const existing = live === null && (conflict || (listed !== undefined && !listedIsKept));
  const blocker = publishBlocker(role, team.data.isProLocked, member, now);
  const callPlace = (value: { readonly districtId: string }): string | null =>
    districtLabel(districts.data?.items, value.districtId);

  const closeCall = (): void => {
    close.mutate(undefined, { onSuccess: () => setConflict(false) });
  };

  const closeControl = (
    <View style={{ marginTop: theme.spacing['3'] }}>
      <ConfirmAction
        label={t('manage.close')}
        question={live === null ? t('manage.closeUnknownQuestion') : t('manage.closeQuestion')}
        confirmLabel={t('manage.closeConfirm')}
        cancelLabel={t('common.cancel')}
        onConfirm={closeCall}
        busy={close.isPending}
        disabled={busy}
        variant="danger"
        testID="call-close"
      />
      <FormError error={close.error} />
    </View>
  );

  return (
    <MatchScreen {...header} testID="match-call-screen">
      {live !== null ? (
        <>
          <SectionTitle>{t('manage.liveTitle')}</SectionTitle>
          <Section>
            <CallFacts call={live} place={callPlace(live)} />
            {closeControl}
          </Section>
          <SectionTitle>{t('manage.applicationsTitle')}</SectionTitle>
          <Section>
            <ApplicationList
              calls={callsApi}
              callId={live.id}
              matchId={matchId}
              active
              disabled={busy}
            />
          </Section>
        </>
      ) : (
        <>
          {existing ? (
            <>
              <SectionTitle>{t('manage.existingTitle')}</SectionTitle>
              <Section>
                <Notice testID="call-exists">{t('manage.exists')}</Notice>
                {listed === undefined || listedIsKept ? null : (
                  <View style={{ marginTop: theme.spacing['3'] }} testID="call-exists-listed">
                    <CallFacts call={listed} place={listed.venue?.name ?? callPlace(listed)} />
                    <Button
                      label={t('manage.openListed')}
                      variant="secondary"
                      onPress={() => {
                        client.setQueryData(callKeys.call(listed.id), listed);
                        router.push(callHref(listed.id));
                      }}
                      testID="call-exists-open"
                      style={{ marginTop: theme.spacing['3'] }}
                    />
                  </View>
                )}
                {closeControl}
              </Section>
            </>
          ) : null}
          <SectionTitle>{t('publish.title')}</SectionTitle>
          <Section>
            {existing ? (
              <Notice testID="publish-hidden">{t('publish.hiddenWhileLive')}</Notice>
            ) : blocker === null ? (
              <PublishForm
                match={member}
                teamId={match.team.id}
                disabled={busy}
                onConflict={() => setConflict(true)}
              />
            ) : (
              <Notice testID="publish-blocked">{t(`publish.blocked.${blocker}`)}</Notice>
            )}
          </Section>
          {call === null || call === undefined ? null : (
            <>
              <SectionTitle>{t('manage.lastTitle')}</SectionTitle>
              <Section>
                <Text
                  tone="muted"
                  style={{ marginBottom: theme.spacing['2'] }}
                  testID="last-call-status"
                >
                  {t(
                    `manage.callStatus.${
                      call.status !== 'open'
                        ? call.status
                        : member.status === 'open'
                          ? 'expired'
                          : 'closed'
                    }`,
                  )}
                </Text>
                <CallFacts call={call} place={callPlace(call)} />
                <View style={{ marginTop: theme.spacing['4'] }}>
                  <ApplicationList
                    calls={callsApi}
                    callId={call.id}
                    matchId={matchId}
                    active={false}
                    disabled={busy}
                  />
                </View>
              </Section>
            </>
          )}
        </>
      )}
    </MatchScreen>
  );
}
