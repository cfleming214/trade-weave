import React from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import { Badge, Btn, Card, SectionTitle, StatBox } from '../components';
import { fmtMoney, pnlColor, theme } from '../theme';
import type { useStore } from '../useStore';

type Store = ReturnType<typeof useStore>;

export function Dashboard({ store }: { store: Store }) {
  const { engine, broker, account, connected } = store;
  const upl = Number(account?.unrealizedPl ?? 0);
  const day = account ? Number(account.equity) - Number(account.lastEquity ?? account.equity) : 0;

  const confirmKill = () =>
    Alert.alert('Kill switch', 'Block all new orders immediately?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'KILL', style: 'destructive', onPress: () => void api.setKill(true) },
    ]);

  const confirmFlatten = () =>
    Alert.alert('Flatten all', 'Cancel orders and CLOSE ALL positions?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Flatten', style: 'destructive', onPress: () => void api.flatten() },
    ]);

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <View style={styles.badges}>
        <Badge label={broker ? `${broker.name}${broker.paper ? ' · paper' : ' · LIVE'}` : '—'} kind={broker?.paper === false ? 'danger' : 'on'} />
        <Badge label={connected ? 'connected' : 'offline'} kind={connected ? 'on' : 'danger'} />
        <Badge label={`engine: ${engine?.mode ?? '—'}`} />
        <Badge label={engine?.running ? 'running' : 'stopped'} kind={engine?.running ? 'on' : 'off'} />
        <Badge label={engine?.tradingEnabled ? 'trading' : 'observe'} kind={engine?.tradingEnabled ? 'on' : 'off'} />
        {engine?.killSwitch ? <Badge label="KILLED" kind="danger" /> : null}
      </View>

      <View style={styles.row}>
        <StatBox label="Equity" value={fmtMoney(account?.equity)} />
        <StatBox label="Cash" value={fmtMoney(account?.cash)} />
      </View>
      <View style={[styles.row, { marginTop: 8, marginBottom: 12 }]}>
        <StatBox label="Unrealized P&L" value={fmtMoney(upl)} color={pnlColor(upl)} />
        <StatBox label="Day P&L" value={fmtMoney(day)} color={pnlColor(day)} />
      </View>

      <Card>
        <SectionTitle>Controls</SectionTitle>
        <View style={styles.btns}>
          <Btn label="▶ Start" kind="primary" onPress={() => void api.start()} />
          <Btn label="⏸ Stop" onPress={() => void api.stop()} />
          <Btn label="Enable trading" onPress={() => void api.setTrading(true)} />
          <Btn label="Disable trading" onPress={() => void api.setTrading(false)} />
          <Btn label="🛑 Kill switch" kind="danger" onPress={confirmKill} />
          <Btn label="Flatten all" kind="danger" onPress={confirmFlatten} />
        </View>
      </Card>

      {engine?.killSwitch ? (
        <Card style={{ borderColor: theme.red }}>
          <Text style={{ color: theme.red }}>
            Kill switch is engaged — no new orders will be placed. Re-enable trading to resume.
          </Text>
        </Card>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 16 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 14 },
  row: { flexDirection: 'row', marginHorizontal: -4 },
  btns: { flexDirection: 'row', flexWrap: 'wrap' },
});
