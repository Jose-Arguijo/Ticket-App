const { spawn } = require("child_process");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const PORT = 4283;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_FILE = path.join(os.tmpdir(), `ticket-app-smoke-${Date.now()}.json`);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function startServer() {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PORT: String(PORT), DATA_FILE },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  return child;
}

async function waitForServer() {
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    try {
      await fetch(`${BASE}/api/me`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error("Server did not start in time.");
}

function makeClient() {
  let cookie = "";
  return {
    async request(pathname, options = {}) {
      const response = await fetch(`${BASE}${pathname}`, {
        ...options,
        headers: {
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          ...(options.headers || {})
        },
        body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body
      });

      const setCookie = response.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";")[0];

      const contentType = response.headers.get("content-type") || "";
      const payload = contentType.includes("application/json") ? await response.json() : await response.text();
      return { response, payload, contentType };
    },
    async json(pathname, options = {}) {
      const result = await this.request(pathname, options);
      if (!result.response.ok) {
        throw new Error(`${options.method || "GET"} ${pathname} failed: ${JSON.stringify(result.payload)}`);
      }
      return result.payload;
    }
  };
}

async function login(email, password) {
  const client = makeClient();
  const payload = await client.json("/api/login", { method: "POST", body: { email, password } });
  return { client, user: payload.user };
}

async function run() {
  const server = startServer();
  try {
    await waitForServer();

    const health = await fetch(`${BASE}/api/health`);
    assert(health.ok, "Health check should be available without a session.");

    const missingAsset = await fetch(`${BASE}/missing-app-bundle.js`);
    assert(missingAsset.status === 404, "Missing static assets should return 404 instead of the app shell.");

    const { client: admin } = await login("admin@tickets.local", "admin123");
    const adminFiles = await admin.request("/api/files");
    assert(adminFiles.response.status === 403, "Admin should not be able to read business paperwork files.");

    const business = await admin.json("/api/admin/businesses", {
      method: "POST",
      body: { name: "Scope Test Hauling" }
    });
    const duplicateBusiness = await admin.request("/api/admin/businesses", {
      method: "POST",
      body: { name: "  scope test hauling  " }
    });
    assert(duplicateBusiness.response.status === 409, "Business names should be unique case-insensitively.");

    const renamedBusiness = await admin.json(`/api/admin/businesses/${business.business.id}`, {
      method: "PUT",
      body: { name: "Scope Test Logistics" }
    });
    assert(renamedBusiness.business.name === "Scope Test Logistics", "Admin should be able to rename an existing business.");

    const duplicateRename = await admin.request(`/api/admin/businesses/${business.business.id}`, {
      method: "PUT",
      body: { name: "demo hauling co." }
    });
    assert(duplicateRename.response.status === 409, "Business rename should enforce unique names case-insensitively.");

    const invalidManagerEmail = await admin.request("/api/admin/managers", {
      method: "POST",
      body: {
        businessId: business.business.id,
        name: "Invalid Manager",
        email: "not-an-email",
        password: "scope123"
      }
    });
    assert(invalidManagerEmail.response.status === 400, "Manager creation should validate email format.");

    await admin.json("/api/admin/managers", {
      method: "POST",
      body: {
        businessId: business.business.id,
        name: "Scope Manager",
        email: "scope.manager@example.com",
        password: "scope123"
      }
    });

    const { client: demoManager } = await login("manager@demohauling.com", "manager123");
    const demoFiles = await demoManager.json("/api/files");
    assert(demoFiles.files.length === 1, "Demo manager should see only demo business files.");
    const demoFileId = demoFiles.files[0].id;
    const managerEditAttempt = await demoManager.request(`/api/files/${demoFileId}`, {
      method: "PATCH",
      body: { rows: [{ date: "2026-05-18", from: "Manager", to: "Edit", ticketNumber: "44", tons: "1.00" }] }
    });
    assert(managerEditAttempt.response.status === 403, "Manager should not be able to edit employee file contents.");
    const flaggedFile = await demoManager.json(`/api/files/${demoFileId}/flag`, {
      method: "POST",
      body: { reviewNote: "Please confirm the ticket number." }
    });
    assert(flaggedFile.file.status === "needs_review", "Manager should be able to flag a file for review.");
    const blankFlag = await demoManager.request(`/api/files/${demoFileId}/flag`, {
      method: "POST",
      body: { reviewNote: "   " }
    });
    assert(blankFlag.response.status === 400, "Manager review flags should require a note.");

    await demoManager.json("/api/manager/destinations", { method: "POST", body: { name: "South Yard" } });
    const destinations = await demoManager.json("/api/destinations");
    assert(destinations.destinations.some((destination) => destination.name === "South Yard"), "Manager destination should be available for autofill.");

    const managerPersonalAttempt = await demoManager.request("/api/me/profile", {
      method: "PUT",
      body: { phone: "555-0100" }
    });
    assert(managerPersonalAttempt.response.status === 403, "Manager should not update driver-owned personal profile fields.");

    const demoEmployees = await demoManager.json("/api/manager/employees");
    const demoEmployeeId = demoEmployees.employees[0].id;
    const managerDriverFieldAttempt = await demoManager.request(`/api/manager/employees/${demoEmployeeId}/profile`, {
      method: "PUT",
      body: { phone: "555-0100" }
    });
    assert(managerDriverFieldAttempt.response.status === 403, "Manager should not update employee-owned personal fields.");

    const managedProfile = await demoManager.json(`/api/manager/employees/${demoEmployeeId}/profile`, {
      method: "PUT",
      body: {
        employeeCode: "DRV-100",
        truckNumber: "TX-42",
        defaultDestinations: "North Pit, Plant 4",
        employmentStatus: "active",
        managementNotes: "Cleared for weekly hauling."
      }
    });
    assert(managedProfile.employee.truckNumber === "TX-42", "Manager should update manager-owned truck number.");
    assert(managedProfile.employee.defaultDestinations.length === 2, "Manager should save default destinations.");

    const { client: scopeManager } = await login("scope.manager@example.com", "scope123");
    const employee = await scopeManager.json("/api/manager/employees", {
      method: "POST",
      body: { name: "Scope Driver", email: "scope.driver@example.com", password: "driver123" }
    });
    const scopeFile = await scopeManager.json("/api/files", {
      method: "POST",
      body: {
        employeeId: employee.employee.id,
        weekStart: "2026-05-18",
        rows: [{ date: "2026-05-18", to: "Yard", from: "Quarry", ticketNumber: "100", tons: "25.20" }]
      }
    });

    const scopeList = await scopeManager.json("/api/files");
    assert(scopeList.files.length === 1 && scopeList.files[0].id === scopeFile.file.id, "Scope manager should see only scope business files.");

    const managerCrossRead = await scopeManager.request(`/api/files/${demoFileId}`);
    assert(managerCrossRead.response.status === 404, "Manager from another business should not open demo business files.");

    const demoManagerCrossRead = await demoManager.request(`/api/files/${scopeFile.file.id}`);
    assert(demoManagerCrossRead.response.status === 404, "Demo manager should not open scope business files.");

    const { client: demoDriver } = await login("driver@demohauling.com", "driver123");
    const driverProfile = await demoDriver.json("/api/me/profile", {
      method: "PUT",
      body: {
        displayName: "Demo Driver JD",
        phone: "555-0101",
        emergencyContact: "Dispatch 555-0102",
        preferredUnits: "tons",
        theme: "dark"
      }
    });
    assert(driverProfile.user.displayName === "Demo Driver JD", "Employee should update preferred display name.");
    assert(driverProfile.user.truckNumber === "TX-42", "Employee should see manager-owned truck number.");

    const driverEmploymentAttempt = await demoDriver.request("/api/me/profile", {
      method: "PUT",
      body: { truckNumber: "TX-99" }
    });
    assert(driverEmploymentAttempt.response.status === 403, "Employee should not update manager-owned employment fields.");

    const driverFiles = await demoDriver.json("/api/files");
    assert(driverFiles.files.length === 1 && driverFiles.files[0].id === demoFileId, "Employee should see only their own file history.");
    assert(driverFiles.files[0].status === "needs_review", "Employee should see manager review flags on their own files.");

    const employeeCrossRead = await demoDriver.request(`/api/files/${scopeFile.file.id}`);
    assert(employeeCrossRead.response.status === 404, "Employee should not open another employee file.");

    const invalidTicket = await demoDriver.request(`/api/files/${demoFileId}`, {
      method: "PATCH",
      body: { rows: [{ date: "2026-05-18", from: "A", to: "B", ticketNumber: "12.4", tons: "1.00" }] }
    });
    assert(invalidTicket.response.status === 400, "Ticket numbers should reject non-integers.");

    const invalidTons = await demoDriver.request(`/api/files/${demoFileId}`, {
      method: "PATCH",
      body: { rows: [{ date: "2026-05-18", from: "A", to: "B", ticketNumber: "124", tons: "1.234" }] }
    });
    assert(invalidTons.response.status === 400, "Tons should reject more than two decimal places.");

    const malformedJson = await demoDriver.request("/api/files", {
      method: "POST",
      body: "{not-json"
    });
    assert(malformedJson.response.status === 400, "Malformed JSON should return a controlled 400 response.");

    const draft = await demoDriver.json("/api/files", {
      method: "POST",
      body: { weekStart: "2026-05-25", rows: [{ date: "2026-05-25", from: "North Pit", to: "Plant 4", ticketNumber: "200", tons: "5.25" }] }
    });
    const deleteDraft = await demoDriver.request(`/api/files/${draft.file.id}`, { method: "DELETE" });
    assert(deleteDraft.response.ok, "Employee should be able to delete their own draft.");

    const submitted = await demoDriver.json("/api/files", {
      method: "POST",
      body: { weekStart: "2026-06-01", rows: [{ date: "2026-06-01", from: "North Pit", to: "Plant 4", ticketNumber: "300", tons: "6.00" }] }
    });
    await demoDriver.json(`/api/files/${submitted.file.id}/submit`, { method: "POST" });
    const deleteSubmitted = await demoDriver.request(`/api/files/${submitted.file.id}`, { method: "DELETE" });
    assert(deleteSubmitted.response.status === 409, "Submitted files should not be deletable.");
    const editSubmitted = await demoDriver.request(`/api/files/${submitted.file.id}`, {
      method: "PATCH",
      body: { rows: [{ date: "2026-06-01", from: "North Pit", to: "Plant 4", ticketNumber: "301", tons: "6.50" }] }
    });
    assert(editSubmitted.response.ok, "Submitted files should remain editable by the employee.");

    const incomplete = await demoDriver.json("/api/files", {
      method: "POST",
      body: { weekStart: "2026-06-08", rows: [{ date: "2026-06-08", from: "North Pit" }] }
    });
    const incompleteSubmit = await demoDriver.request(`/api/files/${incomplete.file.id}`, {
      method: "PATCH",
      body: { status: "submitted", rows: incomplete.file.rows }
    });
    assert(incompleteSubmit.response.status === 400, "Submitting should require complete ticket rows.");

    const exportResult = await demoDriver.request(`/api/files/${demoFileId}/export`);
    assert(exportResult.response.ok, "Employee should be able to export their own file.");
    assert(exportResult.contentType.includes("application/vnd.ms-excel"), "Export should be Excel-compatible.");
    assert(String(exportResult.payload).includes("Ticket Number"), "Export should include ticket number column.");

    console.log("Smoke tests passed: health, static 404s, role scoping, profile permissions, manager read-only files, review flags, draft deletion, submitted-file protection, validation, destinations, and Excel export.");
  } finally {
    server.kill();
    await fs.rm(DATA_FILE, { force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
