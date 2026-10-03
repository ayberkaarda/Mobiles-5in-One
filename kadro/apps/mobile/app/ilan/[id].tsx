import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { api } from '../../src/api/instance';
import { ApiError } from '../../src/api/errors';
import { FormError } from '../../src/auth/components';
import { ApplicationList, CallFacts } from '../../src/calls/components';
import { type Application } from '../../src/calls/contracts';
import {
  APPLICATION_MESSAGE_MAX,
  districtLabel,
  messageIssue,
  normalizeMessage,
} from '../../src/calls/form';
import { callsApi } from '../../src/calls/instance';
import { CALLS_HOME } from '../../src/calls/links';
import { useApply, useCallBusy, useSetApplicationStatus } from '../../src/calls/mutations';
import { callActive, callRelation, canWithdraw } from '../../src/calls/permissions';
import { applicationsQuery, districtsQuery, openCallQuery } from '../../src/calls/queries';
import { formatDateTime } from '../../src/i18n/format';
import { MatchScreen, SectionTitle } from '../../src/matches/components';
import { useNow } from '../../src/matches/use-now';
import { meQuery } from '../../src/query';
import {
  CachedNotice,
  ConfirmAction,
  Notice,
  ResourceState,
  Section,
} from '../../src/teams/components';
import { useTheme } from '../../src/theme';
import { Button, Card, ErrorState, Text, TextField } from '../../src/ui';

function param(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : '';
}

