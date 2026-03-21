/* ═══════════════════════════════════════════════════════════════════
   CHANN THIV SETTLEMENT — AUTH MODULE v2.0
   js/auth.js

   ✓ Login / logout / session management
   ✓ isLoggedIn(), seedDefaultAdmin() for login.html compatibility
   ✓ RBAC: admin, operator, viewer, auditor
   ✓ User CRUD with audit fields (created_by, created_date, updated_by, updated_date)
   ✓ Role CRUD
   ✓ Password change, reset, strength check
   ✓ Soft delete (audit trail preserved)
═══════════════════════════════════════════════════════════════════ */

const AUTH_SUPABASE_URL      = 'https://zsmtqxexroyxhgcknnbi.supabase.co';
const AUTH_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpzbXRxeGV4cm95eGhnY2tubmJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0NzgxMzMsImV4cCI6MjA4OTA1NDEzM30.rjmD14CyEbc_ECXGDfmI4hfJb_vCXadxiUeeg9icElU';
const SESSION_KEY = 'ct_session_v2';

async function _af(path, opts = {}) {
  const res = await fetch(AUTH_SUPABASE_URL + path, {
    ...opts,
    headers: {
      'Content-Type' : 'application/json',
      'apikey'       : AUTH_SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + AUTH_SUPABASE_ANON_KEY,
      'Prefer'       : 'return=representation',
      ...(opts.headers || {})
    }
  });
  if (res.status === 204) return null;
  const d = await res.json();
  if (!res.ok) throw new Error(d?.message || d?.error || 'HTTP ' + res.status);
  return d;
}

async function _hash(plain) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(plain));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

function _tmpPw() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#!';
  return Array.from({length:12}, () => c[Math.floor(Math.random()*c.length)]).join('');
}

function _uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random()*16|0;
    return (c==='x' ? r : (r&0x3|0x8)).toString(16);
  });
}

