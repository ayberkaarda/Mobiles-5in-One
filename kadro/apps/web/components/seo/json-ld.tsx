import { headers } from 'next/headers';

import { NONCE_HEADER } from '../../lib/server/security-headers';

/**
 * JSON-LD structured data (product spec §7, ADR-0055).
 *
 * The data is rendered as the React text child of a `<script type="application/ld+json">` data
 * block: no `dangerouslySetInnerHTML` (`react/no-danger`, page source guards). A data block is
 * never executed, and {@link serializeJsonLd} escapes every character that could end the element
 * (`</script>`), open an HTML comment (`<!--`) or start an entity, plus U+2028 and U+2029, so data
 * from the database (venue names, descriptions) cannot change the markup around it.
 *
 * The element carries the CSP nonce of the response, which the proxy forwards in the `x-nonce`
 * request header (ADR-0021 nonce surfaces), so it stays valid if a policy ever governs data
 * blocks. Reading the header keeps the page dynamic, as every HTML surface is (ADR-0055).
 */

export type JsonLdValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonLdValue[]
  | { readonly [key: string]: JsonLdValue };

export type JsonLdObject = Readonly<Record<string, JsonLdValue>>;

/** Characters that could end the element, open a comment or entity, or break a script line. */
const UNSAFE = /[<>&\u{2028}\u{2029}]/gu;

/** `JSON.stringify` with `<`, `>`, `&`, U+2028 and U+2029 as `\uXXXX` escapes (same data). */
export function serializeJsonLd(data: JsonLdObject): string {
  return JSON.stringify(data).replace(
    UNSAFE,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

/** The data block with an explicit nonce; {@link JsonLd} supplies the nonce of the request. */
export function JsonLdScript({
  data,
  nonce,
}: {
  readonly data: JsonLdObject;
  readonly nonce?: string | undefined;
}) {
  return (
    <script type="application/ld+json" nonce={nonce}>
      {serializeJsonLd(data)}
    </script>
  );
}

/** Server component: one JSON-LD data block carrying the CSP nonce of the current response. */
export async function JsonLd({ data }: { readonly data: JsonLdObject }) {
  const nonce = (await headers()).get(NONCE_HEADER) ?? undefined;
  return <JsonLdScript data={data} nonce={nonce} />;
}
