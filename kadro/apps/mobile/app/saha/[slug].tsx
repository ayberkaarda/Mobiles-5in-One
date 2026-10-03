import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { api } from '../../src/api/instance';
import { ApiError } from '../../src/api/errors';
import { FactCell, FactGrid, Hairline } from '../../src/calls/components';
import { districtLabel } from '../../src/calls/form';
import { callsApi } from '../../src/calls/instance';
import { districtsQuery } from '../../src/calls/queries';
import { formatPriceRange } from '../../src/i18n/format';
import { MatchScreen, SectionTitle } from '../../src/matches/components';
import { meQuery } from '../../src/query';
import { CachedNotice, Notice, ResourceState, Section } from '../../src/teams/components';
import { useTheme } from '../../src/theme';
import { Button, Card, Chip, ErrorState, Text } from '../../src/ui';
import {
  OwnReview,
  ratingText,
  ReviewCard,
  ReviewForm,
  VenueBadges,
  VenueWriteError,
} from '../../src/venues/components';
import { type VenueDetail } from '../../src/venues/contracts';
import { openDialer } from '../../src/venues/dial';
import { featureList, telHref } from '../../src/venues/display';
import { isVenueSlug, type Rating } from '../../src/venues/form';
import { venuesApi } from '../../src/venues/instance';
import { VENUES_HOME } from '../../src/venues/links';
import { MatchHere } from '../../src/venues/MatchHere';
import {
  useCreateReview,
  useDeleteReview,
  useReviewBusy,
  useRewriteReview,
} from '../../src/venues/mutations';
import { otherReviews, reviewerState } from '../../src/venues/permissions';
import {
  type VenueFacts,
  venueDetailQuery,
  venueFactsQuery,
  venueKeys,
} from '../../src/venues/queries';

