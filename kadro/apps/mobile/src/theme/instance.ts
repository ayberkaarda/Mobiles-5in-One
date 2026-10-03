import AsyncStorage from '@react-native-async-storage/async-storage';

import { createColorPreferenceStore } from './preference';

/** The app's colour scheme preference, stored on the device. */
export const colorPreference = createColorPreferenceStore(AsyncStorage);
