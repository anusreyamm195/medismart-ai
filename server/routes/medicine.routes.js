export async function handleMedicineRoute(context) {
  const {
    method,
    pathname,
    url,
    body,
    data,
    saveApplicationData,
    medicineRepository,
    user,
    requireRole,
    fail,
    send,
    coordinate,
    id,
    text,
    positiveNumber,
    audit,
    pharmacySummary,
    calculateDistanceKm,
  } = context;

  if (method === "GET" && pathname === "/api/medicines") {
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();
    const location = (url.searchParams.get("location") || "").trim().toLowerCase();
    const maxPrice = url.searchParams.has("maxPrice") ? Number(url.searchParams.get("maxPrice")) : Infinity;
    const sort = url.searchParams.get("sort") || "price-asc";
    const hasLatitude = url.searchParams.has("latitude");
    const hasLongitude = url.searchParams.has("longitude");
    if (hasLatitude !== hasLongitude) fail(400, "Both latitude and longitude are required for nearby search.");
    const searchLatitude = hasLatitude ? coordinate(url.searchParams.get("latitude"), "Latitude", -90, 90) : null;
    const searchLongitude = hasLongitude ? coordinate(url.searchParams.get("longitude"), "Longitude", -180, 180) : null;
    const radiusKm = hasLatitude
      ? coordinate(url.searchParams.get("radiusKm") || "10", "Search radius", 1, 100)
      : null;
    if (!Number.isFinite(maxPrice) && maxPrice !== Infinity || maxPrice < 0) fail(400, "Maximum price must be a non-negative number.");
    const medicines = await medicineRepository.findAll();
    const listings = medicines.flatMap((medicine) => {
      const pharmacy = data.pharmacies.find((item) => item.id === medicine.pharmacyId && item.status === "approved");
      if (!pharmacy) return [];
      const searchable = `${medicine.name} ${medicine.genericName} ${medicine.category} ${pharmacy.name}`.toLowerCase();
      if (q && !searchable.includes(q)) return [];
      if (!hasLatitude && location && !pharmacy.location.toLowerCase().includes(location)) return [];
      if (medicine.price > maxPrice) return [];
      const distanceKm = hasLatitude && Number.isFinite(pharmacy.latitude) && Number.isFinite(pharmacy.longitude)
        ? calculateDistanceKm(searchLatitude, searchLongitude, pharmacy.latitude, pharmacy.longitude)
        : null;
      if (hasLatitude && (distanceKm === null || distanceKm > radiusKm || Number(medicine.stock) <= 0)) return [];
      return [{
        ...pharmacySummary(pharmacy),
        ...medicine,
        id: medicine.listingId || medicine.id,
        medicineId: medicine.id,
        pharmacyId: pharmacy.id,
        pharmacy: pharmacy.name,
        price: Number(medicine.price),
        stock: Number(medicine.stock),
        distanceKm,
      }];
    });
    if (user?.role === "patient" && q) {
      data.history.unshift({ id: id("search"), userId: user.id, query: url.searchParams.get("q").trim(), createdAt: new Date().toISOString() });
      data.history = data.history.slice(0, 3000);
      await saveApplicationData();
    }
    listings.sort((a, b) => {
      if (hasLatitude && a.distanceKm !== b.distanceKm) {
        if (a.distanceKm === null) return 1;
        if (b.distanceKm === null) return -1;
        return a.distanceKm - b.distanceKm;
      }
      return sort === "price-desc" ? b.price - a.price : sort === "rating" ? b.rating - a.rating : a.price - b.price;
    });
    send(200, { medicines: listings, total: listings.length });
    return true;
  }

  const medicineRoute = pathname.match(/^\/api\/medicines\/([^/]+)$/);
  if (method === "GET" && medicineRoute) {
    const medicineId = decodeURIComponent(medicineRoute[1]);
    const medicine = await medicineRepository.findById(medicineId);
    if (!medicine) fail(404, "Medicine not found.");
    const medicineListings = medicine.listings;
    const listings = medicineListings.flatMap((listing) => {
      const pharmacy = data.pharmacies.find((item) => item.id === listing.pharmacyId && item.status === "approved");
      return pharmacy ? [{
        id: listing.listingId || listing.id,
        price: Number(listing.price),
        stock: Number(listing.stock),
        ...pharmacySummary(pharmacy),
      }] : [];
    });
    const catalog = await medicineRepository.findAllProducts();
    const alternatives = catalog
      .filter((item) => item.id !== medicine.id && item.genericName === medicine.genericName)
      .map((item) => item.name);
    const publicMedicine = {
      id: medicine.id,
      name: medicine.name,
      genericName: medicine.genericName,
      category: medicine.category,
      info: medicine.info || "",
    };
    send(200, { medicine: publicMedicine, listings, alternatives });
    return true;
  }

  if (pathname === "/api/owner/dashboard" && method === "GET") {
    const current = requireRole("owner");
    const pharmacy = data.pharmacies.find((item) => item.ownerId === current.id);
    if (!pharmacy) fail(404, "No pharmacy is associated with this account.");
    const listings = data.listings.filter((item) => item.pharmacyId === pharmacy.id).map((item) => ({ ...data.medicines.find((medicine) => medicine.id === item.medicineId), ...item }));
    const reservations = data.reservations.filter((item) => item.pharmacyId === pharmacy.id).map((item) => ({ ...item, customer: data.users.find((candidate) => candidate.id === item.userId)?.name || "Customer" }));
    send(200, { pharmacy, listings, reservations, stats: { listingCount: listings.length, inStock: listings.filter((item) => item.stock > 0).length, rating: pharmacy.rating || 0 } });
    return true;
  }

  if (pathname === "/api/owner/medicines" && method === "POST") {
    const current = requireRole("owner");
    const pharmacy = data.pharmacies.find((item) => item.ownerId === current.id);
    if (!pharmacy) fail(404, "No pharmacy is associated with this account.");
    const medicine = { id: id("medicine"), ownerId: current.id, name: text(body.name, "Medicine name", 100), genericName: text(body.genericName, "Generic name", 120), category: text(body.category, "Category", 80), info: "" };
    const price = positiveNumber(body.price, "Price", true);
    const stock = positiveNumber(body.stock, "Stock", false);
    const listing = { id: id("listing"), medicineId: medicine.id, ownerId: current.id, pharmacyId: pharmacy.id, price, stock };
    await medicineRepository.create({
      ...medicine,
      listingId: listing.id,
      ownerId: current.id,
      pharmacyId: pharmacy.id,
      price,
      stock,
      createdAt: new Date().toISOString(),
    });
    data.medicines.push(medicine);
    data.listings.push(listing);
    audit(current.email, "inventory.created", medicine.name);
    await saveApplicationData();
    send(201, { medicine });
    return true;
  }

  const ownerMedicineRoute = pathname.match(/^\/api\/owner\/medicines\/([^/]+)$/);
  if (ownerMedicineRoute && method === "PATCH") {
    const current = requireRole("owner");
    const pharmacy = data.pharmacies.find((item) => item.ownerId === current.id);
    const listing = data.listings.find((item) => item.id === decodeURIComponent(ownerMedicineRoute[1]) && item.pharmacyId === pharmacy?.id);
    if (!listing) fail(404, "Inventory item not found.");
    const medicine = data.medicines.find((item) => item.id === listing.medicineId);
    const updates = {};
    if (body.price !== undefined) updates.price = positiveNumber(body.price, "Price", true);
    if (body.stock !== undefined) updates.stock = positiveNumber(body.stock, "Stock", false);
    if (body.name !== undefined) updates.name = text(body.name, "Medicine name", 100);
    if (body.genericName !== undefined) updates.genericName = text(body.genericName, "Generic name", 120);
    if (body.category !== undefined) updates.category = text(body.category, "Category", 80);
    const updated = await medicineRepository.updateOwned(medicine.id, current.id, updates, listing.id);
    if (!updated) fail(403, "You do not have permission to edit this medicine.");
    if (body.price !== undefined) listing.price = updates.price;
    if (body.stock !== undefined) listing.stock = updates.stock;
    if (body.name !== undefined) medicine.name = updates.name;
    if (body.genericName !== undefined) medicine.genericName = updates.genericName;
    if (body.category !== undefined) medicine.category = updates.category;
    audit(current.email, "inventory.updated", medicine.name);
    await saveApplicationData();
    send(200, { listing });
    return true;
  }

  if (ownerMedicineRoute && method === "DELETE") {
    const current = requireRole("owner");
    const pharmacy = data.pharmacies.find((item) => item.ownerId === current.id);
    const listing = data.listings.find((item) => item.id === decodeURIComponent(ownerMedicineRoute[1]) && item.pharmacyId === pharmacy?.id);
    if (!listing) fail(404, "Inventory item not found.");
    const deleted = await medicineRepository.deleteOwned(listing.medicineId, current.id, listing.id);
    if (!deleted) fail(403, "You do not have permission to remove this medicine.");
    data.listings = data.listings.filter((item) => item.id !== listing.id);
    if (!data.listings.some((item) => item.medicineId === listing.medicineId)) {
      data.medicines = data.medicines.filter((item) => item.id !== listing.medicineId);
    }
    await saveApplicationData();
    send(200, { message: "Medicine listing removed." });
    return true;
  }

  return false;
}
