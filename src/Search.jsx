import { useState } from "react";
import medicines from "./data/medicines";
import MedicineCard from "./components/MedicineCard";

function Search() {
  const [searchTerm, setSearchTerm] = useState("");

  const filteredMedicines = medicines.filter((medicine) =>
    medicine.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    medicine.genericName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    medicine.category.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="search-page">

      <h1>Search Medicines</h1>

      <input
        type="text"
        placeholder="Search medicine, brand or generic name..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
      />

      <div className="medicine-list">

        {filteredMedicines.map((medicine) => (
          <MedicineCard
            key={medicine.id}
            medicine={medicine}
          />
        ))}

      </div>

    </div>
  );
}

export default Search;