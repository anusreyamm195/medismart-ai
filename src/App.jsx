import { useState } from "react";
import Navbar from "./components/Navbar";
import medicines from "./data/medicines";
import MedicineCard from "./components/MedicineCard";

function App() {
  const [searchTerm, setSearchTerm] = useState("");
  const [showResults, setShowResults] = useState(false);

  const handleSearch = () => {
    if (searchTerm.trim() === "") {
      alert("Please enter a medicine name");
      return;
    }

    setShowResults(true);
  };

  const filteredMedicines = medicines.filter((medicine) => {
    const search = searchTerm.toLowerCase().trim();

    return (
      medicine.name.toLowerCase().includes(search) ||
      medicine.genericName.toLowerCase().includes(search) ||
      medicine.category.toLowerCase().includes(search)
    );
  });

  return (
    <div>
      <Navbar />

      {/* HERO SECTION */}
      <section className="hero">

        <h1>Find Your Medicine Easily</h1>

        <p>
          Search medicines, compare prices, and find nearby pharmacies.
        </p>

        {/* SEARCH BOX */}
        <div className="search-box">

          <input
            type="text"
            placeholder="Search medicine, brand or generic name..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setShowResults(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleSearch();
              }
            }}
          />

          <button onClick={handleSearch}>
            🔍 Search
          </button>

        </div>

      </section>

      {/* SEARCH RESULTS */}
      {showResults && (
        <section className="search-results">

          <h2>Medicine Search Results</h2>

          {filteredMedicines.length > 0 ? (
            <div className="medicine-results">

              {filteredMedicines.map((medicine) => (
                <MedicineCard
                  key={medicine.id}
                  medicine={medicine}
                />
              ))}

            </div>
          ) : (
            <div className="no-results">
              <h3>No medicine found</h3>
              <p>
                We couldn't find a medicine matching "{searchTerm}".
              </p>
            </div>
          )}

        </section>
      )}

      {/* FEATURES SECTION */}
      <section className="features">

        <div className="feature-card">
          <div>💊</div>

          <h3>Medicine Search</h3>

          <p>
            Search medicines by name, brand or generic name.
          </p>
        </div>

        <div className="feature-card">
          <div>🏥</div>

          <h3>Nearby Pharmacies</h3>

          <p>
            Find pharmacies where your medicine is available.
          </p>
        </div>

        <div className="feature-card">
          <div>💰</div>

          <h3>Compare Prices</h3>

          <p>
            Compare medicine prices across pharmacies.
          </p>
        </div>

        <div className="feature-card">
          <div>🤖</div>

          <h3>AI Assistant</h3>

          <p>
            Get helpful medicine information using AI.
          </p>
        </div>

      </section>

    </div>
  );
}

export default App;