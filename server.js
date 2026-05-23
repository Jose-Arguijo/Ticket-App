const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 4173);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DB_FILE = process.env.DATA_FILE ? path.resolve(process.env.DATA_FILE) : path.join(DATA_DIR, "db.json");
const DB_DIR = path.dirname(DB_FILE);
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;
const USE_MONGODB = Boolean(process.env.MONGODB_URI);
let mongoEnabled = USE_MONGODB;
const MONGODB_DB = process.env.MONGODB_DB || "ticket_app";
const MONGODB_COLLECTION = process.env.MONGODB_COLLECTION || "app_state";
const MONGODB_STATE_ID = "primary";

let mongoClientPromise = null;

function disableMongo(reason, error) {
  mongoEnabled = false;
  mongoClientPromise = null;
  console.warn("MongoDB disabled:", reason);
  if (error) console.warn(error);
}

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function nowIso() {
  return new Date().toISOString();
}

function todayLocal() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return { salt, hash };
}

function verifyPassword(password, stored) {
  if (!stored || !stored.salt || !stored.hash) return false;
  const attempt = hashPassword(password, stored.salt).hash;
  const left = Buffer.from(attempt, "hex");
  const right = Buffer.from(stored.hash, "hex");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function makeUser({ name, email, password, role, businessId = null }) {
  return {
    id: makeId("usr"),
    name,
    email: normalizeEmail(email),
    role,
    businessId,
    password: hashPassword(password),
    createdAt: nowIso()
  };
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    businessId: user.businessId || null
  };
}

function publicBusiness(business) {
  return {
    id: business.id,
    name: business.name,
    createdAt: business.createdAt
  };
}

function fileSummary(file, usersById, businessesById) {
  const employee = usersById.get(file.employeeId);
  const business = businessesById.get(file.businessId);
  return {
    id: file.id,
    businessId: file.businessId,
    businessName: business ? business.name : "Unknown business",
    employeeId: file.employeeId,
    employeeName: employee ? employee.name : "Unknown employee",
    weekStart: file.weekStart,
    status: file.status,
    rowCount: Array.isArray(file.rows) ? file.rows.length : 0,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    submittedAt: file.submittedAt || null,
    reviewNote: file.reviewNote || "",
    flaggedAt: file.flaggedAt || null,
    flaggedBy: file.flaggedBy || null
  };
}

function canAccessFile(user, file) {
  if (!user || !file) return false;
  if (user.role === "manager") return user.businessId === file.businessId;
  if (user.role === "employee") return user.id === file.employeeId && user.businessId === file.businessId;
  return false;
}

function createSeedDb() {
  const businessId = "biz_demo";
  const admin = makeUser({
    name: "Platform Admin",
    email: "admin@tickets.local",
    password: "admin123",
    role: "admin"
  });
  const manager = makeUser({
    name: "Demo Manager",
    email: "manager@demohauling.com",
    password: "manager123",
    role: "manager",
    businessId
  });
  const driver = makeUser({
    name: "Demo Driver",
    email: "driver@demohauling.com",
    password: "driver123",
    role: "employee",
    businessId
  });
  const sampleFile = {
    id: makeId("file"),
    businessId,
    employeeId: driver.id,
    weekStart: todayLocal(),
    status: "draft",
    rows: [{ date: todayLocal(), to: "Plant 4", from: "North Pit", ticketNumber: "1001", tons: "23.50" }],
    createdAt: nowIso(),
    updatedAt: nowIso(),
    submittedAt: null
  };

  return {
    businesses: [{ id: businessId, name: "Demo Hauling Co.", createdAt: nowIso() }],
    users: [admin, manager, driver],
    files: [sampleFile],
    sessions: [],
    destinations: [
      { id: makeId("dest"), businessId, name: "North Pit", createdAt: nowIso(), createdBy: manager.id },
      { id: makeId("dest"), businessId, name: "Plant 4", createdAt: nowIso(), createdBy: manager.id }
    ]
  };
}

