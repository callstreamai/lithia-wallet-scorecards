# Lithia RMO Wallet Scorecards

Live Apple Wallet (and later Google Wallet + PDF) scorecards for Lithia Regional Managers of Operations, branded Alpha Drive AI.

## How it works

1. Each week the team uploads the "Weekly Account Performance Report" .xlsx in the admin portal (`POST /admin/import`). The parser reads every sheet titled "Week of ...", matches dealers to stores (by name or alias), and upserts one `store_weeks` row per dealer per week. Dealers with no store match are created as `pending` and listed as unmatched for the team to assign.
2. A database trigger bumps `rmos.pass_updated_at`; the import (or a Supabase webhook for manual edits) schedules a push per affected RMO.
3. The service pushes an empty APNs notification to every iPhone registered for that RMO's pass.
4. Each iPhone calls back `GET /apple/v1/passes/...`, receives a freshly signed `.pkpass`, and the card updates.

The card shows the latest week on the front (book rate with WoW change, containment, transfer, calls, customers, MTD book rate) and month-to-date plus a per-store breakdown on the back.

Rates: book rate = appointments / customers served and transfer rate = transfers / calls are derived from counts; containment comes from the report. RMO rollups are available both as simple averages of store rates (matches the Excel subtotals) and call-weighted; `settings.rate_aggregation` picks which the cards display.

## Endpoints

| Route | Purpose |
|---|---|
| `GET /health` | Certificate + database check |
| `GET /w/:slug` | RMO landing page with the right "Add to Wallet" button |
| `GET /apple/add/:slug.pkpass` | Direct pass download |
| `/apple/v1/...` | Apple PassKit web service (registration, updates, pass fetch, log) |
| `POST /hooks/scorecard-updated` | Supabase database webhook (header `x-webhook-secret`) |
| `POST /admin/import?weeks=latest\|all` | Upload the weekly .xlsx (raw body; headers `x-admin-key`, `x-filename`, `x-user`) |
| `POST /admin/import/preview` | Parse without writing; returns the weeks found |
| `POST /admin/rmos/:id/push` | Force a push for one RMO (header `x-admin-key`) |
| `POST /admin/push-all` | Force a push for every active RMO |

## Deploy on Render

Secret Files (Render dashboard, Environment tab):
- `lithia-scorecard.p12` (Pass Type ID certificate exported from Keychain Access)
- `AuthKey_3BH6593MS4.p8` (APNs auth key)

Environment variables: see `.env.example` and `render.yaml`. `SUPABASE_SERVICE_ROLE_KEY` and `APPLE_PASS_P12_PASSWORD` are entered by hand.

## Local preview (no database needed)

```
npm install
APPLE_PASS_P12_PATH=path/to/lithia-scorecard.p12 APPLE_PASS_P12_PASSWORD=... node scripts/preview-pass.js preview.pkpass
```
AirDrop `preview.pkpass` to an iPhone to see the layout.

## Brand assets

`assets/icon*.png` (29pt) and `assets/logo*.png` (160x50pt) at 1x/2x/3x. Current files are placeholders; replace with the Alpha Drive AI mark (white on transparent for the logo, dark tile for the icon).

## Certificate renewal

Pass Type ID certificate expires 2027-10-17. Create a new one in the Apple Developer portal, export a new `.p12`, replace the Render Secret File, redeploy. The APNs key does not expire.
