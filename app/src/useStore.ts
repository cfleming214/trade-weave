import { useEffect, useRef, useState, useCallback } from 'react';
import { api, wsUrl, type AccountSnapshot, type EngineState, type SignalRow, type StateResponse } from './api';

export interface LiveLog {
  ts: string;
  level: string;
  scope: string;
  msg: string;
}

/**
 * Subscribes to the server's WebSocket and keeps a live view of engine state,
 * account/positions, recent signals, and logs. Bootstraps from REST on connect
 * and auto-reconnects if the socket drops.
 */
export function useStore() {
  const [connected, setConnected] = useState(false);
  const [engine, setEngine] = useState<EngineState | null>(null);
  const [broker, setBroker] = useState<{ name: string; paper: boolean } | null>(null);
  const [account, setAccount] = useState<AccountSnapshot | null>(null);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [signals, setSignals] = useState<SignalRow[]>([]);
  const [logs, setLogs] = useState<LiveLog[]>([]);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const bootstrap = useCallback(async () => {
    try {
      const state: StateResponse = await api.getState();
      setEngine(state.engine);
      setBroker(state.broker);
      setAccount(state.account);
      setWatchlist(state.watchlist);
      setSignals(await api.getSignals(30));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(wsUrl());
      wsRef.current = ws;
      ws.onopen = () => {
        setConnected(true);
        void bootstrap();
      };
      ws.onclose = () => {
        setConnected(false);
        reconnectRef.current = setTimeout(connect, 2500);
      };
      ws.onerror = () => ws.close();
      ws.onmessage = (ev) => {
        try {
          const { type, payload } = JSON.parse(ev.data as string);
          if (type === 'engine-state') setEngine(payload);
          else if (type === 'account-update') setAccount(payload);
          else if (type === 'signal') setSignals((prev) => [payload, ...prev].slice(0, 50));
          else if (type === 'log') setLogs((prev) => [payload, ...prev].slice(0, 100));
        } catch {
          /* ignore malformed frames */
        }
      };
    } catch (e) {
      setError((e as Error).message);
    }
  }, [bootstrap]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const reconnect = useCallback(() => {
    wsRef.current?.close();
    void bootstrap();
    connect();
  }, [bootstrap, connect]);

  return { connected, engine, broker, account, watchlist, signals, logs, error, bootstrap, reconnect, setEngine };
}
