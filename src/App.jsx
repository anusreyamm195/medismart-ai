import { useCallback, useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import "./medlytic.css";
import StoreLocationPicker from "./components/StoreLocationPicker";
import {
  askMedicalAssistant,
  searchMedicines,
  getMedicineDetails,
  signUpUser,
  loginUser,
  getCurrentUser,
  signOutUser,
  getProfile,
  updateProfile,
  getSearchHistory,
  getSavedPharmacies,
  getLikedMedicines,
  likeMedicine as apiLikeMedicine,
  unlikeMedicine as apiUnlikeMedicine,
  getNearbyPharmacies,
  getApprovedPharmacies,
  getUserReservations,
  removeUserReservation,
  savePharmacy as apiSavePharmacy,
  removeSavedPharmacy as apiRemoveSavedPharmacy,
  ratePharmacy as apiRatePharmacy,
  reserveMedicine as apiReserveMedicine,
  submitReport as apiSubmitReport,
  getOwnerDashboard,
  saveOwnerMedicine,
  deleteOwnerMedicine,
  updateOwnerStock,
  updateOwnerReservationStatus,
  updateOwnerPharmacyProfile,
  getAdminDashboard,
  getAdminRecords,
  updatePharmacyStatus,
  updateReportStatus,
  updateUserActiveStatus,
} from "./services/api";

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Location access is not available in this browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude }),
      () => reject(new Error("Could not access your location. Check browser permission and try again.")),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  });
}

async function reverseGeocode({ latitude, longitude }) {
  const params = new URLSearchParams({ format: "jsonv2", lat: latitude, lon: longitude });
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`);
    if (response.ok) {
      const result = await response.json();
      if (result.display_name) {
        const address = result.address || {};
        const locality = address.suburb || address.neighbourhood || address.city_district;
        const city = address.city || address.town || address.village;
        const label = [...new Set([locality || city, city].filter(Boolean))].join(", ");
        return (label || result.display_name).slice(0, 160);
      }
    }
  } catch {
    // Coordinates still work when the optional address lookup is unavailable.
  }
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

async function geocodeLocation(location) {
  const params = new URLSearchParams({ format: "jsonv2", limit: "1", q: location });
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`);
  if (!response.ok) throw new Error("Location lookup is temporarily unavailable. Try selecting a point on the map.");
  const [result] = await response.json();
  const latitude = Number(result?.lat);
  const longitude = Number(result?.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error("We couldn't find that city or area. Try another name or select a point on the map.");
  }
  return { latitude, longitude };
}

