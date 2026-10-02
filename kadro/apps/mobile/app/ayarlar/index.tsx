import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useStore } from 'zustand';

import { session } from '../../src/api/instance';
import { FormError, TextLink } from '../../src/auth/components';
import { useAsyncAction } from '../../src/auth/use-async-action';
import { type Language, LANGUAGES } from '../../src/i18n/resources';
import { ChoiceGroup } from '../../src/matches/components';
import { ProfileScreen } from '../../src/profile/components';
import { profileApi } from '../../src/profile/instance';
import { appLegalLinks, pushPort, pushStore } from '../../src/settings/instance';
import { chooseLanguage, currentLanguage } from '../../src/settings/language';
import { LEGAL_PAGES } from '../../src/settings/legal';
import {
  type PushPermission,
  type PushRegistration,
  registerDevice,
} from '../../src/settings/push';
import { Notice, Section } from '../../src/teams/components';
import { useTheme } from '../../src/theme';
import { Button, Card, Text } from '../../src/ui';

/** Each language is named in itself, so it can be found whatever the current language is. */
function languageName(language: Language): string {
  return language === 'tr' ? 'Türkçe' : 'English';
}

/**
 * Settings: language, notifications of this device, legal pages, sign-out and the way to delete
 * the account (Apple guideline 5.1.1(v), security checklist item 21).
 */
export default function SettingsScreen() {
  const { t, i18n } = useTranslation('common');
  const theme = useTheme();
  const router = useRouter();
  const signOut = useAsyncAction();
  const language = currentLanguage(i18n);

  return (
    <ProfileScreen title={t('settings.title')} testID="settings-screen">
      <Section>
        <Text variant="title3" style={{ marginBottom: theme.spacing['3'] }}>
          {t('settings.language')}
        </Text>
        <ChoiceGroup<Language>
          label={t('settings.language')}
          options={LANGUAGES.map((value) => ({ value, label: languageName(value) }))}
          selected={language}
          onSelect={(value) => void chooseLanguage(i18n, value, AsyncStorage)}
          testID="settings-language"
        />
      </Section>
      <Section>
        <PushSettings />
      </Section>
      <Section>
        <Text variant="title3" style={{ marginBottom: theme.spacing['2'] }}>
          {t('settings.legal')}
        </Text>
        {appLegalLinks.length === 0 ? (
          <Notice testID="legal-unavailable">{t('settings.legalUnavailable')}</Notice>
        ) : (
          <View testID="legal-links">
            {LEGAL_PAGES.map((page) => {
              const url = appLegalLinks.find((link) => link.key === page.key)?.url;
              return url === undefined ? null : (
                <TextLink
                  key={page.key}
                  label={t(`settings.legalPage.${page.key}`)}
                  hint={t('settings.opensBrowser')}
                  onPress={() => void Linking.openURL(url)}
                />
              );
            })}
            <Text variant="footnote" tone="muted">
              {t('settings.legalSample')}
            </Text>
          </View>
        )}
      </Section>
      <Section>
        <FormError error={signOut.error} />
        <Button
          label={t('profile.signOut')}
          accessibilityHint={t('profile.signOutHint')}
          variant="secondary"
          loading={signOut.busy}
          onPress={() => void signOut.run(() => session.signOut({ revokeRemote: true }))}
          testID="settings-sign-out"
        />
        <Text variant="footnote" tone="muted" style={{ marginTop: theme.spacing['2'] }}>
          {t('settings.signOutScope')}
        </Text>
      </Section>
      <Section>
        <Card>
          <Text variant="title3" style={{ marginBottom: theme.spacing['2'] }}>
            {t('deletion.entryTitle')}
          </Text>
          <Text tone="muted" style={{ marginBottom: theme.spacing['3'] }}>
            {t('deletion.entryMessage')}
          </Text>
          <Button
            label={t('deletion.entry')}
            variant="danger"
            onPress={() => router.push('/ayarlar/hesabi-sil')}
            testID="settings-delete"
          />
        </Card>
      </Section>
    </ProfileScreen>
  );
}

type PushView = PushRegistration | 'loading' | 'undetermined' | 'granted';

function viewOf(permission: PushPermission, registered: boolean): PushView {
  if (permission === 'granted') {
    return registered ? 'registered' : 'granted';
  }
  return permission;
}

/** This device's notification state and the one action that fits it. */
function PushSettings() {
  const { t } = useTranslation('common');
  const theme = useTheme();
  const registered = useStore(pushStore, (state) => state.registered);
  const action = useAsyncAction();
  const [view, setView] = useState<PushView>(
    pushPort.platform === null ? 'unavailable' : 'loading',
  );

  useEffect(() => {
    if (pushPort.platform === null) {
      return;
    }
    let active = true;
    pushPort
      .permission()
      .then((permission) => {
        if (active) {
          setView(viewOf(permission, pushStore.getState().registered));
        }
      })
      .catch(() => {
        if (active) {
          setView('failed');
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const shown: PushView = view === 'granted' && registered ? 'registered' : view;

  const enable = (): void => {
    void action.run(async () => {
      const outcome = await registerDevice(pushPort, profileApi);
      if (outcome === 'registered') {
        pushStore.setState({ registered: true });
      }
      setView(outcome ?? 'undetermined');
    });
  };

  const canEnable = shown === 'undetermined' || shown === 'granted' || shown === 'failed';

  return (
    <View testID="push-settings">
      <Text variant="title3" style={{ marginBottom: theme.spacing['2'] }}>
        {t('settings.push')}
      </Text>
      <Text tone="muted" accessibilityLiveRegion="polite" testID={`push-${shown}`}>
        {t(`settings.pushState.${shown}`)}
      </Text>
      <FormError error={action.error} />
      {canEnable ? (
        <Button
          label={shown === 'undetermined' ? t('settings.pushEnable') : t('settings.pushRegister')}
          variant="secondary"
          loading={action.busy}
          onPress={enable}
          testID="push-enable"
          style={{ marginTop: theme.spacing['3'] }}
        />
      ) : null}
    </View>
  );
}
