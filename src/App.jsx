import { useCallback, useEffect, useState } from "react";
import "./medlytic.css";
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

function App() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState("home");
  const [medicines, setMedicines] = useState([]);
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const [userCoordinates, setUserCoordinates] = useState(null);
  const [locating, setLocating] = useState(false);
  const [registrationCoordinates, setRegistrationCoordinates] = useState(null);
  const [maxPrice, setMaxPrice] = useState("");
  const [sort, setSort] = useState("price-asc");
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

  const search = useCallback(async (searchQuery = query, locationQuery = location, coordinates = userCoordinates) => {
    setLoading(true);
    setError("");
    try {
      const data = await searchMedicines(
        {
          q: searchQuery,
          location: locationQuery,
          maxPrice,
          sort,
          latitude: coordinates?.latitude,
          longitude: coordinates?.longitude,
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
  }, [query, location, userCoordinates, maxPrice, sort, user]);

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
    await search();
  };

  const locateMe = async () => {
    setLocating(true);
    setError("");
    try {
      const coordinates = await getCurrentPosition();
      setUserCoordinates(coordinates);
      const nearbyLocation = await reverseGeocode(coordinates);
      setLocation(nearbyLocation);
      await search(query, nearbyLocation, coordinates);
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
        const registration = { ...payload, role: authRole };
        if (authRole === "owner" && registrationCoordinates) {
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
            <><button className="button button-quiet" onClick={() => { setAuthMode("login"); setAuthError(""); setAuthOpen(true); }}>Log in</button><button className="button button-primary button-small" onClick={() => { setAuthMode("register"); setAuthRole("patient"); setAuthError(""); setAuthOpen(true); }}>Create account</button></>}
        </div>
      </header>

      <main>
        {error && view !== "home" && !authOpen && !detail && !reportTarget && <div className="content-section alert alert-error dashboard-alert" role="alert">{error}<button onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}
        {notice && view !== "home" && <div className="content-section alert alert-success dashboard-alert" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Dismiss notification">×</button></div>}
        {view === "home" && <>
          <section className="hero">
            <div className="hero-copy">
              <span className="eyebrow"><span className="pulse-dot" /> YOUR LOCAL MEDICINE GUIDE</span>
              <h1>Find the right medicine.<br /><em>At the right price.</em></h1>
              <p>Compare real-time availability and prices from pharmacies near you. Better access starts with better information.</p>
              <div className="trust-line"><span>✓ Verified pharmacy listings</span><span>✓ Price transparency</span><span>✓ Always free to search</span></div>
            </div>
            <div className="hero-art" aria-hidden="true">
              <div className="art-ring ring-one" /><div className="art-ring ring-two" />
              <div className="pill-bottle"><div className="bottle-cap" /><div className="bottle-label"><span>Rx</span><b>CARE<br />THAT'S<br />CLOSER</b></div></div>
              <div className="floating-pill pill-a" /><div className="floating-pill pill-b" />
              <div className="art-note"><span>✦</span> Your health, made simpler</div>
            </div>
            <form className="search-form" onSubmit={handleSearch}>
              <label className="search-field"><span>⌕</span><input aria-label="Medicine name" placeholder="Medicine, brand or generic name" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
              <label className="search-field location-field"><span>⌖</span><input aria-label="Location" placeholder="City or area" value={location} onChange={(event) => { setLocation(event.target.value); setUserCoordinates(null); }} /></label>
              <button className="button button-outline button-small locate-button" type="button" onClick={locateMe} disabled={locating}>{locating ? "Locating…" : "Locate me"}</button>
              <button className="button button-primary search-submit" type="submit" disabled={loading}>{loading ? "Searching…" : "Search medicines"} <span>↗</span></button>
            </form>
            <a className="map-attribution search-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">Location lookup © OpenStreetMap</a>
          </section>

          <section className="content-section results-section">
            <div className="section-heading">
              <div><span className="eyebrow">LOCAL AVAILABILITY</span><h2>{query ? `Results for “${query}”` : "Popular near you"}</h2><p>{userCoordinates ? "Nearby pharmacies, closest first." : "Prices and stock reported by listed pharmacies."}</p></div>
              <label className="sort-control"><span>Sort by</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="price-asc">Price: low to high</option><option value="price-desc">Price: high to low</option><option value="rating">Pharmacy rating</option></select></label>
            </div>
            <label className="price-filter">Max price <span>₹</span><input aria-label="Maximum price" type="number" min="0" placeholder="Any" value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)} /><button onClick={() => search()} type="button">Apply</button></label>
            {error && <div className="alert alert-error" role="alert">{error}</div>}
            {notice && <div className="alert alert-success" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Dismiss notification">×</button></div>}
            {medicines.length ? <div className="medicine-grid">{medicines.map((medicine) =>
              <MedicineCard key={medicine.id} medicine={medicine} userCoordinates={userCoordinates} onDetails={() => openMedicine(medicine)} onReserve={() => reserveMedicine(medicine)} onSave={() => savePharmacy(medicine.pharmacyId)} onRate={() => ratePharmacy(medicine.pharmacyId)} />)}</div>
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
          title={authMode === "login" ? "Welcome back" : "Create your account"}
          onClose={() => {
            if (!authLoading) {
              setAuthOpen(false);
              setAuthError("");
            }
          }}
        >
          <p className="modal-intro">
            {authMode === "login"
              ? "Sign in to manage your searches and saved pharmacies."
              : "Join Medlytic to find care closer to home."}
          </p>
          <form className="stack-form" onSubmit={handleAuth}>
            {authMode === "register" && (
              <>
                <label>
                  Your name
                  <input name="name" required autoComplete="name" disabled={authLoading} />
                </label>
                <label>
                  I am a
                  <select
                    value={authRole}
                    onChange={(event) => { setAuthRole(event.target.value); setRegistrationCoordinates(null); }}
                    disabled={authLoading}
                  >
                    <option value="patient">Patient</option>
                    <option value="owner">Medical store owner</option>
                  </select>
                </label>
                {authRole === "owner" && (
                  <>
                    <label>
                      Pharmacy name
                      <input name="pharmacyName" required disabled={authLoading} />
                    </label>
                    <label>
                      Store location
                      <input name="location" required placeholder="Area or city" disabled={authLoading} onChange={() => setRegistrationCoordinates(null)} />
                    </label>
                    <button className="button button-outline button-small location-action" type="button" disabled={authLoading} onClick={async (event) => {
                      const button = event.currentTarget;
                      button.disabled = true;
                      try {
                        const coordinates = await getCurrentPosition();
                        setRegistrationCoordinates(coordinates);
                        button.form.elements.location.value = await reverseGeocode(coordinates);
                      } catch (err) {
                        setAuthError(err.message);
                      } finally {
                        button.disabled = authLoading;
                      }
                    }}>Use current store location</button>
                    <small className="map-attribution">Location lookup © OpenStreetMap</small>
                  </>
                )}
              </>
            )}
            <label>
              Email address
              <input name="email" type="email" required autoComplete="email" disabled={authLoading} />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                required
                minLength="8"
                autoComplete={authMode === "login" ? "current-password" : "new-password"}
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
                : (authMode === "login" ? "Log in" : "Create account")}
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
              ? "New to Medlytic? Create an account"
              : "Already have an account? Log in"}
          </button>
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

function MedicineCard({ medicine, userCoordinates, onDetails, onReserve, onSave, onRate }) {
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
    <div className="card-actions"><button className="button button-primary" disabled={!medicine.stock} onClick={onReserve}>Reserve</button><button className="button button-outline" onClick={onDetails}>Details</button><button className="icon-button" onClick={onSave} aria-label={`Save ${medicine.pharmacy}`}>♡</button></div>
    <div className="rate-control"><select aria-label={`Rating for ${medicine.pharmacy}`} value={rating} onChange={(event) => setRating(event.target.value)}><option value="5">★★★★★</option><option value="4">★★★★☆</option><option value="3">★★★☆☆</option><option value="2">★★☆☆☆</option><option value="1">★☆☆☆☆</option></select><button className="text-button rate-link" onClick={() => onRate(Number(rating))}>Rate pharmacy</button></div>
  </article>;
}

function OwnerDashboard({ data, user, onRefresh, onError, onNotice }) {
  const [form, setForm] = useState({ name: "", genericName: "", category: "", price: "", stock: "" });
  const [editing, setEditing] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const listings = data?.listings || [];

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
    try {
      await updateOwnerStock(listing.id, stock);
      onNotice("Stock updated.");
      onRefresh();
    } catch (err) {
      onError(err.message || "Failed to update stock.");
    }
  };

  return <section className="content-section dashboard-section"><SectionTitle eyebrow="PHARMACY PORTAL" title={data?.pharmacy?.name || "Store dashboard"} sub={data?.pharmacy?.status === "pending" ? "Your store is awaiting admin approval. You can prepare inventory while we review your registration." : "Manage your store listing, live inventory and customer requests."} />
    <div className="metric-grid"><Metric label="Listed medicines" value={data?.stats?.listingCount ?? "—"} /><Metric label="In-stock items" value={data?.stats?.inStock ?? "—"} /><Metric label="Average rating" value={data?.stats?.rating ? `★ ${data.stats.rating}` : "—"} /></div>
    {data?.pharmacy && <StoreProfileEditor key={JSON.stringify(data.pharmacy)} pharmacy={data.pharmacy} user={user} onRefresh={onRefresh} onError={onError} onNotice={onNotice} />}
    <div className="dashboard-columns"><div className="panel"><h3>{editing ? "Edit medicine" : "Add a medicine"}</h3><form className="stack-form" onSubmit={submit}><label>Medicine name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label><label>Generic name<input required value={form.genericName} onChange={(e) => setForm({ ...form, genericName: e.target.value })} /></label><label>Category<input required value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></label><div className="form-row"><label>Price (₹)<input type="number" min="0" step="0.01" required value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></label><label>Stock quantity<input type="number" min="0" required value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} /></label></div><button className="button button-primary" type="submit" disabled={submitting}>{submitting ? "Saving…" : (editing ? "Save changes" : "Add to inventory")}</button>{editing && <button className="text-button" type="button" onClick={() => { setEditing(null); setForm({ name: "", genericName: "", category: "", price: "", stock: "" }); }}>Cancel edit</button>}</form></div>
      <div className="panel"><h3>Customer requests</h3>{data?.reservations?.length ? data.reservations.map((item) => <div className="request-line" key={item.id}><span><b>{item.medicine}</b><small>{item.customer} · Qty {item.quantity}</small></span><span className={`status-tag ${item.status}`}>{item.status}</span></div>) : <p className="muted-copy">Reservations for your listed medicines will appear here.</p>}</div></div>
    <div className="panel inventory-panel"><h3>Medicine inventory <span className="subtle-count">{listings.length} listings</span></h3>{listings.length ? listings.map((listing) => <div className="inventory-line" key={listing.id}><span><b>{listing.name}</b><small>{listing.genericName} · ₹{listing.price.toFixed(2)}</small></span><label className="stock-control">Stock<input type="number" min="0" defaultValue={listing.stock} onBlur={(e) => { if (Number(e.target.value) !== listing.stock) updateStock(listing, Number(e.target.value)); }} /></label><button className="text-button" onClick={() => edit(listing)}>Edit</button></div>) : <EmptyDashboard text="Add your first medicine using the form above." />}</div>
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

function Modal({ title, onClose, children }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-label={title}><button className="modal-close" onClick={onClose} aria-label="Close">×</button><span className="eyebrow">MEDLYTIC</span><h2>{title}</h2>{children}</section></div>;
}

export default App;