function pharmacyIdentity(pharmacy) {
  const normalize = (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  const identity = [
    normalize(pharmacy.name || pharmacy.pharmacy),
    normalize(pharmacy.location),
    normalize(pharmacy.address),
  ];
  return identity.some(Boolean) ? identity.join("|") : pharmacy.id || pharmacy.pharmacyId;
}

function pharmacyDirectionsUrl(pharmacy, origin) {
  const hasCoordinates = pharmacy.latitude !== null && pharmacy.latitude !== undefined
    && pharmacy.longitude !== null && pharmacy.longitude !== undefined
    && Number.isFinite(Number(pharmacy.latitude)) && Number.isFinite(Number(pharmacy.longitude));
  const destination = hasCoordinates
    ? `${pharmacy.latitude},${pharmacy.longitude}`
    : pharmacy.address || pharmacy.location;
  const params = new URLSearchParams({ api: "1", destination });
  if (origin) params.set("origin", `${origin.latitude},${origin.longitude}`);
  return `https://www.google.com/maps/dir/?${params}`;
}

function App() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState("home");
  const [medicines, setMedicines] = useState([]);
  const [pharmacyOptions, setPharmacyOptions] = useState([]);
  const [pharmacyOptionsLoaded, setPharmacyOptionsLoaded] = useState(false);
  const [pharmacyQuery, setPharmacyQuery] = useState("");
  const [selectedPharmacyId, setSelectedPharmacyId] = useState("");
  const [pharmacyMenuOpen, setPharmacyMenuOpen] = useState(false);
  const [nearbyPharmacies, setNearbyPharmacies] = useState([]);
  const [nearbySearchLocation, setNearbySearchLocation] = useState("");
  const [nearbySearchActive, setNearbySearchActive] = useState(false);
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const [userCoordinates, setUserCoordinates] = useState(null);
  const [locating, setLocating] = useState(false);
  const [registrationCoordinates, setRegistrationCoordinates] = useState(null);
  const [registrationLocation, setRegistrationLocation] = useState("");
  const [registrationLocating, setRegistrationLocating] = useState(false);
  const registrationLocationRequest = useRef(0);
  const searchLocationRequest = useRef(0);
  const [maxPrice, setMaxPrice] = useState("");
  const [sort, setSort] = useState("price-asc");
  const [radiusKm, setRadiusKm] = useState(10);
  const [searchMapOpen, setSearchMapOpen] = useState(false);
  const [searchMapCenter, setSearchMapCenter] = useState(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [authRole, setAuthRole] = useState("patient");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [detail, setDetail] = useState(null);
  const [pharmacyDetail, setPharmacyDetail] = useState(null);
  const [history, setHistory] = useState([]);
  const [saved, setSaved] = useState([]);
  const [likedMedicines, setLikedMedicines] = useState([]);
  const [savedDataLoading, setSavedDataLoading] = useState(false);
  const [savedDataError, setSavedDataError] = useState("");
  const [savedDataOwnerId, setSavedDataOwnerId] = useState(null);
  const [savedDataRefresh, setSavedDataRefresh] = useState(0);
  const [savingPharmacyId, setSavingPharmacyId] = useState(null);
  const [savingMedicineId, setSavingMedicineId] = useState(null);
  const [reservations, setReservations] = useState([]);
  const [reservationsLoadedFor, setReservationsLoadedFor] = useState(null);
  const [reservationCartOpen, setReservationCartOpen] = useState(false);
  const [removingReservationId, setRemovingReservationId] = useState(null);
  const [pendingReservation, setPendingReservation] = useState(null);
  const [reservingListingId, setReservingListingId] = useState(null);
  const [profileData, setProfileData] = useState(null);
  const [ownerData, setOwnerData] = useState(null);
  const [updatingReservationId, setUpdatingReservationId] = useState(null);
  const [adminData, setAdminData] = useState(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [reportTarget, setReportTarget] = useState(null);
  const reservationUserId = user?.role === "patient" ? user.id : null;
  const reservationsLoading = Boolean(reservationUserId && reservationsLoadedFor !== reservationUserId);

  const updateReservationStatus = async (reservationId, status) => {
    setUpdatingReservationId(reservationId);
    try {
      await updateOwnerReservationStatus(user.id, reservationId, status);
      setOwnerData((current) => current ? {
        ...current,
        reservations: current.reservations.map((reservation) =>
          reservation.id === reservationId ? { ...reservation, status } : reservation
        ),
      } : current);
      setNotice(`Reservation marked as ${status}.`);
      setRefreshVersion((version) => version + 1);
    } catch (err) {
      setError(err.message || "Failed to update reservation.");
    } finally {
      setUpdatingReservationId(null);
    }
  };

  const toggleLikedMedicine = async (medicine, isLiked) => {
    if (!user) {
      setAuthMode("login");
      setAuthError("");
      setAuthOpen(true);
      return;
    }
    if (user.role !== "patient") {
      setError("Liked medicines are available with a patient account.");
      return;
    }
    const medicineId = medicine.medicineId || medicine.id;
    if (savingMedicineId) return;
    setSavingMedicineId(medicineId);
    try {
      const result = isLiked
        ? await apiUnlikeMedicine(user.id, medicineId)
        : await apiLikeMedicine(user.id, medicineId);
      setLikedMedicines((current) => isLiked
        ? current.filter((item) => item.id !== medicineId)
        : current.some((item) => item.id === medicineId) ? current : [{
          id: medicineId,
          medicineId,
          name: medicine.name,
          genericName: medicine.genericName || "",
          category: medicine.category || "",
          info: medicine.info || "",
          listingId: medicine.id !== medicineId ? medicine.id : null,
          price: Number.isFinite(Number(medicine.price)) ? Number(medicine.price) : null,
          stock: Number(medicine.stock) || 0,
          pharmacyId: medicine.pharmacyId || null,
          pharmacy: medicine.pharmacy || "No approved pharmacy listing",
          location: medicine.location || "",
          address: medicine.address || "",
          createdAt: new Date().toISOString(),
        }, ...current]);
      setNotice(result.message);
    } catch (err) {
      setError(err.message || (isLiked ? "Failed to unlike medicine." : "Failed to like medicine."));
    } finally {
      setSavingMedicineId(null);
    }
  };

  const completeReservation = useCallback(async (listing, userId) => {
    setReservingListingId(listing.id);
    try {
      const result = await apiReserveMedicine(userId, listing.id, 1);
      const optimisticReservation = {
        id: result.reservation?.id || `reservation-${listing.id}-${Date.now()}`,
        listingId: listing.id,
        medicine: listing.name,
        genericName: listing.genericName,
        pharmacy: listing.pharmacy,
        pharmacyId: listing.pharmacyId,
        location: listing.location,
        quantity: 1,
        status: result.reservation?.status || "pending",
        createdAt: new Date().toISOString(),
      };
      setReservations((current) => [optimisticReservation, ...current.filter((item) => item.id !== optimisticReservation.id)]);
      setReservationCartOpen(true);
      setNotice(result.message || "Medicine reserved.");
      try {
        setReservations(await getUserReservations(userId));
        setReservationsLoadedFor(userId);
      } catch (err) {
        setReservationsLoadedFor(userId);
        setError(`Reservation placed, but the cart could not be refreshed: ${err.message}`);
      }
    } catch (err) {
      setError(err.message || "Failed to reserve medicine.");
    } finally {
      setReservingListingId(null);
    }
  }, []);

  useEffect(() => {
    if (!reservationUserId) return undefined;
    let active = true;
    getUserReservations(reservationUserId)
      .then((items) => {
        if (!active) return;
        setReservations(items);
        setReservationsLoadedFor(reservationUserId);
      })
      .catch((err) => {
        if (!active) return;
        setError(err.message || "Failed to load your reservations.");
        setReservationsLoadedFor(reservationUserId);
      });
    return () => { active = false; };
  }, [reservationUserId]);

  const reservePendingAfterAuth = async (authenticatedUser) => {
    if (!pendingReservation) return;
    setPendingReservation(null);
    if (authenticatedUser.role !== "patient") {
      setError("Reservations are available with a patient account. Sign in as a patient to reserve this medicine.");
      return;
    }
    await completeReservation(pendingReservation, authenticatedUser.id);
  };

  const removeReservation = async (reservation) => {
    if (!user || removingReservationId) return;
    setRemovingReservationId(reservation.id);
    setError("");
    try {
      const result = await removeUserReservation(user.id, reservation.id);
      setReservations((current) => current.filter((item) => item.id !== reservation.id));
      setNotice(result.message || "Reservation removed.");
    } catch (err) {
      setError(err.message || "Failed to remove reservation.");
    } finally {
      setRemovingReservationId(null);
    }
  };

  const selectRegistrationLocation = async (coordinates) => {
    setRegistrationCoordinates(coordinates);
    const request = ++registrationLocationRequest.current;
    const area = await reverseGeocode(coordinates);
    if (request === registrationLocationRequest.current) setRegistrationLocation(area);
  };

  const locateRegistrationStore = async () => {
    setRegistrationLocating(true);
    setAuthError("");
    try {
      await selectRegistrationLocation(await getCurrentPosition());
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setRegistrationLocating(false);
    }
  };

  const search = useCallback(async (searchQuery = query, locationQuery = location, coordinates = userCoordinates, searchRadiusKm = radiusKm, searchSort = sort, pharmacyFilterId = selectedPharmacyId) => {
    setLoading(true);
    setError("");
    try {
      const [data, pharmacyData] = await Promise.all([
        searchMedicines(
          {
            q: searchQuery,
            location: locationQuery,
            maxPrice,
            sort: searchSort,
            latitude: coordinates?.latitude,
            longitude: coordinates?.longitude,
            radiusKm: searchRadiusKm,
            pharmacyId: pharmacyFilterId,
          },
          user
        ),
        getNearbyPharmacies(locationQuery, coordinates),
      ]);
      setMedicines(data.medicines);
      setNearbyPharmacies(pharmacyData);
      setNearbySearchLocation(locationQuery);
      setNearbySearchActive(Boolean(coordinates || locationQuery.trim()));
      setView("home");
    } catch (err) {
      setError(err.message || "Failed to search medicines.");
    } finally {
      setLoading(false);
    }
  }, [query, location, userCoordinates, maxPrice, sort, radiusKm, user, selectedPharmacyId]);

  // Initial data loading & user session check
  useEffect(() => {
    searchMedicines({ sort: "price-asc" })
      .then((data) => setMedicines(data.medicines))
      .catch((err) => setError(err.message || "Failed to load catalogue."));
    getApprovedPharmacies()
      .then((pharmacies) => {
        setPharmacyOptions(pharmacies);
        setPharmacyOptionsLoaded(true);
      })
      .catch((err) => {
        setError(err.message || "Failed to load pharmacy stores.");
        setPharmacyOptionsLoaded(true);
      });

    getCurrentUser()
      .then((currentUser) => {
        if (currentUser) {
          setUser(currentUser);
          if (currentUser.role === "owner") setView("owner-dashboard");
        }
      })
      .catch(() => {
        setUser(null);
      });
  }, []);

  useEffect(() => {
    if (user?.role !== "patient") return undefined;
    let active = true;
    const loadSavedItems = async () => {
      setSavedDataLoading(true);
      setSavedDataError("");
      const [pharmaciesResult, medicinesResult] = await Promise.allSettled([
        getSavedPharmacies(user.id),
        getLikedMedicines(user.id),
      ]);
      if (!active) return;
      if (pharmaciesResult.status === "fulfilled") setSaved(pharmaciesResult.value);
      if (medicinesResult.status === "fulfilled") setLikedMedicines(medicinesResult.value);
      const errors = [pharmaciesResult, medicinesResult]
        .filter((result) => result.status === "rejected")
        .map((result) => result.reason?.message || "Saved items could not be loaded.");
      setSavedDataError(errors.join(" "));
      setSavedDataOwnerId(user.id);
      setSavedDataLoading(false);
    };
    loadSavedItems();
    return () => { active = false; };
  }, [user?.id, user?.role, savedDataRefresh]);

  // View data fetching based on current authenticated state & view
  useEffect(() => {
    if (!user) return;
    if (view === "history") {
      getSearchHistory(user.id)
        .then((items) => setHistory(items))
        .catch((err) => setError(err.message));
    } else if (view === "profile") {
      getProfile(user.id)
        .then((data) => setProfileData(data))
        .catch((err) => setError(err.message));
    } else if (view === "owner" || view === "owner-dashboard") {
      getOwnerDashboard(user.id)
        .then(setOwnerData)
        .catch((err) => setError(err.message));
    } else if (view === "admin") {
      getAdminDashboard()
        .then(setAdminData)
        .catch((err) => setError(err.message));
    }
  }, [user, view, refreshVersion]);

  const handleSearch = async (event) => {
    event.preventDefault();
    if (pharmacyQuery.trim() && !selectedPharmacyId) {
      setError("Choose a pharmacy from the store list or clear the pharmacy filter.");
      return;
    }
    if (location.trim() && !userCoordinates) {
      setLoading(true);
      setError("");
      try {
        const locationQuery = location.trim();
        const coordinates = await geocodeLocation(locationQuery);
        setUserCoordinates(coordinates);
        setSearchMapCenter(coordinates);
        setRadiusKm(50);
        setSort("distance-asc");
        await search(query, locationQuery, coordinates, 50, "distance-asc");
      } catch (err) {
        setError(err.message || "Could not find medicines for that location.");
        setLoading(false);
      }
      return;
    }
    await search(query, location, userCoordinates, radiusKm, userCoordinates ? sort : "price-asc");
  };

  const uniquePharmacyOptions = [...new Map(pharmacyOptions.map((pharmacy) => [pharmacyIdentity(pharmacy), pharmacy])).values()];
  const uniqueSavedPharmacies = [...new Map(saved.map((pharmacy) => [pharmacyIdentity(pharmacy), pharmacy])).values()];
  const visiblePharmacyOptions = uniquePharmacyOptions.filter((pharmacy) => {
    const searchTerm = pharmacyQuery.trim().toLowerCase();
    return !searchTerm || `${pharmacy.name} ${pharmacy.location || ""}`.toLowerCase().includes(searchTerm);
  });
  const registeredPharmacyIds = new Set(pharmacyOptions.map((pharmacy) => pharmacy.id));
  const registeredMedicines = pharmacyOptionsLoaded
    ? medicines.filter((medicine) => registeredPharmacyIds.has(medicine.pharmacyId))
    : medicines;

  const choosePharmacy = async (pharmacy) => {
    setSelectedPharmacyId(pharmacy.id);
    setPharmacyQuery(pharmacy.name);
    setPharmacyMenuOpen(false);
    if (location.trim() && !userCoordinates) {
      setLoading(true);
      setError("");
      try {
        const coordinates = await geocodeLocation(location.trim());
        setUserCoordinates(coordinates);
        setSearchMapCenter(coordinates);
        setRadiusKm(50);
        setSort("distance-desc");
        await search(query, location, coordinates, 50, "distance-desc", pharmacy.id);
      } catch (err) {
        setError(err.message || "Could not find medicines near that location.");
        setLoading(false);
      }
      return;
    }
    search(query, location, userCoordinates, radiusKm, sort, pharmacy.id);
  };

  const clearPharmacyFilter = () => {
    setSelectedPharmacyId("");
    setPharmacyQuery("");
    setPharmacyMenuOpen(false);
    search(query, location, userCoordinates, radiusKm, sort, "");
  };

  const selectSearchLocation = async (coordinates) => {
    setUserCoordinates(coordinates);
    setSearchMapCenter(coordinates);
    setRadiusKm(50);
    setSort("distance-asc");
    const request = ++searchLocationRequest.current;
    const area = await reverseGeocode(coordinates);
    if (request === searchLocationRequest.current) setLocation(area);
  };

  const toggleSearchMap = async () => {
    if (searchMapOpen) {
      setSearchMapOpen(false);
      return;
    }
    setError("");
    if (userCoordinates) {
      setSearchMapCenter(userCoordinates);
    } else if (location.trim()) {
      try {
        setSearchMapCenter(await geocodeLocation(location.trim()));
      } catch (err) {
        setError(err.message || "Could not locate that city or area.");
        return;
      }
    } else {
      setSearchMapCenter(null);
    }
    setSearchMapOpen(true);
  };

  const locateMe = async () => {
    setLocating(true);
    setError("");
    try {
      const coordinates = await getCurrentPosition();
      setUserCoordinates(coordinates);
      setSearchMapCenter(coordinates);
      setRadiusKm(50);
      setSort("distance-asc");
      const nearbyLocation = await reverseGeocode(coordinates);
      setLocation(nearbyLocation);
      await search(query, nearbyLocation, coordinates, 50, "distance-asc");
    } catch (err) {
      setError(err.message);
    } finally {
      setLocating(false);
    }
  };

  const handleAuth = async (event) => {
    event.preventDefault();
    if (authLoading) return;
    setAuthLoading(true);
    setAuthError("");
    setError("");

    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());

    try {
      if (authMode === "login") {
        const data = await loginUser({
          email: payload.email,
          password: payload.password,
        });
        setSaved([]);
        setLikedMedicines([]);
        setUser(data.user);
        setView(data.user.role === "owner" ? "owner-dashboard" : "home");
        setAuthOpen(false);
        setNotice(data.message || `Welcome, ${data.user.name}.`);
        setError("");
        await reservePendingAfterAuth(data.user);
      } else {
        if (authRole === "owner" && !registrationCoordinates) {
          throw new Error("Pin your store location on the map before creating an owner account.");
        }
        const registration = { ...payload, role: authRole };
        if (authRole === "owner") {
          registration.location = registrationLocation || payload.location;
          registration.latitude = registrationCoordinates.latitude;
          registration.longitude = registrationCoordinates.longitude;
        }
        const data = await signUpUser({
          ...registration,
        });

        if (data.requiresEmailConfirmation) {
          setNotice(data.message);
          setAuthOpen(false);
        } else {
          setSaved([]);
          setLikedMedicines([]);
          setUser(data.user);
          setView(data.user?.role === "owner" ? "owner-dashboard" : "home");
          setAuthOpen(false);
          setNotice(data.message || `Welcome, ${data.user?.name || ""}.`);
          await reservePendingAfterAuth(data.user);
        }
        setError("");
      }
    } catch (err) {
      setAuthError(err.message || "Authentication failed. Please try again.");
    } finally {
      setAuthLoading(false);
    }
  };

  const signOut = async () => {
    try {
      await signOutUser();
    } catch {
      // Ignored
    }
    setUser(null);
    setSaved([]);
    setLikedMedicines([]);
    setReservations([]);
    setReservationsLoadedFor(null);
    setReservationCartOpen(false);
    setView("home");
    setNotice("You have been signed out.");
  };

  const openMedicine = async (medicine) => {
    try {
      const data = await getMedicineDetails(medicine.medicineId || medicine.id);
      setDetail(data);
    } catch (err) {
      setError(err.message || "Failed to load medicine details.");
    }
  };

  const reserveMedicine = async (listing) => {
    if (!user) {
      setPendingReservation(listing);
      setAuthMode("login");
      setAuthError("");
      setAuthOpen(true);
      return;
    }
    if (user.role !== "patient") {
      setError("Reservations are available with a patient account.");
      return;
    }
    await completeReservation(listing, user.id);
  };

  const toggleSavedPharmacy = async (pharmacy, isSaved) => {
    if (!user) {
      setAuthMode("login");
      setAuthOpen(true);
      return;
    }
    if (user.role !== "patient") {
      setError("Saved stores are available with a patient account.");
      return;
    }
    if (savingPharmacyId) return;
    const pharmacyId = pharmacy.id;
    setSavingPharmacyId(pharmacyId);
    try {
      const data = isSaved
        ? await apiRemoveSavedPharmacy(user.id, pharmacyId)
        : await apiSavePharmacy(user.id, pharmacyId);
      setSaved((current) => isSaved
        ? current.filter((item) => item.id !== pharmacyId)
        : current.some((item) => item.id === pharmacyId) ? current : [...current, pharmacy]);
      setNotice(data.message);
    } catch (err) {
      setError(err.message || (isSaved ? "Failed to remove saved pharmacy." : "Failed to save pharmacy."));
    } finally {
      setSavingPharmacyId(null);
    }
  };

  const ratePharmacy = async (pharmacyId, rating) => {
    if (!user) {
      setAuthMode("login");
      setAuthOpen(true);
      return;
    }
    try {
      const data = await apiRatePharmacy(pharmacyId, rating);
      setNotice(data.message);
      await search();
    } catch (err) {
      setError(err.message || "Failed to rate pharmacy.");
    }
  };

  const submitReport = async (event) => {
    event.preventDefault();
    if (!user) {
      setAuthMode("login");
      setAuthOpen(true);
      return;
    }
    const form = new FormData(event.currentTarget);
    try {
      const data = await apiSubmitReport(user.id, {
        ...Object.fromEntries(form.entries()),
        subject: reportTarget?.name || "Catalogue feedback",
      });
      setReportTarget(null);
      setNotice(data.message);
    } catch (err) {
      setError(err.message || "Failed to submit report.");
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" onClick={(event) => { event.preventDefault(); setView(user?.role === "owner" ? "owner-dashboard" : "home"); }}>
          <span className="brand-mark">✚</span>
          <span>medlytic<span className="brand-dot">.</span><small>care, within reach</small></span>
        </a>
        <nav className="main-nav" aria-label="Main navigation">
          {user?.role === "owner"
            ? <>
              <button className={view === "owner-dashboard" ? "nav-link active" : "nav-link"} onClick={() => setView("owner-dashboard")}>Owner dashboard</button>
              <button className={view === "owner" ? "nav-link active" : "nav-link"} onClick={() => setView("owner")}>Store dashboard</button>
            </>
            : <button className={view === "home" ? "nav-link active" : "nav-link"} onClick={() => setView("home")}>Find medicines</button>}
          {user?.role === "patient" && <>
            <button className={view === "history" ? "nav-link active" : "nav-link"} onClick={() => setView("history")}>My searches</button>
            <button className={view === "saved" ? "nav-link active" : "nav-link"} onClick={() => setView("saved")}>Saved stores</button>
            <button className={view === "profile" ? "nav-link active" : "nav-link"} onClick={() => setView("profile")}>Profile</button>
          </>}
          {user?.role === "admin" && <button className={view === "admin" ? "nav-link active" : "nav-link"} onClick={() => setView("admin")}>Admin dashboard</button>}
        </nav>
        <div className="account-actions">
          {user ? <><span className="user-greeting">{user.name}</span><button className="button button-outline button-small" onClick={signOut}>Sign out</button></> :
            <><button className="button button-quiet" onClick={() => { setAuthMode("login"); setAuthError(""); setAuthOpen(true); }}>Log in</button><button className="button button-primary button-small" onClick={() => { setAuthMode("register"); setAuthRole("patient"); setRegistrationCoordinates(null); setRegistrationLocation(""); setAuthError(""); setAuthOpen(true); }}>Create account</button></>}
        </div>
      </header>

      <main>
        {error && view !== "home" && !authOpen && !detail && !reportTarget && <div className="content-section alert alert-error dashboard-alert" role="alert">{error}<button onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}
        {notice && view !== "home" && <div className="content-section alert alert-success dashboard-alert" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Dismiss notification">×</button></div>}
        {view === "home" && <>
          <section className="hero">
            <div className="hero-copy">
              <span className="eyebrow"><span className="pulse-dot" /> YOUR LOCAL MEDICINE GUIDE</span>
              <h1>Find the right<br /><em>medicine.</em><br />At the right price.</h1>
              <p>Compare real-time availability and prices from pharmacies near you. Better access starts with better information.</p>
              <div className="trust-line"><span><i>✓</i> Verified pharmacy listings</span><span><i>%</i> Price transparency</span><span><i>⌖</i> Always free to search</span></div>
            </div>
            <div className="hero-art" aria-hidden="true">
              <div className="art-ring ring-one" /><div className="art-ring ring-two" />
              <div className="leaf leaf-one" /><div className="leaf leaf-two" /><div className="leaf leaf-three" />
              <div className="hero-pedestal" />
              <div className="pill-bottle"><div className="bottle-cap" /><div className="bottle-label"><span>✚ HEALTH FIRST</span><b>Better<br />Health<br />Everyday</b><small>SAFE · RELIABLE · ACCESSIBLE</small></div></div>
              <div className="blister-pack"><i /><i /><i /><i /><i /><i /></div>
              <div className="floating-pill pill-a" /><div className="floating-pill pill-b" /><div className="floating-pill pill-c" />
              <div className="art-note"><span>♡</span> Small steps to<br />better health</div>
            </div>
            <form className="search-form" onSubmit={handleSearch}>
              <label className="search-field"><span>⌕</span><input aria-label="Medicine names" placeholder="Medicines (separate multiple with commas)" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
              <label className="search-field location-field"><span>⌖</span><input aria-label="Location" placeholder="City or area" value={location} onChange={(event) => { setLocation(event.target.value); setUserCoordinates(null); setSearchMapCenter(null); setSearchMapOpen(false); setSort("price-asc"); }} /></label>
              <button className="button button-outline button-small locate-button" type="button" onClick={locateMe} disabled={locating}>{locating ? "Locating…" : "Locate me"}</button>
              <button className="button button-outline button-small map-select-button" type="button" onClick={toggleSearchMap} aria-expanded={searchMapOpen} aria-controls="search-location-map">{searchMapOpen ? "Close map" : "Select on map"}</button>
              <button className="button button-primary search-submit" type="submit" disabled={loading}>{loading ? "Searching…" : "Search medicines"} <span>↗</span></button>
            </form>
            <a className="map-attribution search-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">Location lookup © OpenStreetMap</a>
          </section>

          <section className="content-section results-section">
            {searchMapOpen && <div className="search-location-map" id="search-location-map">
              <StoreLocationPicker
                position={userCoordinates}
                initialPosition={searchMapCenter}
                purpose="search"
                onSelect={selectSearchLocation}
                onUseCurrentLocation={locateMe}
                locating={locating}
                disabled={loading}
              />
            </div>}
            <div className="section-heading">
              <div><span className="eyebrow">LOCAL AVAILABILITY</span><h2>{query ? `Results for “${query}”` : "Popular medicines"}</h2><p>{userCoordinates ? `In-stock medicines within ${radiusKm} km by road${sort === "distance-desc" ? ", farthest first." : sort === "distance-asc" ? ", closest first." : "."}` : "Prices and stock reported by listed pharmacies."}</p></div>
              <div className="result-controls">
                <div className="pharmacy-filter">
                  <label className="sort-control" htmlFor="pharmacy-filter-search">Pharmacy</label>
                  <div className="pharmacy-picker">
                    <input
                      id="pharmacy-filter-search"
                      type="search"
                      role="combobox"
                      aria-label="Search pharmacy stores"
                      aria-expanded={pharmacyMenuOpen}
                      aria-controls="pharmacy-filter-options"
                      aria-autocomplete="list"
                      placeholder="All stores"
                      value={pharmacyQuery}
                      onFocus={() => setPharmacyMenuOpen(true)}
                      onChange={(event) => {
                        setPharmacyQuery(event.target.value);
                        setSelectedPharmacyId("");
                        setPharmacyMenuOpen(true);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setPharmacyMenuOpen(false);
                        if (event.key === "Enter" && pharmacyMenuOpen && visiblePharmacyOptions[0]) {
                          event.preventDefault();
                          choosePharmacy(visiblePharmacyOptions[0]);
                        }
                      }}
                    />
                    {selectedPharmacyId && <button type="button" className="pharmacy-filter-clear" aria-label="Clear pharmacy filter" onClick={clearPharmacyFilter}>×</button>}
                    {pharmacyMenuOpen && <div className="pharmacy-picker-menu" id="pharmacy-filter-options" role="listbox">
                      <button type="button" className="pharmacy-picker-option all-stores" role="option" aria-selected={!selectedPharmacyId} onMouseDown={(event) => event.preventDefault()} onClick={clearPharmacyFilter}>All pharmacies</button>
                      {visiblePharmacyOptions.length ? visiblePharmacyOptions.map((pharmacy) => <button
                        type="button"
                        className="pharmacy-picker-option"
                        role="option"
                        aria-selected={selectedPharmacyId === pharmacy.id}
                        key={pharmacy.id}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => choosePharmacy(pharmacy)}
                      ><span>{pharmacy.name}</span><small>{pharmacy.location}</small></button>) : <p className="pharmacy-picker-empty">No matching pharmacies</p>}
                    </div>}
                  </div>
                </div>
                {userCoordinates && <label className="sort-control"><span>Within</span><select aria-label="Nearby search radius" value={radiusKm} onChange={(event) => {
                  const nextRadius = Number(event.target.value);
                  setRadiusKm(nextRadius);
                  search(query, location, userCoordinates, nextRadius, sort);
                }}><option value="5">5 km</option><option value="10">10 km</option><option value="20">20 km</option><option value="50">50 km</option><option value="100">100 km</option></select></label>}
                <label className="sort-control"><span>Sort by</span><select value={sort} onChange={(event) => { const nextSort = event.target.value; setSort(nextSort); search(query, location, userCoordinates, radiusKm, nextSort); }}><option value="price-asc">Price: low to high</option><option value="price-desc">Price: high to low</option><option value="rating">Pharmacy rating</option>{userCoordinates && <><option value="distance-desc">Distance: far to near</option><option value="distance-asc">Distance: near to far</option></>}</select></label>
              </div>
            </div>
            <label className="price-filter">Max price <span>₹</span><input aria-label="Maximum price" type="number" min="0" placeholder="Any" value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)} /><button onClick={() => search()} type="button">Apply</button></label>
            {error && <div className="alert alert-error" role="alert">{error}</div>}
            {notice && <div className="alert alert-success" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Dismiss notification">×</button></div>}

            {nearbySearchActive && <NearbyPharmacies pharmacies={nearbyPharmacies} location={nearbySearchLocation} onDetails={setPharmacyDetail} />}
            {registeredMedicines.length ? <div className="medicine-grid">{registeredMedicines.map((medicine) =>
              <MedicineCard key={medicine.id} medicine={medicine} reserving={reservingListingId === medicine.id} savingPharmacy={savingPharmacyId === medicine.pharmacyId} savedPharmacy={saved.some((pharmacy) => pharmacy.id === medicine.pharmacyId)} savingMedicine={savingMedicineId === medicine.medicineId} liked={likedMedicines.some((item) => item.id === medicine.medicineId)} onDetails={() => openMedicine(medicine)} onReserve={() => reserveMedicine(medicine)} onTogglePharmacy={(isSaved) => toggleSavedPharmacy({ id: medicine.pharmacyId, name: medicine.pharmacy, location: medicine.location, address: medicine.address, phone: medicine.phone, latitude: medicine.latitude, longitude: medicine.longitude, rating: medicine.rating }, isSaved)} onToggleLike={(isLiked) => toggleLikedMedicine(medicine, isLiked)} onRate={(rating) => ratePharmacy(medicine.pharmacyId, rating)} />)}</div>
              : <div className="empty-state"><span>⌕</span><h3>No matching medicines</h3><p>Try another name or broaden your location.</p></div>}
          </section>
          <section className="how-section">
            <div><span className="eyebrow">SIMPLE BY DESIGN</span><h2>Good care starts with a good search.</h2></div>
            <div className="how-grid"><article><span>01</span><h3>Search locally</h3><p>Find medicines at participating pharmacies in your area.</p></article><article><span>02</span><h3>Compare clearly</h3><p>Check reported prices, stock and community ratings side by side.</p></article><article><span>03</span><h3>Choose confidently</h3><p>Contact a pharmacy or reserve an item for pickup.</p></article></div>
          </section>
        </>}
        {view === "history" && <section className="content-section dashboard-section"><SectionTitle eyebrow="YOUR ACCOUNT" title="Recent medicine searches" sub="Pick up where you left off." />{history.length ? <div className="history-list">{history.map((item) => <button key={item.id} onClick={() => { setQuery(item.query); search(item.query); }}><span className="history-icon">⌕</span><span><b>{item.query}</b><small>{new Date(item.createdAt).toLocaleString()}</small></span><span className="history-arrow">↗</span></button>)}</div> : <EmptyDashboard text="Your searches will appear here after you look up a medicine." />}</section>}
        {view === "saved" && <SavedPage likedMedicines={likedMedicines} pharmacies={uniqueSavedPharmacies} loading={savedDataLoading || savedDataOwnerId !== user?.id} error={savedDataError} busyMedicineId={savingMedicineId} busyPharmacyId={savingPharmacyId} onRetry={() => setSavedDataRefresh((version) => version + 1)} onFindMedicines={() => setView("home")} onUnlike={(medicine) => toggleLikedMedicine(medicine, true)} onUnsave={(pharmacy) => toggleSavedPharmacy(pharmacy, true)} onMedicineDetails={openMedicine} onPharmacyDetails={setPharmacyDetail} />}
        {view === "profile" && <ProfilePanel key={profileData?.name || ""} profile={profileData} user={user} onChange={setUser} onError={setError} onNotice={setNotice} />}
        {view === "owner-dashboard" && <OwnerOverview data={ownerData} ownerName={user?.name} onOpenStore={() => setView("owner")} onUpdateReservationStatus={updateReservationStatus} updatingReservationId={updatingReservationId} />}
        {view === "owner" && <OwnerDashboard data={ownerData} user={user} onRefresh={() => setRefreshVersion((version) => version + 1)} onError={setError} onNotice={setNotice} onUpdateReservationStatus={updateReservationStatus} updatingReservationId={updatingReservationId} />}
        {view === "admin" && <AdminDashboard data={adminData} currentAdminId={user?.id} onRefresh={() => setRefreshVersion((version) => version + 1)} onError={setError} onNotice={setNotice} />}
      </main>

      {view === "home" && !authOpen && !detail && !reportTarget && <FloatingMedicineChatbot medicines={medicines} currentQuery={query} />}

      <footer className="site-footer"><a className="brand footer-brand" href="/" onClick={(event) => { event.preventDefault(); setView("home"); }}><span className="brand-mark">✚</span><span>medlytic<span className="brand-dot">.</span></span></a><span>Medicine information is for general awareness only. Always follow your clinician’s advice.</span><span>© 2026 Medlytic</span></footer>

      {user?.role === "patient" && <>
        <button className="reservation-cart-toggle" type="button" onClick={() => setReservationCartOpen(true)} aria-label={`Open reservations cart, ${reservations.length} reserved medicines`}>
          <span aria-hidden="true">▣</span><span>My reservations</span><b>{reservations.reduce((total, item) => total + Number(item.quantity || 0), 0)}</b>
        </button>
        {reservationCartOpen && <div className="reservation-cart-layer">
          <button className="reservation-cart-backdrop" type="button" aria-label="Close reservations cart" onClick={() => setReservationCartOpen(false)} />
          <aside className="reservation-cart" role="dialog" aria-modal="true" aria-labelledby="reservation-cart-title">
            <header className="reservation-cart-header">
              <div><span className="eyebrow">YOUR REQUESTS</span><h2 id="reservation-cart-title">My reservations</h2><p>Medicine requests sent to your pharmacies.</p></div>
              <button className="reservation-cart-close" type="button" onClick={() => setReservationCartOpen(false)} aria-label="Close reservations cart">×</button>
            </header>
            <div className="reservation-cart-body">
              {error && <div className="alert alert-error" role="alert">{error}<button type="button" onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}
              {reservationsLoading ? <p className="reservation-cart-message">Loading your reservations…</p>
                : reservations.length ? reservations.map((item) => <article className="reservation-cart-item" key={item.id}>
                  <div className="reservation-cart-medicine"><span aria-hidden="true">✚</span><div><b>{item.medicine}</b>{item.genericName && <small>{item.genericName}</small>}</div></div>
                  <p className="reservation-cart-pharmacy">{item.pharmacy}{item.location ? ` · ${item.location}` : ""}</p>
                  <div className="reservation-cart-item-meta"><span>Qty <b>{item.quantity}</b></span><span className={`status-tag ${item.status}`}>{item.status}</span></div>
                  <div className="reservation-cart-item-footer">
                    {item.createdAt && <small className="reservation-cart-date">{new Date(item.createdAt).toLocaleDateString()}</small>}
                    <button className="reservation-remove-button" type="button" disabled={removingReservationId !== null} onClick={() => removeReservation(item)}>{removingReservationId === item.id ? "Removing…" : "Remove"}</button>
                  </div>
                </article>) : <div className="reservation-cart-empty"><span aria-hidden="true">▣</span><h3>No reservations yet</h3><p>Reserve an in-stock medicine and it will appear here.</p><button type="button" className="button button-primary button-small" onClick={() => { setReservationCartOpen(false); setView("home"); }}>Find medicines</button></div>}
            </div>
            {!!reservations.length && <footer className="reservation-cart-footer"><span>{reservations.length} {reservations.length === 1 ? "request" : "requests"} · {reservations.reduce((total, item) => total + Number(item.quantity || 0), 0)} items</span><button type="button" className="button button-outline button-small" onClick={() => setReservationCartOpen(false)}>Continue browsing</button></footer>}
          </aside>
        </div>}
      </>}

      {authOpen && (
        <Modal
          className="auth-modal"
          showHeading={false}
          title={authMode === "login" ? "Welcome back" : "Create your account"}
          onClose={() => {
            if (!authLoading) {
              setAuthOpen(false);
              setAuthError("");
            }
          }}
        >
          <div className="auth-layout">
            <section className="auth-story">
              <a className="auth-brand" href="/" onClick={(event) => { event.preventDefault(); setAuthOpen(false); setView("home"); }}>
                <span className="brand-mark">✚</span>
                <span>medlytic<small>Smart medicine. Better health.</small></span>
              </a>
              <div className="auth-story-copy">
                <span className="eyebrow">CARE, WITHIN REACH</span>
                <h2>Healthcare<br />made <em>simpler.</em></h2>
                <p>Find the right medicine, compare prices, and get the care you need — all in one place.</p>
                <div className="auth-benefits">
                  <span><i>⌖</i> Nearby pharmacies</span>
                  <span><i>✓</i> Verified listings</span>
                  <span><i>₹</i> Clear prices</span>
                </div>
              </div>
              <div className="auth-illustration" aria-hidden="true">
                <div className="auth-leaf auth-leaf-one" /><div className="auth-leaf auth-leaf-two" /><div className="auth-leaf auth-leaf-three" />
                <div className="auth-bottle"><span>✚</span></div>
                <div className="auth-pill auth-pill-one" /><div className="auth-pill auth-pill-two" />
                <span className="auth-script">Because your<br />health comes first</span>
              </div>
            </section>
            <section className="auth-form-panel">
              <header className="auth-form-heading">
                <span className="eyebrow">MEDLYTIC</span>
                <h2>{authMode === "login" ? "Welcome back" : "Create your account"}</h2>
                <p>{authMode === "login" ? "Sign in to continue your care journey." : "Join Medlytic to find care closer to home."}</p>
              </header>
              <form className="stack-form auth-form" onSubmit={handleAuth}>
                {authMode === "register" && (
                  <>
                    <label>
                      I am a
                      <select
                        value={authRole}
                        onChange={(event) => { setAuthRole(event.target.value); setRegistrationCoordinates(null); setRegistrationLocation(""); }}
                        disabled={authLoading}
                      >
                        <option value="patient">Patient</option>
                        <option value="owner">Medical store owner</option>
                      </select>
                    </label>
                    <label>
                      Your name
                      <input name="name" required autoComplete="name" placeholder="Enter your name" disabled={authLoading} />
                    </label>
                    {authRole === "owner" && (
                      <>
                        <label>
                          Store location
                          <input
                            name="location"
                            required
                            placeholder="Select a point on the map"
                            value={registrationLocation}
                            onChange={(event) => setRegistrationLocation(event.target.value)}
                            disabled={authLoading}
                          />
                        </label>
                        <StoreLocationPicker
                          position={registrationCoordinates}
                          onSelect={selectRegistrationLocation}
                          onUseCurrentLocation={locateRegistrationStore}
                          locating={registrationLocating}
                          disabled={authLoading}
                        />
                        <label>
                          Pharmacy name
                          <input name="pharmacyName" required disabled={authLoading} />
                        </label>
                      </>
                    )}
                  </>
                )}
                <label>
                  Email address
                  <input name="email" type="email" required autoComplete="email" placeholder="Enter your email" disabled={authLoading} />
                </label>
                <label>
                  Password
                  <input
                    name="password"
                    type="password"
                    required
                    minLength="8"
                    autoComplete={authMode === "login" ? "current-password" : "new-password"}
                    placeholder={authMode === "login" ? "Enter your password" : "Create a password"}
                    disabled={authLoading}
                  />
                </label>
                {authError && <div className="alert alert-error" role="alert">{authError}</div>}
                <button
                  className="button button-primary button-full"
                  type="submit"
                  disabled={authLoading}
                >
                  {authLoading
                    ? (authMode === "login" ? "Signing in…" : "Creating account…")
                    : (authMode === "login" ? "Log in" : "Create account")} <span aria-hidden="true">→</span>
                </button>
              </form>
              <button
                className="text-button modal-toggle"
                disabled={authLoading}
                onClick={() => {
                  setAuthMode(authMode === "login" ? "register" : "login");
                  setAuthError("");
                }}
              >
                {authMode === "login"
                  ? <>New to Medlytic? <b>Create an account</b></>
                  : <>Already have an account? <b>Log in</b></>}
              </button>
            </section>
          </div>
        </Modal>
      )}

      {detail && <Modal className="medicine-detail-modal" title={detail.medicine.name} onClose={() => setDetail(null)}>
        <div className="medicine-detail-content">
          <header className="medicine-detail-identity">
            <span className="medicine-detail-icon" aria-hidden="true">✚</span>
            <div><span className="eyebrow">MEDICINE DETAILS</span><p className="detail-generic">{detail.medicine.genericName || "Generic name not listed"}{detail.medicine.category ? ` · ${detail.medicine.category}` : ""}</p></div>
          </header>
          <section className="detail-info">
            <h3>About this medicine</h3>
            <p>{detail.medicine.info || "Ask a pharmacist or clinician for medicine-specific guidance."}</p>
            <div className="medical-disclaimer"><span aria-hidden="true">!</span><p>General information only — not a diagnosis or treatment recommendation. Do not start, stop, or change medication without advice from a qualified health professional.</p></div>
          </section>
          <MedicineChatbot medicine={detail.medicine} alternatives={detail.alternatives} />
          <section className="alternatives">
            <div><h3>Similar medicines</h3><p>{detail.alternatives.length ? detail.alternatives.map((alternative) => <span className="medicine-alternative-chip" key={alternative}>{alternative}</span>) : <span className="medicine-no-alternatives">No similar medicines are listed in the catalogue.</span>}</p></div>
            <small>Similar active ingredients do not mean medicines are interchangeable. Ask a pharmacist or clinician before switching.</small>
          </section>
          <section className="medicine-listings-section">
            <header className="medicine-listings-heading"><div><h3>Available pharmacies</h3><p>Prices and stock reported by registered pharmacies.</p></div><span>{detail.listings.length} {detail.listings.length === 1 ? "store" : "stores"}</span></header>
            {detail.listings.length ? <div className="medicine-listings">{detail.listings.map((listing) => {
              const stock = Number(listing.stock);
              const stockStatus = stock <= 0 ? "out" : stock <= 5 ? "low" : "in";
              return <article className="medicine-listing-card" key={listing.id}>
                <div className="medicine-listing-main"><span className="medicine-listing-store-icon" aria-hidden="true">⌂</span><div className="medicine-listing-store"><b>{listing.pharmacy || "Pharmacy"}</b><small>{listing.location || "Location not provided"}{listing.address && listing.address !== listing.location ? ` · ${listing.address}` : ""}</small><span className={`medicine-listing-stock ${stockStatus}`}>{stockStatus === "out" ? "Out of stock" : stockStatus === "low" ? `Low stock · ${stock} left` : `In stock · ${stock} available`}</span></div></div>
                <div className="medicine-listing-actions"><strong>₹{Number(listing.price).toFixed(2)}</strong><a className="button button-outline button-small listing-directions" href={pharmacyDirectionsUrl(listing, userCoordinates)} target="_blank" rel="noreferrer">Directions <span aria-hidden="true">↗</span></a></div>
              </article>;
            })}</div> : <div className="medicine-listings-empty">No registered pharmacies currently list this medicine.</div>}
          </section>
          {user?.role === "patient" && <button className="text-button report-link" onClick={() => { setReportTarget({ name: detail.medicine.name }); setDetail(null); }}>Report incorrect information <span aria-hidden="true">↗</span></button>}
        </div>
      </Modal>}

      {pharmacyDetail && <Modal title={pharmacyDetail.name || pharmacyDetail.pharmacy || "Pharmacy details"} onClose={() => setPharmacyDetail(null)}>
        <div className="pharmacy-detail-summary">
          <span className="eyebrow">PHARMACY DETAILS</span>
          <p>{pharmacyDetail.location || "Location not provided"}</p>
          {pharmacyDetail.address && pharmacyDetail.address !== pharmacyDetail.location && <p>{pharmacyDetail.address}</p>}
          {pharmacyDetail.phone && pharmacyDetail.phone !== "Not provided" && <p><a href={`tel:${pharmacyDetail.phone}`}>{pharmacyDetail.phone}</a></p>}
          <p className="rating">★ {pharmacyDetail.rating || "New"}{Number.isFinite(pharmacyDetail.distanceKm) ? ` · ${pharmacyDetail.distanceKm.toFixed(1)} km away` : ""}</p>
        </div>
        <a className="button button-primary pharmacy-detail-directions" href={pharmacyDirectionsUrl(pharmacyDetail, userCoordinates)} target="_blank" rel="noreferrer">Get directions ↗</a>
      </Modal>}

      {reportTarget && <Modal title="Report information" onClose={() => setReportTarget(null)}><p className="modal-intro">Help us keep medicine and pharmacy information accurate. Reports are reviewed by the platform team.</p><form className="stack-form" onSubmit={submitReport}><label>Report type<select name="type"><option value="incorrect_price">Incorrect price</option><option value="incorrect_stock">Incorrect availability</option><option value="medicine_information">Medicine information</option><option value="complaint">Complaint</option></select></label><label>What should we review?<textarea name="details" required minLength="5" maxLength="1000" rows="4" /></label>{error && <div className="alert alert-error">{error}</div>}<button className="button button-primary button-full" type="submit">Send report</button></form></Modal>}
    </div>
  );
}

function OwnerOverview({ data, onOpenStore, ownerName, onUpdateReservationStatus, updatingReservationId }) {
  const listings = data?.listings || [];
  const reservations = [...(data?.reservations || [])].sort((first, second) =>
    new Date(second.createdAt || 0).getTime() - new Date(first.createdAt || 0).getTime()
  );
  const recentReservations = reservations.slice(0, 5);
  const lowStockListings = listings
    .filter((listing) => Number(listing.stock) > 0 && Number(listing.stock) <= 5)
    .sort((first, second) => Number(first.stock) - Number(second.stock))
    .slice(0, 5);
  const counts = listings.reduce((result, listing) => {
    const stock = Number(listing.stock);
    result.total += 1;
    if (stock === 0) result.out += 1;
    else if (stock <= 5) result.low += 1;
    else result.available += 1;
    return result;
  }, { total: 0, available: 0, low: 0, out: 0 });
  const reservationCounts = reservations.reduce((result, reservation) => {
    const status = String(reservation.status || "").toLowerCase().replace(/[\s-]+/g, "_");
    if (status === "pending") result.pending += 1;
    if (status === "ready" || status === "ready_for_pickup") result.ready += 1;
    return result;
  }, { pending: 0, ready: 0 });

  const metrics = [
    ["▧", "Total medicine listings", counts.total, "total"],
    ["✚", "Available medicines", counts.available, "available"],
    ["△", "Low-stock medicines", counts.low, "low"],
    ["▣", "Out-of-stock medicines", counts.out, "out"],
    ["▤", "Pending reservations", reservationCounts.pending, "pending"],
    ["↗", "Reservations ready for pickup", reservationCounts.ready, "ready"],
  ];

  const formatDate = (value) => {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? "—"
      : date.toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  };
  const reservationStatus = (status) => String(status || "pending").toLowerCase().replace(/[\s-]+/g, "_");

  return <section className="content-section dashboard-section owner-overview">
    <div className="owner-overview-welcome">
      <div>
        <span className="eyebrow">PHARMACY PORTAL</span>
        <h2>Owner dashboard</h2>
        <p>{data?.pharmacy?.name ? `A live overview of ${data.pharmacy.name}.` : "Your pharmacy overview and customer activity."}</p>
      </div>
      <div className="owner-overview-account"><span>{(ownerName || "O").slice(0, 1).toUpperCase()}</span><b>{ownerName || "Store owner"}</b></div>
    </div>

    <div className="owner-overview-metrics">
      {metrics.map(([icon, label, value, tone]) => <article className={`owner-overview-metric ${tone}`} key={label}>
        <span className="owner-overview-metric-icon" aria-hidden="true">{icon}</span>
        <span className="owner-overview-metric-copy"><small>{label}</small><strong>{value}</strong></span>
      </article>)}
    </div>

    <section className="owner-overview-panel owner-reservations-panel">
      <header className="owner-overview-panel-heading">
        <div><span className="owner-overview-panel-icon" aria-hidden="true">▤</span><span><h3>Reservation management</h3><p>Recent customer requests for your listed medicines.</p></span></div>
        <button className="button button-primary button-small" type="button" onClick={onOpenStore}>View all reservations <span aria-hidden="true">→</span></button>
      </header>
      {recentReservations.length ? <div className="owner-overview-table-wrap">
        <table className="owner-overview-table">
          <thead><tr><th>Reservation</th><th>Customer</th><th>Medicine</th><th>Quantity</th><th>Request date</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>{recentReservations.map((reservation, index) => <tr key={reservation.id}>
            <td><span className="owner-reservation-number">{String(index + 1).padStart(2, "0")}</span><span className="owner-reservation-id">{reservation.id}</span></td>
            <td>{reservation.customer || "Customer"}</td>
            <td>{reservation.medicine || "Medicine"}</td>
            <td>{reservation.quantity} {Number(reservation.quantity) === 1 ? "item" : "items"}</td>
            <td>{formatDate(reservation.createdAt)}</td>
            <td><span className={`status-tag ${reservationStatus(reservation.status)}`}>{String(reservation.status || "pending").replace(/[_-]+/g, " ")}</span></td>
            <td>{["pending", "received"].includes(reservationStatus(reservation.status)) && <button className="owner-mark-received" type="button" onClick={() => onUpdateReservationStatus(reservation.id, reservationStatus(reservation.status) === "pending" ? "received" : "pending")} disabled={updatingReservationId === reservation.id}>{updatingReservationId === reservation.id ? "Updating…" : reservationStatus(reservation.status) === "pending" ? "Mark received" : "Mark pending"}</button>}</td>
          </tr>)}</tbody>
        </table>
      </div> : <div className="owner-overview-empty"><span aria-hidden="true">▤</span><b>No reservations yet</b><p>Customer requests will appear here when someone reserves a listed medicine.</p></div>}
    </section>

    <section className="owner-overview-activity">
      <header className="owner-overview-section-heading"><div><span className="owner-overview-panel-icon" aria-hidden="true">▥</span><span><h3>Inventory & activity</h3><p>Live inventory signals and recent customer requests.</p></span><button className="button button-outline button-small" type="button" onClick={onOpenStore}>Open store dashboard →</button></div></header>
      <div className="owner-overview-activity-grid">
        <article className="owner-overview-panel">
          <header className="owner-overview-subheading"><div><span className="owner-overview-small-icon low" aria-hidden="true">△</span><span><h4>Low-stock medicines</h4><p>Listings with five or fewer packs remaining.</p></span></div><span className="owner-overview-count">{counts.low}</span></header>
          {lowStockListings.length ? <ul className="owner-overview-stock-list">{lowStockListings.map((listing) => <li key={listing.id}>
            <span><b>{listing.name}</b><small>{listing.genericName || listing.category}</small></span>
            <strong>{listing.stock} left</strong>
          </li>)}</ul> : <div className="owner-overview-compact-empty">{listings.length ? "No medicines need restocking right now." : "Add medicines to see inventory status here."}</div>}
        </article>

        <article className="owner-overview-panel">
          <header className="owner-overview-subheading"><div><span className="owner-overview-small-icon recent" aria-hidden="true">◷</span><span><h4>Recent activity</h4><p>Latest reservation updates from your customers.</p></span></div></header>
          {recentReservations.length ? <ul className="owner-overview-recent-list">{recentReservations.slice(0, 4).map((reservation) => <li key={reservation.id}>
            <span className="owner-overview-recent-dot" aria-hidden="true" />
            <span><b>{reservation.customer || "Customer"} requested {reservation.medicine || "a medicine"}</b><small>{reservation.quantity} {Number(reservation.quantity) === 1 ? "item" : "items"} · {formatDate(reservation.createdAt)}</small></span>
            <span className={`status-tag ${reservationStatus(reservation.status)}`}>{String(reservation.status || "pending").replace(/[_-]+/g, " ")}</span>
          </li>)}</ul> : <div className="owner-overview-compact-empty">There are no customer requests to show yet.</div>}
        </article>
      </div>
    </section>
  </section>;
}

function SavedPage({ likedMedicines, pharmacies, loading, error, busyMedicineId, busyPharmacyId, onRetry, onFindMedicines, onUnlike, onUnsave, onMedicineDetails, onPharmacyDetails }) {
  const [activeTab, setActiveTab] = useState("medicines");

  return <section className="content-section dashboard-section saved-page">
    <SectionTitle eyebrow="YOUR ACCOUNT" title="Saved items" sub="Your liked medicines and pharmacies, kept together." />
    <div className="saved-page-tabs" role="tablist" aria-label="Saved items">
      <button className={activeTab === "medicines" ? "saved-page-tab active" : "saved-page-tab"} type="button" role="tab" aria-selected={activeTab === "medicines"} onClick={() => setActiveTab("medicines")}>Liked Medicines <span>{likedMedicines.length}</span></button>
      <button className={activeTab === "pharmacies" ? "saved-page-tab active" : "saved-page-tab"} type="button" role="tab" aria-selected={activeTab === "pharmacies"} onClick={() => setActiveTab("pharmacies")}>Saved Pharmacies <span>{pharmacies.length}</span></button>
    </div>
    {error && <div className="saved-page-error" role="alert"><span>{error}</span><button type="button" onClick={onRetry}>Try again</button></div>}
    {loading ? <div className="saved-page-loading" role="status"><span className="store-settings-spinner" aria-hidden="true" />Loading your saved items…</div>
      : activeTab === "medicines"
        ? likedMedicines.length ? <div className="liked-medicine-grid">{likedMedicines.map((medicine) => {
          const stock = Number(medicine.stock) || 0;
          const stockStatus = stock > 0 ? stock <= 5 ? "low" : "in" : "out";
          return <article className="liked-medicine-card" key={medicine.id}>
            <header><span className="medicine-icon" aria-hidden="true">✚</span><span className={`inventory-stock-status ${stockStatus}`}>{stockStatus === "out" ? "Out of stock" : stockStatus === "low" ? `Low stock · ${stock} left` : "In stock · " + stock + " available"}</span></header>
            <h3>{medicine.name}</h3><p className="liked-medicine-generic">{medicine.genericName || "Generic name not listed"}{medicine.category ? ` · ${medicine.category}` : ""}</p>
            <div className="liked-medicine-details">
              <span><small>Price</small><b>{medicine.price === null ? "Unavailable" : `₹${Number(medicine.price).toFixed(2)}`}</b></span>
              <span><small>Pharmacy</small><b>{medicine.pharmacy || "No approved pharmacy listing"}</b></span>
            </div>
            {medicine.location && <p className="liked-medicine-location">⌖ {medicine.location}</p>}
            <footer><button className="button button-outline button-small" type="button" onClick={() => onMedicineDetails(medicine)}>Medicine details</button><button className="liked-medicine-remove" type="button" disabled={busyMedicineId === medicine.id} onClick={() => onUnlike(medicine)} aria-label={`Unlike ${medicine.name}`}>{busyMedicineId === medicine.id ? "Removing…" : "♥ Unlike"}</button></footer>
          </article>;
        })}</div> : <div className="saved-page-empty"><span aria-hidden="true">♡</span><h3>No liked medicines yet</h3><p>Like a medicine from Find medicines to keep it here.</p><button className="button button-outline button-small" type="button" onClick={onFindMedicines}>Browse medicines</button></div>
        : pharmacies.length ? <div className="saved-pharmacy-grid">{pharmacies.map((pharmacy) => <article className="saved-pharmacy-card" key={pharmacy.id}>
          <span className="saved-pharmacy-card-icon" aria-hidden="true">⌂</span><div className="saved-pharmacy-card-copy"><h3>{pharmacy.name || "Pharmacy"}</h3><p>{pharmacy.location || "Location not provided"}</p><span className="rating">★ {pharmacy.rating || "New"}</span></div>
          <div className="saved-pharmacy-card-actions"><button className="button button-outline button-small" type="button" onClick={() => onPharmacyDetails(pharmacy)}>View Store Details</button><button className="saved-pharmacy-remove" type="button" disabled={busyPharmacyId === pharmacy.id} onClick={() => onUnsave(pharmacy)}>{busyPharmacyId === pharmacy.id ? "Removing…" : "Remove"}</button></div>
        </article>)}</div> : <div className="saved-page-empty"><span aria-hidden="true">⌂</span><h3>No saved pharmacies yet</h3><p>Bookmark a pharmacy from Find medicines to keep it here.</p><button className="button button-outline button-small" type="button" onClick={onFindMedicines}>Browse pharmacies</button></div>}
  </section>;
}

function MedicineCard({ medicine, reserving, savingPharmacy, savedPharmacy, savingMedicine, liked, onDetails, onReserve, onTogglePharmacy, onToggleLike, onRate }) {
  const [rating, setRating] = useState("5");
  return <article className="medicine-card">
    <div className="medicine-card-top"><span className="medicine-icon">✚</span><span className={medicine.stock > 0 ? "stock-pill" : "stock-pill out"}>{medicine.stock > 0 ? "In stock" : "Out of stock"}</span></div>
    <div className="medicine-name"><h3>{medicine.name}</h3><p>{medicine.genericName} · {medicine.category}</p></div>
    <div className="pharmacy-summary"><span className="pharmacy-icon">⌂</span><span><b>{medicine.pharmacy}</b><small>⌖ {medicine.location}{Number.isFinite(medicine.distanceKm) ? ` · ${medicine.distanceKm.toFixed(1)} km away` : ""}</small></span><span className="rating">★ {medicine.rating}</span></div>
    <div className="card-divider" /><div className="price-row"><span>Price per pack</span><strong>₹{medicine.price.toFixed(2)}</strong></div>
    <div className="card-actions"><button className="button button-primary" disabled={!medicine.stock || reserving} onClick={onReserve}>{reserving ? "Reserving…" : "Reserve"}</button><button className="button button-outline" onClick={onDetails}>Details</button><button className={`icon-button save-pharmacy-button${liked ? " saved" : ""}`} type="button" onClick={() => onToggleLike(liked)} disabled={savingMedicine} aria-label={`${liked ? "Unlike" : "Like"} ${medicine.name}`} aria-pressed={liked}>{savingMedicine ? "…" : liked ? "♥" : "♡"}</button><button className={`icon-button save-store-button${savedPharmacy ? " saved" : ""}`} type="button" onClick={() => onTogglePharmacy(savedPharmacy)} disabled={savingPharmacy} aria-label={`${savedPharmacy ? "Remove" : "Save"} ${medicine.pharmacy} ${savedPharmacy ? "from" : "to"} saved pharmacies`} aria-pressed={savedPharmacy}>{savingPharmacy ? "…" : savedPharmacy ? "▣" : "▢"}</button></div>
    <div className="rate-control"><select aria-label={`Rating for ${medicine.pharmacy}`} value={rating} onChange={(event) => setRating(event.target.value)}><option value="5">★★★★★</option><option value="4">★★★★☆</option><option value="3">★★★☆☆</option><option value="2">★★☆☆☆</option><option value="1">★☆☆☆☆</option></select><button className="text-button rate-link" onClick={() => onRate(Number(rating))}>Rate pharmacy</button></div>
  </article>;
}

function MedicineChatbot({ medicine }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState([]);
  const [sending, setSending] = useState(false);
  const messagesContainerRef = useRef(null);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return undefined;
    const observer = new MutationObserver(() => { container.scrollTop = container.scrollHeight; });
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    container.scrollTop = container.scrollHeight;
    return () => observer.disconnect();
  }, [open]);

  const ask = async (text) => {
    const cleanQuestion = text.trim();
    if (!cleanQuestion || sending) return;
    setMessages((current) => [...current, { role: "user", text: cleanQuestion }]);
    setQuestion("");
    setSending(true);
    try {
      const { answer } = await askMedicalAssistant(cleanQuestion, {
        name: medicine.name,
        genericName: medicine.genericName,
        category: medicine.category,
        info: medicine.info,
      });
      setMessages((current) => [...current, { role: "assistant", text: answer }]);
    } catch (error) {
      setMessages((current) => [...current, {
        role: "assistant",
        text: error.message || "The medical assistant is temporarily unavailable. Please try again.",
      }]);
    } finally {
      setSending(false);
    }
  };

  return <section className="medicine-chat-section">
    <button className="button button-outline medicine-chat-toggle" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      {open ? "Close medicine chat" : "Ask about this medicine"}
    </button>
    {open && <div className="medicine-chat">
      <div className="medicine-chat-heading"><strong>Medlytic medicine assistant</strong><span>Groq AI. Don’t include your name or private details. General information only.</span></div>
      <div className="medicine-chat-messages" ref={messagesContainerRef} aria-live="polite" aria-relevant="additions">
        {!messages.length && <p className="chat-welcome">Ask about {medicine.name}, its listed ingredient, or its catalog description.</p>}
        {messages.map((message, index) => <p className={`chat-message ${message.role}`} key={`${message.role}-${index}`}>{message.text}</p>)}
      </div>
      <div className="medicine-chat-prompts">
        <button type="button" onClick={() => ask("What is this medicine for?")}>What is it for?</button>
        <button type="button" onClick={() => ask("What is the generic ingredient?")}>Generic ingredient</button>
      </div>
      <form className="medicine-chat-form" onSubmit={(event) => { event.preventDefault(); ask(question); }}>
        <label className="sr-only" htmlFor="medicine-chat-question">Ask a question about this medicine</label>
        <input id="medicine-chat-question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about this medicine…" maxLength="300" />
        <button className="button button-primary button-small" type="submit" disabled={!question.trim() || sending}>{sending ? "Thinking…" : "Send"}</button>
      </form>
    </div>}
  </section>;
}

