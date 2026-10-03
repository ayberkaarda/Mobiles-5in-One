import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { FormError } from '../auth/components';
import { formatDateTime } from '../i18n/format';
import { ChoiceGroup } from '../matches/components';
import { ConfirmAction, Notice, ResourceState } from '../teams/components';
import { useTheme } from '../theme';
import { Button, Card, Chip, EksikSlot, Numeral, Text, TextField, type TextTone } from '../ui';
import { type CallsApi } from './calls-api';
import {
  type Application,
  type ApplicationStatus,
  type DistrictPublic,
  type Level,
  type MatchDetail,
  type OpenCallPublic,
  type Position,
} from './contracts';
import { kickoffParts, MAX_DRAWN_SLOTS } from './display';
import { districtLabel, searchDistricts } from './form';
import { matchCallHref } from './links';
import { useCallBusy, useSetApplicationStatus } from './mutations';
import { canDecide } from './permissions';
import { applicationsQuery } from './queries';

type Translate = (key: string, options?: Record<string, unknown>) => string;

export function positionLabel(t: Translate, position: Position | null): string {
  return position === null ? t('position.any') : t(`position.${position}`);
}

export function levelLabel(t: Translate, level: Level | null): string {
  return level === null ? t('level.any') : t(`level.${level}`);
}

/**
 * Entry from the match screen to the match's open call (publish, applications, close). Shown
 * by the match screen inside its staff block only.
 */
export function OpenCallEntry({ match }: { readonly match: Pick<MatchDetail, 'id'> }) {
  const { t } = useTranslation('opencalls');
  const theme = useTheme();
  const router = useRouter();
  return (
    <Button
      label={t('entry.label')}
      accessibilityHint={t('entry.hint')}
      variant="secondary"
      onPress={() => router.push(matchCallHref(match.id))}
      testID="match-open-call"
      style={{ marginBottom: theme.spacing['3'] }}
    />
  );
}

export interface DistrictsState {
  readonly status: 'pending' | 'error' | 'success';
  readonly data: { readonly items: readonly DistrictPublic[] } | undefined;
  readonly refetch: () => unknown;
}

/**
 * District choice by search: typing two letters lists matching districts (name or province);
 * the chosen one is shown with a "clear" button. Only a district id is ever sent, never a
 * location.
 */
export function DistrictPicker({
  districts,
  selected,
  onSelect,
  noneLabel,
  disabled = false,
  testID,
}: {
  readonly districts: DistrictsState;
  readonly selected: string | null;
  readonly onSelect: (districtId: string | null) => void;
  /** What "no district chosen" means here ("every district", "the default district"). */
  readonly noneLabel: string;
  readonly disabled?: boolean;
  readonly testID: string;
}) {
  const { t } = useTranslation('opencalls');
  const theme = useTheme();
  const [search, setSearch] = useState('');
  const items = districts.data?.items ?? [];
  const matches = searchDistricts(items, search);
  const chosen = selected === null ? null : districtLabel(items, selected);

  return (
    <View testID={testID}>
      <Text variant="label" style={{ marginBottom: theme.spacing['2'] }}>
        {t('district.label')}
      </Text>
      {selected === null ? (
        <Text tone="muted" testID={`${testID}-none`}>
          {noneLabel}
        </Text>
      ) : (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: theme.spacing['2'],
          }}
        >
          <Text testID={`${testID}-selected`} style={{ flexShrink: 1 }}>
            {chosen ?? t('district.unknown')}
          </Text>
          <Button
            label={t('district.clear')}
            variant="secondary"
            disabled={disabled}
            onPress={() => onSelect(null)}
            testID={`${testID}-clear`}
          />
        </View>
      )}
      {districts.status === 'error' && items.length === 0 ? (
        <View style={{ marginTop: theme.spacing['2'] }}>
          <Text tone="muted" testID={`${testID}-error`}>
            {t('district.loadFailed')}
          </Text>
          <Button
            label={t('district.retry')}
            variant="secondary"
            onPress={() => void districts.refetch()}
            testID={`${testID}-retry`}
            style={{ marginTop: theme.spacing['2'] }}
          />
        </View>
      ) : districts.status === 'pending' && items.length === 0 ? (
        <Text tone="muted" style={{ marginTop: theme.spacing['2'] }}>
          {t('district.loading')}
        </Text>
      ) : (
        <View style={{ marginTop: theme.spacing['3'] }}>
          <TextField
            label={t('district.search')}
            helperText={t('district.searchHelp')}
            value={search}
            onChangeText={setSearch}
            editable={!disabled}
            autoCorrect={false}
            testID={`${testID}-search`}
          />
          {matches.length > 0 ? (
            <ChoiceGroup
              label={t('district.results')}
              options={matches.map((district) => ({
                value: district.id,
                label: `${district.name}, ${district.province}`,
              }))}
              selected={selected}
              onSelect={(districtId) => {
                onSelect(districtId);
                setSearch('');
              }}
              disabled={disabled}
              testID={`${testID}-results`}
            />
          ) : null}
        </View>
      )}
    </View>
  );
}

