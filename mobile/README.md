# Gregslist for iPhone and Android

This is an Expo/React Native client with native controls. It reuses the existing Supabase Auth, membership/RLS policies and transactional post/event/ride/partner/admin RPCs. It contains no service-role credential, replacement booking engine, WebView feed or public registration.

Implemented: password sign-in and secure session refresh; noticeboard/category/type/status search and pagination; saved posts; post/event creation and editing; discussion; event attendance/RSVP; validated private photo upload/read/removal; ride offers, automatic single/pair/partner bookings, switching/cancellation/withdrawal; mutually consented partner management; private directory/profile editing; notifications; member/invitation/role administration; immediate password-verified own-account deletion. All booking confirmations follow committed backend success. Invitations and first-password/recovery email verification use the trusted HTTPS website, then the member returns to native sign-in. Universal links, push notifications and offline content access are not implemented.

## Development and configuration

In `mobile/`, run `npm ci --cache /tmp/gregslist-mobile-npm-cache`. Copy `.env.example` to an ignored `.env.local` and supply the real public HTTPS site/Supabase URL and browser-safe publishable key. No live values or signing secrets belong in Git. The preferred name `gregslist.friend` has not been registered or verified; it is not a configured deployment. Missing configuration shows a clear setup screen and never falls back to a public demo or local private data.

Run `npm start` for Expo development, `npm run typecheck`, `npm test`, and `npm run export`. Export builds separate iOS/Android JavaScript/assets; **these are not installable signed phone binaries**. Expo dependency checks can use `EXPO_OFFLINE=1 npm run check:dependencies` with the bundled SDK compatibility map when the metadata endpoint is unavailable; this is not an online compatibility certification. The root Next.js TypeScript check intentionally excludes this independent React Native application.

Auth sessions use chunked native Keychain/Keystore storage with byte-bounded Unicode chunks and atomic manifest commits. Session write failures preserve the prior committed session. Private screen state is held only in memory, unmounted on sign-out/access failure, and rechecked on foreground and every thirty seconds. The backend rechecks every protected mutation immediately. Private images use bearer headers and no-store responses. Native media selection converts to JPEG before the existing server validates/re-encodes it and strips metadata.

## Downloadable distribution

Native dependency audit currently reports two unpatched High advisories in
Metro/Expo build tooling: `braces@3.0.3` (GHSA-vfj7-8cjw-p6xm) and
`node-forge@1.4.0` (GHSA-86w9-cpqp-85rv), cascading to 35 affected package paths.
No patched releases were available when checked. Shipped-app exposure was not
identified by source inspection; binary exploitability is unverified. Resolve or
obtain a documented upstream security assessment before publication. Keep
development services private and use trusted project/signing inputs. A separate
`uuid` advisory is fixed with a scoped `xcode` override, verified against actual
project ID generation and parser/writer operations.

Before any distributable build, the publisher must own the configured application identifiers and supply a real Expo project, production HTTPS/Supabase configuration, privacy/support URLs and app-store declarations. Do not publish defaults as if they belonged to an organisation. Install the supported EAS CLI and authenticate through the publisher's account. Configure `GREGSLIST_IOS_BUNDLE_ID`, `GREGSLIST_ANDROID_PACKAGE`, `EXPO_PUBLIC_*`, `EXPO_OWNER` and `EAS_PROJECT_ID` in the proper EAS environment. Keep Apple/Android signing material in EAS/platform secure credential storage.

- `eas build --platform android --profile preview`: signed Android APK for internal installation once configuration/signing are supplied.
- `eas build --platform ios --profile preview`: device build for registered ad-hoc devices with Apple provisioning.
- `eas build --platform all --profile production`: Android App Bundle and iOS archive for store/TestFlight review.
- `eas submit --platform all --profile production`: a separate publication action after reviewing actual artifacts and account details.

iPhone installation needs TestFlight, the App Store or properly provisioned registered devices. An arbitrary downloadable IPA does not install on general iPhones. This Linux cloud workspace has no Xcode/Apple signing access or Android SDK/device; JavaScript exports do not verify native compilation, device gestures, VoiceOver/TalkBack, photo permissions or store compliance. Those checks remain required before native release.

The public privacy/account-deletion routes document actual retention. Deletion has no undo period. It removes Auth/profile/contact data, authored text and uploads; minimum pseudonymised event/ride/admin history expires after twelve months. The deployed authenticated maintenance scheduler must retry provider failures and enforce expiry. Backups require verified provider-specific expiry and restore-erasure procedures. No legal-compliance claim is made.
