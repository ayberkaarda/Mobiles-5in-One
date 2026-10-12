import { FACTS } from '../../../content/facts';
import { FAQ } from '../../../content/faq';
import {
  article,
  breadcrumbList,
  dataset,
  faqPage,
  JsonLdNode,
  mobileApplication,
  organization,
  webApplication,
} from '../../seo/json-ld';
import { PageSeo } from '../../seo/seo';
import { ContentView } from './content-view';

export function contentSeo(view: ContentView): PageSeo {
  return {
    title: view.title,
    description: view.description,
    path: view.path,
    index: view.index,
    ogType: view.kind === 'guide' ? 'article' : 'website',
  };
}

function crumbs(view: ContentView): { name: string; path: string }[] {
  const home = { name: FACTS.name, path: '/' };
  const guides = { name: 'Rehberler', path: FACTS.topLevelPaths.guides };
  if (view.kind === 'guide') return [home, guides, { name: view.h1, path: view.path }];
  return [home, { name: view.h1, path: view.path }];
}

export function contentJsonLd(origin: string, view: ContentView): JsonLdNode[] {
  const publisher = organization(origin, { name: FACTS.name, path: '/' });
  const nodes: JsonLdNode[] = [breadcrumbList(origin, crumbs(view))];
  switch (view.kind) {
    case 'guide':
      nodes.push(
        article(origin, {
          headline: view.h1,
          path: view.path,
          description: view.description,
          datePublished: view.datePublished,
          dateModified: view.dateModified,
          author: publisher,
        }),
      );
      break;
    case 'faq':
      nodes.push(faqPage(origin, { path: view.path, items: FAQ }));
      break;
    case 'data':
      nodes.push(
        dataset(origin, {
          name: `${FACTS.name} açık hat verisi`,
          path: view.path,
          description: view.description,
          licensePath: FACTS.topLevelPaths.licence,
          dateModified: view.dateModified,
          creator: publisher,
        }),
      );
      break;
    case 'about':
      nodes.push(
        organization(origin, { name: FACTS.name, path: '/', description: FACTS.description }),
        webApplication(origin, {
          name: FACTS.name,
          path: '/',
          description: FACTS.description,
          operatingSystem: 'Web',
        }),
        mobileApplication(origin, {
          name: FACTS.name,
          path: '/',
          description: FACTS.description,
          operatingSystem: 'Android',
        }),
      );
      break;
    default:
      break;
  }
  return nodes;
}