function param(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Features of one kind (present, absent, unknown) as a chip row under a caption, read as one
 * element ("Var: Aydınlatma, Otopark").
 */
function FeatureGroup({
  label,
  names,
  testID,
}: {
  readonly label: string;
  readonly names: readonly string[];
  readonly testID: string;
}) {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${names.join(', ')}`}
      testID={testID}
      style={{ marginTop: theme.spacing['3'] }}
    >
      <Text variant="caption" tone="muted" style={{ marginBottom: theme.spacing['1'] }}>
        {label}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing['2'] }}>
        {names.map((name) => (
          <Chip key={name} label={name} />
        ))}
      </View>
    </View>
  );
}

/**
 * Facts of the venue: the hourly price in kit-number figures, a two-column grid (district, type,
 * rating), the address, the features as chip rows and the phone link.
 */
function VenueFactsCard({
  venue,
  district,
}: {
  readonly venue: VenueFacts;
  readonly district: string | null;
}) {
  const { t, i18n } = useTranslation('venues');
  const theme = useTheme();
  const price = formatPriceRange(venue.priceMinMinor, venue.priceMaxMinor, i18n.language);
  const tel = telHref(venue.phone);
  const features = featureList(venue.features);
  const names = (list: readonly string[]) => list.map((feature) => t(`feature.${feature}`));
  return (
    <Card>
      <FactCell
        label={t('facts.price')}
        value={price ?? t('facts.priceUnknown')}
        numeral={price !== null}
        wide
        testID="venue-price"
      />
      <Hairline />
      <FactGrid>
        {district === null ? null : (
          <FactCell label={t('facts.district')} value={district} testID="venue-district-fact" />
        )}
        <FactCell
          label={t('facts.type')}
          value={t(venue.indoor ? 'facts.indoor' : 'facts.outdoor')}
          testID="venue-type"
        />
        <FactCell
          label={t('facts.rating')}
          value={ratingText(t, venue.rating, i18n.language)}
          wide
          testID="venue-rating"
        />
        {venue.address === null ? null : (
          <FactCell label={t('facts.address')} value={venue.address} wide testID="venue-address" />
        )}
        {venue.phone !== null && tel === null ? (
          <FactCell label={t('facts.phone')} value={venue.phone} wide testID="venue-phone" />
        ) : null}
      </FactGrid>
      {features.present.length === 0 ? null : (
        <FeatureGroup
          label={t('facts.featuresPresent')}
          names={names(features.present)}
          testID="venue-features-present"
        />
      )}
      {features.absent.length === 0 ? null : (
        <FeatureGroup
          label={t('facts.featuresAbsent')}
          names={names(features.absent)}
          testID="venue-features-absent"
        />
      )}
      {features.unknown.length === 0 ? null : (
        <FeatureGroup
          label={t('facts.featuresUnknown')}
          names={names(features.unknown)}
          testID="venue-features-unknown"
        />
      )}
      {venue.phone === null || tel === null ? null : (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={t('facts.call', { phone: venue.phone })}
          onPress={() => openDialer(tel)}
          testID="venue-phone-link"
          style={{
            minHeight: theme.minTouchTarget,
            justifyContent: 'center',
            marginTop: theme.spacing['3'],
          }}
        >
          <Text tone="link" variant="label" selectable>
            {t('facts.call', { phone: venue.phone })}
          </Text>
        </Pressable>
      )}
    </Card>
  );
}

/** Own review, the form, or why there is none; then the other recent reviews. */
function Reviews({ slug, detail }: { readonly slug: string; readonly detail: VenueDetail }) {
  const { t } = useTranslation('venues');
  const theme = useTheme();
  const me = useQuery(meQuery(api));
  const create = useCreateReview(venuesApi, slug);
  const remove = useDeleteReview(venuesApi, slug);
  const rewrite = useRewriteReview(venuesApi, slug);
  const busy = useReviewBusy(slug);
  const [rewriting, setRewriting] = useState(false);
  // What the viewer last sent: kept so a failed rewrite or a refused review is not typed again.
  const [prefill, setPrefill] = useState<{ rating: Rating; text: string } | null>(null);
  const others = otherReviews(detail);

  const resetErrors = (): void => {
    create.reset();
    remove.reset();
    rewrite.reset();
  };

  let mine;
  if (me.data === undefined) {
    // The email state decides what is offered; a failed load gets a retry, never "not allowed".
    mine = (
      <ResourceState
        status={me.status === 'error' ? 'error' : 'pending'}
        error={me.error}
        onRetry={() => void me.refetch()}
        missingTitle={t('review.meMissing')}
        missingMessage={t('review.meMissing')}
        testID="review-me"
      />
    );
  } else {
    const state = reviewerState(detail, me.data);
    if (state.kind === 'own' && rewriting) {
      mine = (
        <View testID="review-rewrite-form">
          <Notice testID="review-rewrite-notice">{t('review.rewriteNotice')}</Notice>
          <View style={{ marginTop: theme.spacing['3'] }}>
            <ReviewForm
              initialRating={state.review.rating as Rating}
              initialText={state.review.text ?? ''}
              submitLabel={t('review.rewriteSubmit')}
              busy={rewrite.isPending}
              disabled={busy}
              onSubmit={(body) => {
                resetErrors();
                setPrefill({ rating: body.rating as Rating, text: body.text ?? '' });
                rewrite.mutate(body, {
                  onSuccess: () => {
                    setRewriting(false);
                    setPrefill(null);
                  },
                });
              }}
              onCancel={() => setRewriting(false)}
            />
          </View>
        </View>
      );
    } else if (state.kind === 'own') {
      mine = (
        <OwnReview
          review={state.review}
          canRewrite={state.canRewrite}
          disabled={busy}
          deleting={remove.isPending}
          onDelete={() => {
            resetErrors();
            remove.mutate();
          }}
          onRewrite={() => {
            resetErrors();
            setRewriting(true);
          }}
        />
      );
    } else if (state.kind === 'unverified') {
      mine = <Notice testID="review-unverified">{t('review.unverified')}</Notice>;
    } else {
      mine = (
        <View>
          <Text tone="muted" style={{ marginBottom: theme.spacing['3'] }}>
            {t('review.eligibility')}
          </Text>
          <ReviewForm
            key={prefill === null ? 'empty' : 'prefilled'}
            initialRating={prefill?.rating ?? null}
            initialText={prefill?.text ?? ''}
            submitLabel={t('review.submit')}
            busy={create.isPending}
            disabled={busy}
            onSubmit={(body) => {
              resetErrors();
              setPrefill({ rating: body.rating as Rating, text: body.text ?? '' });
              create.mutate(body, {
                onSuccess: () => {
                  setPrefill(null);
                  setRewriting(false);
                },
              });
            }}
          />
        </View>
      );
    }
  }

  return (
    <View testID="reviews">
      <SectionTitle>{t('review.mineTitle')}</SectionTitle>
      <Section>
        <VenueWriteError error={create.error ?? rewrite.error ?? remove.error} context="review" />
        {mine}
      </Section>
      <SectionTitle>{t('review.othersTitle')}</SectionTitle>
      <Section>
        {others.length === 0 ? (
          <Notice testID="reviews-empty">{t('review.othersEmpty')}</Notice>
        ) : (
          <View testID="reviews-list">
            {others.map((review) => (
              <ReviewCard key={review.id} review={review} />
            ))}
            {detail.rating.count > detail.recentReviews.length ? (
              <Text variant="footnote" tone="muted" testID="reviews-partial">
                {t('review.partial', {
                  shown: detail.recentReviews.length,
                  number: detail.rating.count,
                })}
              </Text>
            ) : null}
          </View>
        )}
      </Section>
    </View>
  );
}

/**
 * One venue (`GET /api/v1/venues/:slug`): facts, rating, the viewer's review and the recent
 * reviews, and "Bu sahada maç kur". The review-free facts are kept on the device and shown
 * offline; the reviews (other users' free text) are read only while online and never stored.
 */
export default function VenueScreen() {
  const { t } = useTranslation('venues');
  const theme = useTheme();
  const router = useRouter();
  const client = useQueryClient();
  const slug = param(useLocalSearchParams<{ slug?: string | string[] }>().slug);
  const valid = isVenueSlug(slug);
  const detail = useQuery({ ...venueDetailQuery(venuesApi, client, slug), enabled: valid });
  const facts = useQuery({ ...venueFactsQuery(client, slug), enabled: valid });
  const districts = useQuery(districtsQuery(callsApi));
  const gone = detail.error instanceof ApiError && detail.error.status === 404;

  useEffect(() => {
    // A venue that answers 404 is gone or no longer readable: its kept copy must not reappear.
    if (gone) {
      client.removeQueries({ queryKey: venueKeys.facts(slug), exact: true });
    }
  }, [client, gone, slug]);

  if (!valid || gone) {
    return (
      <MatchScreen back={VENUES_HOME} testID="venue-screen">
        <ErrorState
          title={t('detail.missingTitle')}
          message={t('detail.missingMessage')}
          retry={{ label: t('detail.toList'), onPress: () => router.replace(VENUES_HOME) }}
          testID="venue-missing"
        />
      </MatchScreen>
    );
  }

  const venue: VenueFacts | null = detail.data ?? facts.data ?? null;
  if (venue === null) {
    return (
      <MatchScreen back={VENUES_HOME} testID="venue-screen">
        <ResourceState
          status={detail.status === 'error' ? 'error' : 'pending'}
          error={detail.error}
          onRetry={() => void detail.refetch()}
          missingTitle={t('detail.missingTitle')}
          missingMessage={t('detail.missingMessage')}
          testID="venue"
        />
      </MatchScreen>
    );
  }

  return (
    <MatchScreen title={venue.name} back={VENUES_HOME} testID="venue-screen">
      <CachedNotice visible={detail.isError} />
      <Section>
        <VenueBadges venue={venue} />
        {venue.isSample ? (
          <View style={{ marginTop: theme.spacing['3'] }}>
            <Notice testID="venue-sample-notice">{t('detail.sampleNotice')}</Notice>
          </View>
        ) : null}
        {venue.verified ? null : (
          <View style={{ marginTop: theme.spacing['3'] }}>
            <Notice testID="venue-unverified-notice">{t('detail.unverifiedNotice')}</Notice>
          </View>
        )}
      </Section>
      <Section>
        <VenueFactsCard
          venue={venue}
          district={districtLabel(districts.data?.items, venue.districtId)}
        />
      </Section>
      <SectionTitle>{t('matchHere.title')}</SectionTitle>
      <Section>
        <MatchHere venueId={venue.id} />
      </Section>
      {detail.data === undefined ? (
        <Section>
          {detail.status === 'error' ? (
            <View testID="reviews-offline">
              <Notice>{t('review.offline')}</Notice>
              <Button
                label={t('detail.retry')}
                variant="secondary"
                onPress={() => void detail.refetch()}
                testID="reviews-retry"
                style={{ marginTop: theme.spacing['3'] }}
              />
            </View>
          ) : (
            <ResourceState
              status="pending"
              error={null}
              onRetry={() => void detail.refetch()}
              missingTitle={t('detail.missingTitle')}
              missingMessage={t('detail.missingMessage')}
              testID="reviews"
            />
          )}
        </Section>
      ) : (
        <Reviews slug={slug} detail={detail.data} />
      )}
    </MatchScreen>
  );
}
