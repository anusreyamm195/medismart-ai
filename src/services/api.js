import { supabase } from "../lib/supabase";

async function localRequest(path, { method = "GET", body } = {}) {
  const token = typeof localStorage !== "undefined" ? localStorage.getItem("medlytic-token") : null;
  const response = await fetch(`/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error("The local API did not return JSON. Check that the API server is running and Vite proxies /api to it.");
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "The local API request failed.");
  if (data.token && typeof localStorage !== "undefined") localStorage.setItem("medlytic-token", data.token);
  return data;
}

export async function askMedicalAssistant(question, medicine = null) {
  return localRequest("/medical-chat", {
    method: "POST",
    body: { question, medicine },
  });
}

function pharmacySummary(p) {
  return {
    id: p.id,
    name: p.name,
    location: p.location,
    address: p.address,
    phone: p.phone,
    status: p.status,
    rating: Number(p.rating) || 0,
    createdAt: p.created_at,
    ownerId: p.owner_id,
  };
}

function distanceBetweenKm(latitude, longitude, destinationLatitude, destinationLongitude) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const latitudeDelta = radians(destinationLatitude - latitude);
  const longitudeDelta = radians(destinationLongitude - longitude);
  const value = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(latitude)) * Math.cos(radians(destinationLatitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function matchesLocation(pharmacy, location) {
  const terms = location.split(",").map((term) => term.trim()).filter(Boolean);
  if (!terms.length) return true;
  const searchableLocation = `${pharmacy.location || ""} ${pharmacy.address || ""}`.toLowerCase();
  return terms.some((term) => searchableLocation.includes(term));
}

function getSearchTerms(query) {
  return [...new Set(query.split(/[,\n;]+/).map((term) => term.trim().toLowerCase()).filter(Boolean))];
}

async function addRoadDistances(result, latitude, longitude, radiusKm, sort) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || result.medicines.length === 0) return result;

  const pharmacies = new Map();
  for (const medicine of result.medicines) {
    if (medicine.latitude === null || medicine.latitude === undefined
      || medicine.longitude === null || medicine.longitude === undefined
      || !Number.isFinite(Number(medicine.latitude)) || !Number.isFinite(Number(medicine.longitude))) {
      throw new Error(`Road distance is unavailable for ${medicine.pharmacy}.`);
    }
    pharmacies.set(medicine.pharmacyId, medicine);
  }

  const destinations = [...pharmacies.values()];
  const roadDistances = new Map();
  for (let start = 0; start < destinations.length; start += 50) {
    const batch = destinations.slice(start, start + 50);
    const coordinates = [
      `${longitude},${latitude}`,
      ...batch.map(({ longitude: destinationLongitude, latitude: destinationLatitude }) => `${destinationLongitude},${destinationLatitude}`),
    ].join(";");
    const destinationIndexes = batch.map((_, index) => index + 1).join(";");
    const url = `https://router.project-osrm.org/table/v1/driving/${coordinates}?sources=0&destinations=${destinationIndexes}&annotations=distance`;
    let response;
    try {
      response = await fetch(url);
    } catch {
      throw new Error("Road-distance lookup is unavailable. Please try again.");
    }
    if (!response.ok) throw new Error("Road-distance lookup is unavailable. Please try again.");

    const table = await response.json();
    if (table.code !== "Ok" || !Array.isArray(table.distances?.[0])) {
      throw new Error("Road-distance lookup failed. Please try again.");
    }
    batch.forEach((pharmacy, index) => {
      const meters = table.distances[0][index];
      if (!Number.isFinite(meters)) throw new Error(`A road route could not be found to ${pharmacy.pharmacy}.`);
      roadDistances.set(pharmacy.pharmacyId, meters / 1000);
    });
  }

  result.medicines = result.medicines
    .map((medicine) => ({ ...medicine, distanceKm: roadDistances.get(medicine.pharmacyId) }))
    .filter((medicine) => medicine.distanceKm <= radiusKm);

  if (sort === "distance-asc") {
    result.medicines.sort((a, b) => a.distanceKm - b.distanceKm);
  } else if (sort === "distance-desc") {
    result.medicines.sort((a, b) => b.distanceKm - a.distanceKm);
  } else if (sort === "price-desc") {
    result.medicines.sort((a, b) => b.price - a.price);
  } else if (sort === "rating") {
    result.medicines.sort((a, b) => b.rating - a.rating);
  } else {
    result.medicines.sort((a, b) => a.price - b.price);
  }

  result.total = result.medicines.length;
  return result;
}

