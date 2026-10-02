/** A promise resolved from outside; tests use it to order concurrent steps without timers. */
export interface Deferred<T = void> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

export function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
