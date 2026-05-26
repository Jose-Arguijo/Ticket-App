const app = document.getElementById("app");
const API_BASE = (window.APP_CONFIG && window.APP_CONFIG.API_BASE ? window.APP_CONFIG.API_BASE : "").replace(/\/$/, "");
const THEME_STORAGE_KEY = "ticketapp_theme";
const THEME_OPTIONS = ["light", "dark", "system"];
const PREFERRED_UNITS_OPTIONS = [
  { value: "tons", label: "US tons" },
  { value: "metric_tons", label: "Metric tons" }
];
const EMPLOYMENT_STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "on_leave", label: "On leave" },
  { value: "inactive", label: "Inactive" }
];

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
  noticeType: "success",
  loading: true,
  busyAction: null,
  sheetError: "",
  rowErrors: {},
  reviewError: "",
  theme: "system",
  selectedProfileEmployeeId: "",
  savingProfileSection: "",
  settingsErrors: {},
  passwordPaneOpen: false,
  editingBusinessId: ""
};

const viewsByRole = {
  admin: [
    { id: "businesses", label: "Businesses" },
    { id: "setup", label: "Setup" },
    { id: "settings", label: "Settings" }
  ],
  manager: [
    { id: "files", label: "Files" },
    { id: "employees", label: "Employees" },
    { id: "company", label: "Company" },
    { id: "settings", label: "Settings" }
  ],
  employee: [
    { id: "files", label: "Files" },
    { id: "company", label: "Company" },
    { id: "settings", label: "Settings" }
  ]
};

const statusLabels = {
  draft: "Draft",
  submitted: "Submitted",
  needs_review: "Needs review"
};

const fieldLabels = {
  date: "date",
  from: "origin",
  to: "destination",
  ticketNumber: "ticket number",
  tons: "tons"
};

// ============================================================
// THEME MANAGEMENT
// ============================================================

function initTheme() {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  applyTheme(THEME_OPTIONS.includes(saved) ? saved : "system", { persist: Boolean(saved) });
}

function applyTheme(theme, options = {}) {
  const nextTheme = THEME_OPTIONS.includes(theme) ? theme : "system";
  const persist = options.persist !== false;
  const htmlEl = document.documentElement;
  
  if (nextTheme === "system") {
    const media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    const isDark = Boolean(media?.matches);
    htmlEl.setAttribute("data-theme", isDark ? "dark" : "light");
  } else {
    htmlEl.setAttribute("data-theme", nextTheme);
  }
  
  state.theme = nextTheme;
  if (persist) localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
}

function syncThemeFromUser(user) {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  if (!saved && user?.theme) applyTheme(user.theme);
}

async function setTheme(theme) {
  const previousTheme = state.theme;
  applyTheme(theme);
  state.savingProfileSection = "theme";
  render();
  try {
    const data = await api("/api/me/profile", {
      method: "PUT",
      body: { theme: state.theme }
    });
    state.user = data.user;
    showNotice("Theme preference saved.");
  } catch (error) {
    applyTheme(previousTheme);
    showNotice(error.message, "error");
  } finally {
    state.savingProfileSection = "";
    render();
  }
}

// Listen for system theme changes
const systemThemeQuery = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
systemThemeQuery?.addEventListener("change", () => {
  if (state.theme === "system") {
    applyTheme("system");
  }
});

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

function displayNameFor(user) {
  return user?.displayName || user?.name || "";
}

function initialsFor(user) {
  const source = displayNameFor(user) || user?.email || "U";
  return source
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "U";
}

function optionLabel(options, value) {
  return options.find((option) => option.value === value)?.label || value || "";
}