/**
 * One fact of a fact grid: caption label over the value, read as one element ("Yer: Kadıköy").
 * Half the grid width, or the full width for long values (`wide`); `numeral` sets the value in
 * the kit-number figures (fees, times).
 */
export function FactCell({
  label,
  value,
  wide = false,
  numeral = false,
  testID,
}: {
  readonly label: string;
  readonly value: string;
  readonly wide?: boolean;
  readonly numeral?: boolean;
  readonly testID?: string;
}) {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      testID={testID}
      style={{ width: wide ? '100%' : '50%', paddingRight: theme.spacing['2'] }}
    >
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      {numeral ? (
        <Numeral value={value} />
      ) : (
        <Text variant="bodyStrong" tabular>
          {value}
        </Text>
      )}
    </View>
  );
}

/** Grid of `FactCell`s: two columns, 12 pt between rows. */
export function FactGrid({ children }: { readonly children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: theme.spacing['3'] }}>
      {children}
    </View>
  );
}

/** 1 px `border` hairline between the blocks of a card. */
export function Hairline() {
  const theme = useTheme();
  return (
    <View
      style={{
        height: 1,
        backgroundColor: theme.colors.border,
        marginVertical: theme.spacing['4'],
      }}
    />
  );
}

/**
 * The missing count as the brand draws it: the outlined figure with "eksik" under it and, for
 * small counts, one dashed empty slot per missing player (decorative). The figure carries the
 * spoken text.
 */
