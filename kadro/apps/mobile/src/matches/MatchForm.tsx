import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ApiError } from '../api/errors';
import { errorMessage } from '../i18n/error-copy';
import { Notice, Section } from '../teams/components';
import { useTheme } from '../theme';
import { Button, type ButtonVariant, ListItem, Text, TextField } from '../ui';
import { ChoiceGroup } from './components';
import { type MatchFormat } from './contracts';
import {
  DEFAULT_SLOTS,
  feeIssue,
  MATCH_FORMATS,
  MATCH_LIMITS,
  type MatchValidationKey,
  parseLira,
  parseSlots,
  parseStartsAt,
  searchIssue,
  startsAtIssue,
  venueTextIssue,
} from './form';
import { matchesApi } from './instance';
import { venueSearchQuery } from './queries';

export type VenueChoice =
  | { readonly kind: 'directory'; readonly id: string; readonly name: string }
  | { readonly kind: 'text'; readonly text: string };

/** Checked values of the form, ready for the request body. */
export interface MatchFormValues {
  readonly venue: VenueChoice;
  readonly startsAt: string;
  readonly format: MatchFormat;
  readonly slots: number;
  readonly feeTotalMinor: number;
}

/** What the form starts with: empty for a new match, the stored values when editing. */
export interface MatchFormInitial {
  readonly venue: VenueChoice | null;
  readonly date: string;
  readonly time: string;
  readonly format: MatchFormat;
  readonly slots: string;
  readonly fee: string;
}

export const EMPTY_MATCH_FORM: MatchFormInitial = {
  venue: null,
  date: '',
  time: '',
  format: '7v7',
  slots: String(DEFAULT_SLOTS['7v7']),
  fee: '',
};

export interface MatchFormAction {
  readonly label: string;
  readonly variant?: ButtonVariant;
  readonly testID?: string;
  readonly onSubmit: (values: MatchFormValues) => void;
}

type Field = 'venue' | 'search' | 'startsAt' | 'slots' | 'fee';

const TEXT_PARAMS = {
  min: MATCH_LIMITS.venueTextMin,
  max: MATCH_LIMITS.venueTextMax,
  searchMin: MATCH_LIMITS.searchMin,
  searchMax: MATCH_LIMITS.searchMax,
  slotsMin: MATCH_LIMITS.slotsMin,
  slotsMax: MATCH_LIMITS.slotsMax,
} as const;

/**
 * Create / edit form of a match: venue from the directory or as free text, day and time,
 * format, slots and the total pitch fee in lira (sent as kuruş). Every value is checked on the
 * device first; nothing is sent while a field is invalid. With `termsLocked` (the match was
 * locked once, ADR-0004) format, slots and fee are shown but cannot be changed.
 */
