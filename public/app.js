const app = document.getElementById("app");
const API_BASE = (window.APP_CONFIG && window.APP_CONFIG.API_BASE ? window.APP_CONFIG.API_BASE : "").replace(/\/$/, "");

const state = {
  user: null,
  business: null,
  businesses: [],
  employees: [],
  files: [],
  destinations: [],
  selectedFile: null,
  view: null,
  notice: null,
  noticeType: "success"
};

const viewsByRole = {
  admin: [
    { id: "businesses", label: "Businesses" },
    { id: "setup", label: "Setup" }
  ],
  manager: [
    { id: "files", label: "Files" },
    { id: "employees", label: "Employees" },
    { id: "company", label: "Company" }
  ],
  employee: [
    { id: "files", label: "Files" },
    { id: "company", label: "Company" }
  ]
};

const statusLabels = {
  draft: "Draft",
  submitted: "Submitted",
  needs_review: "Needs review"
};

function today() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatShortDate(value) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function defaultViewForRole(role) {
  return viewsByRole[role]?.[0]?.id || "files";
}

function ensureView() {
  const views = viewsByRole[state.user?.role] || [];
  if (!state.view || !views.some((view) => view.id === state.view)) {
    state.view = defaultViewForRole(state.user?.role);
  }
}

function rowTemplate() {
  return { date: today(), from: "", to: "", ticketNumber: "", tons: "" };
}

function statusLabel(status) {
  return statusLabels[status] || status || "Draft";
}

function statusClass(status) {
  return String(status || "draft").replaceAll("_", "-");
}

function canDeleteFile(file) {
  return state.user?.role === "employee" && file?.employeeId === state.user.id && file.status === "draft" && !file.submittedAt;
}

function canEditSelectedFile() {
  return state.user?.role === "employee" && state.selectedFile?.employeeId === state.user.id;
}

async function api(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const headers = options.body ? { "Content-Type": "application/json", ...(options.headers || {}) } : options.headers || {};
  const response = await fetch(url, {
    ...options,
    headers,
    credentials: API_BASE ? "include" : "same-origin",
    body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body
  });
  const isJson = response.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await response.json() : null;
  if (!response.ok) {
    const error = new Error(payload?.error || "Request failed.");
    error.status = response.status;
    throw error;
  }
  return payload;
}

function showNotice(message, type = "success") {
  state.notice = message;
  state.noticeType = type;
  render();
  window.clearTimeout(showNotice.timer);
  showNotice.timer = window.setTimeout(() => {
    state.notice = null;
    render();
  }, 3200);
}

async function init() {
  try {
    const session = await api("/api/me");
    state.user = session.user;
    state.business = session.business;
    state.view = defaultViewForRole(state.user.role);
    await refreshRoleData();
  } catch (error) {
    if (error.status !== 401) {
      state.notice = error.message;
      state.noticeType = "error";
    }
  }
  render();
}

async function refreshRoleData() {
  if (!state.user) return;

  if (state.user.role === "admin") {
    const data = await api("/api/admin/businesses");
    state.businesses = data.businesses;
  }

  if (state.user.role === "manager") {
    const [employees, files, destinations] = await Promise.all([api("/api/manager/employees"), api("/api/files"), api("/api/destinations")]);
    state.employees = employees.employees;
    state.files = files.files;
    state.destinations = destinations.destinations;
  }

  if (state.user.role === "employee") {
    const [files, destinations] = await Promise.all([api("/api/files"), api("/api/destinations")]);
    state.files = files.files;
    state.destinations = destinations.destinations;
  }
}

function render() {
  if (!state.user) {
    renderLogin();
    return;
  }

  ensureView();
  app.innerHTML = `
    <div class="app-shell">
      ${renderTopbar()}
      <main class="workspace">${renderCurrentView()}</main>
      ${renderNotice()}
    </div>
  `;

  bindCommonEvents();
  if (state.user.role === "admin") bindAdminEvents();
  if (state.user.role === "manager") bindManagerEvents();
  if (state.user.role === "employee") bindEmployeeEvents();
  bindFileEvents();
}

