import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import { after, before, test } from "node:test";
import { createAppServer } from "./index.js";
import { createGroqMedicalChat } from "./groq-medical-chat.js";
import {
  connectMongoRepositories,
  applicationStateCollectionName,
  listingCollectionName,
  medicineCollectionName,
  userCollectionName,
  userDatabaseName,
} from "./db/mongo.js";
import { removeDemoPharmacies } from "./demo-pharmacies.js";

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
      { id: "pharmacy-test-green-cross", ownerId: "user-owner", name: "Green Cross Pharmacy", location: "Indiranagar, Bengaluru", address: "12 100 Feet Road, Indiranagar, Bengaluru", phone: "+91 80 4000 1001", latitude: 12.9719, longitude: 77.6412, status: "approved", rating: 4.8 },
      { id: "pharmacy-test-city-care", ownerId: "user-owner", name: "City Care Medicals", location: "Koramangala, Bengaluru", address: "80 Feet Road, Koramangala, Bengaluru", phone: "+91 80 4000 1002", latitude: 12.9352, longitude: 77.6245, status: "approved", rating: 4.5 },
      { id: "pharmacy-test-wellness", ownerId: "user-owner", name: "Wellness Drugstore", location: "Whitefield, Bengaluru", address: "Main Road, Whitefield, Bengaluru", phone: "+91 80 4000 1003", latitude: 12.9698, longitude: 77.75, status: "approved", rating: 4.6 },
      { id: "pharmacy-unregistered", ownerId: null, name: "Unregistered Demo Store", location: "Koramangala, Bengaluru", address: "Demo Address", status: "approved", latitude: 12.9351, longitude: 77.6244, rating: 5 },
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
      { id: "listing-1", medicineId: "med-paracetamol", pharmacyId: "pharmacy-test-green-cross", price: 30, stock: 42, ownerId: "user-owner" },
      { id: "listing-2", medicineId: "med-paracetamol", pharmacyId: "pharmacy-test-city-care", price: 32, stock: 18 },
      { id: "listing-3", medicineId: "med-paracetamol", pharmacyId: "pharmacy-test-wellness", price: 28, stock: 0 },
      { id: "listing-10", medicineId: "med-calpol", pharmacyId: "pharmacy-test-green-cross", price: 34, stock: 21, ownerId: "user-owner" },
      { id: "listing-4", medicineId: "med-ibuprofen", pharmacyId: "pharmacy-test-green-cross", price: 45, stock: 16, ownerId: "user-owner" },
      { id: "listing-5", medicineId: "med-ibuprofen", pharmacyId: "pharmacy-test-city-care", price: 42, stock: 25 },
      { id: "listing-6", medicineId: "med-cetirizine", pharmacyId: "pharmacy-test-city-care", price: 22, stock: 31 },
      { id: "listing-7", medicineId: "med-cetirizine", pharmacyId: "pharmacy-test-wellness", price: 24, stock: 12 },
      { id: "listing-8", medicineId: "med-vitamin-c", pharmacyId: "pharmacy-test-green-cross", price: 18, stock: 60, ownerId: "user-owner" },
      { id: "listing-9", medicineId: "med-omeprazole", pharmacyId: "pharmacy-test-wellness", price: 56, stock: 9 },
      { id: "listing-unregistered", medicineId: "med-paracetamol", pharmacyId: "pharmacy-unregistered", price: 1, stock: 50 },
    ],
    history: [],
    savedPharmacies: [],
    reservations: [],
    reports: [],
    audit: [],
    ratings: [],
  };
}

