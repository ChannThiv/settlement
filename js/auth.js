/* ═══════════════════════════════════════════════════════════════════
   CHANN THIV SETTLEMENT — AUTH MODULE
   js/auth.js  |  v2.1

   Handles all authentication, session management, and user/role CRUD.
   Depends on: nothing (loads first)

   Public API:
     Auth.login(username, password)     → { ok, session?, error? }
     Auth.logout()
     Auth.isLoggedIn()                  → boolean
     Auth.getSession()                  → { id, username, fullName, role } | null
     Auth.requireLogin()                — redirects to login.html if no session
     Auth.requireAdmin()                — redirects if not admin
     Auth.isConfigured()                → boolean
     Auth.seedDefaultAdmin()            — idempotent; creates admin if none exists

     Auth.getUsers()                    → User[]
     Auth.createUser(opts)              → { ok, error? }
     Auth.updateUser(id, opts)          → { ok, error? }
     Auth.deleteUser(id)                → { ok, error? }
     Auth.setUserActive(id, bool)       → { ok, error? }
     Auth.changePassword(id, pw)        → { ok, error? }

     Auth.getRoles()                    → Role[]
     Auth.createRole(opts)              → { ok, error? }
     Auth.updateRole(id, opts)          → { ok, error? }
     Auth.deleteRole(id)                → { ok, error? }
═══════════════════════════════════════════════════════════════════ */

/* ── Configuration ──────────────────────────────────────────────── */
const AUTH_URL = 'https://zsmtqxexroyxhgcknnbi.supabase.co';
const AUTH_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpzbXRxeGV4cm95eGhnY2tubmJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0NzgxMzMsImV4cCI6MjA4OTA1NDEzM30.rjmD14CyEbc_ECXGDfmI4hfJb_vCXadxiUeeg9icElU';
const SESSION_KEY = 'ct_session_v2';

/* ── Private helpers ────────────────────────────────────────────── */

/** Supabase REST fetch wrapper */
async function _fetch(path, opts = {}) {
  const res = await fetch(AUTH_URL + path, {
    ...opts,
    headers: {
      'Content-Type' : 'application/json',
      'apikey'       : AUTH_KEY,
      'Authorization': 'Bearer ' + AUTH_KEY,
      'Prefer'       : 'return=representation',
      ...(opts.headers || {})
    }
  });
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text || !text.trim()) return null;
  let data;
  try { data = JSON.parse(text); } catch(e) { if (!res.ok) throw new Error('HTTP ' + res.status); return null; }
  if (!res.ok) throw new Error(data?.message || data?.error || 'HTTP ' + res.status);
  return data;
}

/** SHA-256 password hash (browser crypto) */
async function _hash(plain) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(plain));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Generate UUID v4 */
function _uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

/** Generate readable temporary password */
function _tmpPw() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#!';
  return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

/* ── Auth public API ────────────────────────────────────────────── */

