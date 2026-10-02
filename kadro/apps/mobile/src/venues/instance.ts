import { api } from '../api/instance';
import { createVenuesApi } from './venues-api';

/** Venue directory calls on the app's shared API client. */
export const venuesApi = createVenuesApi(api);
