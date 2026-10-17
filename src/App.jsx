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
  getNearbyPharmacies,
  getApprovedPharmacies,
  getUserReservations,
  savePharmacy as apiSavePharmacy,
  ratePharmacy as apiRatePharmacy,
  reserveMedicine as apiReserveMedicine,
  submitReport as apiSubmitReport,
  getOwnerDashboard,
  saveOwnerMedicine,
  updateOwnerStock,
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
  const [history, setHistory] = useState([]);
  const [saved, setSaved] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [reservationsLoadedFor, setReservationsLoadedFor] = useState(null);
  const [reservationCartOpen, setReservationCartOpen] = useState(false);
  const [pendingReservation, setPendingReservation] = useState(null);
  const [reservingListingId, setReservingListingId] = useState(null);
  const [profileData, setProfileData] = useState(null);
  const [ownerData, setOwnerData] = useState(null);
  const [adminData, setAdminData] = useState(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [reportTarget, setReportTarget] = useState(null);
  const reservationUserId = user?.role === "patient" ? user.id : null;
  const reservationsLoading = Boolean(reservationUserId && reservationsLoadedFor !== reservationUserId);

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

  // View data fetching based on current authenticated state & view
  useEffect(() => {
    if (!user) return;
    if (view === "history") {
      getSearchHistory(user.id)
        .then((items) => setHistory(items))
        .catch((err) => setError(err.message));
    } else if (view === "saved") {
      getSavedPharmacies(user.id)
        .then((items) => setSaved(items))
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

  const visiblePharmacyOptions = pharmacyOptions.filter((pharmacy) => {
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

  const savePharmacy = async (pharmacyId) => {
    if (!user) {
      setAuthMode("login");
      setAuthOpen(true);
      return;
    }
    try {
      const data = await apiSavePharmacy(user.id, pharmacyId);
      setNotice(data.message);
    } catch (err) {
      setError(err.message || "Failed to save pharmacy.");
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

            {nearbySearchActive && <NearbyPharmacies pharmacies={nearbyPharmacies} location={nearbySearchLocation} coordinates={userCoordinates} />}
            {registeredMedicines.length ? <div className="medicine-grid">{registeredMedicines.map((medicine) =>
              <MedicineCard key={medicine.id} medicine={medicine} userCoordinates={userCoordinates} reserving={reservingListingId === medicine.id} onDetails={() => openMedicine(medicine)} onReserve={() => reserveMedicine(medicine)} onSave={() => savePharmacy(medicine.pharmacyId)} onRate={(rating) => ratePharmacy(medicine.pharmacyId, rating)} />)}</div>
              : <div className="empty-state"><span>⌕</span><h3>No matching medicines</h3><p>Try another name or broaden your location.</p></div>}
          </section>
          <section className="how-section">
            <div><span className="eyebrow">SIMPLE BY DESIGN</span><h2>Good care starts with a good search.</h2></div>
            <div className="how-grid"><article><span>01</span><h3>Search locally</h3><p>Find medicines at participating pharmacies in your area.</p></article><article><span>02</span><h3>Compare clearly</h3><p>Check reported prices, stock and community ratings side by side.</p></article><article><span>03</span><h3>Choose confidently</h3><p>Contact a pharmacy or reserve an item for pickup.</p></article></div>
          </section>
        </>}
        {view === "history" && <section className="content-section dashboard-section"><SectionTitle eyebrow="YOUR ACCOUNT" title="Recent medicine searches" sub="Pick up where you left off." />{history.length ? <div className="history-list">{history.map((item) => <button key={item.id} onClick={() => { setQuery(item.query); search(item.query); }}><span className="history-icon">⌕</span><span><b>{item.query}</b><small>{new Date(item.createdAt).toLocaleString()}</small></span><span className="history-arrow">↗</span></button>)}</div> : <EmptyDashboard text="Your searches will appear here after you look up a medicine." />}</section>}
        {view === "saved" && <section className="content-section dashboard-section"><SectionTitle eyebrow="YOUR ACCOUNT" title="Saved pharmacies" sub="Keep trusted local stores close at hand." />{saved.length ? <div className="medicine-grid">{saved.map((pharmacy) => <PharmacyCard key={pharmacy.id} pharmacy={pharmacy} />)}</div> : <EmptyDashboard text="Save a pharmacy from any medicine result to see it here." />}</section>}
        {view === "profile" && <ProfilePanel key={profileData?.name || ""} profile={profileData} user={user} onChange={setUser} onError={setError} onNotice={setNotice} />}
        {view === "owner-dashboard" && <OwnerOverview data={ownerData} onOpenStore={() => setView("owner")} />}
        {view === "owner" && <OwnerDashboard data={ownerData} user={user} onRefresh={() => setRefreshVersion((version) => version + 1)} onError={setError} onNotice={setNotice} />}
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
              {reservationsLoading ? <p className="reservation-cart-message">Loading your reservations…</p>
                : reservations.length ? reservations.map((item) => <article className="reservation-cart-item" key={item.id}>
                  <div className="reservation-cart-medicine"><span aria-hidden="true">✚</span><div><b>{item.medicine}</b>{item.genericName && <small>{item.genericName}</small>}</div></div>
                  <p className="reservation-cart-pharmacy">{item.pharmacy}{item.location ? ` · ${item.location}` : ""}</p>
                  <div className="reservation-cart-item-meta"><span>Qty <b>{item.quantity}</b></span><span className={`status-tag ${item.status}`}>{item.status}</span></div>
                  {item.createdAt && <small className="reservation-cart-date">{new Date(item.createdAt).toLocaleDateString()}</small>}
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

      {detail && <Modal title={detail.medicine.name} onClose={() => setDetail(null)}>
        <div className="detail-generic">{detail.medicine.genericName} · {detail.medicine.category}</div>
        <div className="detail-info"><h3>About this medicine</h3><p>{detail.medicine.info || "Ask a pharmacist or clinician for medicine-specific guidance."}</p><div className="medical-disclaimer">General information only — not a diagnosis or treatment recommendation. Do not start, stop, or change medication without advice from a qualified health professional.</div></div>
        <MedicineChatbot medicine={detail.medicine} />
        <div className="alternatives"><h3>Similar options to discuss with a pharmacist</h3><p>{detail.alternatives.length ? detail.alternatives.join(", ") : "No alternatives are listed in the local catalogue."}</p><small>Similar active ingredient does not mean medicines are interchangeable. Confirm suitability with a clinician or pharmacist.</small></div>
        <h3 className="availability-heading">Available listings</h3>{detail.listings.map((listing) => <div className="listing-line" key={listing.id}><span><b>{listing.pharmacy}</b><small>{listing.location} · ★ {listing.rating}</small></span><strong>₹{listing.price.toFixed(2)}</strong></div>)}
        {user?.role === "patient" && <button className="text-button report-link" onClick={() => { setReportTarget({ name: detail.medicine.name }); setDetail(null); }}>Report incorrect information</button>}
      </Modal>}

      {reportTarget && <Modal title="Report information" onClose={() => setReportTarget(null)}><p className="modal-intro">Help us keep medicine and pharmacy information accurate. Reports are reviewed by the platform team.</p><form className="stack-form" onSubmit={submitReport}><label>Report type<select name="type"><option value="incorrect_price">Incorrect price</option><option value="incorrect_stock">Incorrect availability</option><option value="medicine_information">Medicine information</option><option value="complaint">Complaint</option></select></label><label>What should we review?<textarea name="details" required minLength="5" maxLength="1000" rows="4" /></label>{error && <div className="alert alert-error">{error}</div>}<button className="button button-primary button-full" type="submit">Send report</button></form></Modal>}
    </div>
  );
}

function OwnerOverview({ data, onOpenStore }) {
  const listings = data?.listings || [];
  const reservations = data?.reservations || [];
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

  return <section className="content-section dashboard-section">
    <SectionTitle eyebrow="PHARMACY PORTAL" title="Owner dashboard" sub={data?.pharmacy?.name ? `A live overview of ${data.pharmacy.name}.` : "A live overview of your pharmacy inventory and customer reservations."} />
    <div className="metric-grid owner-overview-grid">
      <Metric label="Total medicine listings" value={counts.total} />
      <Metric label="Available medicines" value={counts.available} />
      <Metric label="Low-stock medicines" value={counts.low} />
      <Metric label="Out-of-stock medicines" value={counts.out} />
      <Metric label="Pending reservations" value={reservationCounts.pending} />
      <Metric label="Reservations ready for pickup" value={reservationCounts.ready} />
    </div>
    <div className="panel owner-overview-note"><h3>Manage your pharmacy</h3><p className="muted-copy">Open Store dashboard to add medicines, update stock, and review customer requests.</p><button className="button button-primary button-small" type="button" onClick={onOpenStore}>Open Store dashboard</button></div>
  </section>;
}

function MedicineCard({ medicine, userCoordinates, reserving, onDetails, onReserve, onSave, onRate }) {
  const [rating, setRating] = useState("5");
  const destination = Number.isFinite(medicine.latitude) && Number.isFinite(medicine.longitude)
    ? `${medicine.latitude},${medicine.longitude}`
    : medicine.address || medicine.location;
  const directions = new URLSearchParams({ api: "1", destination });
  if (userCoordinates) directions.set("origin", `${userCoordinates.latitude},${userCoordinates.longitude}`);
  return <article className="medicine-card">
    <div className="medicine-card-top"><span className="medicine-icon">✚</span><span className={medicine.stock > 0 ? "stock-pill" : "stock-pill out"}>{medicine.stock > 0 ? "In stock" : "Out of stock"}</span></div>
    <div className="medicine-name"><h3>{medicine.name}</h3><p>{medicine.genericName} · {medicine.category}</p></div>
    <div className="pharmacy-summary"><span className="pharmacy-icon">⌂</span><span><b>{medicine.pharmacy}</b><small>⌖ {medicine.location}{Number.isFinite(medicine.distanceKm) ? ` · ${medicine.distanceKm.toFixed(1)} km away` : ""}</small></span><span className="rating">★ {medicine.rating}</span></div>
    <a className="map-link" href={`https://www.google.com/maps/dir/?${directions}`} target="_blank" rel="noreferrer">Get directions ↗</a>
    <div className="card-divider" /><div className="price-row"><span>Price per pack</span><strong>₹{medicine.price.toFixed(2)}</strong></div>
    <div className="card-actions"><button className="button button-primary" disabled={!medicine.stock || reserving} onClick={onReserve}>{reserving ? "Reserving…" : "Reserve"}</button><button className="button button-outline" onClick={onDetails}>Details</button><button className="icon-button" onClick={onSave} aria-label={`Save ${medicine.pharmacy}`}>♡</button></div>
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

function OwnerDashboard({ data, user, onRefresh, onError, onNotice }) {
  const [form, setForm] = useState({ name: "", genericName: "", category: "", price: "", stock: "" });
  const [editing, setEditing] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [inventorySearch, setInventorySearch] = useState("");
  const [inventoryStatus, setInventoryStatus] = useState("all");
  const [stockDrafts, setStockDrafts] = useState({});
  const [updatingStockId, setUpdatingStockId] = useState(null);
  const listings = data?.listings || [];
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

  return <section className="content-section dashboard-section"><SectionTitle eyebrow="PHARMACY PORTAL" title={data?.pharmacy?.name || "Store dashboard"} sub={data?.pharmacy?.status === "pending" ? "Your store is awaiting admin approval. You can prepare inventory while we review your registration." : "Manage your store listing, live inventory and customer requests."} />
    {data?.pharmacy && <StoreProfileEditor key={JSON.stringify(data.pharmacy)} pharmacy={data.pharmacy} user={user} onRefresh={onRefresh} onError={onError} onNotice={onNotice} />}
    <div className="dashboard-columns"><div className="panel"><h3>{editing ? "Edit medicine" : "Add a medicine"}</h3><form className="stack-form" onSubmit={submit}><label>Medicine name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label><label>Generic name<input required value={form.genericName} onChange={(e) => setForm({ ...form, genericName: e.target.value })} /></label><label>Category<input required value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></label><div className="form-row"><label>Price (₹)<input type="number" min="0" step="0.01" required value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></label><label>Stock quantity<input type="number" min="0" required value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} /></label></div><button className="button button-primary" type="submit" disabled={submitting}>{submitting ? "Saving…" : (editing ? "Save changes" : "Add to inventory")}</button>{editing && <button className="text-button" type="button" onClick={() => { setEditing(null); setForm({ name: "", genericName: "", category: "", price: "", stock: "" }); }}>Cancel edit</button>}</form></div>
      <div className="panel"><h3>Customer requests</h3>{data?.reservations?.length ? data.reservations.map((item) => <div className="request-line" key={item.id}><span><b>{item.medicine}</b><small>{item.customer} · Qty {item.quantity}</small></span><span className={`status-tag ${item.status}`}>{item.status}</span></div>) : <p className="muted-copy">Reservations for your listed medicines will appear here.</p>}</div></div>
    <div className="panel inventory-panel">
      <div className="inventory-heading">
        <div><h3>Medicine inventory</h3><p>Search your listings and keep stock levels up to date.</p></div>
        <span className="subtle-count">{listings.length} {listings.length === 1 ? "listing" : "listings"}</span>
      </div>
      {listings.length ? <>
        <div className="inventory-tools">
          <label className="inventory-search"><span aria-hidden="true">⌕</span><input type="search" aria-label="Search medicine inventory" placeholder="Search by medicine, generic name or category" value={inventorySearch} onChange={(event) => setInventorySearch(event.target.value)} /></label>
          <div className="inventory-filters" role="group" aria-label="Filter inventory by stock status">
            {[
              ["all", "All", stockCounts.all],
              ["in", "In Stock", stockCounts.in],
              ["low", "Low Stock", stockCounts.low],
              ["out", "Out of Stock", stockCounts.out],
            ].map(([status, label, count]) => <button key={status} type="button" className={inventoryStatus === status ? "inventory-filter active" : "inventory-filter"} aria-pressed={inventoryStatus === status} onClick={() => setInventoryStatus(status)}>{label}<span>{count}</span></button>)}
          </div>
        </div>
        <div className="inventory-result-summary">
          <span>Showing <strong>{visibleListings.length}</strong> of <strong>{listings.length}</strong> medicines</span>
          {(inventorySearch || inventoryStatus !== "all") && <button type="button" className="text-button" onClick={() => { setInventorySearch(""); setInventoryStatus("all"); }}>Clear filters</button>}
        </div>
        <div className="inventory-list">
          {visibleListings.length ? visibleListings.map((listing) => {
            const stockValue = stockDrafts[listing.id] ?? String(listing.stock);
            const stock = Number(listing.stock);
            const status = stock === 0 ? "out" : stock <= 5 ? "low" : "in";
            const canSave = stockValue.trim() !== "" && Number.isInteger(Number(stockValue)) && Number(stockValue) >= 0 && Number(stockValue) !== stock;
            return <div className="inventory-line" key={listing.id}>
              <div className="inventory-medicine"><span className="inventory-medicine-icon" aria-hidden="true">✚</span><span><b>{listing.name}</b><small>{listing.genericName} · {listing.category} · ₹{listing.price.toFixed(2)}</small></span></div>
              <span className={`inventory-stock-status ${status}`}>{status === "out" ? "Out of Stock" : status === "low" ? "Low Stock" : "In Stock"}</span>
              <div className="inventory-stock-editor"><label htmlFor={`inventory-stock-${listing.id}`}>Quantity</label><div><input id={`inventory-stock-${listing.id}`} type="number" min="0" step="1" value={stockValue} onChange={(event) => setStockDrafts((drafts) => ({ ...drafts, [listing.id]: event.target.value }))} /><button className="button button-outline button-small" type="button" disabled={!canSave || updatingStockId !== null} onClick={() => updateStock(listing, stockValue)}>{updatingStockId === listing.id ? "Saving…" : "Save"}</button></div></div>
              <button className="text-button inventory-edit" type="button" onClick={() => edit(listing)}>Edit details</button>
            </div>;
          }) : <p className="inventory-empty">No medicines match these filters. Try another search or stock status.</p>}
        </div>
      </> : <EmptyDashboard text="Add your first medicine using the form above." />}
    </div>
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

function PharmacyCard({ pharmacy }) {
  return <article className="medicine-card saved-pharmacy"><span className="medicine-icon">⌂</span><h3>{pharmacy.name}</h3><p>{pharmacy.location}</p><span className="rating">★ {pharmacy.rating || "New"}</span></article>;
}

function NearbyPharmacies({ pharmacies, location, coordinates }) {
  const uniquePharmacies = [...new Map(pharmacies.map((pharmacy) => [pharmacy.id || pharmacy.pharmacyId, pharmacy])).values()];

  return <section className="nearby-shops" aria-labelledby="nearby-shops-title">
    <div className="nearby-shops-heading">
      <div><span className="eyebrow">PHARMACIES NEAR YOU</span><h3 id="nearby-shops-title">Nearby medical shops</h3><p>{location ? `Showing approved shops near ${location}.` : "Closest shops first."}</p></div>
      <span className="nearby-shop-count">{uniquePharmacies.length} {uniquePharmacies.length === 1 ? "shop" : "shops"}</span>
    </div>
    {uniquePharmacies.length ? <div className="nearby-shop-grid">{uniquePharmacies.map((pharmacy) => {
      const destination = Number.isFinite(pharmacy.latitude) && Number.isFinite(pharmacy.longitude)
        ? `${pharmacy.latitude},${pharmacy.longitude}`
        : pharmacy.address || pharmacy.location;
      const directions = new URLSearchParams({ api: "1", destination });
      if (coordinates) directions.set("origin", `${coordinates.latitude},${coordinates.longitude}`);

      return <article className="nearby-shop" key={pharmacy.id || pharmacy.pharmacyId}>
        <span className="nearby-shop-icon" aria-hidden="true">⌂</span>
        <div className="nearby-shop-copy"><h4>{pharmacy.name || pharmacy.pharmacy}</h4><p>{pharmacy.location}</p><small>{pharmacy.address || pharmacy.location}</small></div>
        <div className="nearby-shop-meta"><span className="rating">★ {pharmacy.rating || "New"}</span>{Number.isFinite(pharmacy.distanceKm) && <span>{pharmacy.distanceKm.toFixed(1)} km</span>}</div>
        <a className="button button-outline button-small nearby-directions" href={`https://www.google.com/maps/dir/?${directions}`} target="_blank" rel="noreferrer">Directions ↗</a>
      </article>;
    })}</div> : <div className="nearby-shop-empty">No approved medical shops were found for this location.</div>}
  </section>;
}

function StoreProfileEditor({ pharmacy, user, onRefresh, onError, onNotice }) {
  const [profile, setProfile] = useState({ name: pharmacy.name, location: pharmacy.location, address: pharmacy.address || "", phone: pharmacy.phone || "", latitude: pharmacy.latitude ?? null, longitude: pharmacy.longitude ?? null });
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);

  const locateStore = async () => {
    setLocating(true);
    try {
      const coordinates = await getCurrentPosition();
      const address = await reverseGeocode(coordinates);
      setProfile((current) => ({ ...current, ...coordinates, location: address, address }));
    } catch (err) { onError(err.message); }
    finally { setLocating(false); }
  };

  const submit = async (event) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await updateOwnerPharmacyProfile(user.id, profile);
      onNotice("Pharmacy profile updated.");
      onRefresh();
    } catch (err) { onError(err.message || "Failed to update pharmacy profile."); }
    finally { setSaving(false); }
  };
  return <div className="panel store-profile-panel"><h3>Pharmacy profile</h3><form className="store-profile-form" onSubmit={submit}><label>Store name<input required value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} /></label><label>Location<input required value={profile.location} onChange={(e) => setProfile({ ...profile, location: e.target.value, latitude: null, longitude: null })} /></label><label>Address<input required value={profile.address} onChange={(e) => setProfile({ ...profile, address: e.target.value })} /></label><label>Phone<input required value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} /></label><button className="button button-outline button-small" type="button" onClick={locateStore} disabled={locating || saving}>{locating ? "Locating…" : "Use current store location"}</button><small className="map-attribution">Location lookup © OpenStreetMap</small><button className="button button-outline button-small" type="submit" disabled={saving}>{saving ? "Saving…" : "Save profile"}</button></form></div>;
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
  return <div className={`modal-backdrop${modifier}-backdrop`} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={`modal${modifier}`} role="dialog" aria-modal="true" aria-label={title}><button className="modal-close" onClick={onClose} aria-label="Close">×</button>{showHeading && <><span className="eyebrow">MEDLYTIC</span><h2>{title}</h2></>}{children}</section></div>;
}

export default App;
