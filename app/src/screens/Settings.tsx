import { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, ApiError } from '../api';
import { colors, spacing } from '../theme';
import type { ModelInfo, PlayerInfo } from '../types';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSignOut: () => void;
}

export default function Settings({ visible, onClose, onSignOut }: Props) {
  const [player, setPlayer] = useState<PlayerInfo | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [themes, setThemes] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setError(null);
    Promise.all([api.me(), api.models()])
      .then(([p, m]) => {
        setPlayer(p);
        setModels(m);
        setThemes(p.blockedThemes.join(', '));
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load settings.'));
  }, [visible]);

  const save = async (patch: Parameters<typeof api.updateSettings>[0]) => {
    setError(null);
    try {
      setPlayer(await api.updateSettings(patch));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save.');
    }
  };

  const toggleAdult = (value: boolean) => {
    if (!value) return void save({ adultContent: false });
    Alert.alert(
      'Allow adult content?',
      'Adult scenes only happen when EVERY player in the scene has this turned on. You can also call a pause with the X button at any time.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'I am 18+ — allow', onPress: () => void save({ adultContent: true }) },
      ],
    );
  };

  const saveThemes = () =>
    void save({
      blockedThemes: themes
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    });

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.title}>Settings</Text>
          <Pressable onPress={onClose}>
            <Text style={styles.close}>Done</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.body}>
          {error && <Text style={styles.error}>{error}</Text>}

          <Text style={styles.section}>Content</Text>
          <View style={styles.row}>
            <View style={styles.flex}>
              <Text style={styles.rowTitle}>Adult content</Text>
              <Text style={styles.hint}>Off by default. Applies only when everyone in the scene has it on.</Text>
            </View>
            <Switch value={player?.adultContent ?? false} onValueChange={toggleAdult} disabled={!player} trackColor={{ true: colors.adult }} />
          </View>

          <Text style={styles.label}>Themes to always avoid (comma separated)</Text>
          <TextInput
            style={styles.input}
            value={themes}
            onChangeText={setThemes}
            onEndEditing={saveThemes}
            placeholder="e.g. spiders, torture"
            placeholderTextColor={colors.dim}
          />

          <Text style={styles.section}>Storyteller model</Text>
          {models.map((m) => {
            const selected = player?.modelId === m.id;
            return (
              <Pressable key={m.id} style={[styles.row, selected && styles.selected]} onPress={() => void save({ modelId: m.id })}>
                <View style={styles.flex}>
                  <Text style={styles.rowTitle}>{m.label}</Text>
                  <Text style={styles.hint}>{m.adultContent ? 'Can run adult scenes' : 'Non-explicit scenes only'}</Text>
                </View>
                {selected && <Text style={styles.check}>✓</Text>}
              </Pressable>
            );
          })}
          <Pressable style={styles.linkRow} onPress={() => void save({ modelId: null })}>
            <Text style={styles.link}>Use the server default</Text>
          </Pressable>

          <Pressable style={styles.signOut} onPress={onSignOut}>
            <Text style={styles.signOutText}>Sign out on this device</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { color: colors.text, fontSize: 20, fontWeight: '700' },
  close: { color: colors.accent, fontSize: 17 },
  body: { padding: spacing.lg, gap: spacing.sm },
  section: { color: colors.accent, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', marginTop: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.panel, borderRadius: 10, padding: spacing.md, borderWidth: 1, borderColor: 'transparent' },
  selected: { borderColor: colors.accent },
  rowTitle: { color: colors.text, fontSize: 16 },
  hint: { color: colors.dim, fontSize: 12, marginTop: 2 },
  label: { color: colors.text, fontSize: 14, marginTop: spacing.md },
  input: { backgroundColor: colors.panel, borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: spacing.md, color: colors.text, fontSize: 16 },
  check: { color: colors.accent, fontSize: 18 },
  linkRow: { padding: spacing.sm },
  link: { color: colors.dim, textDecorationLine: 'underline' },
  error: { color: colors.danger },
  signOut: { marginTop: spacing.xl, padding: spacing.lg, alignItems: 'center', borderRadius: 10, borderWidth: 1, borderColor: colors.danger },
  signOutText: { color: colors.danger, fontSize: 16 },
});