export async function searchMedicines({ q = "", location = "", maxPrice = "", sort = "price-asc", latitude, longitude, radiusKm = 50, pharmacyId = "" } = {}, currentUser = null) {
  if (!supabase) {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (location.trim()) params.set("location", location.trim());
    if (pharmacyId) params.set("pharmacyId", pharmacyId);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      params.set("latitude", latitude);
      params.set("longitude", longitude);
      params.set("radiusKm", radiusKm);
    }
    if (maxPrice !== "") params.set("maxPrice", maxPrice);
    if (sort) params.set("sort", sort);
    const result = await localRequest(`/medicines?${params}`);
    return addRoadDistances(result, latitude, longitude, radiusKm, sort);
  }

  const cleanQ = (q || "").trim().toLowerCase();
  const searchTerms = getSearchTerms(cleanQ);
  const cleanLoc = (location || "").trim().toLowerCase();
  const parsedMax = maxPrice !== "" ? Number(maxPrice) : Infinity;

  const { data: listings, error } = await supabase
    .from("listings")
    .select(`
      id,
      price,
      stock,
      created_at,
      medicine:medicines (
        id,
        name,
        generic_name,
        category,
        info
      ),
      pharmacy:pharmacies (
        id,
        name,
        location,
        address,
        latitude,
        longitude,
        phone,
        status,
        rating,
        owner_id
      )
    `);

  if (error) throw new Error(error.message);

  let results = (listings || [])
    .filter((l) => l.medicine && l.pharmacy && l.pharmacy.status === "approved")
    .flatMap((l) => {
      const med = l.medicine;
      const pharm = l.pharmacy;
      const searchable = `${med.name} ${med.generic_name} ${med.category} ${pharm.name}`.toLowerCase();

      if (cleanQ && !searchable.includes(cleanQ)) return [];
      if (cleanLoc && !matchesLocation(pharm, cleanLoc)) return [];
      const price = Number(l.price);
      if (Number.isFinite(parsedMax) && price > parsedMax) return [];
      const distanceKm = Number.isFinite(latitude) && Number.isFinite(longitude)
        && Number.isFinite(Number(pharm.latitude)) && Number.isFinite(Number(pharm.longitude))
        ? distanceBetweenKm(latitude, longitude, Number(pharm.latitude), Number(pharm.longitude))
        : null;
      if (Number.isFinite(latitude) && Number.isFinite(longitude)
        && (distanceKm === null || distanceKm > radiusKm || Number(l.stock) <= 0)) return [];

      return [{
        id: l.id,
        medicineId: med.id,
        pharmacyId: pharm.id,
        pharmacy: pharm.name,
        location: pharm.location,
        address: pharm.address,
        phone: pharm.phone,
        latitude: pharm.latitude == null ? null : Number(pharm.latitude),
        longitude: pharm.longitude == null ? null : Number(pharm.longitude),
        rating: Number(pharm.rating) || 0,
        distanceKm,
        price,
        stock: Number(l.stock) || 0,
        name: med.name,
        genericName: med.generic_name,
        category: med.category,
        info: med.info,
      }];
    });

  if (sort === "distance-desc" && Number.isFinite(latitude) && Number.isFinite(longitude)) {
    results.sort((a, b) => (b.distanceKm ?? -1) - (a.distanceKm ?? -1));
  } else if (sort === "distance-asc" && Number.isFinite(latitude) && Number.isFinite(longitude)) {
    results.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
  } else if (sort === "price-desc") {
    results.sort((a, b) => b.price - a.price);
  } else if (sort === "rating") {
    results.sort((a, b) => b.rating - a.rating);
  } else {
    results.sort((a, b) => a.price - b.price);
  }

  // Record history for patient searches if authenticated
  if (currentUser?.id && currentUser?.role === "patient" && cleanQ) {
    try {
      await supabase.from("search_history").insert({
        user_id: currentUser.id,
        query: cleanQ,
      });
    } catch {
      // Non-blocking history record
    }
  }

  return addRoadDistances({ medicines: results, total: results.length }, latitude, longitude, radiusKm, sort);
}

