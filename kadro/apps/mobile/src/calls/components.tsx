import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { FormError } from '../auth/components';
import { formatDateTime } from '../i18n/format';
import { ChoiceGroup, Fact } from '../matches/components';
import { ConfirmAction, Notice, ResourceState } from '../teams/components';
import { useTheme } from '../theme';
import { Button, Card, Text, TextField } from '../ui';
import { type CallsApi } from './calls-api';
import {
  type Application,
  type DistrictPublic,
  type Level,
  type MatchDetail,
  type Position,
} from './contracts';
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

/** The public facts of a call, read as one element per line. */
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
  return (
    <Card>
      <View style={{ gap: theme.spacing['2'] }}>
        {call.startsAt === undefined ? null : (
          <Fact label={t('facts.startsAt')} value={formatDateTime(call.startsAt, i18n.language)} />
        )}
        {place === null ? null : (
          <Fact label={t('facts.place')} value={place} testID="call-place" />
        )}
        {call.format === undefined ? null : <Fact label={t('facts.format')} value={call.format} />}
        <Fact label={t('facts.missing')} value={String(call.missingCount)} testID="call-missing" />
        <Fact label={t('facts.position')} value={positionLabel(t, call.position)} />
        <Fact label={t('facts.level')} value={levelLabel(t, call.level)} />
        <Fact
          label={t('facts.expiresAt')}
          value={formatDateTime(call.expiresAt, i18n.language)}
          testID="call-expires"
        />
      </View>
    </Card>
  );
}

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
  return (
    <Card testID={`application-${application.id}`} style={{ marginBottom: theme.spacing['3'] }}>
      <Text variant="label">{applicant.displayName}</Text>
      {details.length === 0 ? null : <Text tone="muted">{details.join(' · ')}</Text>}
      {application.message === null ? null : (
        // Plain text: links in a message are never rendered as links (ADR-0037).
        <Text
          style={{ marginTop: theme.spacing['2'] }}
          testID={`application-${application.id}-message`}
        >
          {application.message}
        </Text>
      )}
      <Text
        variant="footnote"
        tone="muted"
        style={{ marginTop: theme.spacing['2'] }}
        testID={`application-${application.id}-status`}
      >
        {t(`application.status.${application.status}`)}
      </Text>
      {decidable ? (
        <View style={{ marginTop: theme.spacing['3'] }}>
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
