import { useQuery } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ApiError } from '../../src/api/errors';
import { api, session } from '../../src/api/instance';
import { FormError, PasswordField, TextLink, useValidationText } from '../../src/auth/components';
import { issueResolver } from '../../src/auth/forms';
import { nativeApplePort } from '../../src/auth/apple-native';
import { providerSignIn } from '../../src/auth/instance';
import { runtimeRandomBytes } from '../../src/auth/nonce';
import { useAsyncAction } from '../../src/auth/use-async-action';
import { type MeResponse } from '../../src/profile/contracts';
import { ProfileScreen } from '../../src/profile/components';
import { profileApi } from '../../src/profile/instance';
import { meQuery } from '../../src/query';
import {
  appleProof,
  DELETION_GRACE_DAYS,
  DELETION_NOTICE_ROUTE,
  type DeletionValidationKey,
  needsTotp,
  passwordProof,
  passwordProofIssue,
  proofMethod,
  type ProofMethod,
  startDeletion,
  TOTP_LENGTH,
  totpIssue,
} from '../../src/settings/deletion';
import { appLegalLinks } from '../../src/settings/instance';
import { deletionNotice } from '../../src/settings/notice';
import { legalLink } from '../../src/settings/legal';
import { ConfirmAction, Notice, ResourceState, Section } from '../../src/teams/components';
import { useTheme } from '../../src/theme';
import { Text, TextField } from '../../src/ui';

const SETTINGS_HOME = '/ayarlar';

/**
 * "Hesabımı sil" (security checklist item 21, Apple guideline 5.1.1(v)): what happens, the
 * re-authentication the account needs (authorization matrix footnotes 4–5), then `DELETE me`.
 */