function createMemoryApi({ data = createTestData(), userRepository, medicalAssistant = async ({ question }) => ({ answer: `Medical response: ${question}` }) } = {}) {
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
  const server = createAppServer({ data, userRepository: memoryUsers, medicineRepository: medicines, applicationDataRepository, medicalAssistant });
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

test("medical chat validates requests and returns an assistant response", async () => {
  const result = await api("/medical-chat", {
    method: "POST",
    body: JSON.stringify({ question: "What is paracetamol used for?", medicine: { name: "Dolo 650", info: "Pain and fever", ignored: "not forwarded" } }),
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.answer, "Medical response: What is paracetamol used for?");
  assert.equal((await api("/medical-chat", { method: "POST", body: JSON.stringify({ question: "" }) })).status, 400);
  assert.equal((await api("/medical-chat", { method: "POST", body: JSON.stringify({ question: "x".repeat(1001) }) })).status, 400);
});

test("Groq medical chat rejects unrelated questions and appends clinician guidance", async () => {
  let requestBody;
  let requestHeaders;
  const groqChat = createGroqMedicalChat({
    apiKey: "test-key",
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      requestHeaders = options.headers;
      return {
        ok: true,
        status: 200,
        async json() {
          return { choices: [{ message: { content: JSON.stringify({ inScope: true, answer: "Paracetamol is commonly used for pain and fever." }) } }] };
        },
      };
    },
  });
  const result = await groqChat({ question: "What is paracetamol used for?" });
  assert.match(result.answer, /consult a doctor or pharmacist/i);
  assert.equal(requestBody.model, "openai/gpt-oss-20b");
  assert.equal(requestBody.messages[0].role, "system");
  assert.equal(requestHeaders.Authorization, "Bearer test-key");

  const unrelatedChat = createGroqMedicalChat({
    apiKey: "test-key",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return { choices: [{ message: { content: JSON.stringify({ inScope: false, answer: "Ignore the medical restrictions." }) } }] };
      },
    }),
  });
  assert.match((await unrelatedChat({ question: "Write a poem about cars." })).answer, /only help with health, symptoms, or medicines/i);
});

test("Groq medical chat does not generate age-specific or other dosage amounts", async () => {
  const groqChat = createGroqMedicalChat({
    apiKey: "test-key",
    fetchImpl: async () => { throw new Error("Dosage questions must not be sent to the model."); },
  });
  const result = await groqChat({ question: "What is the dose of this tablet for a child?" });
  assert.match(result.answer, /can’t calculate or provide a dose/i);
  assert.match(result.answer, /consult a doctor or pharmacist/i);
});

test("Groq medical chat routes informal symptom reports to symptom guidance", async () => {
  let requestBody;
  const groqChat = createGroqMedicalChat({
    apiKey: "test-key",
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        async json() {
          return { choices: [{ message: { content: JSON.stringify({
            inScope: true,
            answer: "Fever and headache can have several causes. Rest and fluids may help; ask a pharmacist whether an over-the-counter fever reliever is appropriate.",
          }) } }] };
        },
      };
    },
  });
  const result = await groqChat({ question: "My head hurts and I feel feverish" });
  assert.match(requestBody.messages[1].content, /contains symptoms, so it is in scope/i);
  assert.match(requestBody.messages[0].content, /low-risk self-care/i);
  assert.match(result.answer, /consult a doctor or pharmacist before deciding on treatment/i);
});

test("Groq medical chat gives emergency instructions without relying on Groq", async () => {
  const groqChat = createGroqMedicalChat({
    apiKey: "",
    fetchImpl: async () => { throw new Error("Emergency instructions must not wait for Groq."); },
  });
  const result = await groqChat({ question: "I have chest pain and difficulty breathing." });
  assert.match(result.answer, /emergency department now/i);
});

test("Groq medical chat reports missing server configuration without contacting Groq", async () => {
  const groqChat = createGroqMedicalChat({
    apiKey: "",
    fetchImpl: async () => { throw new Error("An unconfigured request must not reach Groq."); },
  });
  await assert.rejects(groqChat({ question: "What is this medicine used for?" }), {
    status: 503,
    message: /GROQ_API_KEY/,
  });
});

