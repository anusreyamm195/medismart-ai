import { supabase } from "../lib/supabase";

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

export async function searchMedicines({ q = "", location = "", maxPrice = "", sort = "price-asc" } = {}, currentUser = null) {
  const cleanQ = (q || "").trim().toLowerCase();
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
      if (cleanLoc && !pharm.location.toLowerCase().includes(cleanLoc)) return [];
      const price = Number(l.price);
      if (Number.isFinite(parsedMax) && price > parsedMax) return [];

      return [{
        id: l.id,
        medicineId: med.id,
        pharmacyId: pharm.id,
        pharmacy: pharm.name,
        location: pharm.location,
        address: pharm.address,
        rating: Number(pharm.rating) || 0,
        price,
        stock: Number(l.stock) || 0,
        name: med.name,
        genericName: med.generic_name,
        category: med.category,
        info: med.info,
      }];
    });

  if (sort === "price-desc") {
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

  return { medicines: results, total: results.length };
}

export async function getMedicineDetails(medicineId) {
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

export async function signUpUser({ name, email, password, role = "patient", pharmacyName, location, address, phone }) {
  const trimmedName = (name || "").trim();
  const trimmedEmail = (email || "").trim().toLowerCase();

  if (!trimmedName) throw new Error("Please enter your name.");
  if (!trimmedEmail) throw new Error("Please enter a valid email address.");
  if (!password || password.length < 8) throw new Error("Password must be at least 8 characters long.");
  if (role === "owner" && !pharmacyName?.trim()) throw new Error("Please provide your pharmacy name.");
  if (role === "owner" && !location?.trim()) throw new Error("Please provide your area / city.");

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
  await supabase.auth.signOut();
}

export async function getProfile(userId) {
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
  const { error } = await supabase
    .from("saved_pharmacies")
    .upsert({ user_id: userId, pharmacy_id: pharmacyId }, { onConflict: "user_id,pharmacy_id" });

  if (error) throw new Error(error.message);
  return { message: "Pharmacy saved to your profile." };
}

export async function ratePharmacy(pharmacyId, rating) {
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

export async function submitReport(userId, { type, details, subject }) {
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
  const { error } = await supabase
    .from("listings")
    .update({ stock: Number(stock) })
    .eq("id", listingId);

  if (error) throw new Error(error.message);
}

export async function updateOwnerPharmacyProfile(userId, profile) {
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
  const { error } = await supabase
    .from("pharmacies")
    .update({ status })
    .eq("id", pharmacyId);

  if (error) throw new Error(error.message);
}

export async function updateReportStatus(reportId, status) {
  const { error } = await supabase
    .from("reports")
    .update({ status })
    .eq("id", reportId);

  if (error) throw new Error(error.message);
}

export async function updateUserActiveStatus(userId, active) {
  const { error } = await supabase
    .from("profiles")
    .update({ active })
    .eq("id", userId);

  if (error) throw new Error(error.message);
}
