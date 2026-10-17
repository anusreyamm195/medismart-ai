# Medlytic

Medlytic is a React medicine-finder frontend with a Node.js REST API. The local API stores persistent application data in MongoDB; when Supabase credentials are configured, the frontend uses Supabase for supported data workflows. It is intended as a runnable project prototype, not as a production medical or pharmacy system.

Authentication and profile endpoints are handled in `server/routes/auth.routes.js`; medicine search, details, and owner inventory endpoints are handled in `server/routes/medicine.routes.js`. `server/index.js` composes shared request handling and the remaining API routes.

## Run locally

Use Node.js 20.19 or newer and add `MONGO_URI` to the root `.env` file. From the project folder, start the API and frontend together:

```sh
npm run dev
```

This starts the API and Vite in one terminal. Press Ctrl+C to stop both. To run only the API, use `npm run server`.

The API connects to the MongoDB database named `Medlytics_Database`. Users are stored in `user`, medicine catalogue entries in `medicine`, pharmacy inventory in `listing`, and pharmacy profiles, reservations, ratings, reports, search history, saved pharmacies, liked medicines, and audit events in `application_state`. Nearby search uses road-route distances from the public OSRM routing service, with 5, 10, 20, 50, or 100 km radii (10 km by default), and lists in-stock medicines from approved pharmacies with coordinates. The selected search coordinates and pharmacy coordinates are sent to OSRM to calculate routes. Search for multiple medicines by separating names with commas, semicolons, or new lines; results are grouped by pharmacy with a price for each listing. `MONGO_URI` supplies the connection credentials and host. The API binds to `127.0.0.1:3002` by default, and Vite forwards `/api` requests there. Set `PORT` to change the API port or `HOST` to change its bind interface; update the Vite proxy target if you use another API host or port.

When using Supabase, apply `supabase/migrations/20261017000000_liked_medicines.sql` to the project. It creates a unique per-user medicine-like table with row-level security and applies user-only access policies to the existing `saved_pharmacies` table.

## Demo accounts

| Role | Email | Password |
| --- | --- | --- |
| Patient | `patient@medlytic.local` | `Patient123!` |
| Medical store owner | `owner@medlytic.local` | `Owner123!` |
| Admin | `admin@medlytic.local` | `Admin123!` |

These accounts are stored in MongoDB for development. Do not use demo credentials or this prototype for a deployed service.

## Included workflows

- **Patients:** search and filter the pharmacy catalogue, compare listed prices and stock, open medicine details, follow a map search link, reserve an in-stock item, like medicines, save pharmacies, rate a pharmacy, view search history, update a profile, and report incorrect catalogue information.
- **Store owners:** register a pharmacy (new stores require admin approval), edit the pharmacy profile, add/edit medicine listings, update stock and prices, and see inventory statistics and reservations.
- **Admins:** view platform counts, approve/reject pharmacy registrations, suspend/reactivate accounts, review/resolve reports, and inspect the audit log.

Medicine facts and same-ingredient brand suggestions are stored in MongoDB; there is no external generative-AI service configured. When a user names a medicine, the assistant checks the current approved pharmacy listings and catalogue for its information, location, price, stock, and contact details. Listings reflect pharmacy-reported data and should be confirmed with the pharmacy. The medicine assistant does not diagnose symptoms or prescribe treatment. It can provide limited general information about common non-prescription symptom-relief options for explicitly named conditions; this is not a personalized recommendation, and users should confirm suitability with a pharmacist or clinician. Symptom questions are given possible causes with a reminder to seek assessment, and potentially urgent symptoms are directed to local emergency services.

## API overview

- `GET /api/health`, `GET /api/medicines`, `GET /api/medicines/:id`, `GET /api/pharmacies`
- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`, `GET|PATCH /api/profile`
- `GET /api/search-history`, `GET|POST|DELETE /api/saved-pharmacies`, `GET|POST /api/liked-medicines`, `DELETE /api/liked-medicines/:medicineId`, `POST /api/reservations`, `POST /api/reports`
- `GET|PATCH /api/owner/profile`, `GET /api/owner/dashboard`, `POST /api/owner/medicines`, `PATCH|DELETE /api/owner/medicines/:id`
- `GET /api/admin/dashboard`, `GET|PATCH /api/admin/pharmacies/:id`, `GET|PATCH /api/admin/users/:id`, `GET|PATCH /api/admin/reports/:id`, `GET /api/admin/audit`
- `POST /api/pharmacies/:id/ratings`

Protected endpoints use `Authorization: Bearer <token>`. Passwords are stored as scrypt hashes; API tokens are signed and expire after seven days. Set a strong `TOKEN_SECRET` before exposing the API outside local development.

## Checks

```sh
npm run test:server
npm run lint
npm run build
```
