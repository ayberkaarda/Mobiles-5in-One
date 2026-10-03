import * as Linking from 'expo-linking';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';

import { FormError, TextLink } from '../auth/components';
import { useAsyncAction } from '../auth/use-async-action';
import { billing } from './instance';
import { manageSubscriptionUrl } from './links';

/** Opens the store's subscription management page (the SDK's URL, else the store default). */
export function ManageSubscriptionLink() {
  const { t } = useTranslation('common');
  const action = useAsyncAction();
  return (
    <>
      <FormError error={action.error} />
      <TextLink
        label={t('settings.proManage')}
        hint={t('settings.opensBrowser')}
        onPress={() =>
          void action.run(async () => {
            const url = manageSubscriptionUrl(await billing.managementUrl(), Platform.OS);
            if (url !== null) {
              await Linking.openURL(url);
            }
          })
        }
      />
    </>
  );
}
