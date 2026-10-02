import { api } from '../api/instance';
import { type AvatarPicker } from './avatar-upload';
import { createProfileApi } from './profile-api';

/** Profile calls on the app's shared API client. */
export const profileApi = createProfileApi(api);

/**
 * No image picker module is a dependency of the app yet, so there is no picker: the profile
 * screens hide "change photo" while this is `null` (ADR-0054).
 */
export const avatarPicker: AvatarPicker | null = null;
