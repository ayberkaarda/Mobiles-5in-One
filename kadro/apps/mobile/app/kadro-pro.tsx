import { useQuery } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, View } from 'react-native';

import { api } from '../src/api/instance';
import { FormError, TextLink } from '../src/auth/components';
import { useAsyncAction } from '../src/auth/use-async-action';
import { ManageSubscriptionLink } from '../src/billing/ManageSubscriptionLink';
import { billing } from '../src/billing/instance';
import { runPurchase, runRestore, type PurchaseOutcome } from '../src/billing/flow';
import { isPro, useRefreshPro } from '../src/billing/hooks';
import { storeTermsUrl } from '../src/billing/links';
import { offersQuery } from '../src/billing/queries';
import { type BillingOffer, type BillingPeriod, billingFailure } from '../src/billing/port';
import { formatDateTime } from '../src/i18n/format';
import { ProfileScreen } from '../src/profile/components';
import { meQuery } from '../src/query';
import { appLegalLinks } from '../src/settings/instance';
import { legalLink } from '../src/settings/legal';
import { Notice, Section } from '../src/teams/components';
import { useTheme } from '../src/theme';
import { Button, ListItem, SegmentedControl, Text } from '../src/ui';

const BENEFITS = ['unlimitedTeams', 'lineupHistory', 'advancedStats', 'noUpsell'] as const;

/**
 * Kadro Pro paywall: the monthly and yearly store offers, purchase and restore. Pro is whatever
 * the server reports in `me.entitlements`; after the store confirms, the profile is re-read until
 * the server agrees (the purchase webhook is asynchronous), never decided here.
 */
export default function PaywallScreen() {
  const { t, i18n } = useTranslation('common');
  const theme = useTheme();
  const me = useQuery(meQuery(api));
  const offers = useQuery(offersQuery(billing));
  const refreshPro = useRefreshPro(api);
  const action = useAsyncAction();
  const [selected, setSelected] = useState<BillingPeriod | null>(null);
  const [outcome, setOutcome] = useState<PurchaseOutcome | null>(null);

  const pro = isPro(me.data);
  const list = offers.data ?? [];
  const chosen: BillingOffer | undefined =
    list.find((offer) => offer.period === selected) ??
    list.find((o) => o.period === 'yearly') ??
    list[0];

  const deps = { port: billing, refreshPro };
  const buy = (): void => {
    if (chosen === undefined) {
      return;
    }
    setOutcome(null);
    void action.run(async () => {
      setOutcome(await runPurchase(deps, chosen.id));
    });
  };
  const restore = (): void => {
    setOutcome(null);
    void action.run(async () => {
      setOutcome(await runRestore(deps));
    });
  };

  const termsUrl = storeTermsUrl(Platform.OS);
  const privacyUrl = legalLink(appLegalLinks, 'privacy');
  const entitlements = me.data?.entitlements;

  return (
    <ProfileScreen title={t('paywall.title')} testID="paywall-screen">
      {pro ? (
        <Section>
          <Notice testID="paywall-active">
            {entitlements?.expiresAt
              ? t('paywall.activeUntil', {
                  date: formatDateTime(entitlements.expiresAt, i18n.language),
                })
              : t('paywall.active')}
          </Notice>
          <ManageSubscriptionLink />
        </Section>
      ) : (
        <>
          <Section>
            <Text tone="muted">{t('paywall.subtitle')}</Text>
            <View style={{ marginTop: theme.spacing['3'] }}>
              {BENEFITS.map((benefit) => (
                <ListItem
                  key={benefit}
                  title={t(`paywall.benefit.${benefit}`)}
                  divider
                  testID={`paywall-benefit-${benefit}`}
                />
              ))}
            </View>
          </Section>
          <Section>
            {!billing.available ? (
              <Notice testID="paywall-unavailable">{t('paywall.unavailable')}</Notice>
            ) : offers.isPending ? (
              <Text tone="muted" testID="paywall-loading">
                {t('state.loading')}
              </Text>
            ) : offers.isError ? (
              <View testID="paywall-offers-error">
                <Text tone="muted" accessibilityLiveRegion="polite">
                  {t(`paywall.outcome.${failureKey(billingFailure(offers.error))}`)}
                </Text>
                <Button
                  label={t('state.retry')}
                  variant="secondary"
                  onPress={() => void offers.refetch()}
                  testID="paywall-offers-retry"
                  style={{ marginTop: theme.spacing['3'] }}
                />
              </View>
            ) : list.length === 0 ? (
              <Notice testID="paywall-empty">{t('paywall.offersEmpty')}</Notice>
            ) : (
              <>
                <SegmentedControl<BillingPeriod>
                  label={t('paywall.plans')}
                  options={list.map((offer) => ({
                    value: offer.period,
                    label: t('paywall.planLabel', {
                      plan: t(`paywall.plan.${offer.period}`),
                      price: offer.priceString,
                    }),
                  }))}
                  selected={chosen?.period ?? null}
                  onSelect={setSelected}
                  disabled={action.busy}
                  testID="paywall-plans"
                />
                <Button
                  label={t('paywall.subscribe')}
                  loading={action.busy}
                  onPress={buy}
                  testID="paywall-subscribe"
                  style={{ marginTop: theme.spacing['4'] }}
                />
              </>
            )}
          </Section>
          {billing.available ? (
            <Section>
              <Button
                label={t('paywall.restore')}
                variant="secondary"
                disabled={action.busy}
                onPress={restore}
                testID="paywall-restore"
              />
            </Section>
          ) : null}
        </>
      )}
      <Section>
        <FormError error={action.error} />
        {outcome === null ? null : (
          <Notice testID={`paywall-outcome-${outcome}`}>{t(`paywall.outcome.${outcome}`)}</Notice>
        )}
      </Section>
      <Section>
        <Text variant="footnote" tone="muted">
          {t('paywall.renewal')}
        </Text>
        {termsUrl === null ? null : (
          <TextLink
            label={t('paywall.terms')}
            hint={t('settings.opensBrowser')}
            onPress={() => void Linking.openURL(termsUrl)}
          />
        )}
        {privacyUrl === null ? null : (
          <TextLink
            label={t('settings.legalPage.privacy')}
            hint={t('settings.opensBrowser')}
            onPress={() => void Linking.openURL(privacyUrl)}
          />
        )}
        <Text variant="footnote" tone="muted">
          {t('settings.legalSample')}
        </Text>
      </Section>
    </ProfileScreen>
  );
}

/** Failure of the price list as an outcome key (the list has no purchase result of its own). */
function failureKey(kind: ReturnType<typeof billingFailure>): PurchaseOutcome {
  switch (kind) {
    case 'network':
    case 'store':
    case 'unavailable':
      return kind;
    default:
      return 'error';
  }
}
