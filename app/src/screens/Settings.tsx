import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, getServerUrl, setServerUrl } from '../api';
import { Btn, Card, SectionTitle } from '../components';
import { theme } from '../theme';
import type { useStore } from '../useStore';

type Store = ReturnType<typeof useStore>;

export function Settings({ store }: { store: Store }) {
  const { engine, watchlist, reconnect, error } = store;
  const [url, setUrl] = useState(getServerUrl());

  useEffect(() => setUrl(getServerUrl()), []);

  const save = async () => {
    await setServerUrl(url.trim());
    reconnect();
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <SectionTitle>Server</SectionTitle>
      <Card>
        <Text style={styles.help}>
          Your Mac's LAN address where the bot is running, e.g. http://192.168.1.50:4000
        </Text>
        <TextInput
          style={styles.input}
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="http://127.0.0.1:4000"
          placeholderTextColor={theme.muted}
        />
        <Btn label="Save & reconnect" kind="primary" onPress={() => void save()} />
        {error ? <Text style={styles.error}>Connection error: {error}</Text> : null}
      </Card>

      <SectionTitle>Decision engine</SectionTitle>
      <Card>
        <Text style={styles.help}>Active mode: {engine?.mode ?? '—'}</Text>
        <View style={styles.btns}>
          <Btn label="Technical" onPress={() => void api.setMode('technical')} />
          <Btn label="LLM (Claude)" onPress={() => void api.setMode('llm')} />
        </View>
      </Card>

      <SectionTitle>Watchlist</SectionTitle>
      <Card>
        {watchlist.length ? (
          watchlist.map((s) => (
            <Text key={s} style={styles.watch}>
              {s}
            </Text>
          ))
        ) : (
          <Text style={styles.help}>—</Text>
        )}
        <Text style={[styles.help, { marginTop: 8 }]}>
          Edit the watchlist in the server's .env (WATCHLIST) and restart the bot.
        </Text>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 16 },
  help: { color: theme.muted, fontSize: 13, marginBottom: 10 },
  input: {
    backgroundColor: theme.panel2,
    color: theme.text,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    fontSize: 15,
  },
  error: { color: theme.red, marginTop: 10, fontSize: 13 },
  btns: { flexDirection: 'row', flexWrap: 'wrap' },
  watch: { color: theme.text, fontSize: 15, paddingVertical: 4 },
});
