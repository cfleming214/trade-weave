import React, { useEffect, useState } from 'react';
import { ActivityIndicator, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { loadServerUrl } from './src/api';
import { theme } from './src/theme';
import { useStore } from './src/useStore';
import { Dashboard } from './src/screens/Dashboard';
import { Positions } from './src/screens/Positions';
import { Activity } from './src/screens/Activity';
import { Analyze } from './src/screens/Analyze';
import { Settings } from './src/screens/Settings';

type Tab = 'dashboard' | 'positions' | 'activity' | 'analyze' | 'settings';
const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: '📊' },
  { key: 'positions', label: 'Positions', icon: '📈' },
  { key: 'activity', label: 'Activity', icon: '🔔' },
  { key: 'analyze', label: 'Analyze', icon: '🧠' },
  { key: 'settings', label: 'Settings', icon: '⚙️' },
];

export default function App() {
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>('dashboard');
  const store = useStore();

  useEffect(() => {
    void loadServerUrl().then(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.app}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Text style={styles.title}>🪡 TradeWeave</Text>
      </View>

      <View style={styles.body}>
        {tab === 'dashboard' && <Dashboard store={store} />}
        {tab === 'positions' && <Positions store={store} />}
        {tab === 'activity' && <Activity store={store} />}
        {tab === 'analyze' && <Analyze />}
        {tab === 'settings' && <Settings store={store} />}
      </View>

      <View style={styles.tabbar}>
        {TABS.map((t) => (
          <TouchableOpacity key={t.key} style={styles.tab} onPress={() => setTab(t.key)} activeOpacity={0.7}>
            <Text style={styles.tabIcon}>{t.icon}</Text>
            <Text style={[styles.tabLabel, tab === t.key ? styles.tabLabelActive : null]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: theme.bg },
  loading: { flex: 1, backgroundColor: theme.bg, justifyContent: 'center', alignItems: 'center' },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
    backgroundColor: theme.panel,
  },
  title: { color: theme.text, fontSize: 18, fontWeight: '600', letterSpacing: 0.5 },
  body: { flex: 1 },
  tabbar: {
    flexDirection: 'row',
    borderTopColor: theme.border,
    borderTopWidth: 1,
    backgroundColor: theme.panel,
    paddingBottom: 8,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 8 },
  tabIcon: { fontSize: 18 },
  tabLabel: { color: theme.muted, fontSize: 11, marginTop: 2 },
  tabLabelActive: { color: theme.accent },
});
