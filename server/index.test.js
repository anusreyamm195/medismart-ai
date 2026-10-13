import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import { after, before, test } from "node:test";
import { createAppServer } from "./index.js";
import {
  connectMongoRepositories,
  applicationStateCollectionName,
  listingCollectionName,
  medicineCollectionName,
  userCollectionName,
  userDatabaseName,
} from "./db/mongo.js";

function passwordHash(password) {
  const salt = "test-salt";
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

function createTestData() {
  const paracetamolInfo = "Paracetamol is commonly used for pain and fever.";
  return {
    users: [
      { id: "user-admin", name: "Platform Admin", email: "admin@medlytic.local", passwordHash: passwordHash("Admin123!"), role: "admin", active: true },
      { id: "user-patient", name: "Aarav Sharma", email: "patient@medlytic.local", passwordHash: passwordHash("Patient123!"), role: "patient", active: true },
      { id: "user-owner", name: "Maya Patel", email: "owner@medlytic.local", passwordHash: passwordHash("Owner123!"), role: "owner", active: true },
    ],
    pharmacies: [
      { id: "pharmacy-green-cross", ownerId: "user-owner", name: "Green Cross Pharmacy", location: "Indiranagar, Bengaluru", address: "12 100 Feet Road, Indiranagar, Bengaluru", phone: "+91 80 4000 1001", latitude: 12.9719, longitude: 77.6412, status: "approved", rating: 4.8 },
      { id: "pharmacy-city-care", ownerId: null, name: "City Care Medicals", location: "Koramangala, Bengaluru", address: "80 Feet Road, Koramangala, Bengaluru", phone: "+91 80 4000 1002", latitude: 12.9352, longitude: 77.6245, status: "approved", rating: 4.5 },
      { id: "pharmacy-wellness", ownerId: null, name: "Wellness Drugstore", location: "Whitefield, Bengaluru", address: "Main Road, Whitefield, Bengaluru", phone: "+91 80 4000 1003", latitude: 12.9698, longitude: 77.75, status: "approved", rating: 4.6 },
    ],
    medicines: [
      { id: "med-paracetamol", name: "Dolo 650", genericName: "Paracetamol 650 mg", category: "Pain relief", info: paracetamolInfo },
      { id: "med-calpol", name: "Calpol 650", genericName: "Paracetamol 650 mg", category: "Pain relief", info: paracetamolInfo },
      { id: "med-ibuprofen", name: "Brufen 400", genericName: "Ibuprofen 400 mg", category: "Pain relief", info: "Ibuprofen is a non-steroidal anti-inflammatory medicine." },
      { id: "med-cetirizine", name: "Cetzine 10", genericName: "Cetirizine 10 mg", category: "Allergy relief", info: "Cetirizine is an antihistamine." },
      { id: "med-vitamin-c", name: "Limcee 500", genericName: "Vitamin C 500 mg", category: "Vitamins", info: "Vitamin C is a dietary supplement." },
      { id: "med-omeprazole", name: "Omez 20", genericName: "Omeprazole 20 mg", category: "Digestive health", info: "Omeprazole reduces stomach acid." },
    ],
    listings: [
      { id: "listing-1", medicineId: "med-paracetamol", pharmacyId: "pharmacy-green-cross", price: 30, stock: 42, ownerId: "user-owner" },
      { id: "listing-2", medicineId: "med-paracetamol", pharmacyId: "pharmacy-city-care", price: 32, stock: 18 },
      { id: "listing-3", medicineId: "med-paracetamol", pharmacyId: "pharmacy-wellness", price: 28, stock: 0 },
      { id: "listing-10", medicineId: "med-calpol", pharmacyId: "pharmacy-green-cross", price: 34, stock: 21, ownerId: "user-owner" },
      { id: "listing-4", medicineId: "med-ibuprofen", pharmacyId: "pharmacy-green-cross", price: 45, stock: 16, ownerId: "user-owner" },
      { id: "listing-5", medicineId: "med-ibuprofen", pharmacyId: "pharmacy-city-care", price: 42, stock: 25 },
      { id: "listing-6", medicineId: "med-cetirizine", pharmacyId: "pharmacy-city-care", price: 22, stock: 31 },
      { id: "listing-7", medicineId: "med-cetirizine", pharmacyId: "pharmacy-wellness", price: 24, stock: 12 },
      { id: "listing-8", medicineId: "med-vitamin-c", pharmacyId: "pharmacy-green-cross", price: 18, stock: 60, ownerId: "user-owner" },
      { id: "listing-9", medicineId: "med-omeprazole", pharmacyId: "pharmacy-wellness", price: 56, stock: 9 },
    ],
    history: [],
    savedPharmacies: [],
    reservations: [],
    reports: [],
    audit: [],
    ratings: [],
  };
}

function createMemoryApi({ data = createTestData(), userRepository } = {}) {
  const users = new Map(data.users.map((user) => [user.id, user]));
  const products = new Map(data.medicines.map((medicine) => [medicine.id, medicine]));
  const listings = new Map(data.listings.map((listing) => [listing.id, listing]));
  const memoryUsers = userRepository || {
    async findAll() { return [...users.values()]; },
    async findById(id) { return users.get(id) || null; },
    async findByEmail(email) { return [...users.values()].find((user) => user.email === email) || null; },
    async updateById(id, updates) {
      const user = users.get(id);
      if (!user) return null;
      Object.assign(user, updates);
      return user;
    },
    async create(user) {
      if (await this.findByEmail(user.email)) throw Object.assign(new Error("Duplicate email."), { code: 11000 });
      users.set(user.id, user);
      return user;
    },
  };
  const medicines = {
    async findAll() {
      return [...listings.values()].flatMap((listing) => {
        const product = products.get(listing.medicineId);
        return product ? [{ ...product, ...listing, id: product.id, listingId: listing.id }] : [];
      });
    },
    async findAllProducts() { return [...products.values()]; },
    async findAllListings() { return [...listings.values()]; },
    async findById(id) {
      const product = products.get(id);
      return product ? { ...product, listings: [...listings.values()].filter((listing) => listing.medicineId === id) } : null;
    },
    async create(medicine) {
      const { listingId, price, stock, pharmacyId, ...product } = medicine;
      products.set(product.id, product);
      listings.set(listingId, { id: listingId, medicineId: product.id, ownerId: product.ownerId, pharmacyId, price, stock });
      return medicine;
    },
    async updateOwned(id, ownerId, updates, listingId) {
      const product = products.get(id);
      const listing = listings.get(listingId);
      if (!product || !listing) return null;
      if (listing.ownerId !== ownerId || listing.medicineId !== id) return null;
      for (const key of ["name", "genericName", "category", "info"]) if (updates[key] !== undefined) product[key] = updates[key];
      for (const key of ["price", "stock"]) if (updates[key] !== undefined) listing[key] = updates[key];
      return this.findById(id);
    },
    async deleteOwned(id, ownerId, listingId) {
      const product = products.get(id);
      const listing = listings.get(listingId);
      if (!product || !listing || listing.ownerId !== ownerId || listing.medicineId !== id) return false;
      listings.delete(listingId);
      if (product.ownerId === ownerId) products.delete(id);
      return true;
    },
  };
  const applicationDataRepository = {
    async save() {},
  };
  const server = createAppServer({ data, userRepository: memoryUsers, medicineRepository: medicines, applicationDataRepository });
  return { server, data, users: memoryUsers, medicines, applicationDataRepository };
}

const testApi = createMemoryApi();
const server = testApi.server;
let baseUrl;

before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
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
  const withinOneKm = await api("/medicines?latitude=12.9352&longitude=77.6245&radiusKm=1");
  assert.ok(withinOneKm.body.medicines.length > 0);
  assert.ok(withinOneKm.body.medicines.every((medicine) => medicine.pharmacy === "City Care Medicals" && medicine.stock > 0));
  assert.equal((await api("/medicines?latitude=12.9352&longitude=77.6245&radiusKm=0")).status, 400);
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

test("Mongo-backed registrations persist and can log in", async () => {
  const storedUsers = new Map();
  const userRepository = {
    async findById(id) {
      return storedUsers.get(id) || null;
    },
    async findByEmail(email) {
      return [...storedUsers.values()].find((user) => user.email === email) || null;
    },
    async updateById(id, updates) {
      const user = storedUsers.get(id);
      if (!user) return null;
      Object.assign(user, updates);
      return user;
    },
    async create(user) {
      if (await this.findByEmail(user.email)) throw Object.assign(new Error("Duplicate email."), { code: 11000 });
      storedUsers.set(user.id, user);
      return user;
    },
  };
  const data = { ...createTestData(), users: [] };
  const persistentApi = createMemoryApi({ data, userRepository });
  const persistentServer = persistentApi.server;
  await new Promise((resolve) => persistentServer.listen(0, "127.0.0.1", resolve));
  const persistentBaseUrl = `http://127.0.0.1:${persistentServer.address().port}/api`;

  try {
    const register = async (path, options = {}) => {
      const response = await fetch(`${persistentBaseUrl}${path}`, {
        ...options,
        headers: { "Content-Type": "application/json", ...options.headers },
      });
      return { status: response.status, body: await response.json() };
    };
    const signup = await register("/auth/register", {
      method: "POST",
      body: JSON.stringify({ name: "Mongo Patient", email: "mongo-patient@example.com", password: "StrongPass123" }),
    });
    assert.equal(signup.status, 201);
    assert.equal(storedUsers.get(signup.body.user.id).email, "mongo-patient@example.com");
    assert.equal(data.users[0].email, "mongo-patient@example.com");

    const login = await register("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "mongo-patient@example.com", password: "StrongPass123" }),
    });
    assert.equal(login.status, 200);
    const profile = await register("/profile", {
      headers: { Authorization: `Bearer ${login.body.token}` },
    });
    assert.equal(profile.body.user.email, "mongo-patient@example.com");
    const renamed = await register("/profile", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${login.body.token}` },
      body: JSON.stringify({ name: "Updated Patient" }),
    });
    assert.equal(renamed.body.user.name, "Updated Patient");
    const currentUser = await register("/auth/me", {
      headers: { Authorization: `Bearer ${login.body.token}` },
    });
    assert.equal(currentUser.body.user.email, "mongo-patient@example.com");
    assert.equal(currentUser.body.user.name, "Updated Patient");
    assert.equal((await register("/auth/register", {
      method: "POST",
      body: JSON.stringify({ name: "Duplicate", email: "mongo-patient@example.com", password: "StrongPass123" }),
    })).status, 409);
  } finally {
    await new Promise((resolve, reject) => persistentServer.close((error) => error ? reject(error) : resolve()));
  }
});

test("Mongo repositories use the configured database and collections", async () => {
  const selections = { collections: [] };
  class FakeMongoClient {
    constructor(uri) {
      assert.equal(uri, "mongodb://test");
    }

    async connect() {}

    db(name) {
      selections.database = name;
      return {
        collection(collectionName) {
          selections.collections.push(collectionName);
          return {
            async createIndex(fields, options) {
              selections.indexes ||= [];
              selections.indexes.push({ collectionName, fields, options });
            },
          };
        },
      };
    }

    async close() {}
  }

  const repositories = await connectMongoRepositories("mongodb://test", { MongoClientClass: FakeMongoClient });
  assert.equal(selections.database, "Medlytics_Database");
  assert.equal(selections.database, userDatabaseName);
  assert.deepEqual(selections.collections, ["user", "medicine", "listing", "application_state"]);
  assert.equal(selections.collections[0], userCollectionName);
  assert.equal(selections.collections[1], medicineCollectionName);
  assert.equal(selections.collections[2], listingCollectionName);
  assert.equal(selections.collections[3], applicationStateCollectionName);
  assert.ok(selections.indexes.some((index) => index.collectionName === "user" && index.fields.email === 1 && index.options.unique));
  assert.ok(selections.indexes.some((index) => index.collectionName === "user" && index.fields.id === 1 && index.options.unique));
  assert.ok(selections.indexes.some((index) => index.collectionName === "medicine" && index.fields.id === 1 && index.options.unique));
  assert.ok(selections.indexes.some((index) => index.collectionName === "listing" && index.fields.id === 1 && index.options.unique));
  await repositories.close();
});

test("owners save medicine form data to Mongo and retain it across server restarts", async () => {
  let mongoApi = createMemoryApi();
  let mongoServer = mongoApi.server;
  await new Promise((resolve) => mongoServer.listen(0, "127.0.0.1", resolve));

  const callServer = async (server, path, { token, ...options } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    return { status: response.status, body: await response.json() };
  };
  const ownerToken = (await callServer(mongoServer, "/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "owner@medlytic.local", password: "Owner123!" }),
  })).body.token;

  try {
    const created = await callServer(mongoServer, "/owner/medicines", {
      token: ownerToken,
      method: "POST",
      body: JSON.stringify({
        name: "Mongo medicine",
        genericName: "Example ingredient",
        category: "General",
        price: "19.50",
        stock: "4",
      }),
    });
    assert.equal(created.status, 201);
    const savedMedicine = await mongoApi.medicines.findById(created.body.medicine.id);
    const savedListing = mongoApi.data.listings.find((item) => item.medicineId === created.body.medicine.id);
    assert.equal(savedMedicine.name, "Mongo medicine");
    assert.equal(savedMedicine.genericName, "Example ingredient");
    assert.equal(savedMedicine.category, "General");
    assert.equal(savedMedicine.ownerId, "user-owner");
    assert.equal(savedListing.price, 19.5);
    assert.equal(savedListing.stock, 4);
    assert.ok(savedListing.id);

    await new Promise((resolve, reject) => mongoServer.close((error) => error ? reject(error) : resolve()));
    mongoApi = createMemoryApi({ data: mongoApi.data });
    mongoServer = mongoApi.server;
    await new Promise((resolve) => mongoServer.listen(0, "127.0.0.1", resolve));

    const dashboard = await callServer(mongoServer, "/owner/dashboard", { token: ownerToken });
    const listing = dashboard.body.listings.find((item) => item.name === "Mongo medicine");
    assert.equal(listing.stock, 4);
    assert.equal(listing.price, 19.5);
    const results = await callServer(mongoServer, "/medicines?q=Mongo%20medicine");
    assert.equal(results.body.medicines[0].name, "Mongo medicine");
    const nearby = await callServer(mongoServer, "/medicines?q=Mongo%20medicine&latitude=12.9719&longitude=77.6412&radiusKm=1");
    assert.equal(nearby.body.total, 1);
    assert.equal(nearby.body.medicines[0].distanceKm, 0);
    const outsideRadius = await callServer(mongoServer, "/medicines?q=Mongo%20medicine&latitude=12.9&longitude=77.5&radiusKm=1");
    assert.equal(outsideRadius.body.total, 0);
    assert.ok((await callServer(mongoServer, "/medicines?q=Dolo%20650")).body.total > 0);
    const details = await callServer(mongoServer, `/medicines/${created.body.medicine.id}`);
    assert.equal(details.body.medicine.name, "Mongo medicine");
    assert.equal(details.body.listings[0].id, savedListing.id);
  } finally {
    if (mongoServer.listening) {
      await new Promise((resolve, reject) => mongoServer.close((error) => error ? reject(error) : resolve()));
    }
  }
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