function FloatingMedicineChatbot({ medicines, currentQuery = "" }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState([]);
  const [sending, setSending] = useState(false);
  const messagesContainerRef = useRef(null);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return undefined;
    const observer = new MutationObserver(() => { container.scrollTop = container.scrollHeight; });
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    container.scrollTop = container.scrollHeight;
    return () => observer.disconnect();
  }, [open]);

  const ask = async (text) => {
    const cleanQuestion = text.trim();
    if (!cleanQuestion || sending) return;
    const normalized = cleanQuestion.toLowerCase();
    const findMedicine = (phrase) => medicines.find((item) =>
      [item.name, item.genericName].some((term) => term && phrase.includes(term.toLowerCase()))
    );
    const currentSearchQuery = typeof currentQuery === "string" ? currentQuery.trim().toLowerCase() : "";
    const medicine = findMedicine(normalized) || findMedicine(currentSearchQuery);
    setMessages((current) => [...current, { role: "user", text: cleanQuestion }]);
    setQuestion("");
    setSending(true);
    try {
      const { answer } = await askMedicalAssistant(cleanQuestion, medicine ? {
        name: medicine.name,
        genericName: medicine.genericName,
        category: medicine.category,
        info: medicine.info,
      } : null);
      setMessages((current) => [...current, { role: "assistant", text: answer }]);
    } catch (error) {
      setMessages((current) => [...current, {
        role: "assistant",
        text: error.message || "The medical assistant is temporarily unavailable. Please try again.",
      }]);
    } finally {
      setSending(false);
    }
  };

  return <aside className="floating-medicine-chat" aria-label="Medicine assistant">
    {open && <section className="floating-chat-panel" role="dialog" aria-label="Ask about a medicine">
      <header className="floating-chat-header">
        <div><strong>Medicine assistant</strong><small>Medical information powered by Groq AI</small></div>
        <button className="floating-chat-close" type="button" aria-label="Close medicine assistant" onClick={() => setOpen(false)}>×</button>
      </header>
      <div className="floating-chat-messages" ref={messagesContainerRef} aria-live="polite" aria-relevant="additions">
        {!messages.length && <p className="chat-welcome">Ask about medicines or symptoms. Don’t include your name or private details. I can’t diagnose or provide doses.</p>}
        {messages.map((message, index) => <p className={`chat-message ${message.role}`} key={`${message.role}-${index}`}>{message.text}</p>)}
      </div>
      <form className="medicine-chat-form floating-chat-form" onSubmit={(event) => { event.preventDefault(); ask(question); }}>
        <label className="sr-only" htmlFor="floating-medicine-question">Ask about a medicine</label>
        <input id="floating-medicine-question" autoFocus value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about a medicine or symptoms…" maxLength="1000" />
        <button className="button button-primary button-small" type="submit" disabled={!question.trim() || sending}>{sending ? "Thinking…" : "Send"}</button>
      </form>
      <p className="floating-chat-disclaimer">Medical questions may be sent to Groq to generate a response. General information only; consult a doctor or pharmacist before treatment decisions. No diagnoses or doses.</p>
    </section>}
    <button className="floating-chat-launcher" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <span aria-hidden="true">✦</span>{open ? "Close chat" : "Ask about medicine"}
    </button>
  </aside>;
}

