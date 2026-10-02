// Preloaded into the real `src/main.ts` process (see main-entry.test.ts). Once the application
// registers its `uncaughtException` listener, an exception is thrown on a later tick. If the
// application never registers one, the exception is thrown after a fallback delay, so a missing
// registration shows up as a missing `fatal` record rather than a hang.
const originalOn = process.on.bind(process);
let scheduled = false;
const trigger = () => {
  throw new Error('entry point failure for ayse@example.com');
};
process.on = (event, listener) => {
  if (event === 'uncaughtException' && !scheduled) {
    scheduled = true;
    setTimeout(trigger, 50);
  }
  return originalOn(event, listener);
};
setTimeout(() => {
  if (!scheduled) {
    scheduled = true;
    trigger();
  }
}, 15_000);
