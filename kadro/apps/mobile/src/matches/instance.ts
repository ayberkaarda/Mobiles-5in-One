import { api } from '../api/instance';
import { createMatchesApi } from './matches-api';

/** Matches calls on the app's shared API client. */
export const matchesApi = createMatchesApi(api);