function OwnerDashboard({ data, user, onRefresh, onError, onNotice, onUpdateReservationStatus, updatingReservationId }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [form, setForm] = useState({ name: "", genericName: "", category: "", price: "", stock: "" });
  const [editing, setEditing] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingListingId, setDeletingListingId] = useState(null);
  const [inventorySearch, setInventorySearch] = useState("");
  const [inventoryStatus, setInventoryStatus] = useState("all");
  const [stockDrafts, setStockDrafts] = useState({});
  const [updatingStockId, setUpdatingStockId] = useState(null);
  const listings = data?.listings || [];
  const reservations = data?.reservations || [];
  const stockUnits = listings.reduce((total, listing) => total + Math.max(0, Number(listing.stock) || 0), 0);
  const pendingReservations = reservations.filter((reservation) => reservation.status === "pending").length;
  const completedReservations = reservations.filter((reservation) => ["received", "completed", "collected"].includes(reservation.status)).length;
  const lowStockListings = listings.filter((listing) => Number(listing.stock) > 0 && Number(listing.stock) <= 5);
  const recentReservations = [...reservations]
    .filter((reservation) => reservation.createdAt && !Number.isNaN(new Date(reservation.createdAt).getTime()))
    .sort((first, second) => new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime());
  const reservationTrends = Array.from({ length: 7 }, (_, index) => {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - (6 - index));
    const nextDay = new Date(day);
    nextDay.setDate(nextDay.getDate() + 1);
    const count = reservations.filter((reservation) => {
      const createdAt = new Date(reservation.createdAt);
      return !Number.isNaN(createdAt.getTime()) && createdAt >= day && createdAt < nextDay;
    }).length;
    return { date: day, count };
  });
  const maxTrendCount = Math.max(1, ...reservationTrends.map((day) => day.count));
  const frequentMedicines = Object.values(reservations.reduce((medicinesByName, reservation) => {
    const name = reservation.medicine || "Medicine";
    const entry = medicinesByName[name] || { name, reservations: 0, quantity: 0 };
    entry.reservations += 1;
    entry.quantity += Number(reservation.quantity) || 0;
    medicinesByName[name] = entry;
    return medicinesByName;
  }, {})).sort((first, second) => second.quantity - first.quantity || second.reservations - first.reservations).slice(0, 5);
  const stockCounts = listings.reduce((counts, listing) => {
    const stock = Number(listing.stock);
    counts.all += 1;
    if (stock === 0) counts.out += 1;
    else if (stock <= 5) counts.low += 1;
    else counts.in += 1;
    return counts;
  }, { all: 0, in: 0, low: 0, out: 0 });
  const visibleListings = listings.filter((listing) => {
    const search = inventorySearch.trim().toLowerCase();
    const matchesSearch = !search || [listing.name, listing.genericName, listing.category]
      .some((value) => value?.toLowerCase().includes(search));
    const stock = Number(listing.stock);
    const matchesStatus = inventoryStatus === "all"
      || (inventoryStatus === "in" && stock > 5)
      || (inventoryStatus === "low" && stock > 0 && stock <= 5)
      || (inventoryStatus === "out" && stock === 0);
    return matchesSearch && matchesStatus;
  });

  const submit = async (event) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      await saveOwnerMedicine(user.id, form, editing);
      setForm({ name: "", genericName: "", category: "", price: "", stock: "" });
      setEditing(null);
      onNotice("Inventory saved.");
      onRefresh();
    } catch (err) {
      onError(err.message || "Failed to save medicine.");
    } finally {
      setSubmitting(false);
    }
  };

  const edit = (listing) => {
    setEditing(listing.id);
    setForm({ name: listing.name, genericName: listing.genericName, category: listing.category, price: String(listing.price), stock: String(listing.stock) });
  };

  const updateStock = async (listing, stock) => {
    const quantity = Number(stock);
    if (stock.trim() === "" || !Number.isInteger(quantity) || quantity < 0) {
      onError("Enter a whole-number stock quantity of zero or more.");
      return;
    }
    setUpdatingStockId(listing.id);
    try {
      await updateOwnerStock(listing.id, quantity);
      setStockDrafts((drafts) => {
        const nextDrafts = { ...drafts };
        delete nextDrafts[listing.id];
        return nextDrafts;
      });
      onNotice("Stock updated.");
      onRefresh();
    } catch (err) {
      onError(err.message || "Failed to update stock.");
    } finally {
      setUpdatingStockId(null);
    }
  };

  const removeListing = async (listing) => {
    if (!window.confirm(`Remove ${listing.name} from your inventory?`)) return;
    setDeletingListingId(listing.id);
    try {
      await deleteOwnerMedicine(user.id, listing.id);
      if (editing === listing.id) {
        setEditing(null);
        setForm({ name: "", genericName: "", category: "", price: "", stock: "" });
      }
      onNotice("Medicine listing removed.");
      onRefresh();
    } catch (err) {
      onError(err.message || "Failed to remove medicine listing.");
    } finally {
      setDeletingListingId(null);
    }
  };

  const formatReservationDate = (value) => {
    const date = new Date(value);
    return value && !Number.isNaN(date.getTime())
      ? date.toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
      : "—";
  };

  const changeTab = (tab) => {
    setActiveTab(tab);
  };

  const renderInventory = () => <div className="panel inventory-panel owner-dashboard-panel">
    <div className="inventory-heading">
      <div><h3>Medicine inventory</h3><p>Search listings, update stock, and manage your medicines.</p></div>
      <span className="subtle-count">{listings.length} {listings.length === 1 ? "listing" : "listings"}</span>
    </div>
    <div className="inventory-tools">
      <label className="inventory-search"><span aria-hidden="true">⌕</span><input type="search" aria-label="Search medicine inventory" placeholder="Search by medicine, generic name or category" value={inventorySearch} onChange={(event) => setInventorySearch(event.target.value)} /></label>
      <div className="inventory-filters" role="group" aria-label="Filter inventory by stock status">
        {[["all", "All", stockCounts.all], ["in", "In Stock", stockCounts.in], ["low", "Low Stock", stockCounts.low], ["out", "Out of Stock", stockCounts.out]]
          .map(([status, label, count]) => <button key={status} type="button" className={inventoryStatus === status ? "inventory-filter active" : "inventory-filter"} aria-pressed={inventoryStatus === status} onClick={() => setInventoryStatus(status)}>{label}<span>{count}</span></button>)}
      </div>
    </div>
    <div className="inventory-result-summary">
      <span>Showing <strong>{visibleListings.length}</strong> of <strong>{listings.length}</strong> medicines</span>
      {(inventorySearch || inventoryStatus !== "all") && <button type="button" className="text-button" onClick={() => { setInventorySearch(""); setInventoryStatus("all"); }}>Clear filters</button>}
    </div>
    {listings.length ? <div className="owner-table-wrap">
      <table className="owner-data-table owner-inventory-table">
        <thead><tr><th>Medicine</th><th>Price</th><th>Stock</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>{visibleListings.map((listing) => {
          const stockValue = stockDrafts[listing.id] ?? String(listing.stock);
          const stock = Number(listing.stock);
          const status = stock === 0 ? "out" : stock <= 5 ? "low" : "in";
          const canSave = stockValue.trim() !== "" && Number.isInteger(Number(stockValue)) && Number(stockValue) >= 0 && Number(stockValue) !== stock;
          return <tr key={listing.id}>
            <td><div className="owner-table-medicine"><span className="inventory-medicine-icon" aria-hidden="true">✚</span><span><b>{listing.name}</b><small>{listing.genericName} · {listing.category}</small></span></div></td>
            <td>₹{Number(listing.price).toFixed(2)}</td>
            <td><div className="inventory-stock-editor owner-table-stock"><label className="sr-only" htmlFor={`inventory-stock-${listing.id}`}>Stock quantity for {listing.name}</label><div><input id={`inventory-stock-${listing.id}`} type="number" min="0" step="1" value={stockValue} onChange={(event) => setStockDrafts((drafts) => ({ ...drafts, [listing.id]: event.target.value }))} /><button className="button button-outline button-small" type="button" disabled={!canSave || updatingStockId !== null} onClick={() => updateStock(listing, stockValue)}>{updatingStockId === listing.id ? "Saving…" : "Save"}</button></div></div></td>
            <td><span className={`inventory-stock-status ${status}`}>{status === "out" ? "Out of stock" : status === "low" ? "Low stock" : "In stock"}</span></td>
            <td><div className="owner-table-actions"><button className="text-button inventory-edit" type="button" onClick={() => edit(listing)}>Edit</button><button className="owner-delete-button" type="button" onClick={() => removeListing(listing)} disabled={deletingListingId === listing.id}>{deletingListingId === listing.id ? "Removing…" : "Delete"}</button></div></td>
          </tr>;
        })}</tbody>
      </table>
      {!visibleListings.length && <p className="inventory-empty">No medicines match these filters. Try another search or stock status.</p>}
    </div> : <EmptyDashboard text="Add your first medicine to begin managing inventory." />}
  </div>;

  const renderReservationTable = () => reservations.length ? <div className="owner-table-wrap">
    <table className="owner-data-table">
      <thead><tr><th>Customer</th><th>Medicine</th><th>Quantity</th><th>Request date</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>{[...reservations].sort((first, second) => new Date(second.createdAt || 0) - new Date(first.createdAt || 0)).map((reservation) =>
        <tr key={reservation.id}>
          <td><div className="owner-customer-cell"><b>{reservation.customer || "Customer"}</b>{reservation.customerEmail && <small>{reservation.customerEmail}</small>}</div></td>
          <td>{reservation.medicine || "Medicine"}</td>
          <td>{reservation.quantity} {Number(reservation.quantity) === 1 ? "item" : "items"}</td>
          <td>{formatReservationDate(reservation.createdAt)}</td>
          <td><span className={`status-tag ${reservation.status}`}>{String(reservation.status || "pending").replace(/[_-]+/g, " ")}</span></td>
          <td>{["pending", "received"].includes(reservation.status) ? <button className="owner-mark-received" type="button" onClick={() => onUpdateReservationStatus(reservation.id, reservation.status === "pending" ? "received" : "pending")} disabled={updatingReservationId === reservation.id}>{updatingReservationId === reservation.id ? "Updating…" : reservation.status === "pending" ? "Mark received" : "Mark pending"}</button> : <span className="muted-copy">No action</span>}</td>
        </tr>
      )}</tbody>
    </table>
  </div> : <EmptyDashboard text="Reservation requests will appear here when customers reserve your medicines." />;

  const navigation = [
    ["overview", "Overview"],
    ["inventory", "Inventory"],
    ["reservations", "Reservations"],
    ["analytics", "Analytics"],
    ["settings", "Store Settings"],
  ];
  const summaryCards = [
    ["Total medicines", listings.length, "▧"],
    ["Stock units", stockUnits, "▣"],
    ["Low-stock items", lowStockListings.length, "△"],
    ["Pending reservations", pendingReservations, "◷"],
    ["Completed reservations", completedReservations, "✓"],
  ];

  return <section className="content-section dashboard-section owner-store-dashboard">
    <SectionTitle eyebrow="PHARMACY PORTAL" title={data?.pharmacy?.name || "Store dashboard"} sub={data?.pharmacy?.status === "pending" ? "Your store is awaiting admin approval. You can prepare inventory while we review your registration." : "A clear view of your medicines, reservations, and store activity."} />
    <nav className="owner-dashboard-tabs" aria-label="Store dashboard sections">
      {navigation.map(([tab, label]) => <button key={tab} type="button" className={activeTab === tab ? "owner-dashboard-tab active" : "owner-dashboard-tab"} aria-current={activeTab === tab ? "page" : undefined} onClick={() => changeTab(tab)}>{label}</button>)}
    </nav>

    {activeTab === "overview" && <>
      <div className="owner-store-summary-grid">{summaryCards.map(([label, value, icon]) => <article className="owner-store-summary-card" key={label}><span aria-hidden="true">{icon}</span><small>{label}</small><strong>{value.toLocaleString()}</strong></article>)}</div>
      <div className="owner-store-overview-grid">
        <section className="panel owner-dashboard-panel"><header className="owner-panel-heading"><div><h3>Recent reservation activity</h3><p>Latest customer requests from your store.</p></div><button className="text-button" type="button" onClick={() => changeTab("reservations")}>View reservations →</button></header>
          {recentReservations.length ? <div className="owner-activity-list">{recentReservations.slice(0, 5).map((reservation) => <article key={reservation.id}><span className="owner-activity-dot" /><div><b>{reservation.customer || "Customer"} reserved {reservation.medicine || "a medicine"}</b><small>{reservation.quantity} {Number(reservation.quantity) === 1 ? "item" : "items"} · {formatReservationDate(reservation.createdAt)}</small></div><span className={`status-tag ${reservation.status}`}>{String(reservation.status || "pending").replace(/[_-]+/g, " ")}</span></article>)}</div> : <p className="muted-copy">There are no recent reservations.</p>}
        </section>
        <section className="panel owner-dashboard-panel"><header className="owner-panel-heading"><div><h3>Stock watch</h3><p>Medicines that may need restocking.</p></div><button className="text-button" type="button" onClick={() => changeTab("inventory")}>Open inventory →</button></header>
          {lowStockListings.length ? <div className="owner-stock-watch">{lowStockListings.slice(0, 5).map((listing) => <div key={listing.id}><span><b>{listing.name}</b><small>{listing.genericName || listing.category}</small></span><span>{listing.stock} left</span></div>)}</div> : <p className="muted-copy">{listings.length ? "No low-stock medicines right now." : "Add medicines to start tracking stock."}</p>}
        </section>
      </div>
    </>}

    {activeTab === "inventory" && <div className="owner-inventory-view">
      <div className="panel owner-dashboard-panel owner-add-medicine"><header className="owner-panel-heading"><div><h3>{editing ? "Edit medicine details" : "Add a medicine"}</h3><p>{editing ? "Update listing details and save your changes." : "Add a medicine listing to your store inventory."}</p></div></header><form className="owner-medicine-form" onSubmit={submit}><label>Medicine name<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label>Generic name<input required value={form.genericName} onChange={(event) => setForm({ ...form, genericName: event.target.value })} /></label><label>Category<input required value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} /></label><label>Price (₹)<input type="number" min="0" step="0.01" required value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} /></label><label>Stock units<input type="number" min="0" step="1" required value={form.stock} onChange={(event) => setForm({ ...form, stock: event.target.value })} /></label><div className="owner-medicine-form-actions"><button className="button button-primary button-small" type="submit" disabled={submitting}>{submitting ? "Saving…" : editing ? "Save changes" : "Add medicine"}</button>{editing && <button className="button button-outline button-small" type="button" onClick={() => { setEditing(null); setForm({ name: "", genericName: "", category: "", price: "", stock: "" }); }}>Cancel</button>}</div></form></div>
      <div id="owner-inventory-section">{renderInventory()}</div>
    </div>}

    {activeTab === "reservations" && <section className="panel owner-dashboard-panel owner-reservations-view"><header className="owner-panel-heading"><div><h3>Reservation management</h3><p>Customer details, requested quantities, and fulfillment status.</p></div><span className="subtle-count">{reservations.length} total</span></header>{renderReservationTable()}</section>}

    {activeTab === "analytics" && <div className="owner-analytics-grid">
      <section className="panel owner-dashboard-panel"><header className="owner-panel-heading"><div><h3>Reservation trend</h3><p>Reservation requests created in the last seven days.</p></div></header>
        {reservations.length ? <div className="owner-trend-chart" aria-label="Reservations for each of the last seven days">{reservationTrends.map((day) => <div className="owner-trend-day" key={day.date.toISOString()}><strong>{day.count}</strong><div className="owner-trend-bar-track"><span style={{ height: `${Math.max(day.count ? 10 : 3, day.count / maxTrendCount * 100)}%` }} /></div><small>{day.date.toLocaleDateString([], { weekday: "short" })}</small></div>)}</div> : <p className="muted-copy">Reservation trends will appear when customers begin reserving medicines.</p>}
      </section>
      <section className="panel owner-dashboard-panel"><header className="owner-panel-heading"><div><h3>Frequently reserved</h3><p>Medicines ranked by total requested units.</p></div></header>
        {frequentMedicines.length ? <ol className="owner-frequent-list">{frequentMedicines.map((medicine) => <li key={medicine.name}><span><b>{medicine.name}</b><small>{medicine.reservations} {medicine.reservations === 1 ? "reservation" : "reservations"}</small></span><strong>{medicine.quantity} {medicine.quantity === 1 ? "unit" : "units"}</strong></li>)}</ol> : <p className="muted-copy">Frequently reserved medicines will appear here.</p>}
      </section>
      <section className="panel owner-dashboard-panel owner-analytics-activity"><header className="owner-panel-heading"><div><h3>Recent updates</h3><p>Latest reservation requests and their current status.</p></div></header>
        {recentReservations.length ? <div className="owner-activity-list">{recentReservations.slice(0, 8).map((reservation) => <article key={reservation.id}><span className="owner-activity-dot" /><div><b>{reservation.medicine || "Medicine"} · {reservation.customer || "Customer"}</b><small>Requested {formatReservationDate(reservation.createdAt)} · Qty {reservation.quantity}</small></div><span className={`status-tag ${reservation.status}`}>{String(reservation.status || "pending").replace(/[_-]+/g, " ")}</span></article>)}</div> : <p className="muted-copy">Recent activity will appear here when your store receives reservations.</p>}
      </section>
    </div>}

    {activeTab === "settings" && data?.pharmacy && <div className="owner-settings-view"><StoreProfileEditor pharmacy={data.pharmacy} user={user} onRefresh={onRefresh} onNotice={onNotice} /></div>}
  </section>;
}

