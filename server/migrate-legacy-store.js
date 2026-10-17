import { readFileSync } from "node:fs";
import { MongoClient } from "mongodb";
import { demoPharmacyIds } from "./demo-pharmacies.js";
import {
  applicationStateCollectionName,
  listingCollectionName,
  medicineCollectionName,
  userCollectionName,
  userDatabaseName,
} from "./db/mongo.js";

const legacyPath = new URL("./store.json", import.meta.url);
const legacyData = JSON.parse(readFileSync(legacyPath, "utf8"));
const client = new MongoClient(process.env.MONGO_URI);

try {
  await client.connect();
  const database = client.db(userDatabaseName);
  const users = database.collection(userCollectionName);
  const medicines = database.collection(medicineCollectionName);
  const listings = database.collection(listingCollectionName);
  const state = database.collection(applicationStateCollectionName);

  await users.createIndex({ email: 1 }, { unique: true });
  await users.createIndex({ id: 1 }, { unique: true });
  await medicines.createIndex({ id: 1 }, { unique: true });
  await listings.createIndex({ id: 1 }, { unique: true });
  await listings.createIndex({ medicineId: 1 });

  let importedUsers = 0;
  for (const user of legacyData.users || []) {
    const existing = await users.findOne({ email: user.email }, { projection: { _id: 1 } });
    if (!existing) {
      await users.updateOne({ id: user.id }, { $setOnInsert: user }, { upsert: true });
      importedUsers += 1;
    }
  }

  for (const medicine of legacyData.medicines || []) {
    const product = { ...medicine };
    delete product.listingId;
    delete product.pharmacyId;
    delete product.price;
    delete product.stock;
    await medicines.updateOne({ id: product.id }, { $setOnInsert: product }, { upsert: true });
  }

  let importedListings = 0;
  for (const listing of legacyData.listings || []) {
    if (demoPharmacyIds.has(listing.pharmacyId)) continue;
    const pharmacy = (legacyData.pharmacies || []).find((item) => item.id === listing.pharmacyId);
    const result = await listings.updateOne(
      { id: listing.id },
      { $setOnInsert: { ...listing, ...(pharmacy?.ownerId ? { ownerId: pharmacy.ownerId } : {}) } },
      { upsert: true },
    );
    if (result.upsertedCount) importedListings += 1;
  }

  for (const medicine of await medicines.find({ listingId: { $exists: true } }).toArray()) {
    await listings.updateOne(
      { id: medicine.listingId },
      {
        $setOnInsert: {
          id: medicine.listingId,
          medicineId: medicine.id,
          ownerId: medicine.ownerId,
          pharmacyId: medicine.pharmacyId,
          price: medicine.price,
          stock: medicine.stock,
        },
      },
      { upsert: true },
    );
    await medicines.updateOne(
      { id: medicine.id },
      { $unset: { listingId: "", pharmacyId: "", price: "", stock: "" } },
    );
  }

  const stateData = Object.fromEntries(
    ["pharmacies", "history", "savedPharmacies", "reservations", "reports", "audit", "ratings"]
      .map((key) => [
        key,
        key === "pharmacies"
          ? (legacyData.pharmacies || []).filter((pharmacy) => !demoPharmacyIds.has(pharmacy.id))
          : legacyData[key] || [],
      ]),
  );
  await state.updateOne(
    { _id: "primary" },
    { $setOnInsert: { _id: "primary", data: stateData } },
    { upsert: true },
  );
  console.log(`Migrated legacy data to ${userDatabaseName}. Imported ${importedUsers} users and ${importedListings} listings; existing Mongo records were retained.`);
} finally {
  await client.close();
}
