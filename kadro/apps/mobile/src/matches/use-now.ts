import { useEffect, useState } from 'react';

/**
 * The current time for rendering, refreshed every 30 s, so a screen left open notices when a
 * match starts (RSVP closes) or the MVP window ends without reading the clock during render.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