function normalizeDb(db = {}) {
  return {
    businesses: Array.isArray(db.businesses) ? db.businesses : [],
    users: Array.isArray(db.users) ? db.users : [],
    files: Array.isArray(db.files) ? db.files : [],
    sessions: Array.isArray(db.sessions) ? db.sessions : [],
    destinations: Array.isArray(db.destinations) ? db.destinations : []
  };
}

async function getMongoCollection() {
  if (!mongoEnabled) {
    return null;
  }

  if (!mongoClientPromise) {
    try {
      const { MongoClient } = require("mongodb");
      const client = new MongoClient(process.env.MONGODB_URI);
      mongoClientPromise = client.connect();
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        disableMongo("initial MongoDB client creation failed", error);
        return null;
      }
      throw new HttpError(500, "MongoDB connection failed during initialization.");
    }
  }

  try {
    const client = await mongoClientPromise;
    return client.db(MONGODB_DB).collection(MONGODB_COLLECTION);
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      disableMongo("MongoDB connection failed", error);
      return null;
    }
    throw new HttpError(500, "MongoDB connection failed. Check MONGODB_URI and network access.");
  }
}

async function ensureJsonDb() {
  await fs.mkdir(DB_DIR, { recursive: true });
  try {
    await fs.access(DB_FILE);
  } catch {
    await writeDb(createSeedDb());
  }
}

async function readDb() {
  if (mongoEnabled) {
    const collection = await getMongoCollection();
    if (collection) {
      let doc = await collection.findOne({ _id: MONGODB_STATE_ID });
      if (!doc) {
        await collection.insertOne({ _id: MONGODB_STATE_ID, ...createSeedDb() });
        doc = await collection.findOne({ _id: MONGODB_STATE_ID });
      }
      return normalizeDb(doc);
    }
  }

  await ensureJsonDb();
  const raw = await fs.readFile(DB_FILE, "utf8");
  return normalizeDb(JSON.parse(raw));
}

async function writeDb(db) {
  const normalized = normalizeDb(db);
  if (mongoEnabled) {
    const collection = await getMongoCollection();
    if (collection) {
      await collection.updateOne({ _id: MONGODB_STATE_ID }, { $set: normalized }, { upsert: true });
      return;
    }
  }

  await fs.mkdir(DB_DIR, { recursive: true });
  const tmpFile = `${DB_FILE}.tmp`;
  await fs.writeFile(tmpFile, `${JSON.stringify(normalized, null, 2)}\n`);
  await fs.rename(tmpFile, DB_FILE);
}

