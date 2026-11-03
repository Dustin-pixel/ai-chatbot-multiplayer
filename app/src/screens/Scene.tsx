import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, ApiError } from '../api';
import { colors, spacing } from '../theme';
import type { FeedItem, Scene as SceneData } from '../types';
import Settings from './Settings';

interface Props {
  characterId: string;
  initialScene?: SceneData;
  onSignOut: () => void;
}

const POLL_MS = 4000;

const merge = (a: FeedItem[], b: FeedItem[]): FeedItem[] => {
  const seen = new Set(a.map((e) => e.id));
  return [...a, ...b.filter((e) => !seen.has(e.id))].sort((x, y) => x.id - y.id);
};

export default function Scene({ characterId, initialScene, onSignOut }: Props) {
  const [scene, setScene] = useState<SceneData | null>(initialScene ?? null);
  const [feed, setFeed] = useState<FeedItem[]>(initialScene?.events ?? []);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const lastId = useRef(initialScene?.lastEventId ?? 0);
  const listRef = useRef<FlatList<FeedItem>>(null);

  const apply = useCallback((next: SceneData) => {
    setScene(next);
    setFeed((cur) => merge(cur, next.events));
    lastId.current = Math.max(lastId.current, next.lastEventId);
  }, []);

  // Initial load (when we did not just create the character) and polling for what other players do.
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const s = await api.scene(characterId, lastId.current);
        if (alive) apply(s);
      } catch (e) {
        if (alive && e instanceof ApiError && e.status === 401) onSignOut();
      }
    };
    void pull();
    const timer = setInterval(() => {
      if (!sending) void pull();
    }, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [characterId, sending, apply, onSignOut]);

  const send = async () => {
    const action = input.trim();
    if (!action || sending) return;
    setSending(true);
    setError(null);
    try {
      const result = await api.turn(characterId, action, lastId.current);
      setInput('');
      apply(result.scene);
      if (result.downgraded) setError('This scene was kept non-explicit because not everyone present has adult content enabled.');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally {
      setSending(false);
    }
  };

  const callPause = () =>
    Alert.alert('Call a pause?', 'This shifts the scene to a gentler register for everyone here for the next half hour. No explanation needed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Pause the scene',
        style: 'destructive',
        onPress: async () => {
          try {
            apply(await api.xcard(characterId, lastId.current));
          } catch (e) {
            setError(e instanceof ApiError ? e.message : 'Could not call a pause.');
          }
        },
      },
    ]);

  const renderItem = ({ item }: { item: FeedItem }) => {
    if (item.kind === 'system') return <Text style={styles.system}>{item.text}</Text>;
    if (item.kind === 'arrive' && item.mine) return <Text style={styles.arrive}>{item.text}</Text>;
    if (item.mine) {
      return (
        <View style={styles.mineBlock}>
          <Text style={styles.action}>› {item.action}</Text>
          <Text style={styles.narration}>{item.text}</Text>
          {item.roll !== null && <Text style={styles.roll}>d20: {item.roll}</Text>}
        </View>
      );
    }
    return <Text style={styles.other}>{item.text}</Text>;
  };

  const rating = scene?.rating ?? 'mature';

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <View style={styles.flex}>
          <Text style={styles.location} numberOfLines={1}>
            {scene?.location.name ?? 'Loading…'}
          </Text>
          <Text style={styles.sub} numberOfLines={1}>
            {scene ? `${scene.character.name} · HP ${scene.character.hp}/${scene.character.max_hp}` : ''}
          </Text>
        </View>
        <View style={[styles.badge, { backgroundColor: rating === 'adult' ? colors.adult : colors.mature }]}>
          <Text style={styles.badgeText}>{rating.toUpperCase()}</Text>
        </View>
        <Pressable style={styles.iconBtn} onPress={callPause} accessibilityLabel="Call a pause">
          <Text style={[styles.iconText, { color: colors.danger }]}>✕</Text>
        </Pressable>
        <Pressable style={styles.iconBtn} onPress={() => setShowSettings(true)} accessibilityLabel="Settings">
          <Text style={styles.iconText}>⚙</Text>
        </Pressable>
      </View>

      {scene && (scene.present.length > 0 || scene.npcs.length > 0) && (
        <ScrollView horizontal style={styles.strip} contentContainerStyle={styles.stripContent} showsHorizontalScrollIndicator={false}>
          {scene.present.map((p) => (
            <View key={p.id} style={[styles.chip, styles.playerChip]}>
              <Text style={styles.chipText}>
                {p.name} · {p.condition}
              </Text>
            </View>
          ))}
          {scene.npcs.map((n) => (
            <View key={n.id} style={styles.chip}>
              <Text style={styles.chipText}>{n.name}</Text>
            </View>
          ))}
        </ScrollView>
      )}

      <FlatList
        ref={listRef}
        style={styles.flex}
        contentContainerStyle={styles.feed}
        data={feed}
        keyExtractor={(e) => String(e.id)}
        renderItem={renderItem}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
      />

      {sending && (
        <View style={styles.thinking}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.thinkingText}>The storyteller is thinking…</Text>
        </View>
      )}
      {error && <Text style={styles.error}>{error}</Text>}

      {scene && scene.exits.length > 0 && (
        <ScrollView horizontal style={styles.strip} contentContainerStyle={styles.stripContent} showsHorizontalScrollIndicator={false}>
          {scene.exits.map((x) => (
            <Pressable key={x.id} style={[styles.chip, styles.exitChip]} onPress={() => setInput(`I head to ${x.name}.`)}>
              <Text style={styles.chipText}>→ {x.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="What do you do?"
            placeholderTextColor={colors.dim}
            multiline
            maxLength={1000}
            editable={!sending}
          />
          <Pressable style={[styles.sendBtn, (sending || !input.trim()) && styles.disabled]} onPress={send} disabled={sending || !input.trim()}>
            <Text style={styles.sendText}>Act</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <Settings visible={showSettings} onClose={() => setShowSettings(false)} onSignOut={onSignOut} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  location: { color: colors.text, fontSize: 18, fontWeight: '700' },
  sub: { color: colors.dim, fontSize: 12, marginTop: 2 },
  badge: { borderRadius: 6, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  iconText: { color: colors.text, fontSize: 20 },
  strip: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: colors.border },
  stripContent: { padding: spacing.sm, gap: spacing.sm },
  chip: { backgroundColor: colors.panelAlt, borderRadius: 14, paddingHorizontal: spacing.md, paddingVertical: 6 },
  playerChip: { borderWidth: 1, borderColor: colors.accent },
  exitChip: { borderWidth: 1, borderColor: colors.border },
  chipText: { color: colors.text, fontSize: 13 },
  feed: { padding: spacing.lg, gap: spacing.lg },
  mineBlock: { gap: spacing.sm },
  action: { color: colors.accent, fontSize: 14, fontStyle: 'italic' },
  narration: { color: colors.text, fontSize: 16, lineHeight: 24 },
  roll: { color: colors.dim, fontSize: 11 },
  other: { color: colors.dim, fontSize: 14, fontStyle: 'italic', paddingLeft: spacing.md, borderLeftWidth: 2, borderLeftColor: colors.border },
  arrive: { color: colors.text, fontSize: 15, lineHeight: 22, backgroundColor: colors.panel, padding: spacing.md, borderRadius: 10 },
  system: { color: colors.dim, fontSize: 13, textAlign: 'center', fontStyle: 'italic' },
  thinking: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  thinkingText: { color: colors.dim, fontSize: 13 },
  error: { color: colors.danger, paddingHorizontal: spacing.lg, paddingVertical: spacing.xs, fontSize: 13 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  input: { flex: 1, maxHeight: 120, backgroundColor: colors.panel, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text, fontSize: 16 },
  sendBtn: { backgroundColor: colors.accent, borderRadius: 12, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  sendText: { color: colors.bg, fontSize: 16, fontWeight: '700' },
  disabled: { opacity: 0.5 },
});
