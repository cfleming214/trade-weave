import React from 'react';
import { Text, View, TouchableOpacity, StyleSheet, type ViewStyle } from 'react-native';
import { theme } from './theme';

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function StatBox({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Card style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, color ? { color } : null]}>{value}</Text>
    </Card>
  );
}

export function Badge({ label, kind = 'off' }: { label: string; kind?: 'on' | 'off' | 'danger' }) {
  const bg = kind === 'on' ? '#13301f' : kind === 'danger' ? '#3a1212' : theme.panel2;
  const fg = kind === 'on' ? theme.green : kind === 'danger' ? theme.red : theme.muted;
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color: fg }]}>{label}</Text>
    </View>
  );
}

export function Btn({
  label,
  onPress,
  kind = 'default',
}: {
  label: string;
  onPress: () => void;
  kind?: 'default' | 'primary' | 'danger';
}) {
  const bg = kind === 'primary' ? '#1a2d52' : kind === 'danger' ? '#3a1212' : theme.panel2;
  const fg = kind === 'primary' ? theme.accent : kind === 'danger' ? theme.red : theme.text;
  return (
    <TouchableOpacity style={[styles.btn, { backgroundColor: bg }]} onPress={onPress} activeOpacity={0.7}>
      <Text style={[styles.btnText, { color: fg }]}>{label}</Text>
    </TouchableOpacity>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.section}>{children}</Text>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.panel,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  stat: { flex: 1, marginHorizontal: 4, marginBottom: 0 },
  statLabel: { color: theme.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  statValue: { color: theme.text, fontSize: 22, fontWeight: '600', marginTop: 6 },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.border,
    marginRight: 6,
    marginBottom: 6,
  },
  badgeText: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  btn: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.border,
    marginRight: 8,
    marginBottom: 8,
  },
  btnText: { fontSize: 14, fontWeight: '500' },
  section: {
    color: theme.muted,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
    marginTop: 4,
  },
});