const Auth = {

  /* ── Session management ───────────────────────────────────────── */

  getSession() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)) || null; }
    catch { return null; }
  },

  isLoggedIn() {
    return !!this.getSession();
  },

  isConfigured() {
    return AUTH_URL.includes('supabase.co') && !AUTH_KEY.includes('YOUR_ANON');
  },

  _saveSession(user) {
    const s = {
      id      : user.id,
      username: user.username,
      fullName: user.full_name,
      role    : user.role,
      email   : user.email || ''
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    return s;
  },

  /** Redirect to login.html if no valid session */
  requireLogin() {
    if (!this.getSession()) window.location.href = 'login.html';
  },

  /** Redirect to index.html if not admin */
  requireAdmin() {
    const s = this.getSession();
    if (!s) { window.location.href = 'login.html'; return; }
    if (s.role !== 'admin') window.location.href = 'index.html';
  },

  requireRole(...roles) {
    const s = this.getSession();
    if (!s) { window.location.href = 'login.html'; return; }
    if (!roles.includes(s.role)) window.location.href = 'index.html';
  },

  logout() {
    sessionStorage.removeItem(SESSION_KEY);
    window.location.href = 'login.html';
  },

  /* ── Authentication ───────────────────────────────────────────── */

  async login(username, password) {
    try {
      if (!this.isConfigured()) {
        return { ok: false, error: 'Database not configured. Edit js/auth.js.' };
      }

      const hash  = await _hash(password);
      const users = await _fetch(
        '/rest/v1/app_users'
        + '?username=eq.' + encodeURIComponent(username.toLowerCase().trim())
        + '&is_active=eq.true&deleted_at=is.null&select=*'
      );

      if (!users || users.length === 0) return { ok: false, error: 'Invalid username or password' };

      const user = users[0];
      if (user.password_hash !== hash) return { ok: false, error: 'Invalid username or password' };

      // Update last_login asynchronously — don't block the response
      _fetch('/rest/v1/app_users?id=eq.' + user.id, {
        method : 'PATCH',
        body   : JSON.stringify({ last_login: new Date().toISOString() }),
        headers: { 'Prefer': 'return=minimal' }
      }).catch(() => {});

      return { ok: true, session: this._saveSession(user) };

    } catch (err) {
      return { ok: false, error: err.message };
    }
  },

  /* ── Seed default admin (idempotent) ──────────────────────────── */

  async seedDefaultAdmin() {
    try {
      if (!this.isConfigured()) return;
      const admins = await _fetch('/rest/v1/app_users?role=eq.admin&limit=1&select=id');
      if (admins && admins.length > 0) return;
      await this.createUser({
        username  : 'admin',
        fullName  : 'System Administrator',
        email     : 'admin@system.local',
        role      : 'admin',
        password  : 'Admin@1234',
        createdBy : 'SYSTEM'
      });
    } catch (e) {
      console.warn('[Auth] seed failed:', e.message);
    }
  },

  /* ── User CRUD ────────────────────────────────────────────────── */

  async getUsers() {
    return _fetch('/rest/v1/app_users?deleted_at=is.null&select=*&order=created_date.desc');
  },

  async createUser({ username, fullName, email, role, password, createdBy }) {
    try {
      const existing = await _fetch(
        '/rest/v1/app_users?username=eq.' + encodeURIComponent(username.toLowerCase().trim()) + '&select=id'
      );
      if (existing && existing.length > 0) return { ok: false, error: 'Username already exists' };

      const s   = this.getSession();
      const now = new Date().toISOString();
      const by  = createdBy || s?.username || 'system';

      await _fetch('/rest/v1/app_users', {
        method : 'POST',
        headers: { 'Prefer': 'return=minimal' },
        body   : JSON.stringify({
          id           : _uuid(),
          username     : username.toLowerCase().trim(),
          full_name    : fullName.trim(),
          email        : (email || '').trim().toLowerCase(),
          role,
          password_hash: await _hash(password),
          is_active    : true,
          created_by   : by,
          created_date : now,
          updated_by   : by,
          updated_date : now
        })
      });

      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },

  async updateUser(id, { fullName, email, role }) {
    try {
      const s   = this.getSession();
      const now = new Date().toISOString();
      const updates = { updated_by: s?.username || 'system', updated_date: now };

      if (fullName !== undefined) updates.full_name = fullName.trim();
      if (email    !== undefined) updates.email     = email.trim().toLowerCase();
      if (role     !== undefined) updates.role      = role;

      await _fetch('/rest/v1/app_users?id=eq.' + id, {
        method : 'PATCH',
        headers: { 'Prefer': 'return=minimal' },
        body   : JSON.stringify(updates)
      });

      // Update local session if editing self
      const sess = this.getSession();
      if (sess && sess.id === id) {
        if (updates.full_name) sess.fullName = updates.full_name;
        if (updates.role)      sess.role     = updates.role;
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(sess));
      }

      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },

  async deleteUser(id) {
    try {
      const s = this.getSession();
      await _fetch('/rest/v1/app_users?id=eq.' + id, {
        method : 'PATCH',
        headers: { 'Prefer': 'return=minimal' },
        body   : JSON.stringify({
          is_active   : false,
          deleted_at  : new Date().toISOString(),
          updated_by  : s?.username || 'system',
          updated_date: new Date().toISOString()
        })
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },

  async setUserActive(id, isActive) {
    try {
      const s = this.getSession();
      await _fetch('/rest/v1/app_users?id=eq.' + id, {
        method : 'PATCH',
        headers: { 'Prefer': 'return=minimal' },
        body   : JSON.stringify({
          is_active   : isActive,
          updated_by  : s?.username || 'system',
          updated_date: new Date().toISOString()
        })
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },

  async changePassword(id, newPassword) {
    try {
      if (!newPassword || newPassword.length < 8) {
        return { ok: false, error: 'Password must be at least 8 characters' };
      }
      const s = this.getSession();
      await _fetch('/rest/v1/app_users?id=eq.' + id, {
        method : 'PATCH',
        headers: { 'Prefer': 'return=minimal' },
        body   : JSON.stringify({
          password_hash: await _hash(newPassword),
          updated_by   : s?.username || 'system',
          updated_date : new Date().toISOString()
        })
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },

  /** Generate and apply a random temporary password */
  async resetPassword(id) {
    const tp = _tmpPw();
    const r  = await this.changePassword(id, tp);
    return r.ok ? { ok: true, tempPw: tp } : r;
  },

  /* ── Role CRUD ────────────────────────────────────────────────── */

  async getRoles() {
    return _fetch('/rest/v1/app_roles?select=*&order=role_name.asc');
  },

  async createRole({ roleName, description }) {
    try {
      const s = this.getSession();
      await _fetch('/rest/v1/app_roles', {
        method : 'POST',
        headers: { 'Prefer': 'return=minimal' },
        body   : JSON.stringify({
          id          : _uuid(),
          role_name   : roleName.trim().toLowerCase(),
          description : (description || '').trim(),
          created_by  : s?.username || 'system',
          created_date: new Date().toISOString()
        })
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },

  async updateRole(id, { roleName, description }) {
    try {
      const s = this.getSession();
      await _fetch('/rest/v1/app_roles?id=eq.' + id, {
        method : 'PATCH',
        headers: { 'Prefer': 'return=minimal' },
        body   : JSON.stringify({
          role_name   : roleName.trim().toLowerCase(),
          description : (description || '').trim(),
          updated_by  : s?.username || 'system',
          updated_date: new Date().toISOString()
        })
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },

  async deleteRole(id) {
    try {
      await _fetch('/rest/v1/app_roles?id=eq.' + id, {
        method : 'DELETE',
        headers: { 'Prefer': 'return=minimal' }
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
};