function AdminDashboard({ data, currentAdminId, onRefresh, onError, onNotice }) {
  const [tab, setTab] = useState("pharmacies");
  const [records, setRecords] = useState([]);

  useEffect(() => {
    getAdminRecords(tab)
      .then(setRecords)
      .catch((err) => onError(err.message || "Failed to load records."));
  }, [tab, onError]);

  const changeStatus = async (pharmacy, status) => {
    try {
      await updatePharmacyStatus(pharmacy.id, status);
      onNotice(`Pharmacy ${status}.`);
      onRefresh();
    } catch (err) { onError(err.message || "Failed to update pharmacy status."); }
  };

  const updateReport = async (report, status) => {
    try {
      await updateReportStatus(report.id, status);
      onNotice("Report updated.");
      setRecords(records.map((item) => item.id === report.id ? { ...item, status } : item));
    } catch (err) { onError(err.message || "Failed to update report."); }
  };

  const toggleUserActive = async (account) => {
    try {
      await updateUserActiveStatus(account.id, !account.active);
      onNotice(account.active ? "Account suspended." : "Account activated.");
      onRefresh();
    } catch (err) { onError(err.message || "Failed to update account."); }
  };

  return <section className="content-section dashboard-section"><SectionTitle eyebrow="PLATFORM ADMIN" title="Operations overview" sub="Review pharmacy registrations, platform accounts and reported information." />
    <div className="metric-grid"><Metric label="Registered users" value={data?.stats?.users ?? "—"} /><Metric label="Pharmacies" value={data?.stats?.pharmacies ?? "—"} /><Metric label="Pending approval" value={data?.stats?.pendingPharmacies ?? "—"} /><Metric label="Open reports" value={data?.stats?.openReports ?? "—"} /></div>
    <div className="admin-tabs">{[["pharmacies", "Pharmacy approvals"], ["reports", "Reports"], ["users", "Accounts"], ["audit", "Audit log"]].map(([key, label]) => <button key={key} className={tab === key ? "admin-tab active" : "admin-tab"} onClick={() => setTab(key)}>{label}</button>)}</div>
    <div className="panel admin-records">
      {tab === "pharmacies" && (records.length ? records.map((pharmacy) => <div className="admin-record" key={pharmacy.id}><span><b>{pharmacy.name}</b><small>{pharmacy.location} · {pharmacy.ownerName} · {pharmacy.ownerEmail}</small></span><span className={`status-tag ${pharmacy.status}`}>{pharmacy.status}</span>{pharmacy.status === "pending" && <div className="record-actions"><button className="button button-primary button-small" onClick={() => changeStatus(pharmacy, "approved")}>Approve</button><button className="button button-outline button-small" onClick={() => changeStatus(pharmacy, "rejected")}>Reject</button></div>}</div>) : <EmptyDashboard text="No pharmacy registrations to review." />)}
      {tab === "reports" && (records.length ? records.map((report) => <div className="admin-record" key={report.id}><span><b>{report.subject}</b><small>{report.type} · {report.details}</small></span><span className={`status-tag ${report.status}`}>{report.status}</span>{report.status === "open" && <button className="button button-outline button-small" onClick={() => updateReport(report, "resolved")}>Resolve</button>}</div>) : <EmptyDashboard text="No reports have been submitted." />)}
      {tab === "users" && (records.length ? records.map((account) => <div className="admin-record" key={account.id}><span><b>{account.name}</b><small>{account.email} · {account.role}</small></span><span className={`status-tag ${account.active ? "approved" : "rejected"}`}>{account.active ? "active" : "suspended"}</span>{account.id !== currentAdminId && <button className="button button-outline button-small" onClick={() => toggleUserActive(account)}>{account.active ? "Suspend" : "Activate"}</button>}</div>) : <EmptyDashboard text="No accounts found." />)}
      {tab === "audit" && (records.length ? records.map((record) => <div className="admin-record" key={record.id}><span><b>{record.action}</b><small>{record.actor} · {record.target} · {new Date(record.created_at || record.createdAt).toLocaleString()}</small></span></div>) : <EmptyDashboard text="Platform activity will appear here." />)}
    </div>
  </section>;
}

