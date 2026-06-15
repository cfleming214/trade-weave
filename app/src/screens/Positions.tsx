import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card } from '../components';
import { fmtMoney, pnlColor, theme } from '../theme';
import type { useStore } from '../useStore';

type Store = ReturnType<typeof useStore>;

export function Positions({ store }: { store: Store }) {
  const positions = store.account?.positions ?? [];
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      {positions.length === 0 ? (
        <Card>
          <Text style={{ color: theme.muted }}>No open positions.</Text>
        </Card>
      ) : (
        positions.map((p) => (
          <Card key={p.symbol}>
            <View style={styles.headerRow}>
              <Text style={styles.symbol}>{p.symbol}</Text>
              <Text style={[styles.pnl, { color: pnlColor(p.unrealizedPl) }]}>
                {fmtMoney(p.unrealizedPl)} ({(p.unrealizedPlPct * 100).toFixed(2)}%)
              </Text>
            </View>
            <View style={styles.detailRow}>
              <Detail label="Qty" value={String(p.qty)} />
              <Detail label="Avg entry" value={fmtMoney(p.avgEntryPrice)} />
              <Detail label="Last" value={fmtMoney(p.currentPrice)} />
            </View>
          </Card>
        ))
      )}
    </ScrollView>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detail}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 16 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  symbol: { color: theme.text, fontSize: 18, fontWeight: '600' },
  pnl: { fontSize: 15, fontWeight: '600' },
  detailRow: { flexDirection: 'row' },
  detail: { flex: 1 },
  detailLabel: { color: theme.muted, fontSize: 11, textTransform: 'uppercase' },
  detailValue: { color: theme.text, fontSize: 15, marginTop: 2 },
});