function renderNotice() {
  if (!state.notice) return "";
  return `<div class="notice ${state.noticeType === "error" ? "error" : ""}">${escapeHtml(state.notice)}</div>`;
}

function renderTopbar() {
  const businessName = state.business?.name || "Platform";
  return `
    <header class="topbar">
      <div class="brand-lockup">
        <img src="/truck-mark.svg" alt="">
        <div>
          <h1>Dispatch Papers</h1>
          <p>${escapeHtml(businessName)} · ${escapeHtml(state.user.name)}</p>
        </div>
      </div>
      <div class="top-actions">
        ${renderNavTabs()}
        <span class="role-pill">${escapeHtml(state.user.role)}</span>
        <button class="button ghost small" data-action="logout">Log out</button>
      </div>
    </header>
  `;
}

function renderNavTabs() {
  const views = viewsByRole[state.user.role] || [];
  return `
    <nav class="nav-tabs" aria-label="Primary">
      ${views
        .map(
          (view) => `
            <button class="nav-tab ${state.view === view.id ? "active" : ""}" data-action="nav" data-view="${escapeHtml(view.id)}">
              ${escapeHtml(view.label)}
            </button>
          `
        )
        .join("")}
    </nav>
  `;
}

function renderLogin() {
  app.innerHTML = `
    <main class="login-screen">
      <section class="login-shell">
        <div class="login-visual">
          <div class="brand-lockup">
            <img src="/truck-mark.svg" alt="">
            <div>
              <h1 class="brand-title">Dispatch Papers</h1>
              <p class="brand-subtitle">Ticket sheets built for truck paperwork.</p>
            </div>
          </div>
          <div class="login-stats" aria-hidden="true">
            <div class="login-stat"><strong>3</strong><span>Account types</span></div>
            <div class="login-stat"><strong>5</strong><span>Sheet columns</span></div>
            <div class="login-stat"><strong>XLS</strong><span>Exports</span></div>
          </div>
        </div>
        <div class="login-panel">
          <form class="form" id="login-form">
            <h2>Log in</h2>
            <label class="field">
              <span>Email</span>
              <input class="input" name="email" type="email" autocomplete="username" required>
            </label>
            <label class="field">
              <span>Password</span>
              <input class="input" name="password" type="password" autocomplete="current-password" required>
            </label>
            <button class="button" type="submit">Log in</button>
          </form>
        </div>
      </section>
      ${renderNotice()}
    </main>
  `;

  document.getElementById("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    try {
      const data = await api("/api/login", {
        method: "POST",
        body: { email: form.get("email"), password: form.get("password") }
      });
      state.user = data.user;
      state.view = defaultViewForRole(state.user.role);
      const session = await api("/api/me");
      state.business = session.business;
      await refreshRoleData();
      showNotice(`Welcome, ${state.user.name}.`);
    } catch (error) {
      showNotice(error.message, "error");
    }
  });
}

function renderCurrentView() {
  if (state.user.role === "admin") {
    return state.view === "setup" ? renderAdminSetup() : renderAdminBusinesses();
  }

  if (state.user.role === "manager") {
    if (state.view === "employees") return renderManagerEmployees();
    if (state.view === "company") return renderCompany();
    return renderFilesPage();
  }

  if (state.view === "company") return renderCompany();
  return renderFilesPage();
}

function renderAdminBusinesses() {
  const totalManagers = state.businesses.reduce((sum, business) => sum + business.managers.length, 0);
  const totalEmployees = state.businesses.reduce((sum, business) => sum + business.employeeCount, 0);
  return `
    <section class="grid three">
      <div class="panel metric"><span>Businesses</span><strong>${state.businesses.length}</strong></div>
      <div class="panel metric"><span>Managers</span><strong>${totalManagers}</strong></div>
      <div class="panel metric"><span>Employees</span><strong>${totalEmployees}</strong></div>
    </section>
    <section class="panel section-panel">
      <div class="panel-header"><div><h2>Businesses</h2><p>Managers and activity by company.</p></div></div>
      ${state.businesses.length ? renderBusinessTable() : `<div class="empty">No businesses yet.</div>`}
    </section>
  `;
}