export async function getNearbyPharmacies(location = "", coordinates = null) {
  if (!supabase) {
    const params = new URLSearchParams();
    if (coordinates) {
      params.set("latitude", coordinates.latitude);
      params.set("longitude", coordinates.longitude);
    } else if (location.trim()) {
      params.set("location", location.trim());
    }
    const { pharmacies } = await localRequest(`/pharmacies?${params}`);
    return pharmacies;
  }

  const cleanLocation = location.trim().toLowerCase();
  const { data, error } = await supabase
    .from("pharmacies")
    .select("id, name, location, address, phone, status, rating")
    .eq("status", "approved");
  if (error) throw new Error(error.message);
  return (data || [])
    .filter((pharmacy) => !cleanLocation || pharmacy.location.toLowerCase().includes(cleanLocation))
    .map((pharmacy) => ({ ...pharmacySummary(pharmacy), distanceKm: null }));
}

export async function getApprovedPharmacies() {
  if (!supabase) {
    const { pharmacies } = await localRequest("/pharmacies");
    return pharmacies.map((pharmacy) => ({
      ...pharmacy,
      id: pharmacy.id || pharmacy.pharmacyId,
    }));
  }

  const { data, error } = await supabase
    .from("pharmacies")
    .select("id, name, location, address")
    .eq("status", "approved")
    .order("name");
  if (error) throw new Error(error.message);
  return (data || []).map((pharmacy) => ({
    ...pharmacy,
    id: pharmacy.id,
  }));
}

export async function getMedicineDetails(medicineId) {
  if (!supabase) return localRequest(`/medicines/${encodeURIComponent(medicineId)}`);

  const { data: medicine, error: medError } = await supabase
    .from("medicines")
    .select("*")
    .eq("id", medicineId)
    .single();

  if (medError || !medicine) throw new Error("Medicine not found.");

  const { data: listings } = await supabase
    .from("listings")
    .select(`
      id,
      price,
      stock,
      pharmacy:pharmacies (
        id,
        name,
        location,
        address,
        phone,
        status,
        rating
      )
    `)
    .eq("medicine_id", medicine.id);

  const approvedListings = (listings || [])
    .filter((l) => l.pharmacy && l.pharmacy.status === "approved")
    .map((l) => ({
      id: l.id,
      price: Number(l.price),
      stock: Number(l.stock),
      pharmacy: l.pharmacy.name,
      location: l.pharmacy.location,
      address: l.pharmacy.address,
      rating: Number(l.pharmacy.rating) || 0,
    }));

  const { data: altMedicines } = await supabase
    .from("medicines")
    .select("name")
    .eq("generic_name", medicine.generic_name)
    .neq("id", medicine.id);

  const alternatives = (altMedicines || []).map((m) => m.name);

  return {
    medicine: {
      id: medicine.id,
      name: medicine.name,
      genericName: medicine.generic_name,
      category: medicine.category,
      info: medicine.info,
    },
    listings: approvedListings,
    alternatives,
  };
}

