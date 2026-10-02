import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { api } from '../../src/api/instance';
import { useAsyncAction } from '../../src/auth/use-async-action';
import { DistrictPicker } from '../../src/calls/components';
import { callsApi } from '../../src/calls/instance';
import { districtsQuery } from '../../src/calls/queries';
import { ChoiceGroup, MatchScreen, SectionTitle } from '../../src/matches/components';
import { meQuery } from '../../src/query';
import { Notice, ResourceState, Section } from '../../src/teams/components';
import { useTheme } from '../../src/theme';
import { Button, Text, TextField } from '../../src/ui';
import { VenueWriteError } from '../../src/venues/components';
import { type VenueFeature } from '../../src/venues/contracts';
import {
  EMPTY_VENUE_DRAFT,
  FEATURES,
  VENUE_LIMITS,
  venueBody,
  type VenueDraft,
  type VenueDraftField,
  type VenueValidationKey,
} from '../../src/venues/form';
import { venuesApi } from '../../src/venues/instance';
import { VENUES_HOME, venueHref } from '../../src/venues/links';
import { useCreateVenue } from '../../src/venues/mutations';
import { canAddVenue } from '../../src/venues/permissions';

type FeatureChoice = 'yes' | 'no' | 'unknown';

const COPY_PARAMS = {
  min: VENUE_LIMITS.nameMin,
  max: VENUE_LIMITS.nameMax,
  addressMax: VENUE_LIMITS.addressMax,
  phoneMin: VENUE_LIMITS.phoneMin,
  phoneMax: VENUE_LIMITS.phoneMax,
} as const;

/**
 * Suggest a venue (`POST /api/v1/venues`, verified email, daily limit V). The venue is created
 * unverified: until a moderator verifies it, only its creator sees it, and its phone and address
 * stay private (footnote 23). The screen says so before the form.
 */
