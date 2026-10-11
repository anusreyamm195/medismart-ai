import { useState } from "react";
import medicines from "./data/medicines";
import MedicineCard from "./components/MedicineCard";

function Search() {
  const [searchTerm, setSearchTerm] = useState("");
  const [location, setLocation] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [sortOrder, setSortOrder] = useState("default");

  const filteredMedicines = medicines
    .filter((medicine) => {
      const search = searchTerm.toLowerCase().trim();

      const matchesSearch =
        medicine.name.toLowerCase().includes(search) ||
        medicine.genericName.toLowerCase().includes(search) ||
        medicine.category.toLowerCase().includes(search) ||
        medicine.pharmacy.toLowerCase().includes(search);

      const matchesLocation =
        location === "" ||
        medicine.location.toLowerCase().includes(location.toLowerCase());

      const matchesPrice =
        maxPrice === "" ||
        medicine.price <= Number(maxPrice);

      return matchesSearch && matchesLocation && matchesPrice;
    })
    .sort((a, b) => {
      if (sortOrder === "low-to-high") {
        return a.price - b.price;
      }

      if (sortOrder === "high-to-low") {
        return b.price - a.price;
      }

      return 0;
    });

  return (
    <section className="search-page">
      <h1>Medicine Search</h1>

      <div className="filter-panel">
        <input
          type="text"
          placeholder="Search medicine, generic name or pharmacy..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />

        <input
          type="text"
          placeholder="Enter location (e.g. Bangalore)"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />

        <input
          type="number"
          min="0"
          placeholder="Maximum price (₹)"
          value={maxPrice}
          onChange={(e) => setMaxPrice(e.target.value)}
        />

        <select
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
        >
          <option value="default">Sort by price</option>
          <option value="low-to-high">Price: Low to High</option>
          <option value="high-to-low">Price: High to Low</option>
        </select>

        <button
          type="button"
          onClick={() => {
            setSearchTerm("");
            setLocation("");
            setMaxPrice("");
            setSortOrder("default");
          }}
        >
          Clear Filters
        </button>
      </div>

      <p className="results-count">
        {filteredMedicines.length} medicine(s) found
      </p>

      {filteredMedicines.length > 0 ? (
        <div className="medicine-list">
          {filteredMedicines.map((medicine) => (
            <MedicineCard
              key={medicine.id}
              medicine={medicine}
            />
          ))}
        </div>
      ) : (
        <div className="no-results">
          <h3>No medicines found</h3>
          <p>Try changing your search or filters.</p>
        </div>
      )}
    </section>
  );
}

export default Search;