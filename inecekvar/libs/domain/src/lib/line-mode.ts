/** Vehicle kinds a line can have (spec section 5, `lines.mode`). */
export const LINE_MODES = ['dolmus', 'minibus', 'servis'] as const;

export type LineMode = (typeof LINE_MODES)[number];

export function isLineMode(value: unknown): value is LineMode {
  return typeof value === 'string' && (LINE_MODES as readonly string[]).includes(value);
}