export default function NewVenueScreen() {
  const { t } = useTranslation('venues');
  const theme = useTheme();
  const router = useRouter();
  const me = useQuery(meQuery(api));
  const districts = useQuery(districtsQuery(callsApi));
  const create = useCreateVenue(venuesApi);
  const action = useAsyncAction();
  const [draft, setDraft] = useState<VenueDraft>(EMPTY_VENUE_DRAFT);
  const [issues, setIssues] = useState<Partial<Record<VenueDraftField, VenueValidationKey>>>({});

  const update = <K extends keyof VenueDraft>(field: K, value: VenueDraft[K]): void => {
    setDraft((current) => ({ ...current, [field]: value }));
    if (field in issues) {
      setIssues((current) => ({ ...current, [field]: undefined }));
    }
  };

  const issueText = (field: VenueDraftField): string | null => {
    // eslint-disable-next-line security/detect-object-injection -- field is a typed VenueDraftField
    const key = issues[field];
    return key === undefined ? null : t(key, COPY_PARAMS);
  };

  if (me.data === undefined) {
    return (
      <MatchScreen title={t('add.title')} back={VENUES_HOME} testID="new-venue-screen">
        <ResourceState
          status={me.status === 'error' ? 'error' : 'pending'}
          error={me.error}
          onRetry={() => void me.refetch()}
          missingTitle={t('review.meMissing')}
          missingMessage={t('review.meMissing')}
          testID="new-venue-me"
        />
      </MatchScreen>
    );
  }

  if (!canAddVenue(me.data)) {
    return (
      <MatchScreen title={t('add.title')} back={VENUES_HOME} testID="new-venue-screen">
        <Section>
          <Notice testID="new-venue-unverified">{t('add.unverifiedEmail')}</Notice>
        </Section>
      </MatchScreen>
    );
  }

  const submit = (): void => {
    const result = venueBody(draft);
    if (!result.ok) {
      setIssues(result.issues);
      return;
    }
    setIssues({});
    // One request per press series: a repeated POST could suggest the venue twice.
    void action.run(async () => {
      const venue = await create.mutateAsync(result.body);
      router.replace(venueHref(venue.slug));
    });
  };

  const featureChoice = (feature: VenueFeature): FeatureChoice => {
    // eslint-disable-next-line security/detect-object-injection -- feature is a typed VenueFeature
    const value = draft.features[feature];
    return value === undefined ? 'unknown' : value ? 'yes' : 'no';
  };

  const setFeature = (feature: VenueFeature, choice: FeatureChoice): void => {
    // An unknown feature is left out of the body (absent key = unknown).
    const next = Object.fromEntries(
      Object.entries(draft.features).filter(([key]) => key !== feature),
    ) as VenueDraft['features'];
    update('features', choice === 'unknown' ? next : { ...next, [feature]: choice === 'yes' });
  };

  const disabled = action.busy;

  return (
    <MatchScreen title={t('add.title')} back={VENUES_HOME} testID="new-venue-screen">
      <Section>
        <Notice testID="new-venue-unverified-notice">{t('add.unverifiedNotice')}</Notice>
      </Section>
      <Section>
        <View style={{ gap: theme.spacing['3'] }}>
          <TextField
            label={t('add.name')}
            helperText={t('add.nameHelp', COPY_PARAMS)}
            error={issueText('name')}
            value={draft.name}
            onChangeText={(value) => update('name', value)}
            editable={!disabled}
            maxLength={VENUE_LIMITS.nameMax + 20}
            testID="new-venue-name"
          />
          <DistrictPicker
            districts={districts}
            selected={draft.districtId}
            onSelect={(districtId) => update('districtId', districtId)}
            noneLabel={t('add.districtNone')}
            disabled={disabled}
            testID="new-venue-district"
          />
          {issueText('districtId') === null ? null : (
            <Text tone="danger" accessibilityRole="alert" testID="new-venue-district-error">
              {issueText('districtId') ?? ''}
            </Text>
          )}
          <TextField
            label={t('add.location')}
            helperText={t('add.locationHelp')}
            error={issueText('location')}
            value={draft.location}
            onChangeText={(value) => update('location', value)}
            editable={!disabled}
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
            testID="new-venue-location"
          />
          <TextField
            label={t('add.address')}
            helperText={t('add.addressHelp', COPY_PARAMS)}
            error={issueText('address')}
            value={draft.address}
            onChangeText={(value) => update('address', value)}
            editable={!disabled}
            maxLength={VENUE_LIMITS.addressMax + 20}
            testID="new-venue-address"
          />
          <TextField
            label={t('add.phone')}
            helperText={t('add.phoneHelp', COPY_PARAMS)}
            error={issueText('phone')}
            value={draft.phone}
            onChangeText={(value) => update('phone', value)}
            editable={!disabled}
            keyboardType="phone-pad"
            testID="new-venue-phone"
          />
          <View>
            <Text variant="label" style={{ marginBottom: theme.spacing['2'] }}>
              {t('facts.type')}
            </Text>
            <ChoiceGroup
              label={t('facts.type')}
              options={[
                { value: 'indoor', label: t('facts.indoor') },
                { value: 'outdoor', label: t('facts.outdoor') },
              ]}
              selected={draft.indoor === null ? null : draft.indoor ? 'indoor' : 'outdoor'}
              onSelect={(value) => update('indoor', value === 'indoor')}
              disabled={disabled}
              testID="new-venue-indoor"
            />
            {issueText('indoor') === null ? null : (
              <Text tone="danger" accessibilityRole="alert" testID="new-venue-indoor-error">
                {issueText('indoor') ?? ''}
              </Text>
            )}
          </View>
          <TextField
            label={t('add.priceMin')}
            helperText={t('add.priceHelp')}
            error={issueText('priceMin')}
            value={draft.priceMin}
            onChangeText={(value) => update('priceMin', value)}
            editable={!disabled}
            keyboardType="decimal-pad"
            testID="new-venue-price-min"
          />
          <TextField
            label={t('add.priceMax')}
            helperText={t('add.priceHelp')}
            error={issueText('priceMax')}
            value={draft.priceMax}
            onChangeText={(value) => update('priceMax', value)}
            editable={!disabled}
            keyboardType="decimal-pad"
            testID="new-venue-price-max"
          />
        </View>
      </Section>
      <SectionTitle>{t('add.featuresTitle')}</SectionTitle>
      <Section>
        <View style={{ gap: theme.spacing['3'] }}>
          {FEATURES.map((feature) => (
            <View key={feature}>
              <Text variant="label" style={{ marginBottom: theme.spacing['2'] }}>
                {t(`feature.${feature}`)}
              </Text>
              <ChoiceGroup
                label={t(`feature.${feature}`)}
                options={(['yes', 'no', 'unknown'] as const).map((choice) => ({
                  value: choice,
                  label: t(`add.featureChoice.${choice}`),
                }))}
                selected={featureChoice(feature)}
                onSelect={(choice) => setFeature(feature, choice)}
                disabled={disabled}
                testID={`new-venue-feature-${feature}`}
              />
            </View>
          ))}
        </View>
      </Section>
      <Section>
        <VenueWriteError error={action.error} context="venue" />
        <Button
          label={t('add.submit')}
          variant="accent"
          loading={action.busy}
          disabled={disabled}
          onPress={submit}
          testID="new-venue-submit"
        />
      </Section>
    </MatchScreen>
  );
}