function renderAdminSetup() {
  const options = state.businesses
    .map((business) => `<option value="${escapeHtml(business.id)}">${escapeHtml(business.name)}</option>`)
    .join("");

  return `
    <section class="grid two">
      <section class="panel">
        <div class="panel-header"><div><h2>Create business</h2><p>Platform-level setup.</p></div></div>
        <div class="panel-body">
          <form class="form" id="business-form">
            <label class="field"><span>Business name</span><input class="input" name="name" required></label>
            <button class="button" type="submit">Create business</button>
          </form>
        </div>
      </section>
      <section class="panel">
        <div class="panel-header"><div><h2>Add manager</h2><p>Assigned to one business.</p></div></div>
        <div class="panel-body">
          <form class="form" id="manager-form">
            <label class="field"><span>Business</span><select class="select" name="businessId" required>${options}</select></label>
            <label class="field"><span>Name</span><input class="input" name="name" required></label>
            <label class="field"><span>Email</span><input class="input" name="email" type="email" required></label>
            <label class="field"><span>Password</span><input class="input" name="password" type="password" minlength="6" required></label>
            <button class="button" type="submit">Create manager</button>
          </form>
        </div>
      </section>
    </section>
  `;
}

function renderBusinessTable() {
  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Business</th><th>Managers</th><th>Employees</th><th>Files</th></tr></thead>
        <tbody>
          ${state.businesses
            .map(
              (business) => `
                <tr>
                  <td><strong>${escapeHtml(business.name)}</strong></td>
                  <td>${business.managers.map((manager) => escapeHtml(manager.name)).join(", ") || "None"}</td>
                  <td>${business.employeeCount}</td>
                  <td>${business.fileCount}</td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderFilesPage() {
  return `
    <section class="page-grid">
      <div>
        ${state.user.role === "manager" ? renderManagerNewFilePanel() : renderEmployeeNewFilePanel()}
        <section class="panel section-panel">
          <div class="panel-header">
            <div><h2>${state.user.role === "manager" ? "Employee files" : "My files"}</h2><p>${escapeHtml(state.business?.name || "")}</p></div>
          </div>
          ${renderFilesTable()}
        </section>
      </div>
      <div>${renderEditor()}</div>
    </section>
  `;
}

function renderManagerNewFilePanel() {
  const selectedId = state.selectedFile?.employeeId || state.employees[0]?.id || "";
  return `
    <section class="panel">
      <div class="panel-header"><div><h2>New weekly file</h2><p>Create a sheet shell for an employee.</p></div></div>
      <div class="panel-body">
        <form class="toolbar" id="new-file-form">
          <label class="field">
            <span>Employee</span>
            <select class="select" name="employeeId" required>${state.employees
              .map((employee) => `<option value="${escapeHtml(employee.id)}" ${employee.id === selectedId ? "selected" : ""}>${escapeHtml(employee.name)}</option>`)
              .join("")}</select>
          </label>
          <label class="field">
            <span>Week start</span>
            <input class="input" name="weekStart" type="date" value="${today()}" required>
          </label>
          <button class="button" type="submit" ${state.employees.length ? "" : "disabled"}>Create</button>
        </form>
      </div>
    </section>
  `;
}

function renderEmployeeNewFilePanel() {
  return `
    <section class="panel">
      <div class="panel-header"><div><h2>New weekly file</h2><p>${escapeHtml(state.user.name)}</p></div></div>
      <div class="panel-body">
        <form class="toolbar" id="new-own-file-form">
          <label class="field">
            <span>Week start</span>
            <input class="input" name="weekStart" type="date" value="${today()}" required>
          </label>
          <button class="button" type="submit">Create</button>
        </form>
      </div>
    </section>
  `;
}

function renderManagerEmployees() {
  return `
    <section class="page-grid">
      <section class="panel">
        <div class="panel-header"><div><h2>Create employee</h2><p>${escapeHtml(state.business?.name || "Business")}</p></div></div>
        <div class="panel-body">
          <form class="form" id="employee-form">
            <label class="field"><span>Name</span><input class="input" name="name" required></label>
            <label class="field"><span>Email</span><input class="input" name="email" type="email" required></label>
            <label class="field"><span>Password</span><input class="input" name="password" type="password" minlength="6" required></label>
            <button class="button" type="submit">Create employee</button>
          </form>
        </div>
      </section>
      <section class="panel">
        <div class="panel-header"><div><h2>Employees</h2><p>${state.employees.length} active</p></div></div>
        ${renderEmployeeList()}
      </section>
    </section>
  `;
}

function renderEmployeeList() {
  if (!state.employees.length) return `<div class="empty">No employees yet.</div>`;
  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Name</th><th>Email</th><th>Files</th></tr></thead>
        <tbody>
          ${state.employees
            .map((employee) => {
              const count = state.files.filter((file) => file.employeeId === employee.id).length;
              return `
                <tr>
                  <td><strong>${escapeHtml(employee.name)}</strong></td>
                  <td>${escapeHtml(employee.email)}</td>
                  <td>${count}</td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderCompany() {
  const submittedCount = state.files.filter((file) => file.status === "submitted").length;
  const reviewCount = state.files.filter((file) => file.status === "needs_review").length;
  return `
    <section class="grid three">
      <div class="panel metric"><span>Files</span><strong>${state.files.length}</strong></div>
      <div class="panel metric"><span>Submitted</span><strong>${submittedCount}</strong></div>
      <div class="panel metric"><span>Review</span><strong>${reviewCount}</strong></div>
    </section>
    <section class="page-grid section-panel">
      <section class="panel">
        <div class="panel-header"><div><h2>Company details</h2><p>${escapeHtml(state.business?.name || "Business")}</p></div></div>
        <div class="panel-body detail-list">
          <div><span>Business</span><strong>${escapeHtml(state.business?.name || "Unassigned")}</strong></div>
          <div><span>Account</span><strong>${escapeHtml(state.user.name)}</strong></div>
          <div><span>Role</span><strong>${escapeHtml(state.user.role)}</strong></div>
        </div>
      </section>
      <section class="panel">
        <div class="panel-header"><div><h2>Destinations</h2><p>${state.destinations.length} saved</p></div></div>
        ${state.user.role === "manager" ? renderDestinationManager() : renderDestinationList()}
      </section>
    </section>
  `;
}

function renderDestinationManager() {
  return `
    <div class="panel-body">
      <form class="toolbar" id="destination-form">
        <label class="field">
          <span>Destination</span>
          <input class="input" name="name" list="destination-options" required>
        </label>
        <button class="button" type="submit">Add</button>
      </form>
    </div>
    ${renderDestinationList(true)}
  `;
}

function renderDestinationList(canRemove = false) {
  if (!state.destinations.length) return `<div class="empty">No destinations yet.</div>`;
  return `
    <div class="destination-list">
      ${state.destinations
        .map(
          (destination) => `
            <div class="destination-item">
              <strong>${escapeHtml(destination.name)}</strong>
              ${
                canRemove
                  ? `<button class="button danger small" data-action="delete-destination" data-id="${escapeHtml(destination.id)}">Remove</button>`
                  : ""
              }
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderFilesTable() {
  if (!state.files.length) return `<div class="empty">No files yet.</div>`;
  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            ${state.user.role === "manager" ? "<th>Employee</th>" : ""}
            <th>Week</th>
            <th>Status</th>
            <th>Rows</th>
            <th>Updated</th>
            <th class="actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${state.files
            .map(
              (file) => `
                <tr>
                  ${state.user.role === "manager" ? `<td><strong>${escapeHtml(file.employeeName)}</strong></td>` : ""}
                  <td>${escapeHtml(formatShortDate(file.weekStart))}</td>
                  <td><span class="status-pill ${statusClass(file.status)}">${escapeHtml(statusLabel(file.status))}</span></td>
                  <td>${file.rowCount}</td>
                  <td>${escapeHtml(formatShortDate(file.updatedAt))}</td>
                  <td class="actions">
                    <div class="split-actions">
                      <button class="button secondary small" data-action="open-file" data-id="${escapeHtml(file.id)}">Open</button>
                      <button class="button ghost small" data-action="export-file" data-id="${escapeHtml(file.id)}">Excel</button>
                      ${canDeleteFile(file) ? `<button class="button danger small" data-action="delete-file" data-id="${escapeHtml(file.id)}">Delete</button>` : ""}
                    </div>
                  </td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderEditor() {
  if (!state.selectedFile) {
    return `
      <section class="panel empty-state">
        <div class="empty">Open a file to view its sheet.</div>
      </section>
    `;
  }

  const file = state.selectedFile;
  const readOnly = !canEditSelectedFile();
  const employeeName =
    state.user.role === "employee"
      ? state.user.name
      : state.employees.find((employee) => employee.id === file.employeeId)?.name || "Employee";
  const rows = file.rows?.length ? file.rows : [rowTemplate()];

  return `
    <section class="editor-panel">
      <div class="editor-header">
        <div class="editor-title">
          <h2>${escapeHtml(employeeName)}</h2>
          <p>Week of <input class="input" id="editor-week" type="date" value="${escapeHtml(file.weekStart || today())}" ${readOnly ? "disabled" : ""}></p>
        </div>
        <div class="editor-actions">
          <span class="status-pill ${statusClass(file.status)}">${escapeHtml(statusLabel(file.status))}</span>
          <button class="button ghost small" data-action="export-file" data-id="${escapeHtml(file.id)}">Excel</button>
          ${readOnly ? "" : `<button class="button secondary small" data-action="save-file">Save</button>`}
          ${readOnly ? "" : `<button class="button warning small" data-action="submit-file">Submit</button>`}
          ${canDeleteFile(file) ? `<button class="button danger small" data-action="delete-file" data-id="${escapeHtml(file.id)}">Delete draft</button>` : ""}
        </div>
      </div>
      ${file.reviewNote ? `<div class="review-note"><strong>Review note</strong><span>${escapeHtml(file.reviewNote)}</span></div>` : ""}
      <div class="sheet-zone">
        ${renderDestinationDatalist()}
        <table class="sheet-table" id="sheet-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Date</th>
              <th>From</th>
              <th>To</th>
              <th>Ticket Number</th>
              <th>Tons</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row, index) => renderSheetRow(row, index, readOnly)).join("")}
          </tbody>
        </table>
      </div>
      ${
        readOnly
          ? renderManagerReviewControls(file)
          : `<div class="sheet-footer">
              <button class="button ghost small" data-action="add-row">Add row</button>
              <div class="split-actions">
                <button class="button secondary small" data-action="save-file">Save changes</button>
                <button class="button warning small" data-action="submit-file">Submit file</button>
              </div>
            </div>`
      }
    </section>
  `;
}

function renderManagerReviewControls(file) {
  if (state.user.role !== "manager") return "";
  return `
    <div class="sheet-footer review-controls">
      <label class="field review-field">
        <span>Review note</span>
        <input class="input" id="review-note" value="${escapeHtml(file.reviewNote || "")}" maxlength="800">
      </label>
      <button class="button warning small" data-action="flag-file" data-id="${escapeHtml(file.id)}">Flag for review</button>
    </div>
  `;
}

function renderDestinationDatalist() {
  return `
    <datalist id="destination-options">
      ${state.destinations.map((destination) => `<option value="${escapeHtml(destination.name)}"></option>`).join("")}
    </datalist>
  `;
}

function renderSheetRow(row, index, readOnly) {
  const disabled = readOnly ? "disabled" : "";
  return `
    <tr class="sheet-row">
      <td>${index + 1}</td>
      <td><input class="sheet-input" name="date" type="date" value="${escapeHtml(row.date || "")}" ${disabled}></td>
      <td><input class="sheet-input" name="from" list="destination-options" value="${escapeHtml(row.from || "")}" placeholder="Origin" ${disabled}></td>
      <td><input class="sheet-input" name="to" list="destination-options" value="${escapeHtml(row.to || "")}" placeholder="Destination" ${disabled}></td>
      <td><input class="sheet-input" name="ticketNumber" inputmode="numeric" pattern="[0-9]*" value="${escapeHtml(row.ticketNumber || "")}" placeholder="Ticket #" ${disabled}></td>
      <td><input class="sheet-input" name="tons" inputmode="decimal" value="${escapeHtml(row.tons || "")}" placeholder="0.00" ${disabled}></td>
      <td>${readOnly ? "" : `<button class="button danger small" data-action="remove-row" data-index="${index}">Remove</button>`}</td>
    </tr>
  `;
}

function collectRows() {
  return [...document.querySelectorAll(".sheet-row")].map((row) => ({
    date: row.querySelector('[name="date"]').value,
    from: row.querySelector('[name="from"]').value,
    to: row.querySelector('[name="to"]').value,
    ticketNumber: row.querySelector('[name="ticketNumber"]').value,
    tons: row.querySelector('[name="tons"]').value
  }));
}

function validateRows(rows) {
  rows.forEach((row, index) => {
    if (row.ticketNumber && !/^\d+$/.test(row.ticketNumber)) {
      throw new Error(`Ticket number in row ${index + 1} must be an integer.`);
    }
    if (row.tons && !/^\d+(\.\d{1,2})?$/.test(row.tons)) {
      throw new Error(`Tons in row ${index + 1} must use no more than two decimal places.`);
    }
  });
}

async function openFile(id) {
  try {
    const data = await api(`/api/files/${encodeURIComponent(id)}`);
    state.selectedFile = data.file;
    state.view = "files";
    render();
  } catch (error) {
    showNotice(error.message, "error");
  }
}

async function saveSelectedFile(status) {
  if (!state.selectedFile) return;
  try {
    const rows = collectRows();
    validateRows(rows);
    const payload = {
      weekStart: document.getElementById("editor-week")?.value || state.selectedFile.weekStart,
      rows
    };
    if (status) payload.status = status;
    const data = await api(`/api/files/${encodeURIComponent(state.selectedFile.id)}`, { method: "PATCH", body: payload });
    state.selectedFile = data.file;
    await refreshRoleData();
    showNotice(status === "submitted" ? "File submitted." : "File saved.");
  } catch (error) {
    showNotice(error.message, "error");
  }
}

async function createFile(body) {
  const data = await api("/api/files", { method: "POST", body: { rows: [rowTemplate()], ...body } });
  state.selectedFile = data.file;
  state.view = "files";
  await refreshRoleData();
  showNotice("File created.");
}

async function deleteFile(id) {
  if (!window.confirm("Delete this draft?")) return;
  try {
    await api(`/api/files/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (state.selectedFile?.id === id) state.selectedFile = null;
    await refreshRoleData();
    showNotice("Draft deleted.");
  } catch (error) {
    showNotice(error.message, "error");
  }
}

async function flagFile(id) {
  try {
    const reviewNote = document.getElementById("review-note")?.value || "";
    const data = await api(`/api/files/${encodeURIComponent(id)}/flag`, { method: "POST", body: { reviewNote } });
    state.selectedFile = data.file;
    await refreshRoleData();
    showNotice("File flagged for review.");
  } catch (error) {
    showNotice(error.message, "error");
  }
}

function bindCommonEvents() {
  document.querySelectorAll('[data-action="nav"]').forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      if (state.view !== "files") state.selectedFile = null;
      render();
    });
  });

  document.querySelector('[data-action="logout"]')?.addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" });
    state.user = null;
    state.business = null;
    state.businesses = [];
    state.employees = [];
    state.files = [];
    state.destinations = [];
    state.selectedFile = null;
    state.view = null;
    render();
  });
}