function NearbyPharmacies({ pharmacies, location, onDetails }) {
  const uniquePharmacies = [...new Map(pharmacies.map((pharmacy) => [pharmacyIdentity(pharmacy), pharmacy])).values()];

  return <section className="nearby-shops" aria-labelledby="nearby-shops-title">
    <div className="nearby-shops-heading">
      <div><span className="eyebrow">PHARMACIES NEAR YOU</span><h3 id="nearby-shops-title">Nearby medical shops</h3><p>{location ? `Showing approved shops near ${location}.` : "Closest shops first."}</p></div>
      <span className="nearby-shop-count">{uniquePharmacies.length} {uniquePharmacies.length === 1 ? "shop" : "shops"}</span>
    </div>
    {uniquePharmacies.length ? <div className="nearby-shop-grid">{uniquePharmacies.map((pharmacy) =>
      <article className="nearby-shop" key={pharmacyIdentity(pharmacy)}>
        <span className="nearby-shop-icon" aria-hidden="true">⌂</span>
        <button className="nearby-shop-copy nearby-shop-details" type="button" onClick={() => onDetails(pharmacy)} aria-label={`View details for ${pharmacy.name || pharmacy.pharmacy}`}><h4>{pharmacy.name || pharmacy.pharmacy}</h4><p>{pharmacy.location}</p>{pharmacy.address && pharmacy.address !== pharmacy.location && <small>{pharmacy.address}</small>}</button>
        <div className="nearby-shop-meta"><span className="rating">★ {pharmacy.rating || "New"}</span>{Number.isFinite(pharmacy.distanceKm) && <span>{pharmacy.distanceKm.toFixed(1)} km</span>}</div>
        <button className="button button-outline button-small nearby-details" type="button" onClick={() => onDetails(pharmacy)}>Details</button>
      </article>
    )}</div> : <div className="nearby-shop-empty">No approved medical shops were found for this location.</div>}
  </section>;
}

