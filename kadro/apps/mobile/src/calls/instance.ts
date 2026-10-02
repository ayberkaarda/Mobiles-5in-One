import { api } from '../api/instance';
import { createCallsApi } from './calls-api';

/** Open-call calls on the app's shared API client. */
export const callsApi = createCallsApi(api);
