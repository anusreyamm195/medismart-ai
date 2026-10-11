import { createServer as httpCreateServer } from "node:http";
import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const defaultStorePath = resolve(here, "store.json");
const port = Number(process.env.PORT || 3002);
const host = process.env.HOST || "127.0.0.1";
const tokenSecret = process.env.TOKEN_SECRET || "medlytic-local-development-secret-change-before-deploy";
if (process.env.NODE_ENV === "production" && !process.env.TOKEN_SECRET) {
  throw new Error("Set TOKEN_SECRET before starting the API in production.");
}

const initialData = () => ({
  users: [
    { id: "user-admin", name: "Platform Admin", email: "admin@medlytic.local", passwordHash: hashPassword("Admin123!"), role: "admin", active: true },
    { id: "user-patient", name: "Aarav Sharma", email: "patient@medlytic.local", passwordHash: hashPassword("Patient123!"), role: "patient", active: true },
    { id: "user-owner", name: "Maya Patel", email: "owner@medlytic.local", passwordHash: hashPassword("Owner123!"), role: "owner", active: true },
  ],
  pharmacies: [
    { id: "pharmacy-green-cross", ownerId: "user-owner", name: "Green Cross Pharmacy", location: "Indiranagar, Bengaluru", address: "12 100 Feet Road, Indiranagar, Bengaluru", phone: "+91 80 4000 1001", status: "approved", rating: 4.8, createdAt: new Date().toISOString() },
    { id: "pharmacy-city-care", ownerId: null, name: "City Care Medicals", location: "Koramangala, Bengaluru", address: "80 Feet Road, Koramangala, Bengaluru", phone: "+91 80 4000 1002", status: "approved", rating: 4.5, createdAt: new Date().toISOString() },
    { id: "pharmacy-wellness", ownerId: null, name: "Wellness Drugstore", location: "Whitefield, Bengaluru", address: "Main Road, Whitefield, Bengaluru", phone: "+91 80 4000 1003", status: "approved", rating: 4.6, createdAt: new Date().toISOString() },
  ],
  medicines: [
    { id: "med-paracetamol", name: "Dolo 650", genericName: "Paracetamol 650 mg", category: "Pain relief", info: "Paracetamol is commonly used for pain and fever. Follow the package directions and avoid taking multiple products that contain paracetamol." },
    { id: "med-calpol", name: "Calpol 650", genericName: "Paracetamol 650 mg", category: "Pain relief", info: "Paracetamol is commonly used for pain and fever. Follow the package directions and avoid taking multiple products that contain paracetamol." },
    { id: "med-ibuprofen", name: "Brufen 400", genericName: "Ibuprofen 400 mg", category: "Pain relief", info: "Ibuprofen is a non-steroidal anti-inflammatory medicine. It may not be suitable for everyone; ask a clinician or pharmacist if you have other conditions or take other medicines." },
    { id: "med-cetirizine", name: "Cetzine 10", genericName: "Cetirizine 10 mg", category: "Allergy relief", info: "Cetirizine is an antihistamine used to relieve allergy symptoms. It can cause drowsiness in some people." },
    { id: "med-vitamin-c", name: "Limcee 500", genericName: "Vitamin C 500 mg", category: "Vitamins", info: "Vitamin C is a dietary supplement. Follow label directions and ask a health professional whether a supplement is right for you." },
    { id: "med-omeprazole", name: "Omez 20", genericName: "Omeprazole 20 mg", category: "Digestive health", info: "Omeprazole reduces stomach acid. Seek professional advice about persistent symptoms or long-term use." },
  ],
  listings: [
    { id: "listing-1", medicineId: "med-paracetamol", pharmacyId: "pharmacy-green-cross", price: 30, stock: 42 },
    { id: "listing-2", medicineId: "med-paracetamol", pharmacyId: "pharmacy-city-care", price: 32, stock: 18 },
    { id: "listing-3", medicineId: "med-paracetamol", pharmacyId: "pharmacy-wellness", price: 28, stock: 0 },
    { id: "listing-10", medicineId: "med-calpol", pharmacyId: "pharmacy-green-cross", price: 34, stock: 21 },
    { id: "listing-4", medicineId: "med-ibuprofen", pharmacyId: "pharmacy-green-cross", price: 45, stock: 16 },
    { id: "listing-5", medicineId: "med-ibuprofen", pharmacyId: "pharmacy-city-care", price: 42, stock: 25 },
    { id: "listing-6", medicineId: "med-cetirizine", pharmacyId: "pharmacy-city-care", price: 22, stock: 31 },
    { id: "listing-7", medicineId: "med-cetirizine", pharmacyId: "pharmacy-wellness", price: 24, stock: 12 },
    { id: "listing-8", medicineId: "med-vitamin-c", pharmacyId: "pharmacy-green-cross", price: 18, stock: 60 },
    { id: "listing-9", medicineId: "med-omeprazole", pharmacyId: "pharmacy-wellness", price: 56, stock: 9 },
  ],
  history: [],
  savedPharmacies: [],
  reservations: [],
  reports: [],
  audit: [],
});

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, expected] = (stored || "").split(":");
  if (!salt || !expected) return false;
  const actual = scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, "hex");
  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
}