export async function signUpUser({ name, email, password, role = "patient", pharmacyName, location, address, phone, latitude, longitude }) {
  const trimmedName = (name || "").trim();
  const trimmedEmail = (email || "").trim().toLowerCase();

  if (!trimmedName) throw new Error("Please enter your name.");
  if (!trimmedEmail) throw new Error("Please enter a valid email address.");
  if (!password || password.length < 8) throw new Error("Password must be at least 8 characters long.");
  if (role === "owner" && !pharmacyName?.trim()) throw new Error("Please provide your pharmacy name.");
  if (role === "owner" && !location?.trim()) throw new Error("Please provide your area / city.");

  if (!supabase) {
    return localRequest("/auth/register", {
      method: "POST",
      body: { name: trimmedName, email: trimmedEmail, password, role, pharmacyName, location, address, phone, latitude, longitude },
    });
  }

  const { data, error } = await supabase.auth.signUp({
    email: trimmedEmail,
    password,
    options: {
      data: {
        name: trimmedName,
        role,
        pharmacy_name: pharmacyName ? pharmacyName.trim() : null,
        location: location ? location.trim() : null,
        address: address ? address.trim() : null,
        phone: phone ? phone.trim() : null,
        latitude: latitude ?? null,
        longitude: longitude ?? null,
      },
    },
  });

  if (error) {
    if (error.message.toLowerCase().includes("rate limit")) {
      throw new Error("Email rate limit exceeded by Supabase. In your Supabase Dashboard, go to Authentication -> Providers -> Email and disable 'Confirm email' for local development.");
    }
    throw new Error(error.message);
  }

  const authUser = data.user;
  const session = data.session;

  // Supabase email confirmation check:
  // When confirmation is enabled, session is null and confirmation_sent_at is present.
  const requiresEmailConfirmation = !session;

  if (requiresEmailConfirmation) {
    return {
      requiresEmailConfirmation: true,
      user: null,
      token: null,
      message: `Registration successful! A verification email has been sent to ${trimmedEmail}. Please check your inbox and verify your email to log in.`,
    };
  }

  // If auto-confirmed or session is present:
  const user = {
    id: authUser.id,
    name: trimmedName,
    email: trimmedEmail,
    role,
    active: true,
  };

  return {
    requiresEmailConfirmation: false,
    user,
    token: session.access_token,
    message: role === "owner"
      ? "Your account is ready. Your pharmacy registration is awaiting admin approval."
      : `Welcome, ${user.name}.`,
  };
}

export async function loginUser({ email, password }) {
  const trimmedEmail = (email || "").trim().toLowerCase();
  if (!trimmedEmail || !password) throw new Error("Please provide both email and password.");

  if (!supabase) {
    return localRequest("/auth/login", { method: "POST", body: { email: trimmedEmail, password } });
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: trimmedEmail,
    password,
  });

  if (error) {
    if (error.message.includes("Email not confirmed")) {
      throw new Error("Your email address has not been confirmed yet. Please check your inbox for the verification link.");
    }
    if (error.message.includes("Invalid login credentials")) {
      throw new Error("Email or password is incorrect.");
    }
    throw new Error(error.message);
  }

  const authUser = data.user;
  const session = data.session;

  // Fetch user profile from public.profiles
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", authUser.id)
    .single();

  if (profile && !profile.active) {
    await supabase.auth.signOut();
    throw new Error("This account has been suspended. Contact the platform administrator.");
  }

  const user = {
    id: authUser.id,
    name: profile?.name || authUser.user_metadata?.name || authUser.email.split("@")[0],
    email: authUser.email,
    role: profile?.role || authUser.user_metadata?.role || "patient",
    active: profile?.active ?? true,
  };

  return {
    user,
    token: session.access_token,
    message: `Welcome, ${user.name}.`,
  };
}

export async function getCurrentUser() {
  if (!supabase) {
    if (typeof localStorage === "undefined" || !localStorage.getItem("medlytic-token")) return null;
    const result = await localRequest("/auth/me");
    return result.user;
  }

  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session?.user) return null;

  const authUser = session.user;
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", authUser.id)
    .single();

  if (profile && !profile.active) {
    await supabase.auth.signOut();
    return null;
  }

  return {
    id: authUser.id,
    name: profile?.name || authUser.user_metadata?.name || authUser.email.split("@")[0],
    email: authUser.email,
    role: profile?.role || authUser.user_metadata?.role || "patient",
    active: profile?.active ?? true,
    token: session.access_token,
  };
}

export async function signOutUser() {
  if (!supabase) {
    if (typeof localStorage !== "undefined") localStorage.removeItem("medlytic-token");
    return;
  }
  await supabase.auth.signOut();
}

export async function getProfile(userId) {
  if (!supabase) return (await localRequest("/profile")).user;

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();
  if (error) throw new Error(error.message);
  return profile;
}

