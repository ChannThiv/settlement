/* ═══════════════════════════════════════════════════════════════════
   IFD FILE PARSER SYSTEM — AUTH MODULE (Supabase Edition)
   js/auth.js

   Replaces the old localStorage-based Auth system.
   All users are now stored in Supabase:
     - auth.users_app  → custom user profiles (username, role, status)
     - Uses Supabase Auth (email/password) for login sessions

   PUBLIC API  (same interface as old auth.js so other pages don't break):
     Auth.login(username, password)   → { ok, error }
     Auth.logout()
     Auth.getSession()                → { id, username, fullName, role } | null
     Auth.requireAdmin()              → redirects if not admin
     Auth.requireLogin()              → redirects if not logged in

   USER CRUD (new — for user-management.html):
     Auth.getUsers()                  → Promise<user[]>
     Auth.createUser(data)            → Promise<{ ok, error }>
     Auth.updateUser(id, data)        → Promise<{ ok, error }>
     Auth.deleteUser(id)              → Promise<{ ok, error }>
     Auth.setUserActive(id, bool)     → Promise<{ ok, error }>
     Auth.changePassword(id, newPw)   → Promise<{ ok, error }>
     Auth.resetPassword(id)           → Promise<{ ok, tempPw }>
═══════════════════════════════════════════════════════════════════ */

/* ─── SUPABASE CONFIG ───────────────────────────────────────────────────────
   ⚠️  REPLACE WITH YOUR OWN — same values as in db.js
─────────────────────────────────────────────────────────────────────────── */
const AUTH_SUPABASE_URL      = 'https://YOUR_PROJECT_REF.supabase.co';
const AUTH_SUPABASE_ANON_KEY = 'YOUR_ANON_PUBLIC_KEY';

/* ─── SESSION KEY ───────────────────────────────────────────────────────────
   Session stored in sessionStorage (cleared on browser close).
   Never stores password — only safe fields.
─────────────────────────────────────────────────────────────────────────── */
const SESSION_KEY = 'ifd_auth_session';

/* ─── INTERNAL HTTP HELPER ──────────────────────────────────────────────────
─────────────────────────────────────────────────────────────────────────── */
async function _authFetch(path, options = {}) {
  const res = await fetch(`${AUTH_SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type' : 'application/json',
      'apikey'       : AUTH_SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${AUTH_SUPABASE_ANON_KEY}`,
      'Prefer'       : 'return=representation',
      ...options.headers
    }
  });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
  return data;
}

/* ─── PASSWORD HELPERS ──────────────────────────────────────────────────────
   Simple SHA-256 hash — enough for this internal tool.
   For production, use bcrypt on a backend server.
─────────────────────────────────────────────────────────────────────────── */
async function _hashPassword(plain) {
  const buf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(plain));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

function _generateId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function _generateTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#!';
  return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