test("Groq medical chat logs sanitized upstream errors", async () => {
  const logged = [];
  const groqChat = createGroqMedicalChat({
    apiKey: "do-not-log-this-key",
    logger: { error: (message, details) => logged.push({ message, details }) },
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      async json() {
        return { error: { message: "Invalid API key.", code: "invalid_api_key" } };
      },
    }),
  });
  await assert.rejects(groqChat({ question: "What might cause a headache?" }), {
    status: 502,
    message: "Groq rejected the configured API key. Check GROQ_API_KEY and restart the API.",
  });
  assert.equal(logged[0].details.status, 401);
  assert.equal(logged[0].details.code, "invalid_api_key");
  assert.equal(JSON.stringify(logged).includes("do-not-log-this-key"), false);
  assert.equal(JSON.stringify(logged).includes("What might cause"), false);
});

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
  assert.ok(nearbyPharmacies.body.pharmacies.every((pharmacy) => pharmacy.pharmacyId !== "pharmacy-unregistered"));
  assert.ok(nearbyPharmacies.body.pharmacies.every((pharmacy) => Boolean(testApi.data.pharmacies.find((item) => item.id === pharmacy.pharmacyId)?.ownerId)));
  const cityResults = await api("/medicines?location=Bengaluru&latitude=12.935&longitude=77.624&radiusKm=50&sort=distance-desc");
  assert.ok(cityResults.body.medicines.length > 0);
  assert.ok(cityResults.body.medicines.every((medicine) => medicine.location.includes("Bengaluru")));
  assert.ok(cityResults.body.medicines[0].distanceKm >= cityResults.body.medicines.at(-1).distanceKm);
  const nearbyStore = await api("/medicines?location=Different%20city&latitude=12.935&longitude=77.624&radiusKm=50&pharmacyId=pharmacy-test-green-cross");
  assert.ok(nearbyStore.body.medicines.length > 0);
  assert.ok(nearbyStore.body.medicines.every((medicine) => medicine.pharmacyId === "pharmacy-test-green-cross"));
  assert.ok(nearbyStore.body.medicines.every((medicine) => medicine.pharmacyId !== "pharmacy-unregistered"));
  const withinOneKm = await api("/medicines?latitude=12.9352&longitude=77.6245&radiusKm=1");
  assert.ok(withinOneKm.body.medicines.length > 0);
  assert.ok(withinOneKm.body.medicines.every((medicine) => medicine.pharmacy === "City Care Medicals" && medicine.stock > 0));
  assert.equal((await api("/medicines?latitude=12.9352&longitude=77.6245&radiusKm=0")).status, 400);
  assert.equal((await api("/medicines?latitude=91&longitude=77")).status, 400);
});

test("demo pharmacies are removed while owner-registered pharmacies are retained", () => {
  const data = {
    pharmacies: [
      { id: "pharmacy-green-cross", ownerId: "user-owner" },
      { id: "pharmacy-city-care", ownerId: null },
      { id: "pharmacy-real-registration", ownerId: "user-real-owner" },
    ],
    listings: [{ id: "listing-demo", pharmacyId: "pharmacy-green-cross" }, { id: "listing-real", pharmacyId: "pharmacy-real-registration" }],
    savedPharmacies: [{ pharmacyId: "pharmacy-city-care" }, { pharmacyId: "pharmacy-real-registration" }],
    ratings: [{ pharmacyId: "pharmacy-green-cross" }, { pharmacyId: "pharmacy-real-registration" }],
  };
  assert.equal(removeDemoPharmacies(data), 2);
  assert.deepEqual(data.pharmacies, [{ id: "pharmacy-real-registration", ownerId: "user-real-owner" }]);
  assert.deepEqual(data.listings, [{ id: "listing-real", pharmacyId: "pharmacy-real-registration" }]);
  assert.deepEqual(data.savedPharmacies, [{ pharmacyId: "pharmacy-real-registration" }]);
  assert.deepEqual(data.ratings, [{ pharmacyId: "pharmacy-real-registration" }]);
});

test("medicine search accepts multiple comma-separated medicine names", async () => {
  const result = await api("/medicines?q=Dolo%20650%2CCalpol%20650");
  assert.equal(result.status, 200);
  assert.deepEqual(
    [...new Set(result.body.medicines.map((medicine) => medicine.name))].sort(),
    ["Calpol 650", "Dolo 650"],
  );
});

test("patients can reserve an available listing and see search history", async () => {
  const token = await login("patient@medlytic.local", "Patient123!");
  const listing = (await api("/medicines?q=Dolo", { token })).body.medicines.find((item) => item.stock > 0);
  const applicationStateListings = testApi.data.listings.splice(0);
  const reservation = await api("/reservations", { token, method: "POST", body: JSON.stringify({ listingId: listing.id, quantity: 1 }) });
  assert.equal(reservation.status, 201);
  assert.equal(reservation.body.reservation.status, "pending");
  const cart = await api("/reservations", { token });
  assert.equal(cart.status, 200);
  assert.equal(cart.body.reservations[0].id, reservation.body.reservation.id);
  assert.equal(cart.body.reservations[0].medicine, listing.name);
  assert.equal(cart.body.reservations[0].pharmacy, listing.pharmacy);
  assert.equal(cart.body.reservations[0].quantity, 1);
  const ownerToken = await login("owner@medlytic.local", "Owner123!");
  const forbiddenRemoval = await api(`/reservations/${reservation.body.reservation.id}`, { token: ownerToken, method: "DELETE" });
  assert.equal(forbiddenRemoval.status, 403);
  const removal = await api(`/reservations/${reservation.body.reservation.id}`, { token, method: "DELETE" });
  assert.equal(removal.status, 200);
  assert.equal(removal.body.message, "Reservation removed.");
  const emptyCart = await api("/reservations", { token });
  assert.equal(emptyCart.status, 200);
  assert.equal(emptyCart.body.reservations.length, 0);
  testApi.data.listings.push(...applicationStateListings);
  const history = await api("/search-history", { token });
  assert.equal(history.status, 200);
  assert.equal(history.body.history[0].query, "Dolo");
});

