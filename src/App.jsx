import { useCallback, useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import "./medlytic.css";
import StoreLocationPicker from "./components/StoreLocationPicker";
import {
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

function groupMedicinesByPharmacy(medicines) {
  const pharmacies = new Map();
  for (const medicine of medicines) {
    const listings = pharmacies.get(medicine.pharmacyId) || [];
    listings.push(medicine);
    pharmacies.set(medicine.pharmacyId, listings);
  }
  return [...pharmacies.entries()].map(([pharmacyId, listings]) => ({ pharmacyId, listings }));
}

function App() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState("home");
  const [medicines, setMedicines] = useState([]);
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
  const [profileData, setProfileData] = useState(null);
  const [ownerData, setOwnerData] = useState(null);
  const [adminData, setAdminData] = useState(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [reportTarget, setReportTarget] = useState(null);
  const pharmacyResults = groupMedicinesByPharmacy(medicines);

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

  const search = useCallback(async (searchQuery = query, locationQuery = location, coordinates = userCoordinates, searchRadiusKm = radiusKm, searchSort = sort) => {
    setLoading(true);
    setError("");
    try {
      const data = await searchMedicines(
        {
          q: searchQuery,
          location: locationQuery,
          maxPrice,
          sort: searchSort,
          latitude: coordinates?.latitude,
          longitude: coordinates?.longitude,
          radiusKm: searchRadiusKm,
        },
        user
      );
      setMedicines(data.medicines);
      setView("home");
    } catch (err) {
      setError(err.message || "Failed to search medicines.");
    } finally {
      setLoading(false);
    }
  }, [query, location, userCoordinates, maxPrice, sort, radiusKm, user]);

  // Initial data loading & user session check
  useEffect(() => {
    searchMedicines({ sort: "price-asc" })
      .then((data) => setMedicines(data.medicines))
      .catch((err) => setError(err.message || "Failed to load catalogue."));

    getCurrentUser()
      .then((currentUser) => {
        if (currentUser) {
          setUser(currentUser);
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
    } else if (view === "owner") {
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
        setAuthOpen(false);
        setNotice(data.message || `Welcome, ${data.user.name}.`);
        setError("");
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
          setAuthOpen(false);
          setNotice(data.message || `Welcome, ${data.user?.name || ""}.`);
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
      setAuthMode("login");
      setAuthOpen(true);
      return;
    }
    try {
      const data = await apiReserveMedicine(user.id, listing.id, 1);
      setNotice(data.message);
    } catch (err) {
      setError(err.message || "Failed to reserve medicine.");
    }
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
        <a className="brand" href="/" onClick={(event) => { event.preventDefault(); setView("home"); }}>
          <span className="brand-mark">✚</span>
          <span>medlytic<span className="brand-dot">.</span><small>care, within reach</small></span>
        </a>
        <nav className="main-nav" aria-label="Main navigation">
          <button className={view === "home" ? "nav-link active" : "nav-link"} onClick={() => setView("home")}>Find medicines</button>
          {user?.role === "patient" && <>
            <button className={view === "history" ? "nav-link active" : "nav-link"} onClick={() => setView("history")}>My searches</button>
            <button className={view === "saved" ? "nav-link active" : "nav-link"} onClick={() => setView("saved")}>Saved stores</button>
            <button className={view === "profile" ? "nav-link active" : "nav-link"} onClick={() => setView("profile")}>Profile</button>
          </>}
          {user?.role === "owner" && <button className={view === "owner" ? "nav-link active" : "nav-link"} onClick={() => setView("owner")}>Store dashboard</button>}
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
            {medicines.length ? <div className="pharmacy-result-grid">{pharmacyResults.map(({ pharmacyId, listings }) =>
              <PharmacyResultCard key={pharmacyId} pharmacy={listings[0]} medicines={listings} userCoordinates={userCoordinates} onDetails={openMedicine} onReserve={reserveMedicine} onSave={() => savePharmacy(pharmacyId)} onRate={ratePharmacy} />)}</div>
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
        {view === "owner" && <OwnerDashboard data={ownerData} user={user} onRefresh={() => setRefreshVersion((version) => version + 1)} onError={setError} onNotice={setNotice} />}
        {view === "admin" && <AdminDashboard data={adminData} currentAdminId={user?.id} onRefresh={() => setRefreshVersion((version) => version + 1)} onError={setError} onNotice={setNotice} />}
      </main>

      <footer className="site-footer"><a className="brand footer-brand" href="/" onClick={(event) => { event.preventDefault(); setView("home"); }}><span className="brand-mark">✚</span><span>medlytic<span className="brand-dot">.</span></span></a><span>Medicine information is for general awareness only. Always follow your clinician’s advice.</span><span>© 2026 Medlytic</span></footer>

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
        <div className="alternatives"><h3>Similar options to discuss with a pharmacist</h3><p>{detail.alternatives.length ? detail.alternatives.join(", ") : "No alternatives are listed in the local catalogue."}</p><small>Similar active ingredient does not mean medicines are interchangeable. Confirm suitability with a clinician or pharmacist.</small></div>
        <h3 className="availability-heading">Available listings</h3>{detail.listings.map((listing) => <div className="listing-line" key={listing.id}><span><b>{listing.pharmacy}</b><small>{listing.location} · ★ {listing.rating}</small></span><strong>₹{listing.price.toFixed(2)}</strong></div>)}
        {user?.role === "patient" && <button className="text-button report-link" onClick={() => { setReportTarget({ name: detail.medicine.name }); setDetail(null); }}>Report incorrect information</button>}
      </Modal>}

      {reportTarget && <Modal title="Report information" onClose={() => setReportTarget(null)}><p className="modal-intro">Help us keep medicine and pharmacy information accurate. Reports are reviewed by the platform team.</p><form className="stack-form" onSubmit={submitReport}><label>Report type<select name="type"><option value="incorrect_price">Incorrect price</option><option value="incorrect_stock">Incorrect availability</option><option value="medicine_information">Medicine information</option><option value="complaint">Complaint</option></select></label><label>What should we review?<textarea name="details" required minLength="5" maxLength="1000" rows="4" /></label>{error && <div className="alert alert-error">{error}</div>}<button className="button button-primary button-full" type="submit">Send report</button></form></Modal>}
    </div>
  );
}

function PharmacyResultCard({ pharmacy, medicines, userCoordinates, onDetails, onReserve, onSave, onRate }) {
  const [rating, setRating] = useState("5");
  const destination = Number.isFinite(pharmacy.latitude) && Number.isFinite(pharmacy.longitude)
    ? `${pharmacy.latitude},${pharmacy.longitude}`
    : pharmacy.address || pharmacy.location;
  const directions = new URLSearchParams({ api: "1", destination });
  if (userCoordinates) directions.set("origin", `${userCoordinates.latitude},${userCoordinates.longitude}`);
  return <article className="pharmacy-result-card">
    <header className="pharmacy-result-header">
      <span className="pharmacy-icon">⌂</span>
      <div className="pharmacy-result-info">
        <h3>{pharmacy.pharmacy}</h3>
        <p>{Number.isFinite(pharmacy.distanceKm) ? `${pharmacy.distanceKm.toFixed(2)} km by road` : "Road distance unavailable"}</p>
        <small>{pharmacy.location}</small>
      </div>
      <button className="icon-button" onClick={onSave} aria-label={`Save ${pharmacy.pharmacy}`}>♡</button>
    </header>
    <a className="map-link pharmacy-directions" href={`https://www.google.com/maps/dir/?${directions}`} target="_blank" rel="noreferrer">Get directions ↗</a>
    <div className="pharmacy-result-medicines">
      {medicines.map((medicine) => <div className="pharmacy-medicine-row" key={medicine.id}>
        <div className="pharmacy-medicine-info">
          <b>{medicine.name}</b>
          <small>{medicine.genericName} · {medicine.stock > 0 ? `${medicine.stock} in stock` : "Out of stock"}</small>
        </div>
        <strong>₹{medicine.price.toFixed(2)}</strong>
        <div className="pharmacy-medicine-actions">
          <button className="button button-outline" onClick={() => onDetails(medicine)}>Details</button>
          <button className="button button-primary" disabled={!medicine.stock} onClick={() => onReserve(medicine)}>Reserve</button>
        </div>
      </div>)}
    </div>
    <div className="rate-control"><select aria-label={`Rating for ${pharmacy.pharmacy}`} value={rating} onChange={(event) => setRating(event.target.value)}><option value="5">★★★★★</option><option value="4">★★★★☆</option><option value="3">★★★☆☆</option><option value="2">★★☆☆☆</option><option value="1">★☆☆☆☆</option></select><button className="text-button rate-link" onClick={() => onRate(Number(rating))}>Rate pharmacy</button><span className="rating">★ {pharmacy.rating}</span></div>
  </article>;
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
    <div className="metric-grid"><Metric label="Listed medicines" value={data?.stats?.listingCount ?? "—"} /><Metric label="In-stock items" value={data?.stats?.inStock ?? "—"} /><Metric label="Average rating" value={data?.stats?.rating ? `★ ${data.stats.rating}` : "—"} /></div>
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
