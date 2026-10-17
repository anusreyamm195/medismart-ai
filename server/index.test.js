import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createAppServer } from "./index.js";

const directory = mkdtempSync(join(tmpdir(), "medlytic-api-"));
const server = createAppServer({ storePath: join(directory, "store.json") });
let baseUrl;

before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  rmSync(directory, { recursive: true, force: true });
});

async function api(path, { token, ...options } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });
  return { status: response.status, body: await response.json() };
}

async function login(email, password) {
  const result = await api("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  assert.equal(result.status, 200);
  return result.body.token;
}

test("public medicine search returns prices, stock, and pharmacy data", async () => {
  const result = await api("/medicines?q=paracetamol&location=Indiranagar");
  assert.equal(result.status, 200);
  assert.ok(result.body.medicines.length > 0);
  assert.equal(result.body.medicines[0].name, "Dolo 650");
  assert.equal(result.body.medicines[0].pharmacy, "Green Cross Pharmacy");
  const detail = await api(`/medicines/${result.body.medicines[0].medicineId}`);
  assert.equal(detail.status, 200);
  assert.ok(detail.body.alternatives.includes("Calpol 650"));
  assert.ok(detail.body.listings.length > 0);

  const nearby = await api("/medicines?q=paracetamol&latitude=12.935&longitude=77.624");
  assert.equal(nearby.body.medicines[0].pharmacy, "City Care Medicals");
  assert.ok(nearby.body.medicines[0].distanceKm < 1);
  const nearbyPharmacies = await api("/pharmacies?latitude=12.935&longitude=77.624");
  assert.equal(nearbyPharmacies.body.pharmacies[0].name, "City Care Medicals");
  assert.ok(nearbyPharmacies.body.pharmacies[0].distanceKm < 1);
  assert.equal((await api("/medicines?latitude=91&longitude=77")).status, 400);
});

test("patients can reserve an available listing and see search history", async () => {
  const token = await login("patient@medlytic.local", "Patient123!");
  const listing = (await api("/medicines?q=Dolo", { token })).body.medicines.find((item) => item.stock > 0);
  const reservation = await api("/reservations", { token, method: "POST", body: JSON.stringify({ listingId: listing.id, quantity: 1 }) });
  assert.equal(reservation.status, 201);
  assert.equal(reservation.body.reservation.status, "pending");
  const history = await api("/search-history", { token });
  assert.equal(history.status, 200);
  assert.equal(history.body.history[0].query, "Dolo");
});

test("owners can update only their inventory, while admins can approve store signups", async () => {
  const ownerToken = await login("owner@medlytic.local", "Owner123!");
  const ownerData = await api("/owner/dashboard", { token: ownerToken });
  const listing = ownerData.body.listings[0];
  const update = await api(`/owner/medicines/${listing.id}`, { token: ownerToken, method: "PATCH", body: JSON.stringify({ stock: 7 }) });
  assert.equal(update.status, 200);
  const created = await api("/owner/medicines", { token: ownerToken, method: "POST", body: JSON.stringify({
    name: "Demo medicine",
    genericName: "Example ingredient",
    category: "General",
    price: "19.50",
    stock: "4",
  }) });
  assert.equal(created.status, 201);
  const refreshed = await api("/owner/dashboard", { token: ownerToken });
  const newListing = refreshed.body.listings.find((item) => item.name === "Demo medicine");
  assert.equal(newListing.stock, 4);
  assert.equal(newListing.price, 19.5);
  const forbidden = await api("/admin/dashboard", { token: ownerToken });
  assert.equal(forbidden.status, 403);

  const signup = await api("/auth/register", { method: "POST", body: JSON.stringify({
    name: "New Store Owner",
    email: "new-owner@example.com",
    password: "StrongPass123",
    role: "owner",
    pharmacyName: "New Pharmacy",
    location: "Jayanagar",
    latitude: 12.925,
    longitude: 77.583,
  }) });
  assert.equal(signup.status, 201);
  const adminToken = await login("admin@medlytic.local", "Admin123!");
  const pharmacies = await api("/admin/pharmacies", { token: adminToken });
  const pending = pharmacies.body.pharmacies.find((item) => item.name === "New Pharmacy");
  assert.equal(pending.status, "pending");
  assert.equal(pending.latitude, 12.925);
  assert.equal(pending.longitude, 77.583);
  const approval = await api(`/admin/pharmacies/${pending.id}`, { token: adminToken, method: "PATCH", body: JSON.stringify({ status: "approved" }) });
  assert.equal(approval.status, 200);
});

test("invalid inputs, missing authentication, and non-admin access are rejected", async () => {
  assert.equal((await api("/owner/dashboard")).status, 401);
  const patientToken = await login("patient@medlytic.local", "Patient123!");
  assert.equal((await api("/admin/audit", { token: patientToken })).status, 403);
  const badRegistration = await api("/auth/register", { method: "POST", body: JSON.stringify({ name: "No", email: "bad", password: "short" }) });
  assert.equal(badRegistration.status, 400);
  const badQuantity = await api("/reservations", { token: patientToken, method: "POST", body: JSON.stringify({ listingId: "listing-1", quantity: 0 }) });
  assert.equal(badQuantity.status, 400);
});

test("patients can save and rate pharmacies, then admins can resolve reports", async () => {
  const patientToken = await login("patient@medlytic.local", "Patient123!");
  const listing = (await api("/medicines?q=Dolo", { token: patientToken })).body.medicines.find((item) => item.stock > 0);
  const saved = await api("/saved-pharmacies", { token: patientToken, method: "POST", body: JSON.stringify({ pharmacyId: listing.pharmacyId }) });
  assert.equal(saved.status, 201);
  assert.equal((await api("/saved-pharmacies", { token: patientToken })).body.pharmacies.length, 1);
  const rating = await api(`/pharmacies/${listing.pharmacyId}/ratings`, { token: patientToken, method: "POST", body: JSON.stringify({ rating: 4 }) });
  assert.equal(rating.status, 201);

  const report = await api("/reports", { token: patientToken, method: "POST", body: JSON.stringify({ type: "incorrect_price", subject: "Dolo 650", details: "The listed price does not match the store." }) });
  assert.equal(report.status, 201);
  const adminToken = await login("admin@medlytic.local", "Admin123!");
  const reports = await api("/admin/reports", { token: adminToken });
  const submitted = reports.body.reports.find((item) => item.id === report.body.report.id);
  const resolved = await api(`/admin/reports/${submitted.id}`, { token: adminToken, method: "PATCH", body: JSON.stringify({ status: "resolved" }) });
  assert.equal(resolved.body.report.status, "resolved");
  const users = await api("/admin/users", { token: adminToken });
  assert.ok(users.body.users.every((user) => !Object.hasOwn(user, "passwordHash")));
});
