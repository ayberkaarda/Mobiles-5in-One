import { featureRows, formatPriceRange } from '../../../components/seo/format';
import { type JsonLdObject, type JsonLdValue } from '../../../components/seo/json-ld';
import { type PublicVenue } from './queries';

/**
 * JSON-LD of the programmatic pages (product spec §7, ADR-0057), rendered through the one
 * escaping helper `components/seo/json-ld.tsx`. Absolute URLs are built from the configured web origin.
 */

interface Crumb {
  readonly name: string;
  readonly path: string;
}

function breadcrumbs(origin: string, crumbs: readonly Crumb[]): JsonLdObject {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: new URL(crumb.path, origin).toString(),
    })),
  };
}

/**
 * `SportsActivityLocation` for a verified venue, with `BreadcrumbList`. Contact details appear
 * only when the page shows them (verified venues); `aggregateRating` only when the page shows an
 * average, which needs at least three reviews (ADR-0038). A sample venue is demonstration data:
 * it gets the breadcrumb only, never a place description that a search engine could take as real.
 */
export function venueStructuredData(
  origin: string,
  venue: PublicVenue,
  path: string,
): JsonLdObject {
  const url = new URL(path, origin).toString();
  const graph: JsonLdValue[] = [
    breadcrumbs(origin, [
      { name: 'Kadro', path: '/' },
      { name: venue.name, path },
    ]),
  ];
  if (!venue.isSample) {
    const place: Record<string, JsonLdValue> = {
      '@type': 'SportsActivityLocation',
      '@id': `${url}#saha`,
      name: venue.name,
      url,
      address: {
        '@type': 'PostalAddress',
        ...(venue.address === null ? {} : { streetAddress: venue.address }),
        addressLocality: venue.district.ilce,
        addressRegion: venue.district.il,
        addressCountry: 'TR',
      },
      geo: {
        '@type': 'GeoCoordinates',
        latitude: venue.location.latitude,
        longitude: venue.location.longitude,
      },
      amenityFeature: featureRows(venue.features).map((feature) => ({
        '@type': 'LocationFeatureSpecification',
        name: feature.label,
        value: feature.present,
      })),
    };
    if (venue.phone !== null) {
      place.telephone = venue.phone;
    }
    const price = formatPriceRange(venue.priceMinMinor, venue.priceMaxMinor);
    if (price !== null) {
      place.priceRange = price;
    }
    if (venue.rating.average !== null) {
      place.aggregateRating = {
        '@type': 'AggregateRating',
        ratingValue: venue.rating.average,
        reviewCount: venue.rating.count,
        bestRating: 5,
        worstRating: 1,
      };
    }
    graph.push(place);
  }
  return { '@context': 'https://schema.org', '@graph': graph };
}

/** `BreadcrumbList` of a district open-call page. */
export function districtStructuredData(origin: string, path: string, title: string): JsonLdObject {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      breadcrumbs(origin, [
        { name: 'Kadro', path: '/' },
        { name: title, path },
      ]),
    ],
  };
}