export default function DeleteAccountScreen() {
  const { t } = useTranslation('common');
  const me = useQuery(meQuery(api));
  const [appleAvailable, setAppleAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    providerSignIn
      .appleAvailable()
      .catch(() => false)
      .then((available) => {
        if (active) {
          setAppleAvailable(available);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  if (me.data === undefined || appleAvailable === null) {
    return (
      <ProfileScreen title={t('deletion.title')} home={SETTINGS_HOME} testID="deletion-screen">
        <ResourceState
          status={me.status === 'error' ? 'error' : 'pending'}
          error={me.error}
          onRetry={() => void me.refetch()}
          missingTitle={t('state.errorTitle')}
          missingMessage={t('error.unknown')}
          testID="deletion"
        />
      </ProfileScreen>
    );
  }
  return <DeletionFlow me={me.data} method={proofMethod(me.data, appleAvailable)} />;
}

interface ProofValues {
  readonly password: string;
  readonly totpCode: string;
}

function DeletionFlow({ me, method }: { readonly me: MeResponse; readonly method: ProofMethod }) {
  const { t } = useTranslation('common');
  const theme = useTheme();
  const router = useRouter();
  const validationText = useValidationText();
  const action = useAsyncAction();
  const [step, setStep] = useState<'explain' | 'proof'>('explain');
  const staff = needsTotp(me);
  const { control, handleSubmit } = useForm<ProofValues>({
    defaultValues: { password: '', totpCode: '' },
    resolver: issueResolver<ProofValues, DeletionValidationKey>((values) => ({
      password: method === 'password' ? passwordProofIssue(values.password) : null,
      totpCode: staff ? totpIssue(values.totpCode) : null,
    })),
  });

  const deps = {
    profile: profileApi,
    session,
    notice: deletionNotice,
    showNotice: () => router.replace(DELETION_NOTICE_ROUTE),
  };

  const submit = handleSubmit((values) => {
    const totp = staff ? values.totpCode : null;
    void action.run(async () => {
      if (method === 'apple') {
        const proof = await appleProof(nativeApplePort, runtimeRandomBytes, totp);
        if (proof.kind !== 'proof') {
          return;
        }
        await startDeletion(deps, proof.body);
      } else {
        // A refused proof stays in the form, so a typo can be corrected.
        await startDeletion(deps, passwordProof(values.password, totp));
      }
    });
  });

  const webLink = legalLink(appLegalLinks, 'deletion');

  return (
    <ProfileScreen title={t('deletion.title')} home={SETTINGS_HOME} testID="deletion-screen">
      <Section>
        <View testID="deletion-explain" style={{ gap: theme.spacing['2'] }}>
          <Text>{t('deletion.whatHappens', { days: DELETION_GRACE_DAYS })}</Text>
          <Text tone="muted">{t('deletion.now')}</Text>
          <Text tone="muted">{t('deletion.grace', { days: DELETION_GRACE_DAYS })}</Text>
          <Text tone="muted">{t('deletion.after')}</Text>
          <Text tone="muted">{t('deletion.teams')}</Text>
          <Text tone="muted">{t('deletion.subscription')}</Text>
        </View>
      </Section>
      {step === 'explain' ? (
        <Section>
          <ConfirmAction
            label={t('deletion.continue')}
            question={t('deletion.continueQuestion')}
            confirmLabel={t('deletion.continueConfirm')}
            cancelLabel={t('deletion.cancel')}
            onConfirm={() => setStep('proof')}
            variant="danger"
            testID="deletion-continue"
          />
        </Section>
      ) : method === 'web' ? (
        <Section>
          <Notice testID="deletion-web">{t('deletion.webOnly')}</Notice>
          {webLink === null ? null : (
            <TextLink
              label={t('settings.legalPage.deletion')}
              hint={t('settings.opensBrowser')}
              onPress={() => void Linking.openURL(webLink)}
            />
          )}
        </Section>
      ) : (
        <Section>
          <DeletionError error={action.error} />
          {method === 'password' ? (
            <Controller
              control={control}
              name="password"
              render={({ field, fieldState }) => (
                <PasswordField
                  label={t('deletion.password')}
                  helperText={t('deletion.passwordHint')}
                  showLabel={t('deletion.showPassword')}
                  hideLabel={t('deletion.hidePassword')}
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  error={validationText(fieldState.error?.message)}
                  editable={!action.busy}
                  autoComplete="current-password"
                  textContentType="password"
                  testID="deletion-password"
                />
              )}
            />
          ) : (
            <Notice testID="deletion-apple">{t('deletion.appleHint')}</Notice>
          )}
          {staff ? (
            <Controller
              control={control}
              name="totpCode"
              render={({ field, fieldState }) => (
                <TextField
                  label={t('deletion.totp')}
                  helperText={t('deletion.totpHint', { length: TOTP_LENGTH })}
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  error={validationText(fieldState.error?.message)}
                  editable={!action.busy}
                  keyboardType="number-pad"
                  autoComplete="one-time-code"
                  textContentType="oneTimeCode"
                  maxLength={TOTP_LENGTH}
                  testID="deletion-totp"
                />
              )}
            />
          ) : null}
          <ConfirmAction
            label={method === 'apple' ? t('deletion.submitApple') : t('deletion.submit')}
            question={t('deletion.submitQuestion', { days: DELETION_GRACE_DAYS })}
            confirmLabel={t('deletion.submitConfirm')}
            cancelLabel={t('deletion.cancel')}
            onConfirm={() => void submit()}
            busy={action.busy}
            disabled={action.busy}
            variant="danger"
            testID="deletion-submit"
          />
        </Section>
      )}
    </ProfileScreen>
  );
}

const DELETION_ERROR_CODES = new Set([
  'reauth_required',
  'step_up_required',
  'deletion_pending',
  'last_admin',
  'rate_limited',
]);

/**
 * Failure of the request in the deletion copy (refused password or token, missing TOTP, last
 * admin, too many attempts), so it never reads as a server outage; anything else goes through the
 * error catalog with its request id.
 */
function DeletionError({ error }: { readonly error: unknown }) {
  const { t } = useTranslation('common');
  const theme = useTheme();
  if (
    !(error instanceof ApiError) ||
    error.code === null ||
    !DELETION_ERROR_CODES.has(error.code)
  ) {
    return <FormError error={error} />;
  }
  return (
    <View style={{ marginBottom: theme.spacing['4'] }}>
      <Text
        tone="danger"
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        testID="deletion-error-message"
      >
        {t(`deletion.errors.${error.code}`)}
      </Text>
      {error.requestId === null ? null : (
        <Text variant="caption" tone="muted" selectable style={{ marginTop: theme.spacing['1'] }}>
          {`${t('state.reference')}: ${error.requestId}`}
        </Text>
      )}
    </View>
  );
}
