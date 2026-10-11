function MedicineCard({ medicine }) {
  return (
    <div className="medicine-card">

      <h3>{medicine.name}</h3>

      <p>
        Generic: {medicine.genericName}
      </p>

      <p>
        Category: {medicine.category}
      </p>

      <p>
        🏥 {medicine.pharmacy}
      </p>

      <p>
        📍 {medicine.location}
      </p>

      <p>
        💰 ₹{medicine.price}
      </p>

      <p>
        📦 Stock: {medicine.stock}
      </p>

      <p>
        ⭐ {medicine.rating}
      </p>

      <button>
        View Details
      </button>

    </div>
  );
}

export default MedicineCard;
