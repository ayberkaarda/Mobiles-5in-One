import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { api } from '../../src/api/instance';
import { ApiError } from '../../src/api/errors';
import { FormError, useValidationText } from '../../src/auth/components';
import { issueResolver } from '../../src/auth/forms';
import { useAsyncAction } from '../../src/auth/use-async-action';
import { AUTH_LIMITS } from '../../src/auth/validation';
import { DistrictPicker } from '../../src/calls/components';
import { callsApi } from '../../src/calls/instance';
import { districtsQuery } from '../../src/calls/queries';
import { ChoiceGroup } from '../../src/matches/components';
import { type AvatarUploadOutcome, uploadAvatar } from '../../src/profile/avatar-upload';
import { Avatar, PROFILE_HOME, ProfileScreen } from '../../src/profile/components';
import { type Level, type MeResponse, type Position } from '../../src/profile/contracts';
import {
  changedProfileFields,
  PROFILE_LEVELS,
  PROFILE_POSITIONS,
  profileFieldOf,
  profileIssues,
  profileValues,
  type ProfileValues,
} from '../../src/profile/form';
import { avatarPicker, profileApi } from '../../src/profile/instance';
import { useProfileBusy, useUpdateProfile } from '../../src/profile/mutations';
import { meQuery, queryKeys } from '../../src/query';
import { ConfirmAction, Notice, ResourceState, Section } from '../../src/teams/components';
import { useTheme } from '../../src/theme';
import { Button, Text, TextField } from '../../src/ui';

const NOT_SET = '_none';
type PositionChoice = Position | typeof NOT_SET;
type LevelChoice = Level | typeof NOT_SET;

/** Edit the own profile (`PATCH /api/v1/me`): name, position, level, district and the photo. */
export default function EditProfileScreen() {
  const { t } = useTranslation('common');
  const me = useQuery(meQuery(api));
  if (me.data === undefined) {
    return (
      <ProfileScreen title={t('profileEdit.title')} testID="profile-edit-screen">
        <ResourceState
          status={me.status === 'error' ? 'error' : 'pending'}
          error={me.error}
          onRetry={() => void me.refetch()}
          missingTitle={t('state.errorTitle')}
          missingMessage={t('error.unknown')}
          testID="profile-edit"
        />
      </ProfileScreen>
    );
  }
  // Keyed by the profile id, so the form starts from the loaded profile exactly once.
  return <EditProfileForm key={me.data.id} me={me.data} />;
}

function uploadNotice(outcome: AvatarUploadOutcome): string | null {
  switch (outcome.kind) {
    case 'cancelled':
    case 'ready':
      return null;
    case 'invalid':
      return outcome.reason === 'type' ? 'profileEdit.photoType' : 'profileEdit.photoSize';
    case 'rejected':
      return 'profileEdit.photoRejected';
    case 'processing':
      return 'profileEdit.photoProcessing';
  }
}