/** The applicant's own application: its state and, while pending, withdrawing it. */
function OwnApplication({
  application,
  callId,
  disabled,
}: {
  readonly application: Application;
  readonly callId: string;
  readonly disabled: boolean;
}) {
  const { t } = useTranslation('opencalls');
  const theme = useTheme();
  const withdraw = useSetApplicationStatus(callsApi, callId);
  return (
    <View testID="own-application">
      <Card>
        <Text variant="bodyStrong" accessibilityLiveRegion="polite" testID="own-application-status">
          {t(`apply.state.${application.status}`)}
        </Text>
        {application.message === null ? null : (
          <Text variant="footnote" tone="muted" style={{ marginTop: theme.spacing['2'] }}>
            {t('apply.yourMessage', { message: application.message })}
          </Text>
        )}
      </Card>
      {canWithdraw(application) ? (
        <View style={{ marginTop: theme.spacing['3'] }}>
          <ConfirmAction
            label={t('apply.withdraw')}
            question={t('apply.withdrawQuestion')}
            confirmLabel={t('apply.withdrawConfirm')}
            cancelLabel={t('common.cancel')}
            onConfirm={() =>
              withdraw.mutate({ applicationId: application.id, status: 'withdrawn' })
            }
            busy={withdraw.isPending}
            disabled={disabled}
            testID="withdraw"
          />
          <FormError error={withdraw.error} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * One open call (public projection, footnote 18) and what the viewer can do with it: apply with
 * an optional message, see their own application, or, for the call's team staff, decide the
 * applications. The viewer's relationship comes from `GET open-calls/:id/applications` (staff:
 * every row; applicant: their own; anyone else: 404). Applying waits for the server.
 */
export default function CallDetailScreen() {
  const { t, i18n } = useTranslation('opencalls');
  const theme = useTheme();
  const router = useRouter();
  const client = useQueryClient();
  const callId = param(useLocalSearchParams<{ id?: string | string[] }>().id);
  const callQuery = useQuery({ ...openCallQuery(client, callId), enabled: callId !== '' });
  const me = useQuery(meQuery(api));
  const districts = useQuery(districtsQuery(callsApi));
  const relationQuery = useInfiniteQuery({
    ...applicationsQuery(callsApi, callId),
    // Only for a call the app knows; an unknown id ends in the "not found" state without a request.
    enabled: callId !== '' && callQuery.data !== undefined && callQuery.data !== null,
  });
  const apply = useApply(callsApi, callId);
  const busy = useCallBusy(callId);
  const now = useNow();
  const [message, setMessage] = useState('');
  const [messageError, setMessageError] = useState<string | null>(null);
  // Members of the match's team cannot apply (409 `already_participant`); the public projection
  // does not say which team the viewer is in, so the server's answer decides.
  const [participant, setParticipant] = useState(false);

  const call = callQuery.data;
  if (call === undefined || call === null) {
    return (
      <MatchScreen back={CALLS_HOME} testID="call-screen">
        {call === null ? (
          <ErrorState
            title={t('detail.missingTitle')}
            message={t('detail.missingMessage')}
            retry={{ label: t('detail.toList'), onPress: () => router.replace(CALLS_HOME) }}
            testID="call-missing"
          />
        ) : (
          <ResourceState
            status="pending"
            error={null}
            onRetry={() => void callQuery.refetch()}
            missingTitle={t('detail.missingTitle')}
            missingMessage={t('detail.missingMessage')}
            testID="call"
          />
        )}
      </MatchScreen>
    );
  }

  const active = callActive(call, now);
  const place = call.venue?.name ?? districtLabel(districts.data?.items, call.districtId);
  const firstPage = relationQuery.data?.pages[0];
  const myUserId = me.data?.id;
  const relation =
    firstPage === undefined || myUserId === undefined ? null : callRelation(firstPage, myUserId);

  const submit = (): void => {
    const issue = messageIssue(message);
    setMessageError(issue === null ? null : t(issue, { max: APPLICATION_MESSAGE_MAX }));
    if (issue !== null) {
      return;
    }
    apply.mutate(normalizeMessage(message), {
      onError: (error) => {
        if (error instanceof ApiError && error.code === 'already_participant') {
          setParticipant(true);
        }
      },
    });
  };

  let applySection;
  if (relation === null) {
    const failed = relationQuery.status === 'error' || me.status === 'error';
    applySection = (
      <ResourceState
        status={failed ? 'error' : 'pending'}
        error={relationQuery.error ?? me.error}
        onRetry={() => {
          void relationQuery.refetch();
          void me.refetch();
        }}
        missingTitle={t('detail.missingTitle')}
        missingMessage={t('detail.missingMessage')}
        testID="relation"
      />
    );
  } else if (relation.kind === 'staff') {
    applySection = (
      <>
        <Notice testID="own-team">{t('detail.ownTeam')}</Notice>
        <View style={{ marginTop: theme.spacing['4'] }}>
          <SectionTitle>{t('manage.applicationsTitle')}</SectionTitle>
          <ApplicationList calls={callsApi} callId={callId} active={active} />
        </View>
      </>
    );
  } else if (relation.kind === 'applicant') {
    applySection = (
      <OwnApplication application={relation.application} callId={callId} disabled={busy} />
    );
  } else if (participant) {
    applySection = <Notice testID="already-participant">{t('apply.participant')}</Notice>;
  } else if (!active) {
    applySection = <Notice testID="apply-closed">{t('apply.closed')}</Notice>;
  } else if (me.data?.emailVerified !== true) {
    applySection = <Notice testID="apply-unverified">{t('apply.unverified')}</Notice>;
  } else {
    applySection = (
      <View testID="apply-form">
        <TextField
          label={t('apply.messageLabel')}
          helperText={t('apply.messageHelp', { max: APPLICATION_MESSAGE_MAX })}
          error={messageError}
          value={message}
          onChangeText={(text) => {
            setMessage(text);
            setMessageError(null);
          }}
          multiline
          maxLength={APPLICATION_MESSAGE_MAX}
          editable={!busy}
          testID="apply-message"
        />
        <FormError error={apply.error} />
        <Button
          label={t('apply.submit')}
          variant="accent"
          loading={apply.isPending}
          disabled={busy}
          onPress={submit}
          testID="apply-submit"
        />
      </View>
    );
  }

  return (
    <MatchScreen
      title={call.teamName}
      subtitle={formatDateTime(call.startsAt, i18n.language)}
      back={CALLS_HOME}
      testID="call-screen"
    >
      <CachedNotice visible={relationQuery.isError && relationQuery.data !== undefined} />
      {active ? null : (
        <Section>
          <Notice testID="call-ended">{t('detail.ended')}</Notice>
        </Section>
      )}
      <Section>
        <CallFacts call={call} place={place} />
      </Section>
      <SectionTitle>{t('apply.title')}</SectionTitle>
      <Section>{applySection}</Section>
    </MatchScreen>
  );
}