export function MatchForm({
  initial,
  termsLocked = false,
  storedStartsAt,
  busy,
  actions,
}: {
  readonly initial: MatchFormInitial;
  readonly termsLocked?: boolean;
  /** Start of the match being edited: keeping it is allowed even once it lies in the past. */
  readonly storedStartsAt?: string;
  readonly busy: boolean;
  readonly actions: readonly MatchFormAction[];
}) {
  const { t, i18n } = useTranslation('matches');
  const theme = useTheme();
  const [venueKind, setVenueKind] = useState<VenueChoice['kind']>(
    initial.venue?.kind ?? 'directory',
  );
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(
    initial.venue?.kind === 'directory' ? { id: initial.venue.id, name: initial.venue.name } : null,
  );
  const [venueText, setVenueText] = useState(
    initial.venue?.kind === 'text' ? initial.venue.text : '',
  );
  const [search, setSearch] = useState('');
  const [searchTerm, setSearchTerm] = useState<string | null>(null);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [format, setFormat] = useState<MatchFormat>(initial.format);
  const [slots, setSlots] = useState(initial.slots);
  const [slotsTouched, setSlotsTouched] = useState(initial.slots !== EMPTY_MATCH_FORM.slots);
  const [fee, setFee] = useState(initial.fee);
  const [issues, setIssues] = useState<Partial<Record<Field, MatchValidationKey>>>({});

  const venues = useQuery({
    ...venueSearchQuery(matchesApi, searchTerm ?? ''),
    enabled: searchTerm !== null,
  });

  const clearIssue = (field: Field): void => {
    // eslint-disable-next-line security/detect-object-injection -- field is a typed Field
    if (issues[field] !== undefined) {
      setIssues((current) => ({ ...current, [field]: undefined }));
    }
  };
  const issueText = (field: Field): string | null => {
    // eslint-disable-next-line security/detect-object-injection -- field is a typed Field
    const key = issues[field];
    return key === undefined ? null : t(key, TEXT_PARAMS);
  };

  const runSearch = (): void => {
    const issue = searchIssue(search);
    setIssues((current) => ({ ...current, search: issue ?? undefined }));
    if (issue === null) {
      setSearchTerm(search.trim());
    }
  };

  const submit = (action: MatchFormAction): void => {
    const next: Partial<Record<Field, MatchValidationKey>> = {};
    let venue: VenueChoice | null = null;
    if (venueKind === 'directory') {
      if (picked === null) {
        next.venue = 'validation.venueRequired';
      } else {
        venue = { kind: 'directory', ...picked };
      }
    } else {
      const issue = venueTextIssue(venueText);
      if (issue === null) {
        venue = { kind: 'text', text: venueText.trim() };
      } else {
        next.venue = issue;
      }
    }
    const startsIssue = startsAtIssue(date, time);
    const unchangedStart =
      storedStartsAt !== undefined &&
      parseStartsAt(date, time)?.getTime() === new Date(storedStartsAt).setSeconds(0, 0);
    if (startsIssue !== null && !(startsIssue === 'validation.startsInPast' && unchangedStart)) {
      next.startsAt = startsIssue;
    }
    const slotCount = parseSlots(slots);
    if (slotCount === null) {
      next.slots = 'validation.slotsInvalid';
    }
    const feeProblem = feeIssue(fee);
    if (feeProblem !== null) {
      next.fee = feeProblem;
    }
    setIssues(next);
    const startsAt = parseStartsAt(date, time);
    const feeMinor = parseLira(fee);
    if (
      Object.keys(next).length > 0 ||
      venue === null ||
      startsAt === null ||
      slotCount === null ||
      feeMinor === null
    ) {
      return;
    }
    action.onSubmit({
      venue,
      startsAt: startsAt.toISOString(),
      format,
      slots: slotCount,
      feeTotalMinor: feeMinor,
    });
  };

  const results = venues.data?.items ?? [];

  return (
    <>
      <Section>
        <Text variant="label" style={{ marginBottom: theme.spacing['2'] }}>
          {t('form.venue')}
        </Text>
        <ChoiceGroup
          label={t('form.venue')}
          options={[
            { value: 'directory', label: t('form.venueDirectory') },
            { value: 'text', label: t('form.venueText') },
          ]}
          selected={venueKind}
          onSelect={(kind) => {
            setVenueKind(kind);
            clearIssue('venue');
          }}
          disabled={busy}
          testID="venue-kind"
        />
      </Section>
      {venueKind === 'text' ? (
        <Section>
          <TextField
            label={t('form.venueTextLabel')}
            helperText={t('form.venueTextHint', TEXT_PARAMS)}
            value={venueText}
            onChangeText={(value) => {
              setVenueText(value);
              clearIssue('venue');
            }}
            error={issueText('venue')}
            editable={!busy}
            maxLength={MATCH_LIMITS.venueTextMax + 20}
            testID="venue-text"
          />
        </Section>
      ) : (
        <Section>
          {picked === null ? null : (
            <View style={{ marginBottom: theme.spacing['3'] }}>
              <Notice testID="venue-picked">{t('form.venuePicked', { venue: picked.name })}</Notice>
            </View>
          )}
          <TextField
            label={t('form.venueSearch')}
            helperText={t('form.venueSearchHint')}
            value={search}
            onChangeText={(value) => {
              setSearch(value);
              clearIssue('search');
            }}
            error={issueText('search') ?? (picked === null ? issueText('venue') : null)}
            editable={!busy}
            maxLength={MATCH_LIMITS.searchMax + 20}
            returnKeyType="search"
            onSubmitEditing={runSearch}
            testID="venue-search"
          />
          <Button
            label={t('form.venueSearchSubmit')}
            variant="secondary"
            disabled={busy}
            loading={venues.isFetching}
            onPress={runSearch}
            testID="venue-search-submit"
            style={{ marginTop: theme.spacing['2'] }}
          />
          {searchTerm === null ? null : venues.status === 'error' ? (
            <Text
              tone="danger"
              accessibilityRole="alert"
              style={{ marginTop: theme.spacing['2'] }}
              testID="venue-search-error"
            >
              {[
                errorMessage(i18n, venues.error),
                venues.error instanceof ApiError && venues.error.requestId !== null
                  ? `${t('form.reference')}: ${venues.error.requestId}`
                  : null,
              ]
                .filter((part): part is string => part !== null)
                .join(' ')}
            </Text>
          ) : venues.status === 'success' && results.length === 0 ? (
            <Text tone="muted" style={{ marginTop: theme.spacing['2'] }} testID="venue-none">
              {t('form.venueNone')}
            </Text>
          ) : (
            <View style={{ marginTop: theme.spacing['2'] }} testID="venue-results">
              {results.map((venue) => (
                <ListItem
                  key={venue.id}
                  title={venue.name}
                  meta={venue.id === picked?.id ? t('form.venueSelected') : undefined}
                  accessibilityHint={t('form.venuePickHint')}
                  disabled={busy}
                  onPress={() => {
                    setPicked({ id: venue.id, name: venue.name });
                    clearIssue('venue');
                  }}
                  testID={`venue-${venue.id}`}
                />
              ))}
            </View>
          )}
        </Section>
      )}

      <Section>
        <View style={{ flexDirection: 'row', gap: theme.spacing['3'] }}>
          <View style={{ flex: 3 }}>
            <TextField
              label={t('form.date')}
              helperText={t('form.dateHint')}
              placeholder={t('form.datePlaceholder')}
              value={date}
              onChangeText={(value) => {
                setDate(value);
                clearIssue('startsAt');
              }}
              error={issueText('startsAt')}
              editable={!busy}
              maxLength={10}
              keyboardType="numbers-and-punctuation"
              testID="match-date"
            />
          </View>
          <View style={{ flex: 2 }}>
            <TextField
              label={t('form.time')}
              helperText={t('form.timeHint')}
              placeholder={t('form.timePlaceholder')}
              value={time}
              onChangeText={(value) => {
                setTime(value);
                clearIssue('startsAt');
              }}
              editable={!busy}
              maxLength={5}
              keyboardType="numbers-and-punctuation"
              testID="match-time"
            />
          </View>
        </View>
      </Section>

      {termsLocked ? (
        <Section>
          <Notice testID="terms-frozen">{t('form.termsFrozen')}</Notice>
        </Section>
      ) : null}
      <Section>
        <Text variant="label" style={{ marginBottom: theme.spacing['2'] }}>
          {t('form.format')}
        </Text>
        <ChoiceGroup
          label={t('form.format')}
          options={MATCH_FORMATS.map((value) => ({ value, label: value }))}
          selected={format}
          onSelect={(value) => {
            setFormat(value);
            if (!slotsTouched) {
              // eslint-disable-next-line security/detect-object-injection -- value is a typed MatchFormat
              setSlots(String(DEFAULT_SLOTS[value]));
            }
          }}
          disabled={busy || termsLocked}
          testID="match-format"
        />
      </Section>
      <Section>
        <TextField
          label={t('form.slots')}
          helperText={t('form.slotsHint', TEXT_PARAMS)}
          value={slots}
          onChangeText={(value) => {
            setSlots(value);
            setSlotsTouched(true);
            clearIssue('slots');
          }}
          error={issueText('slots')}
          editable={!busy && !termsLocked}
          maxLength={2}
          keyboardType="number-pad"
          testID="match-slots"
        />
      </Section>
      <Section>
        <TextField
          label={t('form.fee')}
          helperText={t('form.feeHint')}
          placeholder={t('form.feePlaceholder')}
          value={fee}
          onChangeText={(value) => {
            setFee(value);
            clearIssue('fee');
          }}
          error={issueText('fee')}
          editable={!busy && !termsLocked}
          maxLength={16}
          keyboardType="decimal-pad"
          testID="match-fee"
        />
      </Section>
      <Section>
        {actions.map((action) => (
          <Button
            key={action.label}
            label={action.label}
            variant={action.variant}
            loading={busy}
            onPress={() => submit(action)}
            testID={action.testID}
            style={{ marginBottom: theme.spacing['3'] }}
          />
        ))}
      </Section>
    </>
  );
}
