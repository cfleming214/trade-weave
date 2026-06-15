import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, type Analysis } from '../api';
import { Btn, Card } from '../components';
import { theme } from '../theme';

/**
 * On-demand Claude analysis: a one-off, advisory-only week-ahead view of the
 * watchlist with buy/sell suggestions. Never trades.
 */
export function Analyze() {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .latestAnalysis()
      .then((r) => setAnalysis(r.analysis))
      .catch(() => {});
  }, []);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const r = await api.runAnalysis();
      setAnalysis(r.analysis);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const usedSearch = analysis ? Boolean(analysis.usedWebSearch ?? analysis.used_web_search) : false;

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <Card>
        <Text style={styles.help}>
          A one-off analysis of your watchlist for the week ahead with buy/sell suggestions. Advisory only — the bot
          never auto-executes these.
        </Text>
        <Btn label={running ? 'Asking Claude…' : '🧠 Ask Claude about the week'} kind="primary" onPress={() => void run()} />
        {running ? <ActivityIndicator color={theme.accent} style={{ marginTop: 12 }} /> : null}
        {error ? <Text style={styles.error}>Failed: {error}</Text> : null}
      </Card>

      {analysis ? (
        <Card>
          <Text style={styles.meta}>
            {analysis.model} · web search: {usedSearch ? 'yes' : 'no'} · {new Date(analysis.ts).toLocaleString()}
          </Text>
          <Text style={styles.body}>{analysis.text}</Text>
        </Card>
      ) : (
        <Card>
          <Text style={styles.help}>No analysis yet. Run one above (takes ~30–60s).</Text>
        </Card>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 16 },
  help: { color: theme.muted, fontSize: 13, marginBottom: 12, lineHeight: 19 },
  meta: { color: theme.muted, fontSize: 11, marginBottom: 10 },
  body: { color: theme.text, fontSize: 14, lineHeight: 21 },
  error: { color: theme.red, marginTop: 10, fontSize: 13 },
});
