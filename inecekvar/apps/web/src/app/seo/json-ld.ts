import { BRAND, siteUrl } from './seo';

declare const nodeBrand: unique symbol;

export type JsonLdNode = {
  readonly '@type': string;
  readonly [nodeBrand]: true;
} & Readonly<Record<string, unknown>>;

export type BusStopNode = JsonLdNode & { readonly '@type': 'BusStop' };
export type OrganizationNode = JsonLdNode & { readonly '@type': 'Organization' };

interface NamedPage {
  name: string;
  path: string;
  description?: string;
}

function node<T extends { '@type': string }>(value: T): T & JsonLdNode {
  return value as T & JsonLdNode;
}

function isoDate(value: string): string {
  if (
    !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new Error('Invalid ISO date');
  }
  return value;
}

export function organization(
  origin: string,
  input: NamedPage & { logoPath?: string } = { name: BRAND, path: '/' },
): OrganizationNode {
  return node({
    '@type': 'Organization' as const,
    name: input.name,
    url: siteUrl(origin, input.path),
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.logoPath === undefined ? {} : { logo: siteUrl(origin, input.logoPath) }),
  });
}

export function webSite(
  origin: string,
  input: NamedPage & { searchTargetTemplate?: string } = { name: BRAND, path: '/' },
): JsonLdNode {
  let target: string | undefined;
  if (input.searchTargetTemplate !== undefined) {
    const match = /^(\/[^?]*)\?([A-Za-z][A-Za-z0-9_-]*)=\{search_term_string\}$/.exec(
      input.searchTargetTemplate,
    );
    if (!match || match[1] === undefined || match[2] === undefined) {
      throw new Error('Invalid search target template');
    }
    target = siteUrl(origin, match[1]) + '?' + match[2] + '={search_term_string}';
  }
  return node({
    '@type': 'WebSite',
    name: input.name,
    url: siteUrl(origin, input.path),
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(target === undefined
      ? {}
      : {
          potentialAction: {
            '@type': 'SearchAction',
            target: { '@type': 'EntryPoint', urlTemplate: target },
            'query-input': 'required name=search_term_string',
          },
        }),
  });
}

export function breadcrumbList(
  origin: string,
  items: readonly { name: string; path: string }[],
): JsonLdNode {
  return node({
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: siteUrl(origin, item.path),
    })),
  });
}

export function busStop(
  origin: string,
  input: NamedPage & { latitude?: number; longitude?: number },
): BusStopNode {
  if ((input.latitude === undefined) !== (input.longitude === undefined)) {
    throw new Error('Incomplete coordinates');
  }
  if (
    input.latitude !== undefined &&
    (!Number.isFinite(input.latitude) ||
      !Number.isFinite(input.longitude) ||
      Math.abs(input.latitude) > 90 ||
      Math.abs(input.longitude as number) > 180)
  ) {
    throw new Error('Invalid coordinates');
  }
  return node({
    '@type': 'BusStop' as const,
    name: input.name,
    url: siteUrl(origin, input.path),
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.latitude === undefined
      ? {}
      : {
          geo: {
            '@type': 'GeoCoordinates',
            latitude: input.latitude,
            longitude: input.longitude,
          },
        }),
  });
}

export function busTrip(
  origin: string,
  input: NamedPage & {
    departureBusStop: BusStopNode;
    arrivalBusStop: BusStopNode;
    provider: OrganizationNode;
  },
): JsonLdNode {
  return node({
    '@type': 'BusTrip',
    name: input.name,
    url: siteUrl(origin, input.path),
    ...(input.description === undefined ? {} : { description: input.description }),
    departureBusStop: input.departureBusStop,
    arrivalBusStop: input.arrivalBusStop,
    provider: input.provider,
  });
}

export function dataset(
  origin: string,
  input: NamedPage & { licensePath: string; dateModified: string; creator?: OrganizationNode },
): JsonLdNode {
  return node({
    '@type': 'Dataset',
    name: input.name,
    url: siteUrl(origin, input.path),
    ...(input.description === undefined ? {} : { description: input.description }),
    license: siteUrl(origin, input.licensePath),
    dateModified: isoDate(input.dateModified),
    ...(input.creator === undefined ? {} : { creator: input.creator }),
  });
}

export function faqPage(
  origin: string,
  input: { path: string; items: readonly { question: string; answer: string }[] },
): JsonLdNode {
  return node({
    '@type': 'FAQPage',
    url: siteUrl(origin, input.path),
    mainEntity: input.items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  });
}

export function article(
  origin: string,
  input: {
    headline: string;
    path: string;
    description?: string;
    datePublished: string;
    dateModified: string;
    author: OrganizationNode;
    imagePath?: string;
  },
): JsonLdNode {
  return node({
    '@type': 'Article',
    headline: input.headline,
    url: siteUrl(origin, input.path),
    ...(input.description === undefined ? {} : { description: input.description }),
    datePublished: isoDate(input.datePublished),
    dateModified: isoDate(input.dateModified),
    author: input.author,
    ...(input.imagePath === undefined ? {} : { image: siteUrl(origin, input.imagePath) }),
  });
}

interface ApplicationInput extends NamedPage {
  operatingSystem: string;
}

export function mobileApplication(origin: string, input: ApplicationInput): JsonLdNode {
  return application('MobileApplication', origin, input);
}

export function webApplication(origin: string, input: ApplicationInput): JsonLdNode {
  return application('WebApplication', origin, input);
}

function application(
  type: 'MobileApplication' | 'WebApplication',
  origin: string,
  input: ApplicationInput,
): JsonLdNode {
  return node({
    '@type': type,
    name: input.name,
    url: siteUrl(origin, input.path),
    ...(input.description === undefined ? {} : { description: input.description }),
    operatingSystem: input.operatingSystem,
    applicationCategory: 'TravelApplication',
  });
}

export function serializeJsonLd(nodes: readonly JsonLdNode[]): string {
  const data =
    nodes.length === 1
      ? { '@context': 'https://schema.org', ...nodes[0] }
      : { '@context': 'https://schema.org', '@graph': nodes };
  const ancestors: object[] = [];
  const text = JSON.stringify(data, function (this: unknown, _key, value: unknown) {
    if (
      (typeof value === 'number' && !Number.isFinite(value)) ||
      ['function', 'symbol', 'bigint'].includes(typeof value)
    ) {
      throw new Error('Invalid JSON value');
    }
    if (typeof value === 'object' && value !== null) {
      while (ancestors.length && ancestors[ancestors.length - 1] !== this) {
        ancestors.pop();
      }
      if (ancestors.includes(value)) {
        throw new Error('Cyclic JSON value');
      }
      ancestors.push(value);
    }
    return value;
  });
  return text
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
