# TradeWeave App

A personal React Native / Expo monitor for the TradeWeave bot. It connects to
the local server over your LAN to show live portfolio stats, positions,
activity, and engine controls (including the kill switch). For your own use via
TestFlight — not a published app.

## Run in development

```bash
cd app
npm install
npx expo start         # then press 'i' for iOS simulator, or scan the QR with Expo Go
```

In the app's **Settings** tab, set the server URL to your Mac's LAN address
(e.g. `http://192.168.1.50:4000`) so your phone can reach the bot. Find your IP
with `ipconfig getifaddr en0`. The server must be started with `HOST=0.0.0.0`
to accept LAN connections from the phone.

## Screens

- **Dashboard** — equity, cash, P&L, engine state badges, and controls
  (start/stop, enable/disable trading, kill switch, flatten all).
- **Portfolio** — every holding with live market price, daily change ($/%),
  unrealized P&L, a price graph (react-native-svg), and full trade history.
- **Activity** — recent strategy signals and the live server log.
- **Settings** — server URL, decision-engine mode, watchlist.

## TestFlight (personal)

```bash
npm install -g eas-cli
eas login
eas build --platform ios --profile production
eas submit --platform ios          # uploads to App Store Connect → TestFlight
```

`app.json` already sets the iOS bundle identifier (`com.cfleming.tradeweave`)
and allows cleartext LAN traffic (the bot runs on plain HTTP on your network).
You'll need an Apple Developer account to push to TestFlight.
