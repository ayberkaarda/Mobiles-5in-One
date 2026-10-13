export declare function resolvePlaceholders(
  value: string,
  env?: Record<string, string | undefined>,
): string;
export declare function readPwaHeaders(
  path: string,
  env?: Record<string, string | undefined>,
): Record<string, string>;
export declare function parsePolicy(policy: string): Record<string, string[]>;
