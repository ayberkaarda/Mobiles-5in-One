import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ApiError } from '../api/errors';
import { FormError } from '../auth/components';
import { formatDateTime, formatPriceRange } from '../i18n/format';
import { ChoiceGroup } from '../matches/components';
import { ConfirmAction } from '../teams/components';
import { useTheme } from '../theme';
import { Button, Card, Text, TextField } from '../ui';
import { type VenueRating, type VenueReview, type VenueSummary } from './contracts';
import { formatRating, RATING_MIN_REVIEWS, ratingView } from './display';
import { type Rating, RATINGS, reviewBody, type ReviewDraftResult, VENUE_LIMITS } from './form';
import { RewriteError } from './mutations';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** One-line rating summary: average with count, "n reviews" below the threshold, or none. */
export function ratingText(t: Translate, rating: VenueRating, language: string): string {
  const view = ratingView(rating);
  switch (view.kind) {
    case 'none':
      return t('rating.none');
    case 'few':
      return t('rating.few', { number: view.count, min: RATING_MIN_REVIEWS });
    case 'average':
      return t('rating.average', {
        average: formatRating(view.average, language),
        number: view.count,
      });
  }
}

/** Subtitle of a list row: district, indoor / outdoor, price range. */
export function venueSubtitle(
  t: Translate,
  venue: Pick<VenueSummary, 'indoor' | 'priceMinMinor' | 'priceMaxMinor'>,
  district: string | null,
  language: string,
): string {
  return [
    district,
    t(venue.indoor ? 'facts.indoor' : 'facts.outdoor'),
    formatPriceRange(venue.priceMinMinor, venue.priceMaxMinor, language),
  ]
    .filter((part): part is string => part !== null && part !== '')
    .join(' · ');
}

/** Small label on a card edge: sample row, verified, unverified. */
function Badge({
  label,
  tone,
  testID,
}: {
  readonly label: string;
  readonly tone: 'accent' | 'muted' | 'primary';
  readonly testID: string;
}) {
  const theme = useTheme();
  const color =
    tone === 'accent'
      ? theme.colors.accent
      : tone === 'primary'
        ? theme.colors.primary
        : theme.colors.border;
  return (
    <View
      testID={testID}
      style={{
        borderWidth: 1,
        borderColor: color,
        borderRadius: theme.radius.md,
        paddingHorizontal: theme.spacing['2'],
        paddingVertical: theme.spacing['1'],
        alignSelf: 'flex-start',
      }}
    >
      <Text variant="caption">{label}</Text>
    </View>
  );
}

/**
 * Status labels of a venue. A sample row (`isSample`, spec §0 rule 6) is always labelled, so a
 * demonstration pitch is never taken for a real one; an unverified venue says who sees it.
 */
export function VenueBadges({
  venue,
}: {
  readonly venue: Pick<VenueSummary, 'isSample' | 'verified'>;
}) {
  const { t } = useTranslation('venues');
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing['2'] }}>
      {venue.isSample ? (
        <Badge label={t('badge.sample')} tone="accent" testID="badge-sample" />
      ) : null}
      {venue.verified ? (
        <Badge label={t('badge.verified')} tone="primary" testID="badge-verified" />
      ) : (
        <Badge label={t('badge.unverified')} tone="muted" testID="badge-unverified" />
      )}
    </View>
  );
}

const VENUE_ERROR_CODES = new Set([
  'review_not_eligible',
  'already_reviewed',
  'venue_exists',
  'email_unverified',
]);

/**
 * Failure of a venue write in the venue copy (eligibility, duplicates, the daily limits of groups
 * V and W), else the error catalog. A failed rewrite reports what happened to the old review.
 */
