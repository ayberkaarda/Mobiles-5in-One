import type { Metadata } from 'next';

import { LegalPage } from '../../../components/content/legal-page';
import { pageMetadata } from '../../../components/marketing/metadata';
import { legalDocument } from '../../../lib/content/documents';

const document = legalDocument('/gizlilik');

export const metadata: Metadata = pageMetadata({
  title: document.title,
  description: document.description,
  path: '/gizlilik',
});

/** Privacy page: sample text of a portfolio project (ADR-0080), labelled on the page. */
export default function PrivacyPage() {
  return <LegalPage document={document} />;
}
