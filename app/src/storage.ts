import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// SecureStore on iOS/Android, localStorage when running in a browser (expo start --web).
const web = (): Storage | undefined => (globalThis as { localStorage?: Storage }).localStorage;

export async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return web()?.getItem(key) ?? null;
  return SecureStore.getItemAsync(key);
}

export async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') web()?.setItem(key, value);
  else await SecureStore.setItemAsync(key, value);
}

export async function removeItem(key: string): Promise<void> {
  if (Platform.OS === 'web') web()?.removeItem(key);
  else await SecureStore.deleteItemAsync(key);
}
