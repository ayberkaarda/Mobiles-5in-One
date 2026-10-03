import { renderOgImage } from '../../../../components/marketing/og-image';
import { findDocument, loadCollection } from '../../../../lib/content/documents';

/**
 * Card image of one blog article, `/og/blog/<slug>` (ADR-0083). One PNG per article is rendered
 * by `next build`; any other slug is a 404 without rendering (`dynamicParams = false`), so the
 * route never reads a path built from the request.
 */
export const dynamic = 'force-static';
export const dynamicParams = false;

export function generateStaticParams(): { slug: string }[] {
  return loadCollection('blog').map((article) => ({ slug: article.slug }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const article = findDocument('blog', slug);
  if (article === undefined) {
    return new Response('Not Found', { status: 404 });
  }
  return renderOgImage({
    eyebrow: 'Blog',
    title: article.title,
    subtitle: `${String(article.readingMinutes)} dk okuma`,
  });
}
