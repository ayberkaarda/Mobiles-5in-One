import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { FormError } from '../../../../../src/auth/components';
import { useAsyncAction } from '../../../../../src/auth/use-async-action';
import { Fact, MatchScreen, matchHref } from '../../../../../src/matches/components';
import { matchesApi } from '../../../../../src/matches/instance';
import { confirmedShares, formatMinor } from '../../../../../src/matches/money';
import { useMarkPayment, useMatchBusy } from '../../../../../src/matches/mutations';
import { canMarkPayment, isStaff, paymentsWritable } from '../../../../../src/matches/permissions';
import { useMatchScreen } from '../../../../../src/matches/use-match';
import { CachedNotice, Notice, ResourceState, Section } from '../../../../../src/teams/components';
import { useTheme } from '../../../../../src/theme';
import { Button, Card, Text } from '../../../../../src/ui';

/**
 * Who has paid their share (product spec story 5; no money moves in the app). Team members see
 * the flags; captain and co-captain mark confirmed players paid or unpaid in `locked` and
 * `played` matches (`PATCH matches/:id/payments/:userId`, footnote 16: a co-captain does not mark
 * themselves). Each mark waits for the server, which audits it.
 */
export default function PaymentsScreen() {
  const { t, i18n } = useTranslation('matches');
  const theme = useTheme();
  const { matchId, teamId, query, match, myUserId, role } = useMatchScreen();
  const mark = useMarkPayment(matchesApi, matchId, teamId);
  const busy = useMatchBusy(matchId);
  const action = useAsyncAction();
  const back = matchHref(teamId, matchId);

  if (match === undefined) {
    return (
      <MatchScreen title={t('payments.title')} back={back} testID="payments-screen">
        <ResourceState
          status={query.status === 'error' ? 'error' : 'pending'}
          error={query.error}
          onRetry={() => void query.refetch()}
          missingTitle={t('detail.missingTitle')}
          missingMessage={t('detail.missingMessage')}
          testID="payments"
        />
      </MatchScreen>
    );
  }
  if (match.projection !== 'member') {
    return (
      <MatchScreen title={t('payments.title')} back={back} testID="payments-screen">
        <Section>
          <Notice testID="payments-members-only">{t('payments.membersOnly')}</Notice>
        </Section>
      </MatchScreen>
    );
  }

  const confirmed = match.participants.filter((row) => row.status === 'in');
  const shares = confirmedShares(
    match.feeTotalMinor,
    confirmed.map((row) => row.user.id),
  );
  const paidCount = confirmed.filter((row) => row.paid).length;
  const collected = confirmed.reduce(
    (sum, row) => sum + (row.paid ? (shares.get(row.user.id) ?? 0) : 0),
    0,
  );
  const writable = paymentsWritable(match.status);
  const pendingUser = mark.isPending ? (mark.variables?.userId ?? null) : null;

  const setPaid = (userId: string, paid: boolean): void => {
    void action.run(async () => {
      await mark.mutateAsync({ userId, paid });
    });
  };

  return (
    <MatchScreen
      title={t('payments.title')}
      subtitle={match.team.name}
      back={back}
      testID="payments-screen"
    >
      <CachedNotice visible={query.isError} />
      <Section>
        <Card>
          <View style={{ gap: theme.spacing['2'] }}>
            <Fact label={t('detail.fee')} value={formatMinor(match.feeTotalMinor, i18n.language)} />
            <Fact
              label={t('payments.paidCount')}
              value={t('payments.paidCountValue', { paid: paidCount, total: confirmed.length })}
              testID="payments-count"
            />
            <Fact
              label={t('payments.collected')}
              value={formatMinor(collected, i18n.language)}
              testID="payments-collected"
            />
          </View>
        </Card>
      </Section>
      <Section>
        <Notice>{t('payments.noMoney')}</Notice>
      </Section>
      {isStaff(role) && !writable ? (
        <Section>
          <Notice testID="payments-not-writable">{t('payments.notWritable')}</Notice>
        </Section>
      ) : null}
      <Section>
        <FormError error={action.error} />
      </Section>
      {confirmed.length === 0 ? (
        <Section>
          <Notice testID="payments-empty">{t('payments.empty')}</Notice>
        </Section>
      ) : (
        confirmed.map((row) => {
          const isSelf = row.user.id === myUserId;
          const name = isSelf
            ? t('participants.you', { name: row.user.displayName })
            : row.user.displayName;
          const share = shares.get(row.user.id);
          const markable = canMarkPayment(role, match.status, { status: row.status, isSelf });
          return (
            <Section key={row.user.id}>
              <Card testID={`payment-${row.user.id}`}>
                <View
                  accessible
                  accessibilityLabel={[
                    name,
                    share === undefined ? null : formatMinor(share, i18n.language),
                    row.paid ? t('payments.paid') : t('payments.unpaid'),
                  ]
                    .filter((part): part is string => part !== null)
                    .join(', ')}
                  style={{ flexDirection: 'row', justifyContent: 'space-between' }}
                >
                  <Text variant="label" style={{ flexShrink: 1 }}>
                    {name}
                  </Text>
                  <Text tabular>
                    {share === undefined ? '' : formatMinor(share, i18n.language)}
                  </Text>
                </View>
                <Text
                  tone={row.paid ? 'default' : 'muted'}
                  style={{ marginTop: theme.spacing['1'] }}
                >
                  {row.paid ? t('payments.paid') : t('payments.unpaid')}
                </Text>
                {markable ? (
                  <Button
                    label={row.paid ? t('payments.markUnpaid') : t('payments.markPaid')}
                    accessibilityLabel={
                      row.paid
                        ? t('payments.markUnpaidFor', { name: row.user.displayName })
                        : t('payments.markPaidFor', { name: row.user.displayName })
                    }
                    variant={row.paid ? 'secondary' : 'primary'}
                    disabled={busy || action.busy}
                    loading={pendingUser === row.user.id}
                    onPress={() => setPaid(row.user.id, !row.paid)}
                    testID={`payment-toggle-${row.user.id}`}
                    style={{ marginTop: theme.spacing['3'] }}
                  />
                ) : isSelf && role === 'co_captain' && writable ? (
                  <Text
                    variant="footnote"
                    tone="muted"
                    style={{ marginTop: theme.spacing['2'] }}
                    testID="payment-self-note"
                  >
                    {t('payments.selfByCaptain')}
                  </Text>
                ) : null}
              </Card>
            </Section>
          );
        })
      )}
    </MatchScreen>
  );
}
