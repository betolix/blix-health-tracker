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
