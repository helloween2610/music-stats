# iOS app build

This target keeps the existing Zalo Mini App build separate and wraps the current React app in a Capacitor iOS shell.

## Commands

```sh
npm run sync:ios
npm run open:ios
```

In Xcode, choose the `App` scheme and run it on an iPhone simulator or a connected iPhone.

## Notes

- Zalo remains on `vite.config.mts` and the existing `zmp` scripts.
- iOS uses `vite.ios.config.mts`, outputs `dist-ios`, then copies that bundle into `ios/App/App/public`.
- The iOS build sets `VITE_IOS_APP=true` so native sharing uses Capacitor where available.
- For a physical iPhone, set your personal Apple team/signing in Xcode before running on device.

## Saved Builds

- iOS v1: `MARKETING_VERSION=1.0`, `CURRENT_PROJECT_VERSION=1`; current app shell with direct Apple Music opening and iOS-specific layout polish.