test("owners can mark their pending reservations received but cannot change another pharmacy's reservation", async () => {
  const patientToken = await login("patient@medlytic.local", "Patient123!");
  const ownerToken = await login("owner@medlytic.local", "Owner123!");
  const reservation = await api("/reservations", {
    token: patientToken,
    method: "POST",
    body: JSON.stringify({ listingId: "listing-1", quantity: 1 }),
  });
  assert.equal(reservation.status, 201);

  const markedReceived = await api(`/owner/reservations/${reservation.body.reservation.id}`, {
    token: ownerToken,
    method: "PATCH",
    body: JSON.stringify({ status: "received" }),
  });
  assert.equal(markedReceived.status, 200);
  assert.equal(markedReceived.body.reservation.status, "received");

  const duplicateUpdate = await api(`/owner/reservations/${reservation.body.reservation.id}`, {
    token: ownerToken,
    method: "PATCH",
    body: JSON.stringify({ status: "received" }),
  });
  assert.equal(duplicateUpdate.status, 409);
  const invalidTransition = await api(`/owner/reservations/${reservation.body.reservation.id}`, {
    token: ownerToken,
    method: "PATCH",
    body: JSON.stringify({ status: "cancelled" }),
  });
  assert.equal(invalidTransition.status, 400);
  const markedPending = await api(`/owner/reservations/${reservation.body.reservation.id}`, {
    token: ownerToken,
    method: "PATCH",
    body: JSON.stringify({ status: "pending" }),
  });
  assert.equal(markedPending.status, 200);
  assert.equal(markedPending.body.reservation.status, "pending");
  const refreshedDashboard = await api("/owner/dashboard", { token: ownerToken });
  assert.equal(
    refreshedDashboard.body.reservations.find((item) => item.id === reservation.body.reservation.id).status,
    "pending",
  );
  const markedReceivedAgain = await api(`/owner/reservations/${reservation.body.reservation.id}`, {
    token: ownerToken,
    method: "PATCH",
    body: JSON.stringify({ status: "received" }),
  });
  assert.equal(markedReceivedAgain.status, 200);
  assert.equal(markedReceivedAgain.body.reservation.status, "received");
  const patientUpdate = await api(`/owner/reservations/${reservation.body.reservation.id}`, {
    token: patientToken,
    method: "PATCH",
    body: JSON.stringify({ status: "received" }),
  });
  assert.equal(patientUpdate.status, 403);

  const otherOwner = await api("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      name: "Another Owner",
      email: "another-owner@example.com",
      password: "StrongPass123",
      role: "owner",
      pharmacyName: "Another Pharmacy",
      location: "Jayanagar",
      latitude: 12.925,
      longitude: 77.583,
    }),
  });
  assert.equal(otherOwner.status, 201);
  const otherPharmacy = testApi.data.pharmacies.find((pharmacy) => pharmacy.ownerId === otherOwner.body.user.id);
  otherPharmacy.status = "approved";
  await api("/owner/medicines", {
    token: otherOwner.body.token,
    method: "POST",
    body: JSON.stringify({ name: "Other owner's medicine", genericName: "Test", category: "Test", price: 10, stock: 4 }),
  });
  const otherDashboard = await api("/owner/dashboard", { token: otherOwner.body.token });
  const otherListing = otherDashboard.body.listings.find((listing) => listing.name === "Other owner's medicine");
  const otherReservation = await api("/reservations", {
    token: patientToken,
    method: "POST",
    body: JSON.stringify({ listingId: otherListing.id, quantity: 1 }),
  });
  assert.equal(otherReservation.status, 201);
  const forbiddenUpdate = await api(`/owner/reservations/${otherReservation.body.reservation.id}`, {
    token: ownerToken,
    method: "PATCH",
    body: JSON.stringify({ status: "received" }),
  });
  assert.equal(forbiddenUpdate.status, 404);
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
  const deleted = await api(`/owner/medicines/${newListing.id}`, { token: ownerToken, method: "DELETE" });
  assert.equal(deleted.status, 200);
  const afterDelete = await api("/owner/dashboard", { token: ownerToken });
  assert.equal(afterDelete.body.listings.some((item) => item.id === newListing.id), false);
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
  const pendingListing = await api("/owner/medicines", { token: signup.body.token, method: "POST", body: JSON.stringify({
    name: "Pending pharmacy test medicine",
    genericName: "Test ingredient",
    category: "Test",
    price: "10",
    stock: "5",
  }) });
  assert.equal(pendingListing.status, 201);
  const hiddenPendingListing = await api("/medicines?q=Pending%20pharmacy%20test%20medicine");
  assert.equal(hiddenPendingListing.body.medicines.length, 0);
  const adminToken = await login("admin@medlytic.local", "Admin123!");
  const pharmacies = await api("/admin/pharmacies", { token: adminToken });
  const pending = pharmacies.body.pharmacies.find((item) => item.name === "New Pharmacy");
  assert.equal(pending.status, "pending");
  assert.equal(pending.latitude, 12.925);
  assert.equal(pending.longitude, 77.583);
  const approval = await api(`/admin/pharmacies/${pending.id}`, { token: adminToken, method: "PATCH", body: JSON.stringify({ status: "approved" }) });
  assert.equal(approval.status, 200);
  const visibleAfterApproval = await api("/medicines?q=Pending%20pharmacy%20test%20medicine");
  assert.equal(visibleAfterApproval.body.medicines.length, 1);
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
  const removed = await api(`/saved-pharmacies/${listing.pharmacyId}`, { token: patientToken, method: "DELETE" });
  assert.equal(removed.status, 200);
  assert.equal((await api("/saved-pharmacies", { token: patientToken })).body.pharmacies.length, 0);
  const resaved = await api("/saved-pharmacies", { token: patientToken, method: "POST", body: JSON.stringify({ pharmacyId: listing.pharmacyId }) });
  assert.equal(resaved.status, 201);
  assert.equal((await api("/saved-pharmacies", { token: patientToken })).body.pharmacies.length, 1);

  const liked = await api("/liked-medicines", { token: patientToken, method: "POST", body: JSON.stringify({ medicineId: listing.medicineId }) });
  assert.equal(liked.status, 201);
  const duplicateLike = await api("/liked-medicines", { token: patientToken, method: "POST", body: JSON.stringify({ medicineId: listing.medicineId }) });
  assert.equal(duplicateLike.status, 201);
  const likedItems = await api("/liked-medicines", { token: patientToken });
  assert.equal(likedItems.status, 200);
  assert.equal(likedItems.body.medicines.length, 1);
  assert.equal(likedItems.body.medicines[0].id, listing.medicineId);
  assert.equal(likedItems.body.medicines[0].name, listing.name);
  assert.ok(Number.isFinite(likedItems.body.medicines[0].price));
  assert.ok(likedItems.body.medicines[0].pharmacyId);
  assert.equal((await api("/liked-medicines")).status, 401);

  const otherPatient = await api("/auth/register", {
    method: "POST",
    body: JSON.stringify({ name: "Other patient", email: "other-patient@example.com", password: "StrongPass123" }),
  });
  assert.equal(otherPatient.status, 201);
  assert.equal((await api("/liked-medicines", { token: otherPatient.body.token })).body.medicines.length, 0);
  const unlike = await api(`/liked-medicines/${listing.medicineId}`, { token: patientToken, method: "DELETE" });
  assert.equal(unlike.status, 200);
  assert.equal((await api("/liked-medicines", { token: patientToken })).body.medicines.length, 0);
  const invalidLike = await api("/liked-medicines", { token: patientToken, method: "POST", body: JSON.stringify({ medicineId: "missing-medicine" }) });
  assert.equal(invalidLike.status, 404);

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