function destinationText(destinations = []) {
  return Array.isArray(destinations) && destinations.length ? destinations.join(", ") : "";
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

function isValidDateValue(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function formatWeekRange(dateStr) {
  if (!dateStr) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  
  const [year, month, day] = dateStr.split("-").map(Number);
  const startDate = new Date(year, month - 1, day);
  
  // Calculate day of week (0 = Sunday, 1 = Monday)
  const dayOfWeek = startDate.getDay();
  
  // Calculate Monday (or use current day if it's Monday)
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(startDate);
  monday.setDate(monday.getDate() - daysToMonday);
  
  // Calculate Saturday (5 days after Monday)
  const saturday = new Date(monday);
  saturday.setDate(saturday.getDate() + 5);
  
  const mondayDay = monday.getDate();
  const saturdayDay = saturday.getDate();
  
  return `Week of ${mondayDay}${getOrdinalSuffix(mondayDay)}-${saturdayDay}${getOrdinalSuffix(saturdayDay)}`;
}

function getOrdinalSuffix(n) {
  if (n >= 11 && n <= 13) return "th";
  switch (n % 10) {
    case 1: return "st";
    case 2: return "nd";
    case 3: return "rd";
    default: return "th";
  }
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

function renderStatusPill(status) {
  return `<span class="status-pill ${statusClass(status)}">${escapeHtml(statusLabel(status))}</span>`;
}

function rowHasData(row) {
  return Boolean(row.date || row.from || row.to || row.ticketNumber || row.tons);
}

function totalTons(rows = []) {
  return rows.reduce((sum, row) => {
    const value = Number(row.tons);
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);
}

function errorKey(index, field) {
  return `${index}.${field}`;
}

function rowError(index, field) {
  return state.rowErrors[errorKey(index, field)] || "";
}

function setAction(action) {
  state.busyAction = action;
  render();
}

function clearAction() {
  state.busyAction = null;
  render();
}

function isBusy(action) {
  return state.busyAction === action;
}

function busyDisabled() {
  return state.busyAction ? "disabled aria-busy=\"true\"" : "";
}

function setFormPending(formEl, pending, label = "Saving...") {
  const associatedButtons = formEl.id
    ? [...document.querySelectorAll("button[form]")].filter((button) => button.getAttribute("form") === formEl.id)
    : [];
  const controls = new Set([...formEl.querySelectorAll("input, select, textarea, button"), ...associatedButtons]);
  controls.forEach((control) => {
    control.disabled = pending;
  });

  const submitButton = formEl.querySelector('button[type="submit"]') || associatedButtons.find((button) => button.type === "submit");
  if (!submitButton) return;
  if (!submitButton.dataset.defaultText) submitButton.dataset.defaultText = submitButton.textContent;
  submitButton.textContent = pending ? label : submitButton.dataset.defaultText;
}

function clearSheetValidation() {
  state.sheetError = "";
  state.rowErrors = {};
}

function renderEmptyState(title, body = "") {
  return `
    <div class="empty">
      <strong>${escapeHtml(title)}</strong>
      ${body ? `<span>${escapeHtml(body)}</span>` : ""}
    </div>
  `;
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
  initTheme();
  render();
  try {
    const session = await api("/api/me");
    state.user = session.user;
    syncThemeFromUser(state.user);
    state.business = session.business;
    state.view = defaultViewForRole(state.user.role);
    await refreshRoleData();
  } catch (error) {
    if (error.status !== 401) {
      state.notice = error.message;
      state.noticeType = "error";
    }
  } finally {
    state.loading = false;
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
    if (!state.selectedProfileEmployeeId || !state.employees.some((employee) => employee.id === state.selectedProfileEmployeeId)) {
      state.selectedProfileEmployeeId = state.employees[0]?.id || "";
    }
  }

  if (state.user.role === "employee") {
    const [files, destinations] = await Promise.all([api("/api/files"), api("/api/destinations")]);
    state.files = files.files;
    state.destinations = destinations.destinations;
  }
}

function render() {
  if (state.loading) {
    renderLoading();
    return;
  }

  if (!state.user) {
    renderLogin();
    return;
  }

  ensureView();
  app.innerHTML = `
    <div class="app-shell">
      ${renderTopbar()}
      <main class="workspace">${renderCurrentView()}</main>
      ${renderPasswordPane()}
      ${renderNotice()}
    </div>
  `;

  bindCommonEvents();
  if (state.user.role === "admin") bindAdminEvents();
  if (state.user.role === "manager") bindManagerEvents();
  if (state.user.role === "employee") bindEmployeeEvents();
  bindFileEvents();
}

function renderLoading() {
  app.innerHTML = `
    <main class="loading-screen" aria-live="polite">
      <div class="loading-card">
        <img src="/truck-mark.svg" alt="">
        <div>
          <strong>Dispatch Papers</strong>
          <span>Loading workspace...</span>
        </div>
      </div>
    </main>
  `;
}

function renderNotice() {
  if (!state.notice) return "";
  const noticeClass = state.noticeType === "error" ? "error" : "success";
  return `<div class="notice ${noticeClass}" role="status" aria-live="polite">${escapeHtml(state.notice)}</div>`;
}

function renderTopbar() {
  const businessName = state.business?.name || "Platform";
  return `
    <header class="topbar">
      <div class="brand-lockup">
        <img src="/truck-mark.svg" alt="">
        <div>
          <h1>Dispatch Papers</h1>
          <p>${escapeHtml(businessName)} · ${escapeHtml(displayNameFor(state.user))}</p>
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
    setFormPending(formEl, true, "Logging in...");
    try {
      const data = await api("/api/login", {
        method: "POST",
        body: { email: form.get("email"), password: form.get("password") }
      });
      state.user = data.user;
      syncThemeFromUser(state.user);
      state.view = defaultViewForRole(state.user.role);
      const session = await api("/api/me");
      state.user = session.user;
      syncThemeFromUser(state.user);
      state.business = session.business;
      await refreshRoleData();
      showNotice(`Welcome, ${state.user.name}.`);
    } catch (error) {
      setFormPending(formEl, false);
      showNotice(error.message, "error");
    }
  });
}

function renderCurrentView() {
  if (state.view === "settings") {
    return renderSettings();
  }

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

// ============================================================
// SETTINGS PAGE
// ============================================================

function renderSettings() {
  return `
    <div class="settings-container">
      <div class="settings-header">
        <span class="eyebrow">Operations settings</span>
        <h1>Settings</h1>
        <p>Theme, profile, and account details for the Dispatch Papers workspace.</p>
      </div>

      ${renderAppearanceSettings()}
      ${state.user.role === "employee" ? renderPersonalProfileForm() : renderPersonalProfileReadonly()}
      ${state.user.role === "manager" ? renderManagerEmploymentSettings() : renderEmployeeEmploymentSettings()}
      ${renderAccountInfoSettings()}
    </div>
  `;
}

function renderAppearanceSettings() {
  const saving = state.savingProfileSection === "theme";
  return `
    <div class="settings-section">
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>Appearance</h2>
            <p>Choose a light, dark, or system-matched cockpit.</p>
          </div>
        </div>
        <div class="panel-body">
          <form class="settings-form" id="theme-form">
            <div class="theme-selector" role="radiogroup" aria-label="Theme mode">
              ${[
                { value: "light", title: "Light Mode", body: "Cream paper, navy controls" },
                { value: "dark", title: "Dark Mode", body: "Matte navy command center" },
                { value: "system", title: "System", body: "Follow device settings" }
              ]
                .map(
                  (option) => `
                    <div class="theme-option">
                      <input type="radio" id="theme-${option.value}" name="theme" value="${option.value}" ${state.theme === option.value ? "checked" : ""} ${saving ? "disabled" : ""}>
                      <label for="theme-${option.value}">
                        <span class="theme-swatch ${option.value}"></span>
                        <strong>${option.title}</strong>
                        <small>${option.body}</small>
                      </label>
                    </div>
                  `
                )
                .join("")}
            </div>
            <div class="section-actions">
              <button class="button secondary" type="submit" ${saving ? "disabled" : ""}>${saving ? "Saving..." : "Save theme"}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `;
}

function renderProfileSummary(user, helper = "") {
  return `
    <div class="profile-info">
      <div class="profile-avatar" aria-hidden="true">${escapeHtml(initialsFor(user))}</div>
      <div class="profile-details">
        <div class="profile-name">${escapeHtml(displayNameFor(user))}</div>
        <div class="profile-role">${escapeHtml(user.role.charAt(0).toUpperCase() + user.role.slice(1))}</div>
        <div class="profile-email">${escapeHtml(user.email)}</div>
        ${helper ? `<div class="helper-text">${escapeHtml(helper)}</div>` : ""}
      </div>
    </div>
  `;
}

function renderFieldError(name) {
  const message = state.settingsErrors[name];
  return message ? `<span class="field-error">${escapeHtml(message)}</span>` : "";
}

function renderPersonalProfileForm() {
  const saving = state.savingProfileSection === "personal";
  return `
    <div class="settings-section">
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>Personal Profile</h2>
            <p>Employee-managed details visible to your manager.</p>
          </div>
        </div>
        <div class="panel-body">
          ${renderProfileSummary(state.user)}
          <form class="settings-form" id="personal-profile-form" novalidate>
            <div class="form-row">
              <label class="profile-field">
                <span>Preferred display name</span>
                <input class="input ${state.settingsErrors.displayName ? "invalid" : ""}" type="text" name="displayName" value="${escapeHtml(displayNameFor(state.user))}" maxlength="80" required ${saving ? "disabled" : ""}>
                ${renderFieldError("displayName")}
              </label>
              <label class="profile-field">
                <span>Preferred units</span>
                <select class="select" name="preferredUnits" ${saving ? "disabled" : ""}>
                  ${PREFERRED_UNITS_OPTIONS.map((option) => `<option value="${option.value}" ${state.user.preferredUnits === option.value ? "selected" : ""}>${option.label}</option>`).join("")}
                </select>
              </label>
            </div>
            <div class="form-row">
              <label class="profile-field">
                <span>Phone number</span>
                <input class="input" type="tel" name="phone" value="${escapeHtml(state.user.phone || "")}" maxlength="32" autocomplete="tel" ${saving ? "disabled" : ""}>
              </label>
              <label class="profile-field">
                <span>Emergency contact</span>
                <input class="input" type="text" name="emergencyContact" value="${escapeHtml(state.user.emergencyContact || "")}" maxlength="140" ${saving ? "disabled" : ""}>
              </label>
            </div>
            <div class="section-actions">
              <button class="button ghost" type="reset" ${saving ? "disabled" : ""}>Cancel</button>
              <button class="button secondary" type="submit" ${saving ? "disabled" : ""}>${saving ? "Saving..." : "Save personal profile"}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `;
}

function renderPersonalProfileReadonly() {
  return `
    <div class="settings-section">
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>Personal Profile</h2>
            <p>Driver-owned fields stay with each employee account.</p>
          </div>
        </div>
        <div class="panel-body">
          ${renderProfileSummary(state.user, "Managers and admins can save theme preferences from Appearance.")}
          <div class="locked-callout">Driver personal details are managed by employee accounts.</div>
        </div>
      </div>
    </div>
  `;
}

function renderLockedField(label, value, helper) {
  return `
    <label class="profile-field locked-field">
      <span>${escapeHtml(label)}</span>
      <input class="input" type="text" value="${escapeHtml(value || "Not set")}" disabled>
      <div class="helper-text">${escapeHtml(helper)}</div>
    </label>
  `;
}

function renderEmployeeEmploymentSettings() {
  if (state.user.role !== "employee") {
    return `
      <div class="settings-section">
        <div class="panel">
          <div class="panel-header">
            <div><h2>Employment Details</h2><p>Employee employment profiles are managed by business managers.</p></div>
          </div>
          <div class="panel-body">
            <div class="locked-callout">No employee employment profile is attached to this account.</div>
          </div>
        </div>
      </div>
    `;
  }

  return `
    <div class="settings-section">
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>Employment Details</h2>
            <p>Manager-controlled details visible on your profile.</p>
          </div>
        </div>
        <div class="panel-body">
          <div class="field-grid">
            ${renderLockedField("Employee full name", state.user.name, "Managed by your manager")}
            ${renderLockedField("Assigned business", state.business?.name || "Unassigned", "Managed by your manager")}
            ${renderLockedField("Employee ID", state.user.employeeCode || state.user.id, "Managed by your manager")}
            ${renderLockedField("Truck number", state.user.truckNumber, "Managed by your manager")}
            ${renderLockedField("Default destinations", destinationText(state.user.defaultDestinations), "Managed by your manager")}
            ${renderLockedField("Employment status", optionLabel(EMPLOYMENT_STATUS_OPTIONS, state.user.employmentStatus), "Managed by your manager")}
          </div>
          <label class="profile-field section-gap">
            <span>Notes visible to management</span>
            <textarea class="input" disabled>${escapeHtml(state.user.managementNotes || "Not set")}</textarea>
            <div class="helper-text">Managed by your manager</div>
          </label>
        </div>
      </div>
    </div>
  `;
}

function selectedProfileEmployee() {
  if (!state.employees.length) return null;
  return state.employees.find((employee) => employee.id === state.selectedProfileEmployeeId) || state.employees[0];
}

function renderManagerEmploymentSettings() {
  const employee = selectedProfileEmployee();
  const saving = state.savingProfileSection === "employment";
  if (!employee) {
    return `
      <div class="settings-section">
        <div class="panel">
          <div class="panel-header">
            <div><h2>Employment Details</h2><p>Manager-controlled employee profile information.</p></div>
          </div>
          ${renderEmptyState("No employees yet", "Create an employee before managing profile details.")}
        </div>
      </div>
    `;
  }

  return `
    <div class="settings-section">
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>Employment Details</h2>
            <p>Manager-owned employee fields for trucking operations.</p>
          </div>
        </div>
        <div class="panel-body">
          <label class="profile-field profile-picker">
            <span>Employee</span>
            <select class="select" id="profile-employee-select" ${saving ? "disabled" : ""}>
              ${state.employees.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === employee.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}
            </select>
          </label>

          ${renderProfileSummary(employee, "Employment fields are manager-managed. Personal contact fields are employee-managed.")}

          <form class="settings-form" id="employment-profile-form" novalidate>
            <div class="form-row">
              <label class="profile-field">
                <span>Employee full name</span>
                <input class="input ${state.settingsErrors.employeeName ? "invalid" : ""}" name="name" value="${escapeHtml(employee.name)}" maxlength="100" required ${saving ? "disabled" : ""}>
                ${renderFieldError("employeeName")}
              </label>
              <label class="profile-field">
                <span>Employee ID</span>
                <input class="input" name="employeeCode" value="${escapeHtml(employee.employeeCode || "")}" maxlength="40" ${saving ? "disabled" : ""}>
              </label>
            </div>
            <div class="form-row">
              <label class="profile-field">
                <span>Truck number</span>
                <input class="input" name="truckNumber" value="${escapeHtml(employee.truckNumber || "")}" maxlength="40" ${saving ? "disabled" : ""}>
              </label>
              <label class="profile-field">
                <span>Employment status</span>
                <select class="select" name="employmentStatus" ${saving ? "disabled" : ""}>
                  ${EMPLOYMENT_STATUS_OPTIONS.map((option) => `<option value="${option.value}" ${employee.employmentStatus === option.value ? "selected" : ""}>${option.label}</option>`).join("")}
                </select>
              </label>
            </div>
            <label class="profile-field">
              <span>Default destinations</span>
              <input class="input" name="defaultDestinations" value="${escapeHtml(destinationText(employee.defaultDestinations))}" maxlength="240" ${saving ? "disabled" : ""}>
              <div class="helper-text">Separate destinations with commas.</div>
            </label>
            <label class="profile-field">
              <span>Notes visible to management</span>
              <textarea class="input" name="managementNotes" maxlength="500" ${saving ? "disabled" : ""}>${escapeHtml(employee.managementNotes || "")}</textarea>
            </label>
            <div class="section-actions">
              <button class="button ghost" type="reset" ${saving ? "disabled" : ""}>Cancel</button>
              <button class="button secondary" type="submit" ${saving ? "disabled" : ""}>${saving ? "Saving..." : "Save employment details"}</button>
            </div>
          </form>

          <div class="section-divider"></div>
          <div class="settings-section-title">Driver-Owned Personal Details</div>
          <div class="field-grid">
            ${renderLockedField("Preferred display name", employee.displayName || employee.name, "Managed by employee")}
            ${renderLockedField("Phone number", employee.phone, "Managed by employee")}
            ${renderLockedField("Emergency contact", employee.emergencyContact, "Managed by employee")}
            ${renderLockedField("Preferred units", optionLabel(PREFERRED_UNITS_OPTIONS, employee.preferredUnits), "Managed by employee")}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderAccountInfoSettings() {
  return `
    <div class="settings-section">
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>Account Info</h2>
            <p>Core login and role information.</p>
          </div>
        </div>
        <div class="panel-body">
          <div class="field-grid">
            ${renderLockedField("Email", state.user.email, "Contact an administrator to change")}
            ${renderLockedField("Role", state.user.role, "Managed by account setup")}
            ${renderLockedField("Business", state.business?.name || "Platform", "Managed by account setup")}
            ${renderLockedField("Account ID", state.user.id, "System generated")}
          </div>
          <div class="section-actions">
            <button class="button secondary" type="button" data-action="open-password-pane">Change Password</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderPasswordPane() {
  if (!state.passwordPaneOpen) return "";
  const oldPasswordInvalid = state.settingsErrors.oldPassword ? "invalid" : "";
  const newPasswordInvalid = state.settingsErrors.newPassword ? "invalid" : "";
  const confirmPasswordInvalid = state.settingsErrors.confirmPassword ? "invalid" : "";
  return `
    <div class="modal-backdrop" data-action="close-password-pane">
      <section class="modal-pane password-pane" role="dialog" aria-modal="true" aria-labelledby="change-password-title">
        <div class="modal-header">
          <div>
            <h2 id="change-password-title">Change Password</h2>
            <p>Confirm your old password before saving a new one.</p>
          </div>
          <button class="button ghost small" type="button" data-action="close-password-pane">Close</button>
        </div>
        <form class="settings-form" id="password-change-form" novalidate>
          <label class="profile-field">
            <span>Old password</span>
            <input class="input ${oldPasswordInvalid}" name="oldPassword" type="password" autocomplete="current-password" required>
            ${renderFieldError("oldPassword")}
          </label>
          <label class="profile-field">
            <span>New password</span>
            <input class="input ${newPasswordInvalid}" name="newPassword" type="password" autocomplete="new-password" minlength="6" maxlength="128" required>
            ${renderFieldError("newPassword")}
          </label>
          <label class="profile-field">
            <span>Reenter new password</span>
            <input class="input ${confirmPasswordInvalid}" name="confirmPassword" type="password" autocomplete="new-password" minlength="6" maxlength="128" required>
            ${renderFieldError("confirmPassword")}
          </label>
          <div class="section-actions">
            <button class="button ghost" type="button" data-action="close-password-pane">Cancel</button>
            <button class="button secondary" type="submit">Update Password</button>
          </div>
        </form>
      </section>
    </div>
  `;
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
      ${state.businesses.length ? renderBusinessTable() : renderEmptyState("No businesses yet", "Create a business from Setup.")}
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
        <thead><tr><th>Business</th><th>Managers</th><th>Employees</th><th>Files</th><th class="actions">Actions</th></tr></thead>
        <tbody>
          ${state.businesses
            .map((business) => {
              const isEditing = state.editingBusinessId === business.id;
              const formId = `business-edit-${business.id}`;
              return `
                <tr>
                  <td>
                    ${
                      isEditing
                        ? `<form class="inline-edit-form business-edit-form" id="${escapeHtml(formId)}" data-business-id="${escapeHtml(business.id)}">
                            <label class="sr-only" for="${escapeHtml(formId)}-name">Business name</label>
                            <input class="input" id="${escapeHtml(formId)}-name" name="name" value="${escapeHtml(business.name)}" maxlength="100" required>
                          </form>`
                        : `<strong>${escapeHtml(business.name)}</strong>`
                    }
                  </td>
                  <td>${business.managers.map((manager) => escapeHtml(manager.name)).join(", ") || "None"}</td>
                  <td>${business.employeeCount}</td>
                  <td>${business.fileCount}</td>
                  <td class="actions">
                    <div class="split-actions">
                      ${
                        isEditing
                          ? `<button class="button secondary small" type="submit" form="${escapeHtml(formId)}">Save</button>
                            <button class="button ghost small" type="button" data-action="cancel-business-edit">Cancel</button>`
                          : `<button class="button ghost small" data-action="edit-business" data-id="${escapeHtml(business.id)}">Edit</button>`
                      }
                    </div>
                  </td>
                </tr>
              `;
            })
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
    ${state.employees.length ? "" : `<div class="inline-empty">Add an employee before creating weekly files.</div>`}
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
  if (!state.employees.length) return renderEmptyState("No employees yet", "Create the first driver account to start weekly files.");
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
  if (!state.destinations.length) return renderEmptyState("No destinations yet", "Saved destinations will appear as sheet suggestions.");
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
  if (!state.files.length) return renderEmptyState("No files yet", "Create a weekly file to start entering tickets.");
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
                <tr class="${state.selectedFile?.id === file.id ? "selected-row" : ""}">
                  ${state.user.role === "manager" ? `<td><strong>${escapeHtml(file.employeeName)}</strong></td>` : ""}
                  <td>${escapeHtml(formatShortDate(file.weekStart))}</td>
                  <td>${renderStatusPill(file.status)}</td>
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
        ${renderEmptyState("No file open", "Open a weekly file to view its sheet.")}
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
  const rowCount = rows.filter(rowHasData).length;
  const tonsTotal = totalTons(rows);
  const saveLabel = isBusy("save") ? "Saving..." : "Save";
  const submitLabel = isBusy("submit") ? "Submitting..." : "Submit";

  return `
    <section class="editor-panel">
      <div class="editor-header">
        <div class="editor-title">
          <h2>${escapeHtml(employeeName)}</h2>
          <p>${escapeHtml(rowCount)} rows · ${tonsTotal.toFixed(2)} tons · <span id="week-display">${escapeHtml(formatWeekRange(file.weekStart || today()))}</span></p>
          ${
            readOnly
              ? ""
              : `<label class="field compact week-field">
                  <span>Week start</span>
                  <input class="input" id="editor-week" type="date" value="${escapeHtml(file.weekStart || today())}">
                </label>`
          }
        </div>
        <div class="editor-actions">
          ${renderStatusPill(file.status)}
          <button class="button ghost small" data-action="export-file" data-id="${escapeHtml(file.id)}">Excel</button>
          ${readOnly ? "" : `<button class="button secondary small" data-action="save-file" ${busyDisabled()}>${saveLabel}</button>`}
          ${readOnly ? "" : `<button class="button warning small" data-action="submit-file" ${busyDisabled()}>${submitLabel}</button>`}
          ${canDeleteFile(file) ? `<button class="button danger small" data-action="delete-file" data-id="${escapeHtml(file.id)}" ${busyDisabled()}>${isBusy("delete") ? "Deleting..." : "Delete draft"}</button>` : ""}
        </div>
      </div>
      ${file.reviewNote ? `<div class="review-note"><strong>Review note</strong><span>${escapeHtml(file.reviewNote)}</span></div>` : ""}
      ${state.sheetError ? `<div class="sheet-error-banner" role="alert">${escapeHtml(state.sheetError)}</div>` : ""}
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
                <button class="button secondary small" data-action="save-file" ${busyDisabled()}>${isBusy("save") ? "Saving..." : "Save changes"}</button>
                <button class="button warning small" data-action="submit-file" ${busyDisabled()}>${isBusy("submit") ? "Submitting..." : "Submit file"}</button>
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
        <textarea class="input review-textarea ${state.reviewError ? "invalid" : ""}" id="review-note" maxlength="800" aria-invalid="${state.reviewError ? "true" : "false"}">${escapeHtml(file.reviewNote || "")}</textarea>
        ${state.reviewError ? `<span class="field-error">${escapeHtml(state.reviewError)}</span>` : ""}
      </label>
      <button class="button warning small" data-action="flag-file" data-id="${escapeHtml(file.id)}" ${busyDisabled()}>${isBusy("flag") ? "Flagging..." : "Flag for review"}</button>
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
  const inputCell = (field, type, extra = "") => {
    const error = rowError(index, field);
    const id = `row-${index}-${field}`;
    const value = escapeHtml(row[field] || "");
    return `
      <input
        class="sheet-input ${error ? "invalid" : ""}"
        id="${id}"
        name="${field}"
        type="${type}"
        value="${value}"
        aria-label="Row ${index + 1} ${fieldLabels[field]}"
        aria-invalid="${error ? "true" : "false"}"
        ${error ? `aria-describedby="${id}-error"` : ""}
        ${extra}
        ${disabled}
      >
      ${error ? `<span class="field-error compact-error" id="${id}-error">${escapeHtml(error)}</span>` : ""}
    `;
  };

  return `
    <tr class="sheet-row">
      <td>${index + 1}</td>
      <td>${inputCell("date", "date")}</td>
      <td>${inputCell("from", "text", 'list="destination-options" placeholder="Origin"')}</td>
      <td>${inputCell("to", "text", 'list="destination-options" placeholder="Destination"')}</td>
      <td>${inputCell("ticketNumber", "text", 'inputmode="numeric" pattern="[0-9]*" placeholder="Ticket #"')}</td>
      <td>${inputCell("tons", "text", 'inputmode="decimal" placeholder="0.00"')}</td>
      <td>${readOnly ? "" : `<button class="button danger small" data-action="remove-row" data-index="${index}" aria-label="Remove row ${index + 1}">Remove</button>`}</td>
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

function createValidationError(message) {
  const error = new Error(message);
  error.isValidationError = true;
  return error;
}

function validateRows(rows, options = {}) {
  const rowErrors = {};
  let firstError = "";

  const mark = (index, field, message) => {
    rowErrors[errorKey(index, field)] = message;
    if (!firstError) firstError = `Row ${index + 1}: ${message}`;
  };

  rows.forEach((row, index) => {
    const hasData = rowHasData(row);
    if (row.date && !isValidDateValue(row.date)) {
      mark(index, "date", "Enter a valid date.");
    }
    if (row.ticketNumber && !/^\d+$/.test(row.ticketNumber)) {
      mark(index, "ticketNumber", "Use whole numbers only.");
    }
    if (row.tons && !/^\d+(\.\d{1,2})?$/.test(row.tons)) {
      mark(index, "tons", "Use no more than two decimals.");
    }
    if (options.requireComplete && hasData) {
      ["date", "from", "to", "ticketNumber", "tons"].forEach((field) => {
        if (!row[field]) mark(index, field, `Add ${fieldLabels[field]}.`);
      });
    }
  });

  if (options.requireComplete && !rows.some(rowHasData)) {
    firstError = "Add at least one ticket row before submitting.";
  }

  state.rowErrors = rowErrors;
  state.sheetError = firstError;

  if (firstError) {
    if (state.selectedFile) state.selectedFile.rows = rows.length ? rows : [rowTemplate()];
    render();
    throw createValidationError(firstError);
  }

  clearSheetValidation();
}

async function openFile(id) {
  try {
    const data = await api(`/api/files/${encodeURIComponent(id)}`);
    state.selectedFile = data.file;
    clearSheetValidation();
    state.reviewError = "";
    state.view = "files";
    render();
  } catch (error) {
    showNotice(error.message, "error");
  }
}

async function saveSelectedFile(status) {
  if (!state.selectedFile) return;
  const action = status === "submitted" ? "submit" : "save";
  try {
    const rows = collectRows();
    state.selectedFile.rows = rows.length ? rows : [rowTemplate()];
    state.selectedFile.weekStart = document.getElementById("editor-week")?.value || state.selectedFile.weekStart;
    validateRows(rows, { requireComplete: status === "submitted" });
    const payload = {
      weekStart: state.selectedFile.weekStart,
      rows
    };
    if (status) payload.status = status;
    setAction(action);
    const data = await api(`/api/files/${encodeURIComponent(state.selectedFile.id)}`, { method: "PATCH", body: payload });
    state.selectedFile = data.file;
    await refreshRoleData();
    clearSheetValidation();
    showNotice(status === "submitted" ? "File submitted." : "File saved.");
  } catch (error) {
    if (!error.isValidationError) showNotice(error.message, "error");
  } finally {
    if (state.busyAction === action) clearAction();
  }
}

async function createFile(body) {
  const data = await api("/api/files", { method: "POST", body: { rows: [rowTemplate()], ...body } });
  state.selectedFile = data.file;
  clearSheetValidation();
  state.reviewError = "";
  state.view = "files";
  await refreshRoleData();
  showNotice("File created.");
}

async function deleteFile(id) {
  if (!window.confirm("Delete this draft?")) return;
  try {
    setAction("delete");
    await api(`/api/files/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (state.selectedFile?.id === id) state.selectedFile = null;
    await refreshRoleData();
    showNotice("Draft deleted.");
  } catch (error) {
    showNotice(error.message, "error");
  } finally {
    if (state.busyAction === "delete") clearAction();
  }
}

async function flagFile(id) {
  try {
    const reviewNote = document.getElementById("review-note")?.value || "";
    if (!reviewNote.trim()) {
      state.reviewError = "Add a review note before flagging.";
      render();
      document.getElementById("review-note")?.focus();
      return;
    }
    state.reviewError = "";
    if (state.selectedFile?.id === id) state.selectedFile.reviewNote = reviewNote.trim();
    setAction("flag");
    const data = await api(`/api/files/${encodeURIComponent(id)}/flag`, { method: "POST", body: { reviewNote } });
    state.selectedFile = data.file;
    await refreshRoleData();
    showNotice("File flagged for review.");
  } catch (error) {
    showNotice(error.message, "error");
  } finally {
    if (state.busyAction === "flag") clearAction();
  }
}

async function savePersonalProfile(formEl) {
  const form = new FormData(formEl);
  const displayName = String(form.get("displayName") || "").trim();
  state.settingsErrors = {};
  if (displayName.length < 2) {
    state.settingsErrors.displayName = "Enter at least 2 characters.";
    render();
    document.querySelector('[name="displayName"]')?.focus();
    return;
  }

  state.savingProfileSection = "personal";
  render();
  try {
    const data = await api("/api/me/profile", {
      method: "PUT",
      body: {
        displayName,
        phone: form.get("phone"),
        emergencyContact: form.get("emergencyContact"),
        preferredUnits: form.get("preferredUnits")
      }
    });
    state.user = data.user;
    state.settingsErrors = {};
    showNotice("Personal profile saved.");
  } catch (error) {
    showNotice(error.message, "error");
  } finally {
    state.savingProfileSection = "";
    render();
  }
}

async function saveEmploymentProfile(formEl) {
  const employee = selectedProfileEmployee();
  if (!employee) return;

  const form = new FormData(formEl);
  const name = String(form.get("name") || "").trim();
  state.settingsErrors = {};
  if (name.length < 2) {
    state.settingsErrors.employeeName = "Enter at least 2 characters.";
    render();
    document.querySelector('[name="name"]')?.focus();
    return;
  }

  state.savingProfileSection = "employment";
  render();
  try {
    const data = await api(`/api/manager/employees/${encodeURIComponent(employee.id)}/profile`, {
      method: "PUT",
      body: {
        name,
        employeeCode: form.get("employeeCode"),
        truckNumber: form.get("truckNumber"),
        defaultDestinations: form.get("defaultDestinations"),
        employmentStatus: form.get("employmentStatus"),
        managementNotes: form.get("managementNotes")
      }
    });
    state.selectedProfileEmployeeId = data.employee.id;
    await refreshRoleData();
    state.settingsErrors = {};
    showNotice("Employment details saved.");
  } catch (error) {
    showNotice(error.message, "error");
  } finally {
    state.savingProfileSection = "";
    render();
  }
}

function closePasswordPane() {
  state.passwordPaneOpen = false;
  state.settingsErrors = {};
  render();
}

function focusPasswordField(name) {
  document.querySelector(`#password-change-form [name="${name}"]`)?.focus();
}

function firstPasswordErrorField(errors) {
  return ["oldPassword", "newPassword", "confirmPassword"].find((field) => errors[field]);
}

async function changePassword(formEl) {
  const form = new FormData(formEl);
  const oldPassword = String(form.get("oldPassword") || "");
  const newPassword = String(form.get("newPassword") || "");
  const confirmPassword = String(form.get("confirmPassword") || "");
  const errors = {};

  if (!oldPassword.trim()) errors.oldPassword = "Enter Your Old Password.";
  if (newPassword.length < 6) errors.newPassword = "Use at least 6 characters.";
  if (newPassword.length > 128) errors.newPassword = "Use 128 characters or fewer.";
  if (!confirmPassword) {
    errors.confirmPassword = "Re-Enter Your New Password.";
  } else if (newPassword !== confirmPassword) {
    errors.confirmPassword = "New passwords do not match.";
  }

  state.settingsErrors = errors;
  if (Object.keys(errors).length) {
    render();
    focusPasswordField(firstPasswordErrorField(errors));
    return;
  }

  setFormPending(formEl, true, "Updating...");
  try {
    await api("/api/me/password", {
      method: "PUT",
      body: { oldPassword, newPassword, confirmPassword }
    });
    state.passwordPaneOpen = false;
    state.settingsErrors = {};
    render();
    showNotice("Password changed.");
  } catch (error) {
    if (error.status === 401) {
      state.settingsErrors = { oldPassword: error.message };
      render();
      focusPasswordField("oldPassword");
      return;
    }
    if (error.status === 400 && error.message.includes("match")) {
      state.settingsErrors = { confirmPassword: error.message };
      render();
      focusPasswordField("confirmPassword");
      return;
    }
    if (error.status === 400 && error.message.includes("Password")) {
      state.settingsErrors = { newPassword: error.message };
      render();
      focusPasswordField("newPassword");
      return;
    }
    showNotice(error.message, "error");
  } finally {
    if (document.body.contains(formEl)) setFormPending(formEl, false);
  }
}

async function updateBusiness(formEl) {
  const businessId = formEl.dataset.businessId;
  const form = new FormData(formEl);
  setFormPending(formEl, true, "Saving...");
  try {
    await api(`/api/admin/businesses/${encodeURIComponent(businessId)}`, {
      method: "PUT",
      body: { name: form.get("name") }
    });
    state.editingBusinessId = "";
    await refreshRoleData();
    showNotice("Business updated.");
  } catch (error) {
    showNotice(error.message, "error");
  } finally {
    setFormPending(formEl, false);
  }
}

function bindCommonEvents() {
  document.querySelectorAll('[data-action="nav"]').forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      if (state.view !== "files") state.selectedFile = null;
      state.editingBusinessId = "";
      state.passwordPaneOpen = false;
      state.settingsErrors = {};
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
    state.selectedProfileEmployeeId = "";
    state.savingProfileSection = "";
    state.settingsErrors = {};
    state.passwordPaneOpen = false;
    state.editingBusinessId = "";
    state.view = null;
    render();
  });

  document.querySelector('[data-action="open-password-pane"]')?.addEventListener("click", () => {
    state.passwordPaneOpen = true;
    state.settingsErrors = {};
    render();
    focusPasswordField("oldPassword");
  });

  document.querySelectorAll('[data-action="close-password-pane"]').forEach((element) => {
    element.addEventListener("click", (event) => {
      if (event.currentTarget.classList.contains("modal-backdrop") && event.target !== event.currentTarget) return;
      closePasswordPane();
    });
  });

  document.getElementById("password-change-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    changePassword(event.currentTarget);
  });

  document.getElementById("theme-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setTheme(String(form.get("theme") || "system"));
  });

  document.getElementById("personal-profile-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    savePersonalProfile(event.currentTarget);
  });

  document.getElementById("employment-profile-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    saveEmploymentProfile(event.currentTarget);
  });

  document.getElementById("profile-employee-select")?.addEventListener("change", (event) => {
    state.selectedProfileEmployeeId = event.currentTarget.value;
    state.settingsErrors = {};
    render();
  });
}

