import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Notice, Section, TeamScreen } from '../../src/teams/components';
import { parseInviteInput } from '../../src/teams/invite-code';
import { InviteJoin } from '../../src/teams/InviteJoin';
import { useTheme } from '../../src/theme';
import { Button, TextField } from '../../src/ui';

/**
 * Join with a code typed or pasted by hand (an invite link or the bare code). The code stays in
 * this screen's memory; it is not put into the route.
 */
export default function JoinTeamScreen() {
  const { t } = useTranslation('teams');
  const theme = useTheme();
  const [input, setInput] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [code, setCode] = useState<string | null>(null);

  const show = (): void => {
    const parsed = parseInviteInput(input);
    setInvalid(parsed === null);
    setCode(parsed);
  };

  return (
    <TeamScreen title={t('join.title')} testID="join-team-screen">
      {code === null ? (
        <Section>
          <View style={{ marginBottom: theme.spacing['4'] }}>
            <Notice>{t('join.subtitle')}</Notice>
          </View>
          <TextField
            label={t('join.input')}
            value={input}
            onChangeText={(value) => {
              setInput(value);
              setInvalid(false);
            }}
            error={invalid ? t('join.inputInvalid') : null}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            onSubmitEditing={show}
            maxLength={512}
            testID="invite-input"
          />
          <Button
            label={t('join.submit')}
            onPress={show}
            testID="invite-show"
            style={{ marginTop: theme.spacing['2'] }}
          />
        </Section>
      ) : (
        <>
          <InviteJoin code={code} />
          <Section>
            <Button
              label={t('join.other')}
              variant="secondary"
              onPress={() => {
                setCode(null);
                setInput('');
              }}
            />
          </Section>
        </>
      )}
    </TeamScreen>
  );
}