function bindAdminEvents() {
  document.getElementById("business-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    try {
      await api("/api/admin/businesses", { method: "POST", body: { name: form.get("name") } });
      formEl.reset();
      await refreshRoleData();
      showNotice("Business created.");
    } catch (error) {
      showNotice(error.message, "error");
    }
  });

  document.getElementById("manager-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    try {
      await api("/api/admin/managers", {
        method: "POST",
        body: {
          businessId: form.get("businessId"),
          name: form.get("name"),
          email: form.get("email"),
          password: form.get("password")
        }
      });
      formEl.reset();
      await refreshRoleData();
      showNotice("Manager created.");
    } catch (error) {
      showNotice(error.message, "error");
    }
  });
}

function bindManagerEvents() {
  document.getElementById("employee-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    try {
      await api("/api/manager/employees", {
        method: "POST",
        body: {
          name: form.get("name"),
          email: form.get("email"),
          password: form.get("password")
        }
      });
      formEl.reset();
      await refreshRoleData();
      showNotice("Employee created.");
    } catch (error) {
      showNotice(error.message, "error");
    }
  });

  document.getElementById("new-file-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    try {
      await createFile({ employeeId: form.get("employeeId"), weekStart: form.get("weekStart") });
    } catch (error) {
      showNotice(error.message, "error");
    }
  });

  document.getElementById("destination-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    try {
      await api("/api/manager/destinations", { method: "POST", body: { name: form.get("name") } });
      formEl.reset();
      await refreshRoleData();
      showNotice("Destination added.");
    } catch (error) {
      showNotice(error.message, "error");
    }
  });

  document.querySelectorAll('[data-action="delete-destination"]').forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await api(`/api/manager/destinations/${encodeURIComponent(button.dataset.id)}`, { method: "DELETE" });
        await refreshRoleData();
        showNotice("Destination removed.");
      } catch (error) {
        showNotice(error.message, "error");
      }
    });
  });
}