export function VenueWriteError({
  error,
  context,
}: {
  readonly error: unknown;
  readonly context: 'venue' | 'review';
}) {
  const { t } = useTranslation('venues');
  const { t: tc } = useTranslation('common');
  const theme = useTheme();
  if (error === null || error === undefined) {
    return null;
  }
  const deleted = error instanceof RewriteError && error.deleted;
  const cause = error instanceof RewriteError ? error.cause : error;
  let message: string | null = null;
  if (cause instanceof ApiError && cause.code !== null) {
    if (cause.code === 'rate_limited' || cause.status === 429) {
      message = t(context === 'venue' ? 'errors.rateLimitedVenue' : 'errors.rateLimitedReview');
    } else if (VENUE_ERROR_CODES.has(cause.code)) {
      message = t(`errors.${cause.code}`);
    }
  }
  return (
    <View style={{ marginBottom: theme.spacing['3'] }}>
      {deleted ? (
        <Text tone="danger" accessibilityRole="alert" testID="rewrite-deleted">
          {t('review.rewriteDeleted')}
        </Text>
      ) : null}
      {message === null ? (
        <FormError error={cause} />
      ) : (
        <View>
          <Text tone="danger" accessibilityRole="alert" testID="venue-error">
            {message}
          </Text>
          {cause instanceof ApiError && cause.requestId !== null ? (
            <Text variant="caption" tone="muted" selectable>
              {`${tc('state.reference')}: ${cause.requestId}`}
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
}

/** A review as plain text: never markdown, never a link (matrix footnote 24). */
export function ReviewCard({
  review,
  own = false,
}: {
  readonly review: VenueReview;
  readonly own?: boolean;
}) {
  const { t, i18n } = useTranslation('venues');
  const theme = useTheme();
  return (
    <Card testID={`review-${review.id}`} style={{ marginBottom: theme.spacing['3'] }}>
      <Text variant="label">{own ? t('review.mine') : review.authorDisplayName}</Text>
      <Text
        tone="muted"
        accessibilityLabel={t('review.ratingSpoken', { rating: review.rating })}
        testID={`review-${review.id}-rating`}
      >
        {`${'★'.repeat(review.rating)}${'☆'.repeat(VENUE_LIMITS.ratingMax - review.rating)}`}
      </Text>
      {review.text === null ? null : (
        <Text style={{ marginTop: theme.spacing['2'] }} testID={`review-${review.id}-text`}>
          {review.text}
        </Text>
      )}
      <Text variant="footnote" tone="muted" style={{ marginTop: theme.spacing['2'] }}>
        {formatDateTime(review.createdAt, i18n.language)}
      </Text>
    </Card>
  );
}

/**
 * Rating 1..5 and an optional plain-text review. Checked on the device first (nothing is sent
 * while a field is invalid); `onSubmit` gets the request body.
 */
export function ReviewForm({
  initialRating = null,
  initialText = '',
  submitLabel,
  busy,
  disabled,
  onSubmit,
  onCancel,
}: {
  readonly initialRating?: Rating | null;
  readonly initialText?: string;
  readonly submitLabel: string;
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly onSubmit: (body: Extract<ReviewDraftResult, { ok: true }>['body']) => void;
  readonly onCancel?: () => void;
}) {
  const { t } = useTranslation('venues');
  const theme = useTheme();
  const [rating, setRating] = useState<Rating | null>(initialRating);
  const [text, setText] = useState(initialText);
  const [issues, setIssues] = useState<{ rating: string | null; text: string | null }>({
    rating: null,
    text: null,
  });

  const submit = (): void => {
    const result = reviewBody(rating, text);
    if (!result.ok) {
      setIssues({
        rating: result.rating === null ? null : t(result.rating),
        text: result.text === null ? null : t(result.text, { max: VENUE_LIMITS.reviewTextMax }),
      });
      return;
    }
    setIssues({ rating: null, text: null });
    onSubmit(result.body);
  };

  return (
    <View testID="review-form">
      <Text variant="label" style={{ marginBottom: theme.spacing['2'] }}>
        {t('review.ratingLabel')}
      </Text>
      <ChoiceGroup
        label={t('review.ratingLabel')}
        options={RATINGS.map((value) => ({
          value: String(value),
          label: `${value} ★`,
          accessibilityLabel: t('review.ratingSpoken', { rating: value }),
        }))}
        selected={rating === null ? null : String(rating)}
        onSelect={(value) => {
          setRating(Number(value) as Rating);
          setIssues((current) => ({ ...current, rating: null }));
        }}
        disabled={disabled}
        testID="review-rating"
      />
      {issues.rating === null ? null : (
        <Text tone="danger" accessibilityRole="alert" testID="review-rating-error">
          {issues.rating}
        </Text>
      )}
      <View style={{ marginTop: theme.spacing['3'] }}>
        <TextField
          label={t('review.textLabel')}
          helperText={t('review.textHelp', { max: VENUE_LIMITS.reviewTextMax })}
          error={issues.text}
          value={text}
          onChangeText={(value) => {
            setText(value);
            setIssues((current) => ({ ...current, text: null }));
          }}
          multiline
          maxLength={VENUE_LIMITS.reviewTextMax + 20}
          editable={!disabled}
          testID="review-text"
        />
      </View>
      <Button
        label={submitLabel}
        variant="accent"
        loading={busy}
        disabled={disabled}
        onPress={submit}
        testID="review-submit"
      />
      {onCancel === undefined ? null : (
        <Button
          label={t('review.cancel')}
          variant="secondary"
          disabled={busy}
          onPress={onCancel}
          testID="review-cancel"
          style={{ marginTop: theme.spacing['2'] }}
        />
      )}
    </View>
  );
}

/** The viewer's own review with delete (confirmed) and, with a verified email, rewrite. */
export function OwnReview({
  review,
  canRewrite,
  disabled,
  deleting,
  onDelete,
  onRewrite,
}: {
  readonly review: VenueReview;
  readonly canRewrite: boolean;
  readonly disabled: boolean;
  readonly deleting: boolean;
  readonly onDelete: () => void;
  readonly onRewrite: () => void;
}) {
  const { t } = useTranslation('venues');
  const theme = useTheme();
  return (
    <View testID="own-review">
      <ReviewCard review={review} own />
      {canRewrite ? (
        <Button
          label={t('review.rewrite')}
          accessibilityHint={t('review.rewriteHint')}
          variant="secondary"
          disabled={disabled}
          onPress={onRewrite}
          testID="review-rewrite"
          style={{ marginBottom: theme.spacing['3'] }}
        />
      ) : null}
      <ConfirmAction
        label={t('review.delete')}
        question={t('review.deleteQuestion')}
        confirmLabel={t('review.deleteConfirm')}
        cancelLabel={t('review.cancel')}
        onConfirm={onDelete}
        busy={deleting}
        disabled={disabled}
        testID="review-delete"
      />
    </View>
  );
}
