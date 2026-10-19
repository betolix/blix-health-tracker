# Alberto Health Dashboard v2

Local-first React + TypeScript dashboard for nutrition, weight and blood-pressure tracking.

## Run

```bash
npm install
npm run dev
```

Open the localhost URL shown by Vite.

## What v2 adds

- Light/dark theme with remembered preference
- Daily food log with editable entries
- Calories, protein, carbs, fat and fiber targets
- Remaining calories/protein
- Weight trend and target line
- Recent blood-pressure readings
- Add-food and add-vitals forms
- LocalStorage persistence
- Oct 3 history + Oct 4 current breakfast preloaded

## Data

v2 stores data only in the browser's localStorage. The next production step is replacing this with an authenticated cloud data store (e.g. AWS Amplify Data) so the same data is available on phone and desktop.
# blix-health-tracker

## Language selection (BLX-49)

Use the Language / Idioma selector above the sign-in screen or dashboard to
choose English or Español. The choice takes effect immediately and is saved as
`health-language` in this browser's localStorage. It survives refresh and sign-out;
it is not an account preference synced across devices. A first visit or invalid
stored preference defaults to English. Missing Spanish translations fall back to
English. When browser storage is unavailable, the current choice remains in memory.

Dashboard labels, dates, forms, accessibility labels, user-facing save/delete
errors, and the synthetic ownership-test screen use the selected language. The
Authenticator uses Amplify's built-in English and Spanish vocabularies. Existing
food names and notes remain as entered; stored source enums and API payload fields
retain their original values.

Run language regression checks with:

```bash
node --import tsx --test tests/i18n.test.ts
npm run build
```

The normal build requires the environment's generated `amplify_outputs.json`.
Before release, verify sign-in, dashboard, both entry forms, and the mobile menu at
320px, 375px, 720px, and desktop widths in both languages. Confirm there are no
clipped labels, overlapping controls, or page-wide horizontal scrolling. Refresh
and sign out/in to verify that the chosen language is retained.