function bindEmployeeEvents() {
  document.getElementById("new-own-file-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    try {
      await createFile({ weekStart: form.get("weekStart") });
    } catch (error) {
      showNotice(error.message, "error");
    }
  });
}

function bindFileEvents() {
  document.querySelectorAll('[data-action="open-file"]').forEach((button) => {
    button.addEventListener("click", () => openFile(button.dataset.id));
  });

  document.querySelectorAll('[data-action="export-file"]').forEach((button) => {
    button.addEventListener("click", () => {
      window.location.href = `${API_BASE}/api/files/${encodeURIComponent(button.dataset.id)}/export`;
    });
  });

  document.querySelectorAll('[data-action="save-file"]').forEach((button) => {
    button.addEventListener("click", () => saveSelectedFile());
  });

  document.querySelectorAll('[data-action="submit-file"]').forEach((button) => {
    button.addEventListener("click", () => saveSelectedFile("submitted"));
  });

  document.querySelectorAll('[data-action="delete-file"]').forEach((button) => {
    button.addEventListener("click", () => deleteFile(button.dataset.id));
  });

  document.querySelectorAll('[data-action="flag-file"]').forEach((button) => {
    button.addEventListener("click", () => flagFile(button.dataset.id));
  });

  document.querySelector('[data-action="add-row"]')?.addEventListener("click", () => {
    state.selectedFile.rows = collectRows();
    state.selectedFile.rows.push(rowTemplate());
    render();
  });

  document.querySelectorAll('[data-action="remove-row"]').forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.index);
      const rows = collectRows();
      rows.splice(index, 1);
      state.selectedFile.rows = rows.length ? rows : [rowTemplate()];
      render();
    });
  });

  document.querySelectorAll('[name="ticketNumber"]').forEach((input) => {
    input.addEventListener("input", () => {
      input.value = input.value.replace(/\D/g, "");
    });
  });

  document.querySelectorAll('[name="tons"]').forEach((input) => {
    input.addEventListener("input", () => {
      const match = input.value.match(/^\d*(?:\.\d{0,2})?/);
      input.value = match ? match[0] : "";
    });
    input.addEventListener("blur", () => {
      if (/^\d+(\.\d{1,2})?$/.test(input.value)) {
        input.value = Number(input.value).toFixed(2);
      }
    });
  });
}

init();