function StoreProfileEditor({ pharmacy, user, onRefresh, onNotice }) {
  const [profile, setProfile] = useState({ name: pharmacy.name || "", location: pharmacy.location || "", address: pharmacy.address || "", phone: pharmacy.phone || "", latitude: pharmacy.latitude ?? null, longitude: pharmacy.longitude ?? null });
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [formError, setFormError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");

  const locateStore = async () => {
    setLocating(true);
    setFormError("");
    setSavedMessage("");
    try {
      const coordinates = await getCurrentPosition();
      const address = await reverseGeocode(coordinates);
      setProfile((current) => ({ ...current, ...coordinates, location: address, address }));
    } catch (err) { setFormError(err.message || "Could not look up your current location."); }
    finally { setLocating(false); }
  };

  const submit = async (event) => {
    event.preventDefault();
    if (saving || !editing) return;
    const cleanProfile = {
      ...profile,
      name: profile.name.trim(),
      location: profile.location.trim(),
      address: profile.address.trim(),
      phone: profile.phone.trim(),
    };
    const phoneDigits = cleanProfile.phone.replace(/\D/g, "");
    if (cleanProfile.name.length < 2) {
      setFormError("Enter a store name with at least 2 characters.");
      return;
    }
    if (cleanProfile.location.length < 2) {
      setFormError("Enter a valid store location.");
      return;
    }
    if (cleanProfile.address.length < 5) {
      setFormError("Enter a complete store address with at least 5 characters.");
      return;
    }
    if (!/^\+?[\d\s().-]+$/.test(cleanProfile.phone) || phoneDigits.length < 7 || phoneDigits.length > 15) {
      setFormError("Enter a valid phone number with 7 to 15 digits.");
      return;
    }

    setSaving(true);
    setFormError("");
    setSavedMessage("");
    try {
      await updateOwnerPharmacyProfile(user.id, cleanProfile);
      setProfile(cleanProfile);
      setEditing(false);
      setSavedMessage("Changes saved. Your pharmacy profile has been updated.");
      onNotice("Pharmacy profile updated.");
      onRefresh();
    } catch (err) { setFormError(err.message || "Failed to update pharmacy profile."); }
    finally { setSaving(false); }
  };
  return <section className="panel store-profile-panel" aria-labelledby="store-profile-title">
    <header className="store-profile-heading">
      <span className="store-profile-icon" aria-hidden="true">✚</span>
      <div className="store-profile-heading-copy"><span className="eyebrow">STORE SETTINGS</span><h3 id="store-profile-title">Pharmacy profile</h3><p>Keep your store information accurate for nearby customers.</p></div>
      {!editing && <button className="button button-outline button-small" type="button" onClick={() => { setEditing(true); setFormError(""); setSavedMessage(""); }}>Edit</button>}
    </header>
    {savedMessage && <p className="store-profile-feedback success" role="status"><span aria-hidden="true">✓</span>{savedMessage}</p>}
    {formError && <p className="store-profile-feedback error" role="alert"><span aria-hidden="true">!</span>{formError}</p>}
    <form className="store-profile-form" onSubmit={submit} noValidate>
      <label>Store name<input required minLength="2" maxLength="100" autoComplete="organization" value={profile.name} disabled={!editing || saving} aria-invalid={Boolean(formError && profile.name.trim().length < 2)} onChange={(event) => { setProfile({ ...profile, name: event.target.value }); setFormError(""); setSavedMessage(""); }} /></label>
      <label className="store-location-field">Location<input required minLength="2" maxLength="120" autoComplete="address-level2" value={profile.location} disabled={!editing || saving} aria-invalid={Boolean(formError && profile.location.trim().length < 2)} onChange={(event) => { setProfile({ ...profile, location: event.target.value, latitude: null, longitude: null }); setFormError(""); setSavedMessage(""); }} />
        <span className="store-location-help">Used to help customers find your pharmacy nearby.</span>
        {editing && <><button className="store-location-button" type="button" onClick={locateStore} disabled={locating || saving}>{locating ? <><span className="store-settings-spinner" aria-hidden="true" />Looking up location…</> : "⌖ Use current store location"}</button><small className="store-location-attribution">Location lookup powered by OpenStreetMap.</small></>}
      </label>
      <label className="store-address-field">Address<textarea required minLength="5" maxLength="240" autoComplete="street-address" rows="3" value={profile.address} disabled={!editing || saving} aria-invalid={Boolean(formError && profile.address.trim().length < 5)} onChange={(event) => { setProfile({ ...profile, address: event.target.value }); setFormError(""); setSavedMessage(""); }} /></label>
      <label>Phone<input required type="tel" inputMode="tel" autoComplete="tel" maxLength="25" placeholder="+91 98765 43210" value={profile.phone} disabled={!editing || saving} aria-invalid={formError === "Enter a valid phone number with 7 to 15 digits."} onChange={(event) => { setProfile({ ...profile, phone: event.target.value }); setFormError(""); setSavedMessage(""); }} /></label>
      {editing && <div className="store-profile-actions"><button className="button button-primary button-small" type="submit" disabled={saving || locating}>{saving ? <><span className="store-settings-spinner" aria-hidden="true" />Saving changes…</> : "Save Changes"}</button><button className="button button-outline button-small" type="button" disabled={saving || locating} onClick={() => { setProfile({ name: pharmacy.name || "", location: pharmacy.location || "", address: pharmacy.address || "", phone: pharmacy.phone || "", latitude: pharmacy.latitude ?? null, longitude: pharmacy.longitude ?? null }); setEditing(false); setFormError(""); setSavedMessage(""); }}>Cancel</button></div>}
    </form>
  </section>;
}

function ProfilePanel({ profile, user, onChange, onError, onNotice }) {
  const [name, setName] = useState(profile?.name || user?.name || "");
  const [saving, setSaving] = useState(false);

  const save = async (event) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const updated = await updateProfile(user.id, { name });
      onChange({ ...user, name: updated.name });
      onNotice("Profile updated.");
    } catch (err) { onError(err.message || "Failed to update profile."); }
    finally { setSaving(false); }
  };

  return <section className="content-section dashboard-section"><SectionTitle eyebrow="YOUR ACCOUNT" title="Profile settings" sub="Manage your Medlytic account details." /><div className="panel profile-panel"><div className="profile-avatar">{(name || "M").slice(0, 1).toUpperCase()}</div><form className="stack-form" onSubmit={save}><label>Your name<input required maxLength="80" value={name} onChange={(event) => setName(event.target.value)} /></label><label>Email address<input value={profile?.email || user?.email || ""} disabled /></label><label>Account type<input value={`${(user?.role || "patient").slice(0, 1).toUpperCase()}${(user?.role || "patient").slice(1)} account`} disabled /></label><button className="button button-primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save profile"}</button></form></div></section>;
}

function SectionTitle({ eyebrow, title, sub }) {
  return <div className="section-heading dashboard-heading"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2><p>{sub}</p></div></div>;
}

function Metric({ label, value }) {
  return <div className="metric-card"><span>{label}</span><strong>{value}</strong></div>;
}

function EmptyDashboard({ text }) {
  return <div className="empty-state compact"><span>✦</span><p>{text}</p></div>;
}

function Modal({ title, onClose, children, className = "", showHeading = true }) {
  const modifier = className ? ` ${className}` : "";
  const backdropClass = className ? `modal-backdrop ${className}-backdrop` : "modal-backdrop";
  return <div className={backdropClass} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={`modal${modifier}`} role="dialog" aria-modal="true" aria-label={title}><button className="modal-close" onClick={onClose} aria-label="Close">×</button>{showHeading && <><span className="eyebrow">MEDLYTIC</span><h2>{title}</h2></>}{children}</section></div>;
}

export default App;
