import { createServer as httpCreateServer } from "node:http";
import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connectMongoRepositories } from "./db/mongo.js";
import { createGroqMedicalChat } from "./groq-medical-chat.js";
import { handleAuthRoute } from "./routes/auth.routes.js";
import { handleMedicineRoute } from "./routes/medicine.routes.js";

const port = Number(process.env.PORT || 3002);
const host = process.env.HOST || "127.0.0.1";
const tokenSecret = process.env.TOKEN_SECRET || "medlytic-local-development-secret-change-before-deploy";
if (process.env.NODE_ENV === "production" && !process.env.TOKEN_SECRET) {
  throw new Error("Set TOKEN_SECRET before starting the API in production.");
}

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

function createAppServer({
  data: applicationData,
  userRepository: persistentUsers,
  medicineRepository,
  applicationDataRepository,
  medicalAssistant = createGroqMedicalChat(),
} = {}) {
  if (!applicationData || !persistentUsers || !medicineRepository || !applicationDataRepository) {
    throw new Error("MongoDB data and repositories are required to create the API server.");
  }
  const data = applicationData;
  const chatRequests = new Map();
  for (const key of ["users", "pharmacies", "medicines", "listings", "history", "savedPharmacies", "reservations", "reports", "audit", "ratings"]) data[key] ||= [];
  const saveApplicationData = () => applicationDataRepository.save(data);
  const users = {
    async findById(userId) {
      return await persistentUsers.findById(userId);
    },
    async findByEmail(email) {
      return await persistentUsers.findByEmail(email);
    },
    async updateById(userId, updates) {
      const updated = await persistentUsers.updateById(userId, updates);
      if (updated) Object.assign(data.users.find((candidate) => candidate.id === userId) || {}, updated);
      return updated;
    },
    async create(user) {
      const created = await persistentUsers.create(user);
      data.users.push(created);
      return created;
    },
  };

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
      const foundUser = userId ? await users.findById(userId) : null;
      const user = foundUser?.active ? foundUser : null;
      const requireUser = () => user || fail(401, "Please sign in to continue.");
      const requireRole = (...roles) => {
        const current = requireUser();
        if (!roles.includes(current.role)) fail(403, "You do not have permission to perform this action.");
        return current;
      };
      const coordinate = (value, label, minimum, maximum) => {
        if (value === undefined || value === null || value === "") return null;
        const number = Number(value);
        if (!Number.isFinite(number) || number < minimum || number > maximum) fail(400, `${label} must be between ${minimum} and ${maximum}.`);
        return number;
      };
      const routeContext = {
        method,
        pathname,
        url,
        body,
        users,
        data,
        saveApplicationData,
        medicineRepository,
        user,
        requireUser,
        requireRole,
        hashPassword,
        signToken,
        verifyPassword,
        id,
        text,
        validEmail,
        validPassword,
        coordinate,
        positiveNumber,
        audit,
        pharmacySummary,
        calculateDistanceKm,
        publicUser,
        send,
        fail,
      };
      if (method === "POST" && pathname === "/api/medical-chat") {
        const question = text(body.question, "Question", 1000);
        const now = Date.now();
        const clientAddress = req.socket.remoteAddress || "unknown";
        if (chatRequests.size > 1000) {
          for (const [address, timestamps] of chatRequests) {
            const activeTimestamps = timestamps.filter((timestamp) => now - timestamp < 60_000);
            if (activeTimestamps.length) chatRequests.set(address, activeTimestamps);
            else chatRequests.delete(address);
          }
        }
        const recent = (chatRequests.get(clientAddress) || []).filter((timestamp) => now - timestamp < 60_000);
        if (recent.length >= 12) fail(429, "Too many chat requests. Please wait a minute and try again.");
        recent.push(now);
        chatRequests.set(clientAddress, recent);

        const medicine = body.medicine && typeof body.medicine === "object" && !Array.isArray(body.medicine)
          ? Object.fromEntries(["name", "genericName", "category", "info"]
            .filter((key) => typeof body.medicine[key] === "string")
            .map((key) => [key, body.medicine[key].trim().slice(0, key === "info" ? 1000 : 160)]))
          : null;
        const result = await medicalAssistant({ question, medicine });
        return send(200, { answer: result.answer });
      }
      if (await handleAuthRoute(routeContext)) return;
      if (await handleMedicineRoute(routeContext)) return;

      if (method === "GET" && pathname === "/api/health") return send(200, { status: "ok" });
      if (method === "GET" && pathname === "/api/pharmacies") {
        const location = (url.searchParams.get("location") || "").trim().toLowerCase();
        const hasLatitude = url.searchParams.has("latitude");
        const hasLongitude = url.searchParams.has("longitude");
        if (hasLatitude !== hasLongitude) fail(400, "Both latitude and longitude are required for nearby search.");
        const searchLatitude = hasLatitude ? coordinate(url.searchParams.get("latitude"), "Latitude", -90, 90) : null;
        const searchLongitude = hasLongitude ? coordinate(url.searchParams.get("longitude"), "Longitude", -180, 180) : null;
        const pharmacies = data.pharmacies
          .filter((item) => item.status === "approved" && (hasLatitude || !location || item.location.toLowerCase().includes(location)))
          .map((pharmacy) => ({
            ...pharmacySummary(pharmacy),
            distanceKm: hasLatitude && Number.isFinite(pharmacy.latitude) && Number.isFinite(pharmacy.longitude)
              ? calculateDistanceKm(searchLatitude, searchLongitude, pharmacy.latitude, pharmacy.longitude)
              : null,
          }))
          .sort((a, b) => {
            if (hasLatitude && a.distanceKm !== b.distanceKm) {
              if (a.distanceKm === null) return 1;
              if (b.distanceKm === null) return -1;
              return a.distanceKm - b.distanceKm;
            }
            return b.rating - a.rating;
          });
        return send(200, { pharmacies });
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
        await saveApplicationData();
        return send(201, { message: "Pharmacy saved." });
      }
      if (method === "DELETE" && pathname.startsWith("/api/saved-pharmacies/")) {
        const current = requireRole("patient");
        const pharmacyId = decodeURIComponent(pathname.split("/").pop());
        data.savedPharmacies = data.savedPharmacies.filter((item) => item.userId !== current.id || item.pharmacyId !== pharmacyId);
        await saveApplicationData();
        return send(200, { message: "Saved pharmacy removed." });
      }
      if (method === "GET" && pathname === "/api/reservations") {
        const current = requireRole("patient");
        const listings = await medicineRepository.findAll();
        const reservations = data.reservations
          .filter((item) => item.userId === current.id)
          .map((reservation) => {
            const listing = listings.find((item) => item.listingId === reservation.listingId || item.id === reservation.listingId);
            const pharmacy = data.pharmacies.find((item) => item.id === (listing?.pharmacyId || reservation.pharmacyId));
            return {
              id: reservation.id,
              listingId: reservation.listingId,
              medicine: listing?.name || reservation.medicine || "Medicine",
              genericName: listing?.genericName || "",
              pharmacy: pharmacy?.name || "Pharmacy",
              pharmacyId: pharmacy?.id || reservation.pharmacyId,
              location: pharmacy?.location || "",
              quantity: reservation.quantity,
              status: reservation.status,
              createdAt: reservation.createdAt,
            };
          });
        return send(200, { reservations });
      }
      if (method === "POST" && pathname === "/api/reservations") {
        const current = requireRole("patient");
        const listings = await medicineRepository.findAll();
        const listing = listings.find((item) => item.listingId === body.listingId || item.id === body.listingId);
        if (!listing) fail(404, "Medicine listing not found.");
        const quantity = Number(body.quantity ?? 1);
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) fail(400, "Quantity must be between 1 and 20.");
        if (Number(listing.stock) < quantity) fail(409, "There is not enough stock to reserve that quantity.");
        const pharmacy = data.pharmacies.find((item) => item.id === listing.pharmacyId && item.status === "approved");
        if (!pharmacy) fail(404, "Pharmacy not found.");
        const reservation = { id: id("reservation"), userId: current.id, pharmacyId: pharmacy.id, listingId: listing.listingId || listing.id, medicine: listing.name, quantity, status: "pending", createdAt: new Date().toISOString() };
        data.reservations.unshift(reservation);
        audit(current.email, "reservation.created", reservation.id);
        await saveApplicationData();
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
        await saveApplicationData();
        return send(201, { rating: pharmacy.rating });
      }
      if (method === "POST" && pathname === "/api/reports") {
        const current = requireUser();
        const report = { id: id("report"), userId: current.id, reporter: current.email, type: text(body.type, "Report type", 50), subject: text(body.subject, "Subject", 120), details: text(body.details, "Details", 1000), status: "open", createdAt: new Date().toISOString() };
        data.reports.unshift(report);
        audit(current.email, "report.created", report.id);
        await saveApplicationData();
        return send(201, { report: { id: report.id, status: report.status } });
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
        if (body.latitude !== undefined || body.longitude !== undefined) {
          const latitude = coordinate(body.latitude, "Latitude", -90, 90);
          const longitude = coordinate(body.longitude, "Longitude", -180, 180);
          if ((latitude === null) !== (longitude === null)) fail(400, "Both latitude and longitude are required for a store location.");
          pharmacy.latitude = latitude;
          pharmacy.longitude = longitude;
        }
        await saveApplicationData();
        return send(200, { pharmacy });
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
        await saveApplicationData();
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
        await users.updateById(account.id, { active: account.active });
        audit(current.email, account.active ? "account.activated" : "account.suspended", account.email);
        await saveApplicationData();
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
        await saveApplicationData();
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
  return { pharmacyId: pharmacy.id, pharmacy: pharmacy.name, name: pharmacy.name, location: pharmacy.location, address: pharmacy.address, latitude: pharmacy.latitude ?? null, longitude: pharmacy.longitude ?? null, phone: pharmacy.phone, rating: Number(pharmacy.rating || 0) };
}

function calculateDistanceKm(latitude, longitude, destinationLatitude, destinationLongitude) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const latitudeDelta = radians(destinationLatitude - latitude);
  const longitudeDelta = radians(destinationLongitude - longitude);
  const value = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(latitude)) * Math.cos(radians(destinationLatitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
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
  async function startServer() {
    const repositories = await connectMongoRepositories(process.env.MONGO_URI);
    const data = await repositories.applicationData.load();
    data.users = await repositories.users.findAll();
    data.medicines = await repositories.medicines.findAllProducts();
    data.listings = await repositories.medicines.findAllListings();
    const server = createAppServer({
      data,
      userRepository: repositories.users,
      medicineRepository: repositories.medicines,
      applicationDataRepository: repositories.applicationData,
    });
    server.listen(port, host, () => console.log(`Medlytic API listening on http://${host}:${port}`));
    server.on("close", () => {
      repositories.close().catch((error) => console.error("Unable to close MongoDB connection:", error.name));
    });
  }

  startServer().catch((error) => {
    console.error("Unable to start Medlytic API. Check MONGO_URI and MongoDB connectivity.", error.name);
    process.exitCode = 1;
  });
}

export { createAppServer };
