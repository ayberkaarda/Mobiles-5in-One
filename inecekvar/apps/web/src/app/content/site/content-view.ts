import { ResolveFn } from '@angular/router';
import { Block } from '../../../content/blocks';
import { guideBySlug } from '../../../content/guides';
import { FAQ, FaqItem } from '../../../content/faq';
import { FACTS } from '../../../content/facts';
import { PageKind, STATIC_PAGES } from '../../../content/pages';
import { PageData } from '../page-data';

export type ContentKind = PageKind | 'guide';

export interface ContentView {
  readonly path: string;
  readonly kind: ContentKind;
  readonly h1: string;
  readonly title: string;
  readonly description: string;
  readonly status?: string;
  readonly blocks: readonly Block[];
  readonly faq?: readonly FaqItem[];
  readonly showExport: boolean;
  readonly index: boolean;
  readonly datePublished: string;
  readonly dateModified: string;
}

export interface ContentData {
  content: ContentView;
}

export function contentViewForPath(path: string): ContentView | undefined {
  const guidePrefix = FACTS.topLevelPaths.guides + '/';
  if (path.startsWith(guidePrefix)) {
    const guide = guideBySlug(path.slice(guidePrefix.length));
    if (!guide) return undefined;
    return {
      path: guide.path,
      kind: 'guide',
      h1: guide.h1,
      title: guide.title,
      description: guide.description,
      blocks: guide.blocks,
      showExport: false,
      index: true,
      datePublished: guide.datePublished,
      dateModified: guide.dateModified,
    };
  }
  const page = STATIC_PAGES.find((item) => item.path === path);
  if (!page) return undefined;
  return {
    path: page.path,
    kind: page.kind,
    h1: page.h1,
    title: page.title,
    description: page.description,
    ...(page.status === undefined ? {} : { status: page.status }),
    blocks: page.blocks,
    ...(page.kind === 'faq' ? { faq: FAQ } : {}),
    showExport: page.showExport === true,
    index: page.index !== false,
    datePublished: FACTS.contentDate,
    dateModified: page.dateModified,
  };
}

/** Content is local data, so the resolver is synchronous and makes no API call. */
export const contentResolver: ResolveFn<PageData<ContentData>> = (route) => {
  const slug = route.paramMap.get('slug');
  const path =
    slug === null
      ? (route.data['contentPath'] as string | undefined)
      : `${FACTS.topLevelPaths.guides}/${slug}`;
  const content = path === undefined ? undefined : contentViewForPath(path);
  return content ? { state: 'ok', content } : { state: 'not_found' };
};
