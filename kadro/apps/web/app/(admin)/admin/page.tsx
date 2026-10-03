import { redirect } from 'next/navigation';

/** `/admin` opens the venue verification queue. */
export default function AdminIndexPage(): never {
  redirect('/admin/sahalar');
}
