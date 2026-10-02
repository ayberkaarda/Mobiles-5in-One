import { isSlug } from './deep-links';

interface DistrictRef {
  readonly id: string;
  readonly provinceSlug: string;
  readonly slug: string;
}

export interface DistrictLink {
  /** `<il>/<ilce>`, so one link is applied once even when the screen re-renders. */
  readonly key: string;
  /** The district of the link, or `null` when the list has no such district. */
  readonly districtId: string | null;
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? undefined : value;
}

/**
 * The district a `/eksik-var/<il>/<ilce>` link names, looked up in the `GET districts` list by
 * province and district slug. `null` while there is no well-formed link or the list is not loaded.
 */
export function districtFromLink(
  il: string | string[] | undefined,
  ilce: string | string[] | undefined,
  districts: readonly DistrictRef[] | undefined,
): DistrictLink | null {
  const province = single(il);
  const district = single(ilce);
  if (province === undefined || district === undefined || districts === undefined) {
    return null;
  }
  if (!isSlug(province) || !isSlug(district)) {
    return null;
  }
  const match = districts.find((item) => item.provinceSlug === province && item.slug === district);
  return { key: `${province}/${district}`, districtId: match?.id ?? null };
}
