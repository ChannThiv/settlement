/* ═══════════════════════════════════════════════════════════════════
   IFD FILE PARSER SYSTEM — AUTH MODULE
   js/auth.js

   Handles:
   - Session storage (sessionStorage — clears on tab close)
   - Login / logout
   - Route guard (redirect to login if not authenticated)
   - Default admin seed on first run
═══════════════════════════════════════════════════════════════════ */

const AUTH_SESSION_KEY = 'ifd_session';
const USERS_STORE_KEY  = 'ifd_users';

/* ─── PASSWORD HASHING ──────────────────────────────────────────────
   Simple deterministic hash (djb2) — suitable for a local/intranet
   tool. Replace with bcrypt via Web Crypto API for production use.
─────────────────────────────────────────────────────────────────── */
function hashPassword(password) {
  let hash = 5381;
  for (let i = 0; i < password.length; i++) {
    hash = ((hash << 5) + hash) ^ password.charCodeAt(i);
    hash = hash & 0xFFFFFFFF; // keep 32-bit
  }
  return 'h' + Math.abs(hash).toString(16).padStart(8, '0');
}

/* ─── USER STORE ────────────────────────────────────────────────────
   All users stored in localStorage as JSON array.
   Schema per user:
   {
     id        : string (uuid-like)
     username  : string (unique, lowercase)
     fullName  : string
     role      : 'admin' | 'user'
     password  : string (hashed)
     createdAt : ISO date string
     lastLogin : ISO date string | null
     active    : boolean
   }
─────────────────────────────────────────────────────────────────── */
function loadUsers() {
  try {
    return JSON.parse(localStorage.getItem(USERS_STORE_KEY)) || [];
  } catch { return []; }
}

function saveUsers(users) {
  localStorage.setItem(USERS_STORE_KEY, JSON.stringify(users));
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* Seed default admin on first run */
function seedDefaultAdmin() {
  const users = loadUsers();
  if (users.length === 0) {
    users.push({
      id        : generateId(),
      username  : 'admin',
      fullName  : 'System Administrator',
      role      : 'admin',
      password  : hashPassword('Admin@1234'),
      createdAt : new Date().toISOString(),
      lastLogin : null,
      active    : true
    });
    saveUsers(users);
  }
}

/* ─── SESSION ───────────────────────────────────────────────────────
   Session is stored in sessionStorage (auto-clears on tab/browser close).
─────────────────────────────────────────────────────────────────── */
function getSession() {
  try {
    return JSON.parse(sessionStorage.getItem(AUTH_SESSION_KEY));
  } catch { return null; }
}

function setSession(user) {
  sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({
    id       : user.id,
    username : user.username,
    fullName : user.fullName,
    role     : user.role,
    loginAt  : new Date().toISOString()
  }));
}

function clearSession() {
  sessionStorage.removeItem(AUTH_SESSION_KEY);
}

function isLoggedIn() {
  return !!getSession();
}

/* ─── ROUTE GUARD ───────────────────────────────────────────────────
   Call requireAuth() at the top of any protected page.
   Call requireAdmin() for admin-only pages.
─────────────────────────────────────────────────────────────────── */
function requireAuth() {
  seedDefaultAdmin();
  if (!isLoggedIn()) {
    window.location.href = 'login.html';
    return false;
  }
  return true;
}

function requireAdmin() {
  if (!requireAuth()) return false;
  const session = getSession();
  if (session.role !== 'admin') {
    window.location.href = 'index.html';
    return false;
  }
  return true;
}

/* ─── LOGIN / LOGOUT ────────────────────────────────────────────── */
function login(username, password) {
  const users = loadUsers();
  const user  = users.find(u =>
    u.username === username.trim().toLowerCase() &&
    u.password === hashPassword(password) &&
    u.active   === true
  );
  if (!user) return { ok: false, error: 'Invalid username or password.' };

  // Update lastLogin
  user.lastLogin = new Date().toISOString();
  saveUsers(users);
  setSession(user);
  return { ok: true, user };
}

function logout() {
  clearSession();
  window.location.href = 'login.html';
}

/* ─── EXPOSE GLOBALLY ──────────────────────────────────────────── */
window.Auth = {
  login, logout, requireAuth, requireAdmin,
  getSession, isLoggedIn,
  loadUsers, saveUsers, hashPassword, generateId, seedDefaultAdmin
};
