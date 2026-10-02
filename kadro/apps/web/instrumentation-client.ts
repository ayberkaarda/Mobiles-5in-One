/**
 * Client entry hook: Next.js evaluates this file before any other application code and before
 * it hydrates or reads the URL. Importing the token capture here takes an email-link token out of
 * the fragment and the address bar first (ADR-0040 step 2); on every other page it does nothing.
 */
import './lib/client/token-capture';
