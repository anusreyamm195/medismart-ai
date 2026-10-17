export const demoPharmacyIds = new Set([
  "pharmacy-green-cross",
  "pharmacy-city-care",
  "pharmacy-wellness",
]);

export function isRegisteredPharmacy(pharmacy) {
  return Boolean(pharmacy?.ownerId) && !demoPharmacyIds.has(pharmacy.id);
}

export function removeDemoPharmacies(data) {
  const originalCount = data.pharmacies.length;
  data.pharmacies = data.pharmacies.filter((pharmacy) => !demoPharmacyIds.has(pharmacy.id));
  data.savedPharmacies = (data.savedPharmacies || []).filter((saved) => !demoPharmacyIds.has(saved.pharmacyId));
  data.ratings = (data.ratings || []).filter((rating) => !demoPharmacyIds.has(rating.pharmacyId));
  data.listings = (data.listings || []).filter((listing) => !demoPharmacyIds.has(listing.pharmacyId));
  return originalCount - data.pharmacies.length;
}
