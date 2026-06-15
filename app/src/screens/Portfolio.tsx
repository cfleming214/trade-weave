import React, { useCallback, useEffect, useState } from 'react';
import { Dimensions, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, type PortfolioPosition, type OrderRow } from '../api';
import { Card, SectionTitle } from '../components';
import { Sparkline } from '../Sparkline';
import { fmtMoney, pnlColor, theme } from '../theme';

const CHART_W = Dimensions.get('window').width - 64;

/**
 * Portfolio view: every holding the bot bought/sold, with live market price,
 * daily change ($ and %), unrealized P&L, a price graph, and the trade history.
 */
export function Portfolio() {
  const [positions, setPositions] = useState<PortfolioPosition[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.getPortfolio();
      setPositions(r.positions);
      setOrders(r.orders);
    } catch {
      /* ignore transient errors */
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />}
    >
      <SectionTitle>Holdings</SectionTitle>
      {positions.length === 0 ? (
        <Card>
          <Text style={{ color: theme.muted }}>No open positions.</Text>
        </Card>
      ) : (
        positions.map((p) => {
          const dayColor = pnlColor(p.change);
          return (
            <Card key={p.symbol}>
              <View style={styles.headerRow}>
                <View>
                  <Text style={styles.symbol}>{p.symbol}</Text>
                  <Text style={styles.sub}>
                    {p.qty} @ {fmtMoney(p.avgEntryPrice)}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.price}>{fmtMoney(p.currentPrice)}</Text>
                  <Text style={[styles.change, { color: dayColor }]}>
                    {p.change >= 0 ? '+' : ''}
                    {fmtMoney(p.change)} ({p.changePct >= 0 ? '+' : ''}
                    {p.changePct}%)
                  </Text>
                </View>
              </View>

              <Sparkline data={p.history.map((h) => h.close)} width={CHART_W} height={64} />

              <View style={styles.footerRow}>
                <Text style={styles.footerLabel}>Unrealized P&L</Text>
                <Text style={[styles.footerValue, { color: pnlColor(p.unrealizedPl) }]}>
                  {fmtMoney(p.unrealizedPl)} ({(p.unrealizedPlPct * 100).toFixed(2)}%)
                </Text>
              </View>
            </Card>
          );
        })
      )}

      <SectionTitle>Trade history</SectionTitle>
      <Card>
        {orders.length === 0 ? (
          <Text style={{ color: theme.muted }}>No trades yet.</Text>
        ) : (
          orders.slice(0, 30).map((o, i) => (
            <View key={`${o.id}-${i}`} style={styles.trade}>
              <View style={styles.tradeHeader}>
                <Text style={[styles.side, { color: o.side === 'buy' ? theme.green : theme.red }]}>
                  {o.side.toUpperCase()} {Number(o.qty).toFixed(2)} {o.symbol}
                </Text>
                <Text style={styles.tradeTime}>{new Date(o.ts).toLocaleString()}</Text>
              </View>
              <Text style={styles.tradeDetail}>
                {o.filled_avg_price ? `@ ${fmtMoney(o.filled_avg_price)}` : o.status}
                {o.reason ? ` · ${o.reason}` : ''}
              </Text>
            </View>
          ))
        )}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 16 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  symbol: { color: theme.text, fontSize: 18, fontWeight: '600' },
  sub: { color: theme.muted, fontSize: 12, marginTop: 2 },
  price: { color: theme.text, fontSize: 16, fontWeight: '600' },
  change: { fontSize: 13, marginTop: 2 },
  footerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  footerLabel: { color: theme.muted, fontSize: 12, textTransform: 'uppercase' },
  footerValue: { fontSize: 15, fontWeight: '600' },
  trade: { borderBottomColor: theme.border, borderBottomWidth: 1, paddingVertical: 8 },
  tradeHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  side: { fontSize: 14, fontWeight: '600' },
  tradeTime: { color: theme.muted, fontSize: 11 },
  tradeDetail: { color: theme.muted, fontSize: 12, marginTop: 2 },
});
