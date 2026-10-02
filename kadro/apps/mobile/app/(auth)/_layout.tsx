import { Stack } from 'expo-router';

/** Sign-in, registration and "forgot password"; open only while signed out (see the root stack). */
export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
