# Medlytic

Medlytic is a React medicine-finder frontend with a Node.js REST API. All persistent application data is stored in MongoDB. It is intended as a runnable project prototype, not as a production medical or pharmacy system.

Authentication and profile endpoints are handled in `server/routes/auth.routes.js`; medicine search, details, and owner inventory endpoints are handled in `server/routes/medicine.routes.js`. `server/index.js` composes shared request handling and the remaining API routes.

## Run locally

Use Node.js 20.19 or newer and add `MONGO_URI` to the root `.env` file. From the project folder, start the API and frontend together:

```sh
npm run dev
```

This starts the API and Vite in one terminal. Press Ctrl+C to stop both. To run only the API, use `npm run server`.

The API connects to the MongoDB database named `Medlytics_Database`. Users are stored in `user`, medicine catalogue entries in `medicine`, pharmacy inventory in `listing`, and pharmacy profiles, reservations, ratings, reports, search history, saved pharmacies, and audit events in `application_state`. Nearby search uses MongoDB pharmacy coordinates and offers 5, 10, 20, or 50 km radii (10 km by default), listing only in-stock medicines from approved pharmacies with coordinates. `MONGO_URI` supplies the connection credentials and host. The API binds to `127.0.0.1:3002` by default, and Vite forwards `/api` requests there. Set `PORT` to change the API port or `HOST` to change its bind interface; update the Vite proxy target if you use another API host or port.

## Demo accounts

| Role | Email | Password |
| --- | --- | --- |
| Patient | `patient@medlytic.local` | `Patient123!` |
| Medical store owner | `owner@medlytic.local` | `Owner123!` |
| Admin | `admin@medlytic.local` | `Admin123!` |

These accounts are stored in MongoDB for development. Do not use demo credentials or this prototype for a deployed service.

## Included workflows

- **Patients:** search and filter the pharmacy catalogue, compare listed prices and stock, open medicine details, follow a map search link, reserve an in-stock item, save pharmacies, rate a pharmacy, view search history, update a profile, and report incorrect catalogue information.
- **Store owners:** register a pharmacy (new stores require admin approval), edit the pharmacy profile, add/edit medicine listings, update stock and prices, and see inventory statistics and reservations.
- **Admins:** view platform counts, approve/reject pharmacy registrations, suspend/reactivate accounts, review/resolve reports, and inspect the audit log.

Medicine facts and same-ingredient brand suggestions are stored in MongoDB; there is no external generative-AI service configured. The information is general awareness only, not medical advice or a recommendation to switch medicines. Patients should confirm any medicine or alternative with a qualified clinician or pharmacist.

## API overview

- `GET /api/health`, `GET /api/medicines`, `GET /api/medicines/:id`, `GET /api/pharmacies`
- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`, `GET|PATCH /api/profile`
- `GET /api/search-history`, `GET|POST|DELETE /api/saved-pharmacies`, `POST /api/reservations`, `POST /api/reports`
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