function bindAdminEvents() {
  document.getElementById("business-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    setFormPending(formEl, true, "Creating...");
    try {
      await api("/api/admin/businesses", { method: "POST", body: { name: form.get("name") } });
      formEl.reset();
      state.editingBusinessId = "";
      await refreshRoleData();
      showNotice("Business created.");
    } catch (error) {
      showNotice(error.message, "error");
    } finally {
      setFormPending(formEl, false);
    }
  });

  document.querySelectorAll(".business-edit-form").forEach((formEl) => {
    formEl.addEventListener("submit", (event) => {
      event.preventDefault();
      updateBusiness(event.currentTarget);
    });
  });

  document.querySelectorAll('[data-action="edit-business"]').forEach((button) => {
    button.addEventListener("click", () => {
      state.editingBusinessId = button.dataset.id;
      render();
      document.querySelector(".business-edit-form .input")?.focus();
    });
  });

  document.querySelectorAll('[data-action="cancel-business-edit"]').forEach((button) => {
    button.addEventListener("click", () => {
      state.editingBusinessId = "";
      render();
    });
  });

  document.getElementById("manager-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    setFormPending(formEl, true, "Creating...");
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
    } finally {
      setFormPending(formEl, false);
    }
  });
}

function bindManagerEvents() {
  document.getElementById("employee-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    setFormPending(formEl, true, "Creating...");
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
    } finally {
      setFormPending(formEl, false);
    }
  });

  document.getElementById("new-file-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    setFormPending(formEl, true, "Creating...");
    try {
      await createFile({ employeeId: form.get("employeeId"), weekStart: form.get("weekStart") });
    } catch (error) {
      showNotice(error.message, "error");
    } finally {
      setFormPending(formEl, false);
    }
  });

  document.getElementById("destination-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    setFormPending(formEl, true, "Adding...");
    try {
      await api("/api/manager/destinations", { method: "POST", body: { name: form.get("name") } });
      formEl.reset();
      await refreshRoleData();
      showNotice("Destination added.");
    } catch (error) {
      showNotice(error.message, "error");
    } finally {
      setFormPending(formEl, false);
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
    setFormPending(formEl, true, "Creating...");
    try {
      await createFile({ weekStart: form.get("weekStart") });
    } catch (error) {
      showNotice(error.message, "error");
    } finally {
      setFormPending(formEl, false);
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

  const editorWeekInput = document.getElementById("editor-week");
  if (editorWeekInput) {
    editorWeekInput.addEventListener("change", () => {
      const weekDisplay = document.getElementById("week-display");
      if (weekDisplay) {
        weekDisplay.textContent = formatWeekRange(editorWeekInput.value);
      }
    });
  }

  document.querySelectorAll(".sheet-input").forEach((input) => {
    input.addEventListener("input", () => {
      const rows = [...document.querySelectorAll(".sheet-row")];
      const index = rows.indexOf(input.closest(".sheet-row"));
      delete state.rowErrors[errorKey(index, input.name)];
      input.classList.remove("invalid");
      input.setAttribute("aria-invalid", "false");
      input.removeAttribute("aria-describedby");
      input.parentElement.querySelector(".compact-error")?.remove();
      if (!Object.keys(state.rowErrors).length) {
        state.sheetError = "";
        document.querySelector(".sheet-error-banner")?.remove();
      }
    });
  });

  document.querySelector('[data-action="add-row"]')?.addEventListener("click", () => {
    state.selectedFile.rows = collectRows();
    state.selectedFile.rows.push(rowTemplate());
    clearSheetValidation();
    render();
  });

  document.querySelectorAll('[data-action="remove-row"]').forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.index);
      const rows = collectRows();
      rows.splice(index, 1);
      state.selectedFile.rows = rows.length ? rows : [rowTemplate()];
      clearSheetValidation();
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
