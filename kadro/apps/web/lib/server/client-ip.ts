import { BlockList, isIP } from 'node:net';

import { type ClientIpHeader } from '@kadro/config';

/**
 * Client address for rate limiting and audit hashing (security checklist item 5, threat model
 * T-AUTH-02). Route handlers have no socket address, so the address comes from the single
 * header that the edge proxy is configured to set (`CLIENT_IP_HEADER`); every other forwarding
 * header is ignored.
 *
 * For `x-forwarded-for` the list is read from the right: hops whose address is inside
 * `TRUSTED_PROXY_CIDRS` are skipped and the first remaining entry is the client. Entries to its
 * left were supplied by the client and are never used, so prepending a spoofed address changes
 * nothing. With an empty trusted list the rightmost entry (written by the edge proxy) is used.
 */

export interface ClientIpConfig {
  readonly CLIENT_IP_HEADER: ClientIpHeader;
  readonly TRUSTED_PROXY_CIDRS: readonly string[];
}

export interface ClientIpResolver {
  /** Normalized client address, or `null` when the configured header is absent or malformed. */
  resolve(headers: Headers): string | null;
}

/** Strips brackets and ports, folds IPv4-mapped IPv6 to IPv4. Returns `null` if not an address. */
export function normalizeIp(raw: string): string | null {
  let value = raw.trim();
  if (value.length === 0 || value.length > 64) {
    return null;
  }
  if (value.startsWith('[')) {
    // `[2001:db8::1]` or `[2001:db8::1]:443`
    const close = value.indexOf(']');
    const rest = close < 0 ? '' : value.slice(close + 1);
    if (close < 0 || !(rest === '' || /^:[0-9]{1,5}$/.test(rest))) {
      return null;
    }
    value = value.slice(1, close);
  } else if (/^[0-9.]+:[0-9]{1,5}$/.test(value)) {
    // `203.0.113.7:51234`
    value = value.slice(0, value.indexOf(':'));
  }
  value = value.toLowerCase();
  const mapped = /^::ffff:([0-9.]+)$/.exec(value);
  if (mapped?.[1] !== undefined && isIP(mapped[1]) === 4) {
    value = mapped[1];
  }
  return isIP(value) === 0 ? null : value;
}

function family(address: string): 'ipv4' | 'ipv6' {
  return isIP(address) === 4 ? 'ipv4' : 'ipv6';
}

function buildTrustedList(cidrs: readonly string[]): BlockList {
  const list = new BlockList();
  for (const entry of cidrs) {
    const [address = '', prefix] = entry.split('/');
    const normalized = normalizeIp(address);
    if (normalized === null) {
      continue;
    }
    const type = family(normalized);
    if (prefix === undefined) {
      list.addAddress(normalized, type);
    } else {
      list.addSubnet(normalized, Number(prefix), type);
    }
  }
  return list;
}

export function createClientIpResolver(config: ClientIpConfig): ClientIpResolver {
  const trusted = buildTrustedList(config.TRUSTED_PROXY_CIDRS);
  const isTrusted = (address: string): boolean => trusted.check(address, family(address));

  return {
    resolve(headers: Headers): string | null {
      const raw = headers.get(config.CLIENT_IP_HEADER);
      if (raw === null) {
        return null;
      }
      if (config.CLIENT_IP_HEADER !== 'x-forwarded-for') {
        return normalizeIp(raw);
      }
      const hops = raw.split(',');
      for (let index = hops.length - 1; index >= 0; index -= 1) {
        // eslint-disable-next-line security/detect-object-injection -- numeric index into a local array
        const address = normalizeIp(hops[index] ?? '');
        if (address === null) {
          return null;
        }
        if (!isTrusted(address) || index === 0) {
          return address;
        }
      }
      return null;
    },
  };
}

/**
 * Rate-limit identity of an address. IPv6 clients usually control a whole /64, so IPv6
 * addresses are grouped by their /64 prefix; IPv4 addresses are used as they are.
 */
export function rateLimitSubject(address: string | null): string {
  if (address === null) {
    return 'unknown';
  }
  if (isIP(address) !== 6) {
    return address;
  }
  const expanded = expandIpv6(address);
  return `${expanded.slice(0, 4).join(':')}::/64`;
}

function expandIpv6(address: string): string[] {
  let text = address;
  const embedded = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (embedded?.[1] !== undefined) {
    const octets = embedded[1].split('.').map(Number);
    const high = (((octets[0] ?? 0) << 8) | (octets[1] ?? 0)).toString(16);
    const low = (((octets[2] ?? 0) << 8) | (octets[3] ?? 0)).toString(16);
    text = `${text.slice(0, text.length - embedded[1].length)}${high}:${low}`;
  }
  const [head = '', tail] = text.split('::');
  const headParts = head === '' ? [] : head.split(':');
  const tailParts = tail === undefined || tail === '' ? [] : tail.split(':');
  const missing = 8 - headParts.length - tailParts.length;
  const zeros = tail === undefined ? [] : Array.from({ length: Math.max(missing, 0) }, () => '0');
  return [...headParts, ...zeros, ...tailParts].map((part) => part.padStart(4, '0'));
}