export async function updateProfile(userId, { name }) {
  const trimmed = (name || "").trim();
  if (!trimmed) throw new Error("Name cannot be empty.");
  if (!supabase) return (await localRequest("/profile", { method: "PATCH", body: { name: trimmed } })).user;

  const { data, error } = await supabase
    .from("profiles")
    .update({ name: trimmed, updated_at: new Date().toISOString() })
    .eq("id", userId)
    .select()
    .single();

  if (error) throw new Error(error.message);

  // Also update user metadata in Supabase Auth
  await supabase.auth.updateUser({ data: { name: trimmed } });

  return data;
}

export async function getSearchHistory(userId) {
  if (!supabase) return (await localRequest("/search-history")).history;

  const { data, error } = await supabase
    .from("search_history")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw new Error(error.message);
  return (data || []).map((item) => ({
    id: item.id,
    query: item.query,
    createdAt: item.created_at,
  }));
}

export async function getSavedPharmacies(userId) {
  if (!supabase) {
    const { pharmacies } = await localRequest("/saved-pharmacies");
    return pharmacies.map((pharmacy) => ({ ...pharmacy, id: pharmacy.id || pharmacy.pharmacyId }));
  }

  const { data, error } = await supabase
    .from("saved_pharmacies")
    .select(`
      id,
      created_at,
      pharmacy:pharmacies (*)
    `)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data || [])
    .filter((item) => item.pharmacy)
    .map((item) => pharmacySummary(item.pharmacy));
}

export async function savePharmacy(userId, pharmacyId) {
  if (!supabase) return localRequest("/saved-pharmacies", { method: "POST", body: { pharmacyId } });

  const { error } = await supabase
    .from("saved_pharmacies")
    .upsert({ user_id: userId, pharmacy_id: pharmacyId }, { onConflict: "user_id,pharmacy_id" });

  if (error) throw new Error(error.message);
  return { message: "Pharmacy saved to your profile." };
}

export async function ratePharmacy(pharmacyId, rating) {
  if (!supabase) {
    await localRequest(`/pharmacies/${pharmacyId}/ratings`, { method: "POST", body: { rating } });
    return { message: "Thanks for rating this pharmacy." };
  }

  const { data: pharmacy, error: fetchErr } = await supabase
    .from("pharmacies")
    .select("rating")
    .eq("id", pharmacyId)
    .single();

  if (fetchErr) throw new Error(fetchErr.message);

  const currentRating = Number(pharmacy?.rating) || 0;
  const newRating = currentRating > 0 ? Number(((currentRating + Number(rating)) / 2).toFixed(1)) : Number(rating);

  const { error } = await supabase
    .from("pharmacies")
    .update({ rating: newRating })
    .eq("id", pharmacyId);

  if (error) throw new Error(error.message);
  return { message: "Thanks for rating this pharmacy." };
}