function signToken(user) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({ sub: user.id, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 });
  const signature = createHmac("sha256", tokenSecret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function verifyToken(token) {
  const [header, payload, signature] = (token || "").split(".");
  if (!header || !payload || !signature) return null;
  const expected = createHmac("sha256", tokenSecret).update(`${header}.${payload}`).digest();
  const supplied = Buffer.from(signature, "base64url");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
    return decoded.exp > Date.now() ? decoded.sub : null;
  } catch {
    return null;
  }
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role, active: user.active };
}

function id(prefix) {
  return `${prefix}-${randomBytes(9).toString("hex")}`;
}

function safeEqualText(first, second) {
  const a = Buffer.from(first.toLowerCase());
  const b = Buffer.from(second.toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}

function createStore(storePath) {
  let data;
  if (existsSync(storePath)) {
    try {
      data = JSON.parse(readFileSync(storePath, "utf8"));
    } catch (error) {
      throw new Error(`Unable to read Medlytic data at ${storePath}: ${error.message}`, { cause: error });
    }
  } else {
    data = initialData();
    persist();
  }
  for (const key of ["users", "pharmacies", "medicines", "listings", "history", "savedPharmacies", "reservations", "reports", "audit"]) data[key] ||= [];
  function persist() {
    mkdirSync(dirname(storePath), { recursive: true });
    const temporaryPath = `${storePath}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify(data, null, 2), "utf8");
    renameSync(temporaryPath, storePath);
  }
  return {
    get data() { return data; },
    save() { persist(); },
  };
}

function createAppServer({ storePath = defaultStorePath } = {}) {
  const store = createStore(storePath);
  const data = store.data;

  function audit(actor, action, target) {
    data.audit.unshift({ id: id("audit"), actor, action, target, createdAt: new Date().toISOString() });
    data.audit = data.audit.slice(0, 500);
  }

  function fail(status, message) {
    const error = new Error(message);
    error.status = status;
    throw error;
  }

  async function handler(req, res) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    const send = (status, value) => {
      res.writeHead(status);
      res.end(JSON.stringify(value));
    };
    try {
      const url = new URL(req.url, "http://localhost");
      const pathname = url.pathname.replace(/\/+$/, "") || "/";
      const method = req.method || "GET";
      const body = ["POST", "PATCH", "PUT"].includes(method) ? await readBody(req) : {};
      const token = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : "";
      const userId = verifyToken(token);
      const user = userId ? data.users.find((candidate) => candidate.id === userId && candidate.active) : null;
      const requireUser = () => user || fail(401, "Please sign in to continue.");
      const requireRole = (...roles) => {
        const current = requireUser();
        if (!roles.includes(current.role)) fail(403, "You do not have permission to perform this action.");
        return current;
      };

      if (method === "GET" && pathname === "/api/health") return send(200, { status: "ok" });
      if (method === "GET" && pathname === "/api/medicines") {
        const q = (url.searchParams.get("q") || "").trim().toLowerCase();
        const location = (url.searchParams.get("location") || "").trim().toLowerCase();
        const maxPrice = url.searchParams.has("maxPrice") ? Number(url.searchParams.get("maxPrice")) : Infinity;
        const sort = url.searchParams.get("sort") || "price-asc";
        if (!Number.isFinite(maxPrice) && maxPrice !== Infinity || maxPrice < 0) fail(400, "Maximum price must be a non-negative number.");
        let listings = data.listings.flatMap((listing) => {
          const medicine = data.medicines.find((item) => item.id === listing.medicineId);
          const pharmacy = data.pharmacies.find((item) => item.id === listing.pharmacyId && item.status === "approved");
          if (!medicine || !pharmacy) return [];
          const searchable = `${medicine.name} ${medicine.genericName} ${medicine.category} ${pharmacy.name}`.toLowerCase();
          if (q && !searchable.includes(q)) return [];
          if (location && !pharmacy.location.toLowerCase().includes(location)) return [];
          if (listing.price > maxPrice) return [];
          return [{ ...pharmacySummary(pharmacy), ...medicine, id: listing.id, medicineId: medicine.id, pharmacyId: pharmacy.id, pharmacy: pharmacy.name, price: Number(listing.price), stock: Number(listing.stock) }];
        });
        if (user?.role === "patient" && q) {
          data.history.unshift({ id: id("search"), userId: user.id, query: url.searchParams.get("q").trim(), createdAt: new Date().toISOString() });
          data.history = data.history.slice(0, 3000);
          store.save();
        }
        listings.sort((a, b) => sort === "price-desc" ? b.price - a.price : sort === "rating" ? b.rating - a.rating : a.price - b.price);
        return send(200, { medicines: listings, total: listings.length });
      }
      const medicineRoute = pathname.match(/^\/api\/medicines\/([^/]+)$/);
      if (method === "GET" && medicineRoute) {
        const medicine = data.medicines.find((item) => item.id === decodeURIComponent(medicineRoute[1]));
        if (!medicine) fail(404, "Medicine not found.");
        const listings = data.listings.filter((listing) => listing.medicineId === medicine.id).flatMap((listing) => {
          const pharmacy = data.pharmacies.find((item) => item.id === listing.pharmacyId && item.status === "approved");
          return pharmacy ? [{ id: listing.id, price: Number(listing.price), stock: Number(listing.stock), ...pharmacySummary(pharmacy) }] : [];
        });
        const alternatives = data.medicines.filter((item) => item.id !== medicine.id && item.genericName === medicine.genericName).map((item) => item.name);
        return send(200, { medicine, listings, alternatives });
      }
      if (method === "GET" && pathname === "/api/pharmacies") {
        const location = (url.searchParams.get("location") || "").toLowerCase();
        return send(200, { pharmacies: data.pharmacies.filter((item) => item.status === "approved" && (!location || item.location.toLowerCase().includes(location))).map(pharmacySummary) });
      }
      if (method === "POST" && pathname === "/api/auth/register") {
        const name = text(body.name, "Name", 80);
        const email = validEmail(body.email);
        const password = validPassword(body.password);
        const role = body.role || "patient";
        if (!["patient", "owner"].includes(role)) fail(400, "Choose patient or medical store owner.");
        if (data.users.some((item) => safeEqualText(item.email, email))) fail(409, "An account with that email already exists.");
        const newUser = { id: id("user"), name, email, passwordHash: hashPassword(password), role, active: true };
        data.users.push(newUser);
        let message = "Your account is ready.";
        if (role === "owner") {
          const pharmacy = { id: id("pharmacy"), ownerId: newUser.id, name: text(body.pharmacyName, "Pharmacy name", 100), location: text(body.location, "Location", 160), address: text(body.address || body.location, "Address", 200), phone: text(body.phone || "Not provided", "Phone", 32), status: "pending", rating: 0, createdAt: new Date().toISOString() };
          data.pharmacies.push(pharmacy);
          message = "Your account is ready. Your pharmacy registration is awaiting admin approval.";
        }
        audit(newUser.email, "account.registered", newUser.role);
        store.save();
        return send(201, { token: signToken(newUser), user: publicUser(newUser), message });
      }
      if (method === "POST" && pathname === "/api/auth/login") {
        const email = validEmail(body.email);
        const account = data.users.find((item) => safeEqualText(item.email, email));
        if (!account || !verifyPassword(String(body.password || ""), account.passwordHash)) fail(401, "Email or password is incorrect.");
        if (!account.active) fail(403, "This account has been suspended. Contact the platform administrator.");
        return send(200, { token: signToken(account), user: publicUser(account) });
      }
      if (method === "GET" && pathname === "/api/auth/me") {
        return send(200, { user: publicUser(requireUser()) });
      }
      if (method === "GET" && pathname === "/api/profile") {
        const current = requireUser();
        return send(200, { user: publicUser(current) });
      }
      if (method === "PATCH" && pathname === "/api/profile") {
        const current = requireUser();
        if (body.name !== undefined) current.name = text(body.name, "Name", 80);
        store.save();
        return send(200, { user: publicUser(current) });
      }
      if (method === "GET" && pathname === "/api/search-history") {
        const current = requireRole("patient");
        return send(200, { history: data.history.filter((item) => item.userId === current.id).slice(0, 100) });
      }
      if (method === "GET" && pathname === "/api/saved-pharmacies") {
        const current = requireRole("patient");
        const pharmacies = data.savedPharmacies.filter((item) => item.userId === current.id).flatMap((saved) => {
          const pharmacy = data.pharmacies.find((item) => item.id === saved.pharmacyId && item.status === "approved");
          return pharmacy ? [pharmacySummary(pharmacy)] : [];
        });
        return send(200, { pharmacies });
      }
      if (method === "POST" && pathname === "/api/saved-pharmacies") {
        const current = requireRole("patient");
        const pharmacy = data.pharmacies.find((item) => item.id === body.pharmacyId && item.status === "approved");
        if (!pharmacy) fail(404, "Pharmacy not found.");
        if (!data.savedPharmacies.some((item) => item.userId === current.id && item.pharmacyId === pharmacy.id)) data.savedPharmacies.push({ userId: current.id, pharmacyId: pharmacy.id, createdAt: new Date().toISOString() });
        store.save();
        return send(201, { message: "Pharmacy saved." });
      }
      if (method === "DELETE" && pathname.startsWith("/api/saved-pharmacies/")) {
        const current = requireRole("patient");
        const pharmacyId = decodeURIComponent(pathname.split("/").pop());
        data.savedPharmacies = data.savedPharmacies.filter((item) => item.userId !== current.id || item.pharmacyId !== pharmacyId);
        store.save();
        return send(200, { message: "Saved pharmacy removed." });
      }
      if (method === "POST" && pathname === "/api/reservations") {
        const current = requireRole("patient");
        const listing = data.listings.find((item) => item.id === body.listingId);
        if (!listing) fail(404, "Medicine listing not found.");
        const quantity = Number(body.quantity ?? 1);
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) fail(400, "Quantity must be between 1 and 20.");
        if (listing.stock < quantity) fail(409, "There is not enough stock to reserve that quantity.");
        const medicine = data.medicines.find((item) => item.id === listing.medicineId);
        const pharmacy = data.pharmacies.find((item) => item.id === listing.pharmacyId && item.status === "approved");
        if (!pharmacy) fail(404, "Pharmacy not found.");
        const reservation = { id: id("reservation"), userId: current.id, pharmacyId: pharmacy.id, listingId: listing.id, medicine: medicine.name, quantity, status: "pending", createdAt: new Date().toISOString() };
        data.reservations.unshift(reservation);
        audit(current.email, "reservation.created", reservation.id);
        store.save();
        return send(201, { message: `Request sent to ${pharmacy.name}. The pharmacy will confirm availability.`, reservation: { id: reservation.id, status: reservation.status } });
      }
      const ratingRoute = pathname.match(/^\/api\/pharmacies\/([^/]+)\/ratings$/);
      if (method === "POST" && ratingRoute) {
        const current = requireRole("patient");
        const pharmacy = data.pharmacies.find((item) => item.id === decodeURIComponent(ratingRoute[1]) && item.status === "approved");
        if (!pharmacy) fail(404, "Pharmacy not found.");
        const rating = Number(body.rating);
        if (!Number.isInteger(rating) || rating < 1 || rating > 5) fail(400, "Rating must be a whole number from 1 to 5.");
        if (!data.ratings) data.ratings = [];
        if (data.ratings.some((item) => item.userId === current.id && item.pharmacyId === pharmacy.id)) fail(409, "You have already rated this pharmacy.");
        data.ratings.push({ id: id("rating"), userId: current.id, pharmacyId: pharmacy.id, rating, createdAt: new Date().toISOString() });
        pharmacy.rating = Number((data.ratings.filter((item) => item.pharmacyId === pharmacy.id).reduce((sum, item) => sum + item.rating, 0) / data.ratings.filter((item) => item.pharmacyId === pharmacy.id).length).toFixed(1));
        store.save();
        return send(201, { rating: pharmacy.rating });
      }
      if (method === "POST" && pathname === "/api/reports") {
        const current = requireUser();
        const report = { id: id("report"), userId: current.id, reporter: current.email, type: text(body.type, "Report type", 50), subject: text(body.subject, "Subject", 120), details: text(body.details, "Details", 1000), status: "open", createdAt: new Date().toISOString() };
        data.reports.unshift(report);
        audit(current.email, "report.created", report.id);
        store.save();
        return send(201, { report: { id: report.id, status: report.status } });
      }
      if (pathname === "/api/owner/dashboard" && method === "GET") {
        const current = requireRole("owner");
        const pharmacy = data.pharmacies.find((item) => item.ownerId === current.id);
        if (!pharmacy) fail(404, "No pharmacy is associated with this account.");
        const listings = data.listings.filter((item) => item.pharmacyId === pharmacy.id).map((item) => ({ ...data.medicines.find((medicine) => medicine.id === item.medicineId), ...item }));
        const reservations = data.reservations.filter((item) => item.pharmacyId === pharmacy.id).map((item) => ({ ...item, customer: data.users.find((candidate) => candidate.id === item.userId)?.name || "Customer" }));
        return send(200, { pharmacy, listings, reservations, stats: { listingCount: listings.length, inStock: listings.filter((item) => item.stock > 0).length, rating: pharmacy.rating || 0 } });
      }
      if (pathname === "/api/owner/profile" && method === "GET") {
        const current = requireRole("owner");
        const pharmacy = data.pharmacies.find((item) => item.ownerId === current.id);
        if (!pharmacy) fail(404, "No pharmacy is associated with this account.");
        return send(200, { pharmacy });
      }
      if (pathname === "/api/owner/profile" && method === "PATCH") {
        const current = requireRole("owner");
        const pharmacy = data.pharmacies.find((item) => item.ownerId === current.id);
        if (!pharmacy) fail(404, "No pharmacy is associated with this account.");
        if (body.name !== undefined) pharmacy.name = text(body.name, "Pharmacy name", 100);
        if (body.location !== undefined) pharmacy.location = text(body.location, "Location", 160);
        if (body.address !== undefined) pharmacy.address = text(body.address, "Address", 200);
        if (body.phone !== undefined) pharmacy.phone = text(body.phone, "Phone", 32);
        store.save();
        return send(200, { pharmacy });
      }
      if (pathname === "/api/owner/medicines" && method === "POST") {
        const current = requireRole("owner");
        const pharmacy = data.pharmacies.find((item) => item.ownerId === current.id);
        if (!pharmacy) fail(404, "No pharmacy is associated with this account.");
        const medicine = { id: id("medicine"), name: text(body.name, "Medicine name", 100), genericName: text(body.genericName, "Generic name", 120), category: text(body.category, "Category", 80), info: "" };
        const price = positiveNumber(body.price, "Price", true);
        const stock = positiveNumber(body.stock, "Stock", false);
        data.medicines.push(medicine);
        data.listings.push({ id: id("listing"), medicineId: medicine.id, pharmacyId: pharmacy.id, price, stock });
        audit(current.email, "inventory.created", medicine.name);
        store.save();
        return send(201, { medicine });
      }
      const ownerMedicineRoute = pathname.match(/^\/api\/owner\/medicines\/([^/]+)$/);
      if (ownerMedicineRoute && method === "PATCH") {
        const current = requireRole("owner");
        const pharmacy = data.pharmacies.find((item) => item.ownerId === current.id);
        const listing = data.listings.find((item) => item.id === decodeURIComponent(ownerMedicineRoute[1]) && item.pharmacyId === pharmacy?.id);
        if (!listing) fail(404, "Inventory item not found.");
        if (body.price !== undefined) listing.price = positiveNumber(body.price, "Price", true);
        if (body.stock !== undefined) listing.stock = positiveNumber(body.stock, "Stock", false);
        const medicine = data.medicines.find((item) => item.id === listing.medicineId);
        if (body.name !== undefined) medicine.name = text(body.name, "Medicine name", 100);
        if (body.genericName !== undefined) medicine.genericName = text(body.genericName, "Generic name", 120);
        if (body.category !== undefined) medicine.category = text(body.category, "Category", 80);
        audit(current.email, "inventory.updated", medicine.name);
        store.save();
        return send(200, { listing });
      }
      if (ownerMedicineRoute && method === "DELETE") {
        const current = requireRole("owner");
        const pharmacy = data.pharmacies.find((item) => item.ownerId === current.id);
        const listing = data.listings.find((item) => item.id === decodeURIComponent(ownerMedicineRoute[1]) && item.pharmacyId === pharmacy?.id);
        if (!listing) fail(404, "Inventory item not found.");
        data.listings = data.listings.filter((item) => item.id !== listing.id);
        store.save();
        return send(200, { message: "Medicine listing removed." });
      }
      if (pathname === "/api/admin/dashboard" && method === "GET") {
        requireRole("admin");
        return send(200, { stats: { users: data.users.length, pharmacies: data.pharmacies.length, pendingPharmacies: data.pharmacies.filter((item) => item.status === "pending").length, openReports: data.reports.filter((item) => item.status === "open").length } });
      }
      if (pathname === "/api/admin/pharmacies" && method === "GET") {
        requireRole("admin");
        return send(200, { pharmacies: data.pharmacies.map((pharmacy) => ({ ...pharmacy, ownerName: data.users.find((item) => item.id === pharmacy.ownerId)?.name || "—", ownerEmail: data.users.find((item) => item.id === pharmacy.ownerId)?.email || "—" })) });
      }
      const adminPharmacyRoute = pathname.match(/^\/api\/admin\/pharmacies\/([^/]+)$/);
      if (adminPharmacyRoute && method === "PATCH") {
        const current = requireRole("admin");
        if (!["approved", "rejected", "pending"].includes(body.status)) fail(400, "Status must be approved, rejected, or pending.");
        const pharmacy = data.pharmacies.find((item) => item.id === decodeURIComponent(adminPharmacyRoute[1]));
        if (!pharmacy) fail(404, "Pharmacy not found.");
        pharmacy.status = body.status;
        audit(current.email, `pharmacy.${body.status}`, pharmacy.name);
        store.save();
        return send(200, { pharmacy });
      }
      if (pathname === "/api/admin/users" && method === "GET") {
        const current = requireRole("admin");
        const users = data.users.map((account) => {
          const publicAccount = { ...account };
          delete publicAccount.passwordHash;
          return publicAccount;
        });
        return send(200, { currentAdminId: current.id, users });
      }
      const adminUserRoute = pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
      if (adminUserRoute && method === "PATCH") {
        const current = requireRole("admin");
        const account = data.users.find((item) => item.id === decodeURIComponent(adminUserRoute[1]));
        if (!account) fail(404, "Account not found.");
        if (account.id === current.id && body.active === false) fail(400, "You cannot suspend your own admin account.");
        if (typeof body.active !== "boolean") fail(400, "Active must be true or false.");
        account.active = body.active;
        audit(current.email, account.active ? "account.activated" : "account.suspended", account.email);
        store.save();
        const publicAccount = { ...account };
        delete publicAccount.passwordHash;
        return send(200, { user: publicAccount });
      }
      if (pathname === "/api/admin/reports" && method === "GET") {
        requireRole("admin");
        return send(200, { reports: data.reports.map((report) => ({ ...report, reporter: report.reporter || data.users.find((item) => item.id === report.userId)?.email || "Unknown" })) });
      }
      const adminReportRoute = pathname.match(/^\/api\/admin\/reports\/([^/]+)$/);
      if (adminReportRoute && method === "PATCH") {
        const current = requireRole("admin");
        if (!["open", "resolved", "dismissed"].includes(body.status)) fail(400, "Status must be open, resolved, or dismissed.");
        const report = data.reports.find((item) => item.id === decodeURIComponent(adminReportRoute[1]));
        if (!report) fail(404, "Report not found.");
        report.status = body.status;
        audit(current.email, `report.${body.status}`, report.id);
        store.save();
        return send(200, { report });
      }
      if (pathname === "/api/admin/audit" && method === "GET") {
        requireRole("admin");
        return send(200, { records: data.audit.slice(0, 200) });
      }
      return send(404, { error: "API endpoint not found." });
    } catch (error) {
      if (error.status) return send(error.status, { error: error.message });
      console.error("Medlytic API request failed:", error);
      return send(500, { error: "An unexpected server error occurred." });
    }
  }

  return httpCreateServer((req, res) => { handler(req, res); });
}

function pharmacySummary(pharmacy) {
  return { pharmacyId: pharmacy.id, pharmacy: pharmacy.name, name: pharmacy.name, location: pharmacy.location, address: pharmacy.address, phone: pharmacy.phone, rating: Number(pharmacy.rating || 0) };
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) {
      const error = new Error("Request body is too large.");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) failBody();
    return body;
  } catch (error) {
    if (error.status) throw error;
    const invalid = new Error("Request body must be valid JSON.");
    invalid.status = 400;
    throw invalid;
  }
}

function failBody() {
  const error = new Error("Request body must be a JSON object.");
  error.status = 400;
  throw error;
}

function text(value, label, maxLength) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) throw Object.assign(new Error(`${label} is required and must be at most ${maxLength} characters.`), { status: 400 });
  return value.trim();
}

function validEmail(value) {
  const email = text(value, "Email", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new Error("Enter a valid email address."), { status: 400 });
  return email;
}

function validPassword(value) {
  if (typeof value !== "string" || value.length < 8 || value.length > 128) throw Object.assign(new Error("Password must be between 8 and 128 characters."), { status: 400 });
  return value;
}

function positiveNumber(value, label, allowZero) {
  const number = Number(value);
  if (!Number.isFinite(number) || (allowZero ? number < 0 : !Number.isInteger(number) || number < 0)) throw Object.assign(new Error(`${label} must be a valid ${allowZero ? "non-negative number" : "non-negative whole number"}.`), { status: 400 });
  return number;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createAppServer();
  server.listen(port, host, () => console.log(`Medlytic API listening on http://${host}:${port}`));
}

export { createAppServer };
