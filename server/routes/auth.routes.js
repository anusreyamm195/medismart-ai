function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

export async function registerUser(body, {
  userRepository,
  hashPassword,
  signToken,
  id,
  text,
  validEmail,
  validPassword,
  coordinate,
}) {
  const name = text(body.name, "Name", 80);
  const email = validEmail(body.email);
  const password = validPassword(body.password);
  const role = body.role || "patient";

  if (!["patient", "owner"].includes(role)) fail(400, "Choose patient or medical store owner.");
  if (await userRepository.findByEmail(email)) fail(409, "An account with that email already exists.");

  let pharmacy;
  if (role === "owner") {
    const latitude = coordinate(body.latitude, "Latitude", -90, 90);
    const longitude = coordinate(body.longitude, "Longitude", -180, 180);
    if ((latitude === null) !== (longitude === null)) fail(400, "Both latitude and longitude are required for a store location.");
    pharmacy = {
      id: id("pharmacy"),
      ownerId: null,
      name: text(body.pharmacyName, "Pharmacy name", 100),
      location: text(body.location, "Location", 160),
      address: text(body.address || body.location, "Address", 200),
      phone: text(body.phone || "Not provided", "Phone", 32),
      latitude,
      longitude,
      status: "pending",
      rating: 0,
      createdAt: new Date().toISOString(),
    };
  }

  const user = { id: id("user"), name, email, passwordHash: hashPassword(password), role, active: true };
  try {
    await userRepository.create(user);
  } catch (error) {
    if (error.code === 11000) fail(409, "An account with that email already exists.");
    throw error;
  }

  if (pharmacy) pharmacy.ownerId = user.id;
  return {
    user,
    token: signToken(user),
    pharmacy,
    message: pharmacy
      ? "Your account is ready. Your pharmacy registration is awaiting admin approval."
      : "Your account is ready.",
  };
}

export async function loginUser(body, { userRepository, verifyPassword, signToken, validEmail }) {
  const email = validEmail(body.email);
  const account = await userRepository.findByEmail(email);
  if (!account || !verifyPassword(String(body.password || ""), account.passwordHash)) fail(401, "Email or password is incorrect.");
  if (!account.active) fail(403, "This account has been suspended. Contact the platform administrator.");
  return { token: signToken(account), user: account };
}

export async function handleAuthRoute(context) {
  const {
    method,
    pathname,
    body,
    users,
    hashPassword,
    signToken,
    verifyPassword,
    id,
    text,
    validEmail,
    validPassword,
    coordinate,
    requireUser,
    publicUser,
    send,
    fail: routeFail,
    data,
    audit,
    saveApplicationData,
  } = context;

  if (method === "POST" && pathname === "/api/auth/register") {
    const registration = await registerUser(body, {
      userRepository: users,
      hashPassword,
      signToken,
      id,
      text,
      validEmail,
      validPassword,
      coordinate,
    });
    if (registration.pharmacy) data.pharmacies.push(registration.pharmacy);
    audit(registration.user.email, "account.registered", registration.user.role);
    await saveApplicationData();
    send(201, {
      token: registration.token,
      user: publicUser(registration.user),
      message: registration.message,
    });
    return true;
  }

  if (method === "POST" && pathname === "/api/auth/login") {
    const result = await loginUser(body, { userRepository: users, verifyPassword, signToken, validEmail });
    send(200, { token: result.token, user: publicUser(result.user) });
    return true;
  }

  if (method === "GET" && pathname === "/api/auth/me") {
    send(200, { user: publicUser(requireUser()) });
    return true;
  }

  if (method === "GET" && pathname === "/api/profile") {
    send(200, { user: publicUser(requireUser()) });
    return true;
  }

  if (method === "PATCH" && pathname === "/api/profile") {
    let current = requireUser();
    if (body.name !== undefined) {
      const name = text(body.name, "Name", 80);
      current = await users.updateById(current.id, { name });
      if (!current) routeFail(404, "User account not found.");
    }
    send(200, { user: publicUser(current) });
    return true;
  }

  return false;
}
