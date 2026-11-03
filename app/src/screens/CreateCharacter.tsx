import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, ApiError } from '../api';
import { colors, spacing } from '../theme';
import type { Scene, Stats } from '../types';

interface Props {
  onCreated: (scene: Scene) => void;
}

const STAT_INFO: { key: keyof Stats; label: string; hint: string }[] = [
  { key: 'might', label: 'Might', hint: 'Force, endurance, fighting' },
  { key: 'finesse', label: 'Finesse', hint: 'Agility, stealth, aim' },
  { key: 'wits', label: 'Wits', hint: 'Perception, lore, cunning' },
  { key: 'charm', label: 'Charm', hint: 'Persuasion, presence, deceit' },
];
const TOTAL = 6;

export default function CreateCharacter({ onCreated }: Props) {
  const [name, setName] = useState('');
  const [concept, setConcept] = useState('');
  const [stats, setStats] = useState<Stats>({ might: 2, finesse: 2, wits: 1, charm: 1 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const used = stats.might + stats.finesse + stats.wits + stats.charm;
  const adjust = (key: keyof Stats, delta: number) => {
    const next = stats[key] + delta;
    if (next < 0 || next > 3) return;
    if (delta > 0 && used >= TOTAL) return;
    setStats({ ...stats, [key]: next });
  };

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      onCreated(await api.createCharacter(name.trim(), concept.trim(), stats));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Who are you?</Text>

        <Text style={styles.label}>Character name</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Mira Thornwick" placeholderTextColor={colors.dim} maxLength={30} />

        <Text style={styles.label}>Concept</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={concept}
          onChangeText={setConcept}
          placeholder="Disgraced duelist turned ferry guide, owes a dangerous favour"
          placeholderTextColor={colors.dim}
          multiline
          maxLength={160}
        />

        <Text style={styles.label}>
          Stats ({TOTAL - used} points left)
        </Text>
        {STAT_INFO.map((s) => (
          <View key={s.key} style={styles.statRow}>
            <View style={styles.flex}>
              <Text style={styles.statName}>{s.label}</Text>
              <Text style={styles.hint}>{s.hint}</Text>
            </View>
            <Pressable style={styles.step} onPress={() => adjust(s.key, -1)}>
              <Text style={styles.stepText}>−</Text>
            </Pressable>
            <Text style={styles.statValue}>+{stats[s.key]}</Text>
            <Pressable style={styles.step} onPress={() => adjust(s.key, 1)}>
              <Text style={styles.stepText}>+</Text>
            </Pressable>
          </View>
        ))}

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable style={[styles.button, (busy || used !== TOTAL) && styles.disabled]} onPress={submit} disabled={busy || used !== TOTAL}>
          {busy ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.buttonText}>Begin the story</Text>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  container: { padding: spacing.xl, paddingTop: 72, gap: spacing.sm },
  title: { color: colors.accent, fontSize: 30, fontWeight: '700', marginBottom: spacing.md },
  label: { color: colors.text, fontSize: 14, marginTop: spacing.md },
  input: { backgroundColor: colors.panel, borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: spacing.md, color: colors.text, fontSize: 16 },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.panel, borderRadius: 10, padding: spacing.md },
  statName: { color: colors.text, fontSize: 16, fontWeight: '600' },
  hint: { color: colors.dim, fontSize: 12 },
  step: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  stepText: { color: colors.accent, fontSize: 20 },
  statValue: { color: colors.text, fontSize: 18, width: 32, textAlign: 'center' },
  error: { color: colors.danger, marginTop: spacing.md },
  button: { backgroundColor: colors.accent, borderRadius: 10, padding: spacing.lg, alignItems: 'center', marginTop: spacing.xl },
  buttonText: { color: colors.bg, fontSize: 17, fontWeight: '700' },
  disabled: { opacity: 0.5 },
});
