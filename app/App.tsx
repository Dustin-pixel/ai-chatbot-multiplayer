import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api, ApiError, setToken } from './src/api';
import CreateCharacter from './src/screens/CreateCharacter';
import Onboarding from './src/screens/Onboarding';
import Scene from './src/screens/Scene';
import { getItem, removeItem, setItem } from './src/storage';
import { colors } from './src/theme';
import type { Scene as SceneData } from './src/types';

type Stage =
  | { name: 'loading' }
  | { name: 'onboarding' }
  | { name: 'create' }
  | { name: 'play'; characterId: string; initialScene?: SceneData }
  | { name: 'error'; message: string };

const TOKEN_KEY = 'realms.token';
const CHARACTER_KEY = 'realms.characterId';

export default function App() {
  const [stage, setStage] = useState<Stage>({ name: 'loading' });

  const signOut = useCallback(async () => {
    setToken(null);
    await Promise.all([removeItem(TOKEN_KEY), removeItem(CHARACTER_KEY)]);
    setStage({ name: 'onboarding' });
  }, []);

  // Restore a previous session, if any.
  useEffect(() => {
    (async () => {
      try {
        const saved = await getItem(TOKEN_KEY);
        if (!saved) return setStage({ name: 'onboarding' });
        setToken(saved);
        const mine = await api.characters();
        const savedId = await getItem(CHARACTER_KEY);
        const pick = mine.find((c) => c.id === savedId) ?? mine[0];
        setStage(pick ? { name: 'play', characterId: pick.id } : { name: 'create' });
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return void signOut();
        setStage({ name: 'error', message: e instanceof Error ? e.message : 'Could not start.' });
      }
    })();
  }, [signOut]);

  const registered = async (token: string) => {
    setToken(token);
    await setItem(TOKEN_KEY, token);
    setStage({ name: 'create' });
  };

  const created = async (scene: SceneData) => {
    await setItem(CHARACTER_KEY, scene.character.id);
    setStage({ name: 'play', characterId: scene.character.id, initialScene: scene });
  };

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      <View style={styles.root}>
        {stage.name === 'loading' && <ActivityIndicator style={styles.center} color={colors.accent} size="large" />}
        {stage.name === 'error' && (
          <View style={styles.center}>
            <Text style={styles.errorText}>{stage.message}</Text>
          </View>
        )}
        {stage.name === 'onboarding' && <Onboarding onRegistered={registered} />}
        {stage.name === 'create' && <CreateCharacter onCreated={created} />}
        {stage.name === 'play' && <Scene key={stage.characterId} characterId={stage.characterId} initialScene={stage.initialScene} onSignOut={signOut} />}
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { color: colors.danger, fontSize: 16, textAlign: 'center' },
});
