import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { AdminCard, Notice, PanelFrame } from '../../../../components/admin/frames';
import { csrfCookieName, panelViewer } from '../../../../lib/admin/session';

/**
 * Panel sections behind a staff session. The step-up window is enforced by each page's admin
 * read (401 `step_up_required` leads to `/admin/dogrulama`), never by this layout alone.
 */
export default async function PanelLayout({ children }: { readonly children: ReactNode }) {
  const viewer = await panelViewer();
  if (viewer.kind === 'signed_out') {
    redirect('/admin/giris');
  }
  if (viewer.kind !== 'staff') {
    return (
      <AdminCard title="Erişim yok">
        <Notice>
          {viewer.kind === 'not_staff'
            ? 'Bu alan yalnızca yetkili ekip içindir.'
            : 'Şu an hesabın okunamadı. Biraz sonra tekrar dene.'}
        </Notice>
      </AdminCard>
    );
  }
  return (
    <PanelFrame
      displayName={viewer.me.displayName}
      role={viewer.me.role}
      csrfCookieName={await csrfCookieName()}
    >
      {children}
    </PanelFrame>
  );
}