const Auth = {

  getSession() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)) || null; }
    catch { return null; }
  },

  isLoggedIn() { return !!this.getSession(); },

  _save(user) {
    const s = { id: user.id, username: user.username, fullName: user.full_name, role: user.role, email: user.email || '' };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    return s;
  },

  requireLogin()   { if (!this.getSession()) window.location.href = 'login.html'; },
  requireAdmin()   { const s=this.getSession(); if(!s){window.location.href='login.html';return;} if(s.role!=='admin') window.location.href='index.html'; },
  requireRole(...roles) { const s=this.getSession(); if(!s){window.location.href='login.html';return;} if(!roles.includes(s.role)) window.location.href='index.html'; },
  logout()         { sessionStorage.removeItem(SESSION_KEY); window.location.href='login.html'; },
  isConfigured()   { return AUTH_SUPABASE_URL.includes('supabase.co') && !AUTH_SUPABASE_ANON_KEY.includes('YOUR_ANON'); },

  async seedDefaultAdmin() {
    try {
      if (!this.isConfigured()) return;
      const ex = await _af('/rest/v1/app_users?role=eq.admin&limit=1&select=id');
      if (ex && ex.length > 0) return;
      await this.createUser({ username:'admin', fullName:'System Administrator', email:'admin@system.local', role:'admin', password:'Admin@1234', createdBy:'SYSTEM' });
    } catch(e) { console.warn('[Auth] seed failed:', e.message); }
  },

  async login(username, password) {
    try {
      if (!this.isConfigured()) return { ok:false, error:'Database not configured. Edit js/auth.js with your Supabase credentials.' };
      const hash  = await _hash(password);
      const users = await _af('/rest/v1/app_users?username=eq.'+encodeURIComponent(username.toLowerCase().trim())+'&is_active=eq.true&deleted_at=is.null&select=*');
      if (!users || users.length===0) return { ok:false, error:'Invalid username or password' };
      const user = users[0];
      if (user.password_hash !== hash) return { ok:false, error:'Invalid username or password' };
      _af('/rest/v1/app_users?id=eq.'+user.id, { method:'PATCH', body:JSON.stringify({last_login:new Date().toISOString()}), headers:{'Prefer':'return=minimal'} }).catch(()=>{});
      return { ok:true, session: this._save(user) };
    } catch(err) { return { ok:false, error:err.message }; }
  },

  async getUsers()  { return _af('/rest/v1/app_users?deleted_at=is.null&select=*&order=created_date.desc'); },
  async getRoles()  { return _af('/rest/v1/app_roles?select=*&order=role_name.asc'); },

  async createUser({ username, fullName, email, role, password, createdBy }) {
    try {
      const ex = await _af('/rest/v1/app_users?username=eq.'+encodeURIComponent(username.toLowerCase().trim())+'&select=id');
      if (ex && ex.length>0) return { ok:false, error:'Username already exists' };
      const hash=await _hash(password), s=this.getSession(), now=new Date().toISOString();
      await _af('/rest/v1/app_users', { method:'POST', body:JSON.stringify({ id:_uuid(), username:username.toLowerCase().trim(), full_name:fullName.trim(), email:(email||'').trim().toLowerCase(), role, password_hash:hash, is_active:true, created_by:createdBy||(s?.username||'system'), created_date:now, updated_by:createdBy||(s?.username||'system'), updated_date:now }), headers:{'Prefer':'return=minimal'} });
      return { ok:true };
    } catch(err) { return { ok:false, error:err.message }; }
  },

  async updateUser(id, { fullName, email, role }) {
    try {
      const s=this.getSession(), now=new Date().toISOString();
      const updates = { updated_by:s?.username||'system', updated_date:now };
      if (fullName!==undefined) updates.full_name=fullName.trim();
      if (email!==undefined)    updates.email=email.trim().toLowerCase();
      if (role!==undefined)     updates.role=role;
      await _af('/rest/v1/app_users?id=eq.'+id, { method:'PATCH', body:JSON.stringify(updates), headers:{'Prefer':'return=minimal'} });
      const sess=this.getSession();
      if(sess&&sess.id===id){ if(updates.full_name)sess.fullName=updates.full_name; if(updates.role)sess.role=updates.role; sessionStorage.setItem(SESSION_KEY,JSON.stringify(sess)); }
      return { ok:true };
    } catch(err) { return { ok:false, error:err.message }; }
  },

  async deleteUser(id) {
    try {
      const s=this.getSession();
      await _af('/rest/v1/app_users?id=eq.'+id, { method:'PATCH', body:JSON.stringify({ is_active:false, deleted_at:new Date().toISOString(), updated_by:s?.username||'system', updated_date:new Date().toISOString() }), headers:{'Prefer':'return=minimal'} });
      return { ok:true };
    } catch(err) { return { ok:false, error:err.message }; }
  },

  async setUserActive(id, isActive) {
    try {
      const s=this.getSession();
      await _af('/rest/v1/app_users?id=eq.'+id, { method:'PATCH', body:JSON.stringify({ is_active:isActive, updated_by:s?.username||'system', updated_date:new Date().toISOString() }), headers:{'Prefer':'return=minimal'} });
      return { ok:true };
    } catch(err) { return { ok:false, error:err.message }; }
  },

  async changePassword(id, newPassword) {
    try {
      if (!newPassword||newPassword.length<8) return { ok:false, error:'Password must be at least 8 characters' };
      const s=this.getSession(), hash=await _hash(newPassword);
      await _af('/rest/v1/app_users?id=eq.'+id, { method:'PATCH', body:JSON.stringify({ password_hash:hash, updated_by:s?.username||'system', updated_date:new Date().toISOString() }), headers:{'Prefer':'return=minimal'} });
      return { ok:true };
    } catch(err) { return { ok:false, error:err.message }; }
  },

  async resetPassword(id) {
    const tp=_tmpPw(), r=await this.changePassword(id,tp);
    return r.ok ? { ok:true, tempPw:tp } : r;
  },

  async createRole({ roleName, description }) {
    try {
      const s=this.getSession();
      await _af('/rest/v1/app_roles', { method:'POST', body:JSON.stringify({ id:_uuid(), role_name:roleName.trim().toLowerCase(), description:(description||'').trim(), created_by:s?.username||'system', created_date:new Date().toISOString() }), headers:{'Prefer':'return=minimal'} });
      return { ok:true };
    } catch(err) { return { ok:false, error:err.message }; }
  },

  async updateRole(id, { roleName, description }) {
    try {
      const s=this.getSession();
      await _af('/rest/v1/app_roles?id=eq.'+id, { method:'PATCH', body:JSON.stringify({ role_name:roleName.trim().toLowerCase(), description:(description||'').trim(), updated_by:s?.username||'system', updated_date:new Date().toISOString() }), headers:{'Prefer':'return=minimal'} });
      return { ok:true };
    } catch(err) { return { ok:false, error:err.message }; }
  },

  async deleteRole(id) {
    try {
      await _af('/rest/v1/app_roles?id=eq.'+id, { method:'DELETE', headers:{'Prefer':'return=minimal'} });
      return { ok:true };
    } catch(err) { return { ok:false, error:err.message }; }
  }
};