/* ═══════════════════════════════════════════════════════════════════
   AUTH OBJECT — public API
═══════════════════════════════════════════════════════════════════ */
const Auth = {

  /* ─── SESSION ──────────────────────────────────────────────────── */

  getSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },

  _saveSession(user) {
    const session = {
      id       : user.id,
      username : user.username,
      fullName : user.full_name,
      role     : user.role,
      email    : user.email || ''
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  },

  requireLogin() {
    if (!this.getSession()) {
      window.location.href = 'login.html';
    }
  },

  requireAdmin() {
    const s = this.getSession();
    if (!s) { window.location.href = 'login.html'; return; }
    if (s.role !== 'admin') { window.location.href = 'index.html'; }
  },

  logout() {
    sessionStorage.removeItem(SESSION_KEY);
    window.location.href = 'login.html';
  },


  /* ─── LOGIN ────────────────────────────────────────────────────── */

  async login(username, password) {
    try {
      const hash  = await _hashPassword(password);
      const users = await _authFetch(
        `/rest/v1/app_users?username=eq.${encodeURIComponent(username.toLowerCase().trim())}&is_active=eq.true&select=*`
      );

      if (!users || users.length === 0) {
        return { ok: false, error: 'Invalid username or password' };
      }

      const user = users[0];

      if (user.password_hash !== hash) {
        return { ok: false, error: 'Invalid username or password' };
      }

      // Update last login timestamp
      await _authFetch(`/rest/v1/app_users?id=eq.${user.id}`, {
        method  : 'PATCH',
        body    : JSON.stringify({ last_login: new Date().toISOString() }),
        headers : { 'Prefer': 'return=minimal' }
      });

      const session = this._saveSession(user);
      return { ok: true, session };

    } catch (err) {
      return { ok: false, error: err.message };
    }
  },


  /* ─── USER CRUD ────────────────────────────────────────────────── */

  /**
   * getUsers()
   * Returns all users from app_users table, newest first.
   */
  async getUsers() {
    return _authFetch('/rest/v1/app_users?select=*&order=created_at.desc');
  },


  /**
   * createUser({ username, fullName, role, password })
   * Inserts a new user into app_users.
   */
  async createUser({ username, fullName, role, password }) {
    try {
      // Check username uniqueness
      const existing = await _authFetch(
        `/rest/v1/app_users?username=eq.${encodeURIComponent(username.toLowerCase().trim())}&select=id`
      );
      if (existing && existing.length > 0) {
        return { ok: false, error: 'Username already exists' };
      }

      const hash = await _hashPassword(password);

      await _authFetch('/rest/v1/app_users', {
        method : 'POST',
        body   : JSON.stringify({
          id            : _generateId(),
          username      : username.toLowerCase().trim(),
          full_name     : fullName.trim(),
          role          : role,
          password_hash : hash,
          is_active     : true,
          created_at    : new Date().toISOString()
        }),
        headers: { 'Prefer': 'return=minimal' }
      });

      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },


  /**
   * updateUser(id, { fullName, role })
   * Updates name and/or role of an existing user.
   */
  async updateUser(id, { fullName, role }) {
    try {
      const updates = {};
      if (fullName !== undefined) updates.full_name = fullName.trim();
      if (role     !== undefined) updates.role      = role;
      updates.updated_at = new Date().toISOString();

      await _authFetch(`/rest/v1/app_users?id=eq.${id}`, {
        method  : 'PATCH',
        body    : JSON.stringify(updates),
        headers : { 'Prefer': 'return=minimal' }
      });

      // If updating current session user, refresh session
      const session = this.getSession();
      if (session && session.id === id) {
        session.fullName = updates.full_name || session.fullName;
        session.role     = updates.role      || session.role;
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      }

      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },


  /**
   * deleteUser(id)
   * Soft deletes by setting is_active=false and marking deleted_at.
   * Never hard-deletes for audit trail preservation.
   */
  async deleteUser(id) {
    try {
      await _authFetch(`/rest/v1/app_users?id=eq.${id}`, {
        method  : 'PATCH',
        body    : JSON.stringify({
          is_active  : false,
          deleted_at : new Date().toISOString()
        }),
        headers : { 'Prefer': 'return=minimal' }
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },


  /**
   * setUserActive(id, isActive)
   * Enable or disable a user account.
   */
  async setUserActive(id, isActive) {
    try {
      await _authFetch(`/rest/v1/app_users?id=eq.${id}`, {
        method  : 'PATCH',
        body    : JSON.stringify({
          is_active  : isActive,
          updated_at : new Date().toISOString()
        }),
        headers : { 'Prefer': 'return=minimal' }
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },


  /**
   * changePassword(id, newPassword)
   * Updates a user's password hash.
   */
  async changePassword(id, newPassword) {
    try {
      if (!newPassword || newPassword.length < 8) {
        return { ok: false, error: 'Password must be at least 8 characters' };
      }
      const hash = await _hashPassword(newPassword);
      await _authFetch(`/rest/v1/app_users?id=eq.${id}`, {
        method  : 'PATCH',
        body    : JSON.stringify({
          password_hash : hash,
          updated_at    : new Date().toISOString()
        }),
        headers : { 'Prefer': 'return=minimal' }
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },


  /**
   * resetPassword(id)
   * Generates a temporary password, saves it, and returns it for sharing.
   */
  async resetPassword(id) {
    try {
      const tempPw = _generateTempPassword();
      const result = await this.changePassword(id, tempPw);
      if (!result.ok) return result;
      return { ok: true, tempPw };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },


  /* ─── SETUP HELPERS ────────────────────────────────────────────── */

  /**
   * isConfigured()
   * Returns true if Supabase credentials have been filled in.
   */
  isConfigured() {
    return (
      AUTH_SUPABASE_URL      !== 'https://YOUR_PROJECT_REF.supabase.co' &&
      AUTH_SUPABASE_ANON_KEY !== 'sb_publishable_u3k5r8xCtireQeps4DsgRg_JgUg_LTk'
    );
  },

  /**
   * createFirstAdmin({ username, fullName, password })
   * One-time setup: creates the first admin user.
   * Call this once from browser console if no users exist yet.
   */
  async createFirstAdmin({ username, fullName, password }) {
    return this.createUser({ username, fullName, role: 'admin', password });
  }

};