function allowedOrigin(origin) {
  if (!origin) return "";
  const configured = String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (configured.includes(origin)) return origin;
  if (process.env.NODE_ENV !== "production" && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return "";
}

function applyCors(req, res) {
  const origin = allowedOrigin(req.headers.origin);
  if (!origin) return;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader("Vary", "Origin");
}

function sessionCookie(value, maxAge) {
  const sameSite = process.env.COOKIE_SAMESITE || "Lax";
  const secure = process.env.COOKIE_SECURE === "true" || sameSite.toLowerCase() === "none";
  return [
    `session=${encodeURIComponent(value)}`,
    "HttpOnly",
    `SameSite=${sameSite}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    secure ? "Secure" : ""
  ]
    .filter(Boolean)
    .join("; ");
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        if (index === -1) return [part, ""];
        return [decodeURIComponent(part.slice(0, index)), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "Invalid JSON body.");
  }
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, error) {
  const status = error instanceof HttpError ? error.status : 500;
  const message = error instanceof HttpError ? error.message : status === 500 ? "Something went wrong." : error.message;
  if (status === 500) console.error(error);
  sendJson(res, status, { error: message });
}

async function getCurrentUser(req, db) {
  const token = parseCookies(req).session;
  if (!token) return null;
  const cutoff = Date.now() - SESSION_MAX_AGE_SECONDS * 1000;
  const session = db.sessions.find((entry) => entry.token === token && new Date(entry.createdAt).getTime() > cutoff);
  if (!session) return null;
  return db.users.find((user) => user.id === session.userId) || null;
}

async function requireUser(req, db) {
  const user = await getCurrentUser(req, db);
  if (!user) throw new HttpError(401, "Please log in.");
  return user;
}

function requireRole(user, roles) {
  if (!roles.includes(user.role)) throw new HttpError(403, "This account cannot perform that action.");
}

function requireFields(body, fields) {
  for (const field of fields) {
    if (body[field] === undefined || body[field] === null || String(body[field]).trim() === "") {
      throw new HttpError(400, `${field} is required.`);
    }
  }
}

function normalizeDestinationName(name) {
  return String(name || "").trim().replace(/\s+/g, " ").slice(0, 120);
}

function cleanRows(rows) {
  if (!Array.isArray(rows)) return [];
  const mapped = rows
    .slice(0, 250)
    .map((row, index) => {
      const ticketNumber = String(row.ticketNumber || "").trim();
      const tons = String(row.tons || "").trim();

      if (ticketNumber && !/^\d+$/.test(ticketNumber)) {
        throw new HttpError(400, `Ticket number in row ${index + 1} must be an integer.`);
      }

      if (tons && !/^\d+(\.\d{1,2})?$/.test(tons)) {
        throw new HttpError(400, `Tons in row ${index + 1} must be a decimal with no more than two places.`);
      }

      return {
        date: String(row.date || "").slice(0, 20),
        from: String(row.from || "").trim().slice(0, 120),
        to: String(row.to || "").trim().slice(0, 120),
        ticketNumber,
        tons: tons ? Number(tons).toFixed(2) : ""
      };
    });

  // Only filter completely empty rows, but keep structure intact
  const filtered = mapped.filter((row) => row.date || row.to || row.from || row.ticketNumber || row.tons);
  
  // Always return the filtered rows (which may be empty)
  return filtered;
}

function usersById(db) {
  return new Map(db.users.map((user) => [user.id, user]));
}

function businessesById(db) {
  return new Map(db.businesses.map((business) => [business.id, business]));
}

function findVisibleFiles(db, user, employeeId) {
  if (user.role === "employee") {
    return db.files.filter((file) => file.employeeId === user.id && file.businessId === user.businessId);
  }

  if (user.role === "manager") {
    return db.files.filter((file) => {
      if (file.businessId !== user.businessId) return false;
      return employeeId ? file.employeeId === employeeId : true;
    });
  }

  return [];
}

function createExcelHtml({ file, employee, business }) {
  const rows = cleanRows(file.rows);

  const escape = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");

  const bodyRows = rows
    .map(
      (row) => `<tr>
        <td>${escape(row.date)}</td>

        <td>${escape(row.to)}</td>

        <td>${escape(row.from)}</td>

        <!-- Force Excel to keep ticket numbers as whole numbers/text -->
        <td style="mso-number-format:'\\@';">
          ${escape(row.ticketNumber)}
        </td>

        <!-- Force tons to always show 2 decimals -->
        <td style="mso-number-format:'0.00';">
          ${escape(row.tons)}
        </td>
      </tr>`
    )
    .join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    table {
      border-collapse: collapse;
      font-family: Arial, sans-serif;
      width: 100%;
    }

    th, td {
      border: 1px solid #888;
      padding: 6px 10px;
      text-align: left;
      white-space: nowrap;
    }

    th {
      background: #eef2f7;
      font-weight: bold;
    }

    h2 {
      font-family: Arial, sans-serif;
      margin-bottom: 12px;
    }
  </style>
</head>
<body>
  <h2>
    ${escape(business.name)} -
    ${escape(employee.name)} -
    Week of ${escape(file.weekStart)}
  </h2>

  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>To</th>
        <th>From</th>
        <th>Ticket Number</th>
        <th>Tons</th>
      </tr>
    </thead>

    <tbody>
      ${
        bodyRows ||
        '<tr><td colspan="5">No rows</td></tr>'
      }
    </tbody>
  </table>
</body>
</html>`;
}

async function handleApi(req, res, pathname, query) {
  const db = await readDb();
  const method = req.method || "GET";

  if (method === "POST" && pathname === "/api/login") {
    const body = await readJson(req);
    requireFields(body, ["email", "password"]);
    const email = normalizeEmail(body.email);
    const user = db.users.find((entry) => entry.email === email);
    if (!user || !verifyPassword(String(body.password), user.password)) {
      throw new HttpError(401, "Email or password is incorrect.");
    }
    const token = crypto.randomBytes(32).toString("hex");
    db.sessions = db.sessions.filter((entry) => entry.userId !== user.id);
    db.sessions.push({ token, userId: user.id, createdAt: nowIso() });
    await writeDb(db);
    sendJson(
      res,
      200,
      { user: sanitizeUser(user) },
      {
        "Set-Cookie": sessionCookie(token, SESSION_MAX_AGE_SECONDS)
      }
    );
    return;
  }

  if (method === "POST" && pathname === "/api/logout") {
    const token = parseCookies(req).session;
    if (token) {
      db.sessions = db.sessions.filter((entry) => entry.token !== token);
      await writeDb(db);
    }
    sendJson(res, 200, { ok: true }, { "Set-Cookie": sessionCookie("", 0) });
    return;
  }

  const user = await requireUser(req, db);

  if (method === "GET" && pathname === "/api/me") {
    const business = user.businessId ? db.businesses.find((entry) => entry.id === user.businessId) : null;
    sendJson(res, 200, { user: sanitizeUser(user), business: business ? publicBusiness(business) : null });
    return;
  }

  if (method === "GET" && pathname === "/api/admin/businesses") {
    requireRole(user, ["admin"]);
    const result = db.businesses.map((business) => {
      const businessUsers = db.users.filter((entry) => entry.businessId === business.id);
      return {
        ...publicBusiness(business),
        managers: businessUsers.filter((entry) => entry.role === "manager").map(sanitizeUser),
        employeeCount: businessUsers.filter((entry) => entry.role === "employee").length,
        fileCount: db.files.filter((file) => file.businessId === business.id).length
      };
    });
    sendJson(res, 200, { businesses: result });
    return;
  }

  if (method === "POST" && pathname === "/api/admin/businesses") {
    requireRole(user, ["admin"]);
    const body = await readJson(req);
    requireFields(body, ["name"]);
    const business = { id: makeId("biz"), name: String(body.name).trim().slice(0, 100), createdAt: nowIso() };
    db.businesses.push(business);
    await writeDb(db);
    sendJson(res, 201, { business: publicBusiness(business) });
    return;
  }

  if (method === "POST" && pathname === "/api/admin/managers") {
    requireRole(user, ["admin"]);
    const body = await readJson(req);
    requireFields(body, ["businessId", "name", "email", "password"]);
    const business = db.businesses.find((entry) => entry.id === String(body.businessId));
    if (!business) throw new HttpError(404, "Business not found.");
    const email = normalizeEmail(body.email);
    if (db.users.some((entry) => entry.email === email)) throw new HttpError(409, "That email is already in use.");
    const manager = makeUser({
      name: String(body.name).trim().slice(0, 100),
      email,
      password: String(body.password),
      role: "manager",
      businessId: business.id
    });
    db.users.push(manager);
    await writeDb(db);
    sendJson(res, 201, { manager: sanitizeUser(manager) });
    return;
  }

  if (method === "GET" && pathname === "/api/manager/employees") {
    requireRole(user, ["manager"]);
    const employees = db.users
      .filter((entry) => entry.role === "employee" && entry.businessId === user.businessId)
      .map(sanitizeUser);
    sendJson(res, 200, { employees });
    return;
  }

  if (method === "POST" && pathname === "/api/manager/employees") {
    requireRole(user, ["manager"]);
    const body = await readJson(req);
    requireFields(body, ["name", "email", "password"]);
    const email = normalizeEmail(body.email);
    if (db.users.some((entry) => entry.email === email)) throw new HttpError(409, "That email is already in use.");
    const employee = makeUser({
      name: String(body.name).trim().slice(0, 100),
      email,
      password: String(body.password),
      role: "employee",
      businessId: user.businessId
    });
    db.users.push(employee);
    await writeDb(db);
    sendJson(res, 201, { employee: sanitizeUser(employee) });
    return;
  }

  if (method === "GET" && pathname === "/api/destinations") {
    requireRole(user, ["manager", "employee"]);
    const destinations = db.destinations
      .filter((entry) => entry.businessId === user.businessId)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => ({ id: entry.id, name: entry.name, createdAt: entry.createdAt }));
    sendJson(res, 200, { destinations });
    return;
  }

  if (method === "POST" && pathname === "/api/manager/destinations") {
    requireRole(user, ["manager"]);
    const body = await readJson(req);
    requireFields(body, ["name"]);
    const name = normalizeDestinationName(body.name);
    if (!name) throw new HttpError(400, "Destination name is required.");
    const duplicate = db.destinations.find(
      (entry) => entry.businessId === user.businessId && entry.name.toLowerCase() === name.toLowerCase()
    );
    if (duplicate) throw new HttpError(409, "That destination already exists.");
    const destination = { id: makeId("dest"), businessId: user.businessId, name, createdAt: nowIso(), createdBy: user.id };
    db.destinations.push(destination);
    await writeDb(db);
    sendJson(res, 201, { destination: { id: destination.id, name: destination.name, createdAt: destination.createdAt } });
    return;
  }

  const destinationMatch = pathname.match(/^\/api\/manager\/destinations\/([^/]+)$/);
  if (destinationMatch && method === "DELETE") {
    requireRole(user, ["manager"]);
    const destinationId = destinationMatch[1];
    const destination = db.destinations.find((entry) => entry.id === destinationId && entry.businessId === user.businessId);
    if (!destination) throw new HttpError(404, "Destination not found.");
    db.destinations = db.destinations.filter((entry) => entry.id !== destination.id);
    await writeDb(db);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (method === "GET" && pathname === "/api/files") {
    requireRole(user, ["manager", "employee"]);
    const employeeId = query.get("employeeId") || "";
    if (user.role === "manager" && employeeId) {
      const employee = db.users.find((entry) => entry.id === employeeId && entry.businessId === user.businessId && entry.role === "employee");
      if (!employee) throw new HttpError(404, "Employee not found in this business.");
    }
    const userMap = usersById(db);
    const businessMap = businessesById(db);
    const files = findVisibleFiles(db, user, employeeId)
      .map((file) => fileSummary(file, userMap, businessMap))
      .sort((a, b) => String(b.weekStart).localeCompare(String(a.weekStart)) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
    sendJson(res, 200, { files });
    return;
  }

  if (method === "POST" && pathname === "/api/files") {
    requireRole(user, ["manager", "employee"]);
    const body = await readJson(req);
    const requestedEmployeeId = body.employeeId || user.id;
    let employee;

    if (user.role === "employee") {
      if (requestedEmployeeId !== user.id) throw new HttpError(403, "Employees can only create their own files.");
      employee = user;
    } else {
      employee = db.users.find((entry) => entry.id === requestedEmployeeId && entry.businessId === user.businessId && entry.role === "employee");
      if (!employee) throw new HttpError(404, "Employee not found in this business.");
    }

    const weekStart = String(body.weekStart || todayLocal()).slice(0, 10);
    const file = {
      id: makeId("file"),
      businessId: employee.businessId,
      employeeId: employee.id,
      weekStart,
      status: "draft",
      rows: cleanRows(body.rows || []),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      submittedAt: null
    };
    db.files.push(file);
    await writeDb(db);
    sendJson(res, 201, { file });
    return;
  }

  const fileMatch = pathname.match(/^\/api\/files\/([^/]+)(?:\/(export|submit|flag))?$/);
  if (fileMatch) {
    requireRole(user, ["manager", "employee"]);
    const fileId = fileMatch[1];
    const action = fileMatch[2] || "";
    const file = db.files.find((entry) => entry.id === fileId);
    if (!file || !canAccessFile(user, file)) throw new HttpError(404, "File not found.");

    if (method === "GET" && !action) {
      sendJson(res, 200, { file });
      return;
    }

    if (method === "PATCH" && !action) {
      requireRole(user, ["employee"]);
      if (file.employeeId !== user.id || file.businessId !== user.businessId) throw new HttpError(404, "File not found.");
      const body = await readJson(req);
      if (body.weekStart !== undefined) file.weekStart = String(body.weekStart).slice(0, 10);
      if (body.rows !== undefined) file.rows = cleanRows(body.rows);
      if (body.status === "submitted") {
        file.status = body.status;
        file.submittedAt ||= nowIso();
        file.reviewNote = "";
        file.flaggedAt = null;
        file.flaggedBy = null;
      }
      file.updatedAt = nowIso();
      await writeDb(db);
      sendJson(res, 200, { file });
      return;
    }

    if (method === "POST" && action === "submit") {
      requireRole(user, ["employee"]);
      if (file.employeeId !== user.id || file.businessId !== user.businessId) throw new HttpError(404, "File not found.");
      file.status = "submitted";
      file.updatedAt = nowIso();
      file.submittedAt ||= nowIso();
      file.reviewNote = "";
      file.flaggedAt = null;
      file.flaggedBy = null;
      await writeDb(db);
      sendJson(res, 200, { file });
      return;
    }

    if (method === "POST" && action === "flag") {
      requireRole(user, ["manager"]);
      const body = await readJson(req);
      file.status = "needs_review";
      file.reviewNote = String(body.reviewNote || "").trim().slice(0, 800);
      file.flaggedAt = nowIso();
      file.flaggedBy = user.id;
      file.updatedAt = nowIso();
      await writeDb(db);
      sendJson(res, 200, { file });
      return;
    }

    if (method === "DELETE" && !action) {
      requireRole(user, ["employee"]);
      if (file.employeeId !== user.id || file.businessId !== user.businessId) throw new HttpError(404, "File not found.");
      if (file.status !== "draft" || file.submittedAt) {
        throw new HttpError(409, "Submitted files cannot be deleted. They can only be edited.");
      }
      db.files = db.files.filter((entry) => entry.id !== file.id);
      await writeDb(db);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === "GET" && action === "export") {
      const employee = db.users.find((entry) => entry.id === file.employeeId);
      const business = db.businesses.find((entry) => entry.id === file.businessId);
      if (!employee || !business) throw new HttpError(404, "File owner not found.");
      const filename = `${employee.name.replace(/[^a-z0-9]+/gi, "_")}_${file.weekStart}.xls`;
      res.writeHead(200, {
        "Content-Type": "application/vnd.ms-excel; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`
      });
      res.end(createExcelHtml({ file, employee, business }));
      return;
    }
  }

  throw new HttpError(404, "Route not found.");
}

async function serveStatic(req, res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": contentTypes[ext] || "application/octet-stream" });
    res.end(data);
  } catch {
    const index = await fs.readFile(path.join(PUBLIC_DIR, "index.html"));
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(index);
  }
}

async function handleRequest(req, res) {
  applyCors(req, res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url.pathname, url.searchParams);
      return;
    }
    await serveStatic(req, res, url.pathname);
  } catch (error) {
    sendError(res, error);
  }
}

if (require.main === module) {
  const server = http.createServer(handleRequest);

  server.listen(PORT, () => {
    console.log(`Ticket paperwork app running at http://localhost:${PORT}`);
  });
}

module.exports = handleRequest;
module.exports.handleRequest = handleRequest;
module.exports.default = handleRequest;