export async function reserveMedicine(userId, listingId, quantity = 1) {
  if (!supabase) return localRequest("/reservations", { method: "POST", body: { listingId, quantity } });

  const { data, error } = await supabase
    .from("reservations")
    .insert({
      user_id: userId,
      listing_id: listingId,
      quantity: Number(quantity) || 1,
      status: "pending",
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return { message: "Reservation placed. The pharmacy will hold your medicine.", reservation: data };
}

export async function getUserReservations(userId) {
  if (!supabase) {
    const { reservations } = await localRequest("/reservations");
    return reservations;
  }

  const { data, error } = await supabase
    .from("reservations")
    .select(`
      id,
      listing_id,
      quantity,
      status,
      created_at,
      listing:listings (
        id,
        medicine:medicines (name, generic_name),
        pharmacy:pharmacies (id, name, location)
      )
    `)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data || []).map((reservation) => {
    const listing = Array.isArray(reservation.listing) ? reservation.listing[0] : reservation.listing;
    const medicine = Array.isArray(listing?.medicine) ? listing.medicine[0] : listing?.medicine;
    const pharmacy = Array.isArray(listing?.pharmacy) ? listing.pharmacy[0] : listing?.pharmacy;
    return {
      id: reservation.id,
      listingId: reservation.listing_id,
      medicine: medicine?.name || "Medicine",
      genericName: medicine?.generic_name || "",
      pharmacy: pharmacy?.name || "Pharmacy",
      pharmacyId: pharmacy?.id || null,
      location: pharmacy?.location || "",
      quantity: Number(reservation.quantity),
      status: reservation.status,
      createdAt: reservation.created_at,
    };
  });
}

export async function submitReport(userId, { type, details, subject }) {
  if (!supabase) {
    await localRequest("/reports", { method: "POST", body: { type, details, subject } });
    return { message: "Thanks — your report was sent for review." };
  }

  const { error } = await supabase
    .from("reports")
    .insert({
      user_id: userId,
      subject: subject || "Catalogue feedback",
      type: type || "complaint",
      details: (details || "").trim(),
      status: "open",
    });

  if (error) throw new Error(error.message);
  return { message: "Thanks — your report was sent for review." };
}

export async function getOwnerDashboard(userId) {
  if (!supabase) return localRequest("/owner/dashboard");

  const { data: pharmacy } = await supabase
    .from("pharmacies")
    .select("*")
    .eq("owner_id", userId)
    .single();

  if (!pharmacy) {
    return {
      pharmacy: null,
      stats: { listingCount: 0, inStock: 0, rating: null },
      listings: [],
      reservations: [],
    };
  }

  const { data: listings } = await supabase
    .from("listings")
    .select(`
      id,
      price,
      stock,
      medicine:medicines (*)
    `)
    .eq("pharmacy_id", pharmacy.id);

  const formattedListings = (listings || []).map((l) => ({
    id: l.id,
    medicineId: l.medicine?.id,
    name: l.medicine?.name || "Unknown medicine",
    genericName: l.medicine?.generic_name || "",
    category: l.medicine?.category || "",
    price: Number(l.price),
    stock: Number(l.stock),
  }));

  const listingIds = formattedListings.map((l) => l.id);
  let formattedReservations = [];

  if (listingIds.length) {
    const { data: reservations } = await supabase
      .from("reservations")
      .select(`
        id,
        quantity,
        status,
        created_at,
        listing_id,
        user:profiles (
          id,
          name,
          email
        )
      `)
      .in("listing_id", listingIds);

    formattedReservations = (reservations || []).map((r) => {
      const matchListing = formattedListings.find((l) => l.id === r.listing_id);
      return {
        id: r.id,
        medicine: matchListing?.name || "Medicine",
        customer: r.user?.name || "Customer",
        quantity: r.quantity,
        status: r.status,
      };
    });
  }

  const inStock = formattedListings.filter((l) => l.stock > 0).length;

  return {
    pharmacy: pharmacySummary(pharmacy),
    stats: {
      listingCount: formattedListings.length,
      inStock,
      rating: pharmacy.rating ? Number(pharmacy.rating).toFixed(1) : null,
    },
    listings: formattedListings,
    reservations: formattedReservations,
  };
}

export async function saveOwnerMedicine(userId, form, editingListingId = null) {
  if (!supabase) {
    return localRequest(editingListingId ? `/owner/medicines/${editingListingId}` : "/owner/medicines", {
      method: editingListingId ? "PATCH" : "POST",
      body: form,
    });
  }

  const { data: pharmacy } = await supabase
    .from("pharmacies")
    .select("id")
    .eq("owner_id", userId)
    .single();

  if (!pharmacy) throw new Error("No pharmacy found for your account.");

  if (editingListingId) {
    // Updating existing listing
    const { data: listing } = await supabase
      .from("listings")
      .select("medicine_id")
      .eq("id", editingListingId)
      .single();

    if (listing?.medicine_id) {
      await supabase
        .from("medicines")
        .update({
          name: form.name.trim(),
          generic_name: form.genericName.trim(),
          category: form.category.trim(),
        })
        .eq("id", listing.medicine_id);
    }

    const { error } = await supabase
      .from("listings")
      .update({
        price: Number(form.price),
        stock: Number(form.stock),
      })
      .eq("id", editingListingId);

    if (error) throw new Error(error.message);
  } else {
    // Creating new medicine & listing
    const medId = `med-${Date.now().toString(36)}`;
    const { error: medError } = await supabase
      .from("medicines")
      .insert({
        id: medId,
        name: form.name.trim(),
        generic_name: form.genericName.trim(),
        category: form.category.trim(),
        info: "",
      });

    if (medError) throw new Error(medError.message);

    const { error: listError } = await supabase
      .from("listings")
      .insert({
        medicine_id: medId,
        pharmacy_id: pharmacy.id,
        price: Number(form.price),
        stock: Number(form.stock),
      });

    if (listError) throw new Error(listError.message);
  }
}

export async function updateOwnerStock(listingId, stock) {
  if (!supabase) return localRequest(`/owner/medicines/${listingId}`, { method: "PATCH", body: { stock } });

  const { error } = await supabase
    .from("listings")
    .update({ stock: Number(stock) })
    .eq("id", listingId);

  if (error) throw new Error(error.message);
}

export async function updateOwnerPharmacyProfile(userId, profile) {
  if (!supabase) return localRequest("/owner/profile", { method: "PATCH", body: profile });

  const { error } = await supabase
    .from("pharmacies")
    .update({
      name: profile.name.trim(),
      location: profile.location.trim(),
      address: profile.address.trim(),
      phone: profile.phone.trim(),
    })
    .eq("owner_id", userId);

  if (error) throw new Error(error.message);
}

export async function getAdminDashboard() {
  if (!supabase) return localRequest("/admin/dashboard");

  const [usersRes, pharmaciesRes, pendingRes, reportsRes] = await Promise.all([
    supabase.from("profiles").select("*", { count: "exact", head: true }),
    supabase.from("pharmacies").select("*", { count: "exact", head: true }),
    supabase.from("pharmacies").select("*", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("reports").select("*", { count: "exact", head: true }).eq("status", "open"),
  ]);

  return {
    stats: {
      users: usersRes.count ?? 0,
      pharmacies: pharmaciesRes.count ?? 0,
      pendingPharmacies: pendingRes.count ?? 0,
      openReports: reportsRes.count ?? 0,
    },
  };
}

export async function getAdminRecords(tab) {
  if (!supabase) {
    const endpoint = tab === "pharmacies" ? "/admin/pharmacies" : `/admin/${tab}`;
    const result = await localRequest(endpoint);
    const key = tab === "audit" ? "audit" : tab;
    return result[key] || [];
  }

  if (tab === "pharmacies") {
    const { data } = await supabase
      .from("pharmacies")
      .select(`
        id,
        name,
        location,
        status,
        owner_id,
        owner:profiles (
          name,
          email
        )
      `)
      .order("created_at", { ascending: false });

    return (data || []).map((p) => ({
      id: p.id,
      name: p.name,
      location: p.location,
      status: p.status,
      ownerName: p.owner?.name || "Unknown",
      ownerEmail: p.owner?.email || "No email",
    }));
  }

  if (tab === "reports") {
    const { data } = await supabase
      .from("reports")
      .select("*")
      .order("created_at", { ascending: false });
    return data || [];
  }

  if (tab === "users") {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });
    return data || [];
  }

  if (tab === "audit") {
    const { data } = await supabase
      .from("audit_logs")
      .select("*")
      .order("created_at", { ascending: false });
    return data || [];
  }

  return [];
}

export async function updatePharmacyStatus(pharmacyId, status) {
  if (!supabase) return localRequest(`/admin/pharmacies/${pharmacyId}`, { method: "PATCH", body: { status } });

  const { error } = await supabase
    .from("pharmacies")
    .update({ status })
    .eq("id", pharmacyId);

  if (error) throw new Error(error.message);
}

export async function updateReportStatus(reportId, status) {
  if (!supabase) return localRequest(`/admin/reports/${reportId}`, { method: "PATCH", body: { status } });

  const { error } = await supabase
    .from("reports")
    .update({ status })
    .eq("id", reportId);

  if (error) throw new Error(error.message);
}

export async function updateUserActiveStatus(userId, active) {
  if (!supabase) return localRequest(`/admin/users/${userId}`, { method: "PATCH", body: { active } });

  const { error } = await supabase
    .from("profiles")
    .update({ active })
    .eq("id", userId);

  if (error) throw new Error(error.message);
}