function MissingCount({
  count,
  accessibilityLabel,
  slots = false,
}: {
  readonly count: number;
  readonly accessibilityLabel: string;
  readonly slots?: boolean;
}) {
  const { t } = useTranslation('opencalls');
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing['3'] }}>
      <View style={{ alignItems: 'center', minWidth: theme.spacing['12'] }}>
        <Numeral value={count} variant="score" outlined accessibilityLabel={accessibilityLabel} />
        <Text variant="caption" tone="muted">
          {t('list.missingUnit')}
        </Text>
      </View>
      {slots && count <= MAX_DRAWN_SLOTS ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing['1'] }}>
          {Array.from({ length: count }, (_, index) => (
            <EksikSlot key={index} size={28} testID={`missing-slot-${index}`} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Row of the Eksik Var list, laid out as a scoreboard line: the missing count as an outlined
 * figure on the left; the day and the kick-off time, the team, the place and the position, level
 * and format chips in the middle. The whole row is one button that speaks all of its text.
 */
export function OpenCallRow({
  call,
  place,
  onPress,
}: {
  readonly call: OpenCallPublic;
  readonly place: string | null;
  readonly onPress: () => void;
}) {
  const { t, i18n } = useTranslation('opencalls');
  const theme = useTheme();
  const kickoff = kickoffParts(call.startsAt, i18n.language);
  const missing = t('list.missing', { number: call.missingCount });
  const position = positionLabel(t, call.position);
  const level = levelLabel(t, call.level);
  const spoken = [
    call.teamName,
    formatDateTime(call.startsAt, i18n.language),
    place,
    position,
    level,
    call.format,
    missing,
  ]
    .filter((part): part is string => part !== null && part !== '')
    .join(', ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityHint={t('list.openHint')}
      onPress={onPress}
      testID={`open-call-${call.id}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: theme.spacing['3'],
        minHeight: theme.layout.rowMinHeight,
        paddingHorizontal: theme.spacing['4'],
        paddingVertical: theme.spacing['3'],
        backgroundColor: pressed ? theme.colors.pressed : theme.colors.surface,
      })}
    >
      <MissingCount count={call.missingCount} accessibilityLabel={missing} />
      <View style={{ flex: 1, gap: theme.spacing['1'] }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: theme.spacing['2'],
          }}
        >
          <Text variant="caption" tone="muted" style={{ flexShrink: 1 }}>
            {kickoff.day}
          </Text>
          <Numeral value={kickoff.time} />
        </View>
        <Text variant="bodyStrong" numberOfLines={2}>
          {call.teamName}
        </Text>
        {place === null ? null : (
          <Text variant="footnote" tone="muted" numberOfLines={1}>
            {place}
          </Text>
        )}
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: theme.spacing['2'],
            marginTop: theme.spacing['1'],
          }}
        >
          <Chip label={position} />
          <Chip label={level} />
          <Chip label={call.format} />
        </View>
      </View>
    </Pressable>
  );
}

/**
 * The public facts of a call: the missing count as the outlined figure with its empty slots and
 * the place, then a two-column grid (kick-off, format, position, level) and the deadline.
 */
export function CallFacts({
  call,
  place,
}: {
  readonly call: {
    readonly startsAt?: string;
    readonly format?: string;
    readonly missingCount: number;
    readonly position: Position | null;
    readonly level: Level;
    readonly expiresAt: string;
  };
  /** Venue name or district; omitted when not known. */
  readonly place: string | null;
}) {
  const { t, i18n } = useTranslation('opencalls');
  const theme = useTheme();
  const missing = `${t('facts.missing')}: ${call.missingCount}`;
  return (
    <Card>
      <View accessible accessibilityLabel={missing} testID="call-missing">
        <MissingCount count={call.missingCount} accessibilityLabel={missing} slots />
      </View>
      {place === null ? null : (
        <View
          accessible
          accessibilityLabel={`${t('facts.place')}: ${place}`}
          testID="call-place"
          style={{ marginTop: theme.spacing['3'] }}
        >
          <Text variant="caption" tone="muted">
            {t('facts.place')}
          </Text>
          <Text variant="title3" accessibilityRole="text">
            {place}
          </Text>
        </View>
      )}
      <Hairline />
      <FactGrid>
        {call.startsAt === undefined ? null : (
          <FactCell
            label={t('facts.startsAt')}
            value={formatDateTime(call.startsAt, i18n.language)}
          />
        )}
        {call.format === undefined ? null : (
          <FactCell label={t('facts.format')} value={call.format} />
        )}
        <FactCell label={t('facts.position')} value={positionLabel(t, call.position)} />
        <FactCell label={t('facts.level')} value={levelLabel(t, call.level)} />
        <FactCell
          label={t('facts.expiresAt')}
          value={formatDateTime(call.expiresAt, i18n.language)}
          wide
          testID="call-expires"
        />
      </FactGrid>
    </Card>
  );
}

/** Status word of an application: accepted in green text, closed ones muted. */
const STATUS_TONE: Readonly<Record<ApplicationStatus, TextTone>> = {
  pending: 'default',
  accepted: 'primary',
  rejected: 'muted',
  withdrawn: 'muted',
};

function ApplicationRow({
  application,
  decidable,
  disabled,
  accepting,
  onAccept,
  onReject,
}: {
  readonly application: Application;
  readonly decidable: boolean;
  readonly disabled: boolean;
  readonly accepting: boolean;
  readonly onAccept: () => void;
  readonly onReject: () => void;
}) {
  const { t } = useTranslation('opencalls');
  const theme = useTheme();
  const { applicant } = application;
  const details = [
    applicant.position === null ? null : positionLabel(t, applicant.position),
    applicant.level === null ? null : levelLabel(t, applicant.level),
  ].filter((part): part is string => part !== null);
  const statusTone = STATUS_TONE[application.status];
  return (
    <Card testID={`application-${application.id}`} style={{ marginBottom: theme.spacing['3'] }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: theme.spacing['3'],
        }}
      >
        <Text variant="bodyStrong" style={{ flexShrink: 1 }}>
          {applicant.displayName}
        </Text>
        <Text variant="label" tone={statusTone} testID={`application-${application.id}-status`}>
          {t(`application.status.${application.status}`)}
        </Text>
      </View>
      {details.length === 0 ? null : (
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: theme.spacing['2'],
            marginTop: theme.spacing['2'],
          }}
        >
          {details.map((detail) => (
            <Chip key={detail} label={detail} />
          ))}
        </View>
      )}
      {application.message === null ? null : (
        // Plain text: links in a message are never rendered as links (ADR-0037).
        <Text
          style={{ marginTop: theme.spacing['3'] }}
          testID={`application-${application.id}-message`}
        >
          {application.message}
        </Text>
      )}
      {decidable ? (
        <View style={{ marginTop: theme.spacing['4'] }}>
          <Button
            label={t('manage.accept')}
            accessibilityLabel={t('manage.acceptName', { name: applicant.displayName })}
            disabled={disabled}
            loading={accepting}
            onPress={onAccept}
            testID={`application-${application.id}-accept`}
            style={{ marginBottom: theme.spacing['3'] }}
          />
          <ConfirmAction
            label={t('manage.reject')}
            question={t('manage.rejectQuestion', { name: applicant.displayName })}
            confirmLabel={t('manage.rejectConfirm')}
            cancelLabel={t('common.cancel')}
            onConfirm={onReject}
            disabled={disabled}
            testID={`application-${application.id}-reject`}
          />
        </View>
      ) : null}
    </Card>
  );
}

/**
 * Applications of a call for its team's staff (`GET open-calls/:id/applications`), with accept /
 * reject on pending ones while the call is active. Decisions wait for the server (an acceptance
 * adds a player to the match); a refusal shows the catalog copy and the applications refetch.
 */
export function ApplicationList({
  calls,
  callId,
  matchId = null,
  active,
  disabled = false,
}: {
  readonly calls: CallsApi;
  readonly callId: string;
  readonly matchId?: string | null;
  readonly active: boolean;
  readonly disabled?: boolean;
}) {
  const { t } = useTranslation('opencalls');
  const theme = useTheme();
  const query = useInfiniteQuery(applicationsQuery(calls, callId));
  const decide = useSetApplicationStatus(calls, callId, matchId);
  const busy = useCallBusy(callId);
  const applications = query.data?.pages.flatMap((page) => page.items) ?? [];

  if (query.data === undefined) {
    return (
      <ResourceState
        status={query.status === 'error' ? 'error' : 'pending'}
        error={query.error}
        onRetry={() => void query.refetch()}
        missingTitle={t('manage.applicationsMissingTitle')}
        missingMessage={t('manage.applicationsMissingMessage')}
        testID="applications"
      />
    );
  }

  const pending = applications.filter((row) => row.status === 'pending').length;
  return (
    <View testID="applications">
      {query.isError ? (
        <Text variant="footnote" tone="muted" testID="applications-cached">
          {t('manage.applicationsCached')}
        </Text>
      ) : null}
      <Text tone="muted" style={{ marginBottom: theme.spacing['3'] }} testID="applications-count">
        {t('manage.applicationsCount', { total: applications.length, pending })}
      </Text>
      {applications.length === 0 ? (
        <Notice testID="applications-empty">{t('manage.applicationsEmpty')}</Notice>
      ) : (
        applications.map((application) => (
          <ApplicationRow
            key={application.id}
            application={application}
            decidable={canDecide(application, active)}
            disabled={disabled || busy}
            accepting={
              decide.isPending &&
              decide.variables.applicationId === application.id &&
              decide.variables.status === 'accepted'
            }
            onAccept={() => decide.mutate({ applicationId: application.id, status: 'accepted' })}
            onReject={() => decide.mutate({ applicationId: application.id, status: 'rejected' })}
          />
        ))
      )}
      <FormError error={decide.error} />
      {query.hasNextPage ? (
        <Button
          label={t('manage.more')}
          variant="secondary"
          loading={query.isFetchingNextPage}
          onPress={() => void query.fetchNextPage()}
          testID="applications-more"
        />
      ) : null}
      {!active && applications.some((row) => row.status === 'pending') ? (
        <Notice testID="applications-inactive">{t('manage.inactive')}</Notice>
      ) : null}
    </View>
  );
}
