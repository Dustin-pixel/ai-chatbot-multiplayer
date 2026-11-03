import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, ApiError } from '../api';
import { colors, spacing } from '../theme';

interface Props {
  onRegistered: (token: string) => void;
}

export default function Onboarding({ onRegistered }: Props) {
  const [name, setName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!confirmed) return setError('Please confirm you are 18 or older.');
    setBusy(true);
    try {
      const { token } = await api.register(name.trim(), birthDate.trim());
      onRegistered(token);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>The Lantern Coast</Text>
        <Text style={styles.subtitle}>A shared world where every traveller's story can cross paths.</Text>

        <Text style={styles.label}>Display name</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="What should others call you?" placeholderTextColor={colors.dim} maxLength={24} />

        <Text style={styles.label}>Date of birth</Text>
        <TextInput
          style={styles.input}
          value={birthDate}
          onChangeText={setBirthDate}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={colors.dim}
          keyboardType="numbers-and-punctuation"
          maxLength={10}
        />

        <Pressable style={styles.checkRow} onPress={() => setConfirmed(!confirmed)}>
          <View style={[styles.box, confirmed && styles.boxOn]}>{confirmed && <Text style={styles.tick}>✓</Text>}</View>
          <Text style={styles.checkText}>
            I am 18 or older. I understand this is a fiction game with mature themes (violence, horror and, if every player in a scene opts in, adult content).
          </Text>
        </Pressable>

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable style={[styles.button, busy && styles.disabled]} onPress={submit} disabled={busy}>
          {busy ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.buttonText}>Enter the world</Text>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  container: { padding: spacing.xl, paddingTop: 72, gap: spacing.sm },
  title: { color: colors.accent, fontSize: 34, fontWeight: '700' },
  subtitle: { color: colors.dim, fontSize: 16, marginBottom: spacing.xl },
  label: { color: colors.text, fontSize: 14, marginTop: spacing.md },
  input: { backgroundColor: colors.panel, borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: spacing.md, color: colors.text, fontSize: 16 },
  checkRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg, alignItems: 'flex-start' },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 1, borderColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.accent },
  tick: { color: colors.bg, fontWeight: '700' },
  checkText: { flex: 1, color: colors.text, fontSize: 14, lineHeight: 20 },
  error: { color: colors.danger, marginTop: spacing.md },
  button: { backgroundColor: colors.accent, borderRadius: 10, padding: spacing.lg, alignItems: 'center', marginTop: spacing.xl },
  buttonText: { color: colors.bg, fontSize: 17, fontWeight: '700' },
  disabled: { opacity: 0.6 },
});
