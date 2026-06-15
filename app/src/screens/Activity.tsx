import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card, SectionTitle } from '../components';
import { theme } from '../theme';
import type { useStore } from '../useStore';

type Store = ReturnType<typeof useStore>;

const actionColor = (action: string) =>
  action === 'buy' ? theme.green : action === 'close' || action === 'sell' ? theme.red : theme.muted;

export function Activity({ store }: { store: Store }) {
  const { signals, logs } = store;
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <SectionTitle>Recent signals</SectionTitle>
      <Card>
        {signals.length === 0 ? (
          <Text style={{ color: theme.muted }}>No signals yet.</Text>
        ) : (
          signals.slice(0, 25).map((s, i) => (
            <View key={`${s.ts}-${i}`} style={styles.line}>
              <View style={styles.lineHeader}>
                <Text style={[styles.action, { color: actionColor(s.action) }]}>
                  {s.action.toUpperCase()} {s.symbol}
                </Text>
                <Text style={styles.time}>{new Date(s.ts).toLocaleTimeString()}</Text>
              </View>
              <Text style={styles.reason}>
                {s.reason ?? ''} {s.executed ? '' : '· not executed'}
              </Text>
            </View>
          ))
        )}
      </Card>

      <SectionTitle>Log</SectionTitle>
      <Card>
        {logs.length === 0 ? (
          <Text style={{ color: theme.muted }}>No log output yet.</Text>
        ) : (
          logs.slice(0, 60).map((l, i) => (
            <Text
              key={i}
              style={[
                styles.log,
                l.level === 'error' ? { color: theme.red } : l.level === 'warn' ? { color: theme.yellow } : null,
              ]}
            >
              {new Date(l.ts).toLocaleTimeString()} ({l.scope}) {l.msg}
            </Text>
          ))
        )}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 16 },
  line: { borderBottomColor: theme.border, borderBottomWidth: 1, paddingVertical: 8 },
  lineHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  action: { fontSize: 14, fontWeight: '600' },
  time: { color: theme.muted, fontSize: 12 },
  reason: { color: theme.muted, fontSize: 13, marginTop: 2 },
  log: { color: theme.muted, fontSize: 12, fontFamily: 'Courier', paddingVertical: 2 },
});