function EditProfileForm({ me }: { readonly me: MeResponse }) {
  const { t } = useTranslation('common');
  const { t: tc } = useTranslation('opencalls');
  const theme = useTheme();
  const router = useRouter();
  const client = useQueryClient();
  const validationText = useValidationText();
  const update = useUpdateProfile(profileApi);
  const busy = useProfileBusy();
  const save = useAsyncAction();
  const photo = useAsyncAction();
  const [photoNotice, setPhotoNotice] = useState<string | null>(null);
  const districts = useQuery(districtsQuery(callsApi));
  const { control, handleSubmit, setError } = useForm<ProfileValues>({
    defaultValues: profileValues(me),
    resolver: issueResolver<ProfileValues>(profileIssues),
  });
  const locked = save.busy || busy;

  const leave = (): void => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(PROFILE_HOME);
    }
  };

  const submit = handleSubmit((values) => {
    const body = changedProfileFields(me, values);
    if (body === null) {
      leave();
      return;
    }
    void save
      .run(async () => {
        try {
          await update.mutateAsync(body);
        } catch (error) {
          if (error instanceof ApiError) {
            for (const fieldError of error.fieldErrors) {
              const field = profileFieldOf(fieldError.path);
              if (field !== null) {
                setError(field, { type: 'server', message: 'common:profileEdit.fieldRejected' });
              }
            }
          }
          throw error;
        }
      })
      .then((saved) => {
        if (saved) {
          leave();
        }
      });
  });

  const changePhoto = (): void => {
    if (avatarPicker === null) {
      return;
    }
    const picker = avatarPicker;
    setPhotoNotice(null);
    void photo.run(async () => {
      const outcome = await uploadAvatar({ picker, profile: profileApi });
      setPhotoNotice(uploadNotice(outcome));
      if (outcome.kind === 'ready' || outcome.kind === 'processing') {
        void client.invalidateQueries({ queryKey: queryKeys.me(), exact: true });
      }
    });
  };

  const removePhoto = (): void => {
    setPhotoNotice(null);
    void photo.run(async () => {
      await update.mutateAsync({ avatar: null });
    });
  };

  const positionOptions: { value: PositionChoice; label: string }[] = [
    { value: NOT_SET, label: t('profile.notSet') },
    ...PROFILE_POSITIONS.map((position) => ({
      value: position,
      label: tc(`position.${position}`),
    })),
  ];
  const levelOptions: { value: LevelChoice; label: string }[] = [
    { value: NOT_SET, label: t('profile.notSet') },
    ...PROFILE_LEVELS.map((level) => ({ value: level, label: tc(`level.${level}`) })),
  ];

  return (
    <ProfileScreen title={t('profileEdit.title')} testID="profile-edit-screen">
      <Section>
        <Text variant="title3" style={{ marginBottom: theme.spacing['3'] }}>
          {t('profileEdit.photo')}
        </Text>
        <Avatar url={me.avatarUrl} displayName={me.displayName} />
        <FormError error={photo.error} />
        {photoNotice === null ? null : (
          <Text tone="muted" accessibilityLiveRegion="polite" testID="photo-notice">
            {t(photoNotice)}
          </Text>
        )}
        {avatarPicker === null ? null : (
          <Button
            label={t('profileEdit.changePhoto')}
            variant="secondary"
            loading={photo.busy}
            disabled={locked}
            onPress={changePhoto}
            testID="photo-change"
            style={{ marginTop: theme.spacing['3'] }}
          />
        )}
        {me.avatarUrl === null ? null : (
          <ConfirmAction
            label={t('profileEdit.removePhoto')}
            question={t('profileEdit.removePhotoQuestion')}
            confirmLabel={t('profileEdit.removePhotoConfirm')}
            cancelLabel={t('profileEdit.cancel')}
            onConfirm={removePhoto}
            busy={photo.busy}
            disabled={locked || photo.busy}
            testID="photo-remove"
          />
        )}
      </Section>
      <Section>
        <FormError error={save.error} />
        <Controller
          control={control}
          name="displayName"
          render={({ field, fieldState }) => (
            <TextField
              label={t('profileEdit.displayName')}
              helperText={t('profileEdit.displayNameHint', {
                min: AUTH_LIMITS.displayNameMin,
                max: AUTH_LIMITS.displayNameMax,
              })}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={validationText(fieldState.error?.message)}
              editable={!locked}
              maxLength={AUTH_LIMITS.displayNameMax + 20}
              autoCapitalize="words"
              autoComplete="name"
              textContentType="name"
              testID="profile-name"
            />
          )}
        />
        <Controller
          control={control}
          name="position"
          render={({ field, fieldState }) => (
            <>
              <Text variant="label" style={{ marginBottom: theme.spacing['2'] }}>
                {t('profile.position')}
              </Text>
              <ChoiceGroup<PositionChoice>
                label={t('profile.position')}
                options={positionOptions}
                selected={field.value ?? NOT_SET}
                onSelect={(value) => field.onChange(value === NOT_SET ? null : value)}
                disabled={locked}
                testID="profile-position"
              />
              <FieldIssue message={validationText(fieldState.error?.message)} />
            </>
          )}
        />
        <Controller
          control={control}
          name="level"
          render={({ field, fieldState }) => (
            <>
              <Text
                variant="label"
                style={{ marginTop: theme.spacing['4'], marginBottom: theme.spacing['2'] }}
              >
                {t('profile.level')}
              </Text>
              <ChoiceGroup<LevelChoice>
                label={t('profile.level')}
                options={levelOptions}
                selected={field.value ?? NOT_SET}
                onSelect={(value) => field.onChange(value === NOT_SET ? null : value)}
                disabled={locked}
                testID="profile-level"
              />
              <FieldIssue message={validationText(fieldState.error?.message)} />
            </>
          )}
        />
      </Section>
      <Section>
        <Controller
          control={control}
          name="districtId"
          render={({ field, fieldState }) => (
            <>
              <DistrictPicker
                districts={districts}
                selected={field.value}
                onSelect={field.onChange}
                noneLabel={t('profile.notSet')}
                disabled={locked}
                testID="profile-district"
              />
              <FieldIssue message={validationText(fieldState.error?.message)} />
            </>
          )}
        />
        <Notice>{t('profileEdit.districtUse')}</Notice>
      </Section>
      <Section>
        <Button
          label={t('profileEdit.save')}
          loading={save.busy}
          disabled={busy && !save.busy}
          onPress={() => void submit()}
          testID="profile-save"
        />
      </Section>
    </ProfileScreen>
  );
}

function FieldIssue({ message }: { readonly message: string | null }) {
  const theme = useTheme();
  if (message === null) {
    return null;
  }
  return (
    <Text
      tone="danger"
      variant="footnote"
      accessibilityLiveRegion="polite"
      style={{ marginTop: theme.spacing['1'] }}
    >
      {message}
    </Text>
  );
}
