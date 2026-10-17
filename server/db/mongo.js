import { MongoClient } from "mongodb";

export const userDatabaseName = "Medlytics_Database";
export const userCollectionName = "user";
export const medicineCollectionName = "medicine";
export const listingCollectionName = "listing";
export const applicationStateCollectionName = "application_state";

const applicationStateId = "primary";
const applicationStateKeys = [
  "pharmacies",
  "history",
  "savedPharmacies",
  "reservations",
  "reports",
  "audit",
  "ratings",
];

const emptyApplicationData = () => Object.fromEntries(applicationStateKeys.map((key) => [key, []]));

export async function connectMongoRepositories(uri, { MongoClientClass = MongoClient } = {}) {
  if (!uri) throw new Error("MONGO_URI is required to start the API.");

  const client = new MongoClientClass(uri);
  try {
    await client.connect();

    const database = client.db(userDatabaseName);
    const users = database.collection(userCollectionName);
    const medicines = database.collection(medicineCollectionName);
    const listings = database.collection(listingCollectionName);
    const applicationState = database.collection(applicationStateCollectionName);
    await users.createIndex({ email: 1 }, { unique: true });
    await users.createIndex({ id: 1 }, { unique: true });
    await medicines.createIndex({ id: 1 }, { unique: true });
    await listings.createIndex({ id: 1 }, { unique: true });
    await listings.createIndex({ medicineId: 1 });

    return {
      users: {
        async findAll() {
          return users.find({}, { projection: { _id: 0 } }).toArray();
        },
        async findById(id) {
          return users.findOne({ id }, { projection: { _id: 0 } });
        },
        async findByEmail(email) {
          return users.findOne({ email }, { projection: { _id: 0 } });
        },
        async updateById(id, updates) {
          const result = await users.updateOne({ id }, { $set: updates });
          if (!result.matchedCount) return null;
          return users.findOne({ id }, { projection: { _id: 0 } });
        },
        async create(user) {
          await users.insertOne(user);
          return user;
        },
      },
      medicines: {
        async findAll() {
          const products = await medicines.find({}, { projection: { _id: 0 } }).toArray();
          const inventory = await listings.find({}, { projection: { _id: 0 } }).toArray();
          return products.flatMap((product) => inventory
            .filter((listing) => listing.medicineId === product.id)
            .map((listing) => ({ ...product, ...listing, id: product.id, listingId: listing.id })));
        },
        async findById(id) {
          const product = await medicines.findOne({ id }, { projection: { _id: 0 } });
          if (!product) return null;
          const productListings = await listings.find({ medicineId: id }, { projection: { _id: 0 } }).toArray();
          return { ...product, listings: productListings };
        },
        async findAllProducts() {
          return medicines.find({}, { projection: { _id: 0 } }).toArray();
        },
        async findAllListings() {
          return listings.find({}, { projection: { _id: 0 } }).toArray();
        },
        async create(medicine) {
          const { listingId, price, stock, pharmacyId, ...product } = medicine;
          await medicines.insertOne(product);
          try {
            await listings.insertOne({
              id: listingId,
              medicineId: product.id,
              ownerId: product.ownerId,
              pharmacyId,
              price,
              stock,
            });
          } catch (error) {
            await medicines.deleteOne({ id: product.id });
            throw error;
          }
          return medicine;
        },
        async updateOwned(id, ownerId, updates, listingId) {
          const productUpdates = Object.fromEntries(Object.entries(updates).filter(([key]) => ["name", "genericName", "category", "info"].includes(key)));
          const listingUpdates = Object.fromEntries(Object.entries(updates).filter(([key]) => ["price", "stock"].includes(key)));
          const ownedListing = await listings.findOne({ id: listingId, medicineId: id, ownerId });
          if (!ownedListing) return null;
          if (Object.keys(productUpdates).length) await medicines.updateOne({ id }, { $set: productUpdates });
          if (Object.keys(listingUpdates).length) {
            await listings.updateOne({ id: ownedListing.id }, { $set: listingUpdates });
          }
          return this.findById(id);
        },
        async deleteOwned(id, ownerId, listingId) {
          const product = await medicines.findOne({ id }, { projection: { _id: 0 } });
          if (!product) return false;
          if (product.ownerId === ownerId) {
            await medicines.deleteOne({ id, ownerId });
            await listings.deleteMany({ medicineId: id, ownerId });
            return true;
          }
          const result = await listings.deleteOne({ id: listingId, medicineId: id, ownerId });
          return result.deletedCount === 1;
        },
      },
      applicationData: {
        async load() {
          const saved = await applicationState.findOne({ _id: applicationStateId }, { projection: { _id: 0 } });
          return { ...emptyApplicationData(), ...(saved?.data || {}) };
        },
        async save(data) {
          const persistedData = Object.fromEntries(applicationStateKeys.map((key) => [key, data[key] || []]));
          await applicationState.replaceOne(
            { _id: applicationStateId },
            { _id: applicationStateId, data: persistedData },
            { upsert: true },
          );
        },
      },
      close() {
        return client.close();
      },
    };
  } catch (error) {
    await client.close();
    throw error;
  }
}
