import { api } from '../api/instance';
import { createTeamsApi } from './teams-api';

/** Teams calls on the app's shared API client. */
export const teamsApi = createTeamsApi(api);
