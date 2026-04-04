/* ═══════════════════════════════════════════════════════════════════
   CHANN THIV SETTLEMENT — SYSTEM DASHBOARD LOGIC
   js/system.js  |  v2.1

   Controls all UI behaviour on system.html.
   Depends on: auth.js, db.js, utils.js (load before this)
═══════════════════════════════════════════════════════════════════ */

/* ── Session guard ──────────────────────────────────────────────── */
Auth.requireLogin();
const SESSION = Auth.getSession();

/* ── Boot: populate header + sidebar ────────────────────────────── */
(function _boot() {
  // Header user badge (legacy — kept for DB badge)
  const legacyUser = document.getElementById('huser-label');
  if (legacyUser) legacyUser.textContent = SESSION.username + ' · ' + SESSION.role.toUpperCase();

  // Header profile (new top-right profile)
  const ini = (SESSION.fullName || '?')
    .split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase();
  const hdrAvatar = document.getElementById('hdr-avatar');
  const hdrName   = document.getElementById('hdr-name');
  const hdrRole   = document.getElementById('hdr-role');
  if (hdrAvatar) hdrAvatar.textContent = ini;
  if (hdrName)   hdrName.textContent   = SESSION.fullName;
  if (hdrRole)   hdrRole.textContent   = SESSION.role.toUpperCase();

  // Hide admin-only elements for non-admins
  if (SESSION.role !== 'admin') {
    ['admin-only-users', 'admin-only-roles', 'admin-only-logs',
     'dash-btn-users', 'dash-btn-logs'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  }

  _refreshDbStatus();
  loadDashboard();
})();


/* ══════════════════════════════════════════════════════════════════
   DB STATUS
══════════════════════════════════════════════════════════════════ */

function _refreshDbStatus() {
  const ok = Auth.isConfigured();
  document.getElementById('hdb-dot').style.background    = ok ? 'var(--green)' : 'var(--red)';
  document.getElementById('hdb-label').textContent       = ok ? 'DB Connected' : 'DB Offline';
  document.getElementById('sb-db-label').textContent     = ok ? 'Supabase Connected' : 'Not Configured';
  document.getElementById('badge-db').classList.toggle('online', ok);
  const sbDot = document.getElementById('sb-db-dot');
  if (sbDot) { sbDot.style.background = ok ? 'var(--green)' : 'var(--red)'; sbDot.classList.toggle('on', ok); }
}

function checkDbStatus() { _refreshDbStatus(); }


/* ══════════════════════════════════════════════════════════════════
   SIDEBAR
══════════════════════════════════════════════════════════════════ */

let _sidebarOpen = true;

function toggleSidebar() {
  _sidebarOpen = !_sidebarOpen;
  const sidebar = document.getElementById('sidebar');
  const btn     = document.getElementById('sidebar-toggle');
  sidebar.classList.toggle('collapsed', !_sidebarOpen);
  btn.textContent = _sidebarOpen ? '◀' : '▶';
  btn.style.left  = _sidebarOpen
    ? 'calc(var(--sidebar-w, 220px) - 8px)'
    : '0px';
}

function toggleDD(id) {
  document.getElementById(id)?.classList.toggle('open');
}


/* ══════════════════════════════════════════════════════════════════
   TASKBAR / TAB MANAGEMENT
══════════════════════════════════════════════════════════════════ */

const _openTabs = new Map();
let _activeTab = 'dashboard';

function openTab(pageId, label, icon, color) {
  if (_openTabs.has(pageId)) { switchTab(pageId); return; }

  const tab = document.createElement('div');
  tab.className = 'tb-tab';
  tab.dataset.page = pageId;
  tab.style.setProperty('--tc', color);
  tab.innerHTML = `
    <span style="font-size:10px">${icon}</span>
    <span class="tb-tab-label">${label}</span>
    <span class="tb-close" onclick="closeTab(event,'${pageId}')">×</span>
  `;
  tab.addEventListener('click', () => switchTab(pageId));
  document.getElementById('taskbar').appendChild(tab);
  _openTabs.set(pageId, tab);
  switchTab(pageId);
  _loadPageData(pageId);
}

function switchTab(pageId) {
  document.querySelectorAll('.tb-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.page-panel').forEach(p => p.classList.remove('active'));

  const tab   = pageId === 'dashboard'
    ? document.getElementById('tb-home')
    : _openTabs.get(pageId);
  const panel = document.getElementById('page-' + pageId);

  if (tab)   tab.classList.add('active');
  if (panel) panel.classList.add('active');
  _activeTab = pageId;
}

function closeTab(e, pageId) {
  e.stopPropagation();
  _openTabs.get(pageId)?.remove();
  _openTabs.delete(pageId);
  if (_activeTab === pageId) {
    document.querySelectorAll('.page-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tb-tab').forEach(t => t.classList.remove('active'));
    document.getElementById('page-dashboard').classList.add('active');
    document.getElementById('tb-home').classList.add('active');
    _activeTab = 'dashboard';
  }
}

function _loadPageData(pageId) {
  const loaders = {
    'user-list'     : loadUsers,
    'role-list'     : loadRoles,
    'audit-logs'    : loadLogs,
    'upload-history': loadFileHistory
  };
  loaders[pageId]?.();
}


/* ══════════════════════════════════════════════════════════════════
   DASHBOARD
══════════════════════════════════════════════════════════════════ */

async function loadDashboard() {
  try {
    const [users, roles] = await Promise.all([Auth.getUsers(), Auth.getRoles()]);
    document.getElementById('d-users').textContent = (users || []).filter(u => u.is_active).length;
    document.getElementById('d-roles').textContent = (roles || []).length;
    document.getElementById('d-files').textContent = '—';
    document.getElementById('d-txns').textContent  = '—';
  } catch (e) {
    console.warn('Dashboard load:', e.message);
  }
}


/* ══════════════════════════════════════════════════════════════════
   USER MANAGEMENT
══════════════════════════════════════════════════════════════════ */

let _allUsers  = [];
let _editUserId = null;
let _delUserId  = null;
let _resetUserId = null;
let _pwUserId   = null;
let _tmpPwStr   = '';

async function loadUsers() {
  setTableLoading('u-loading', true);
  try {
    _allUsers = await Auth.getUsers() || [];
    _filterUsers();
    _updateUserStats();
  } catch (e) {
    toast('Load users failed: ' + e.message, 'error');
  } finally {
    setTableLoading('u-loading', false);
  }
}

function _updateUserStats() {
  document.getElementById('u-stat-total').textContent  = _allUsers.length;
  document.getElementById('u-stat-active').textContent = _allUsers.filter(u => u.is_active).length;
  document.getElementById('u-stat-admin').textContent  = _allUsers.filter(u => u.role === 'admin').length;
}

function filterUsers() { _filterUsers(); }

function _filterUsers() {
  const q  = document.getElementById('u-search').value.trim().toLowerCase();
  const rf = document.getElementById('u-filter-role').value;
  const sf = document.getElementById('u-filter-status').value;

  const list = _allUsers.filter(u => {
    const mq = !q || u.username.includes(q) || (u.full_name || '').toLowerCase().includes(q) || (u.email || '').includes(q);
    const mr = !rf || u.role === rf;
    const ms = !sf || (sf === 'active' ? u.is_active : !u.is_active);
    return mq && mr && ms;
  });

  const tb = document.getElementById('u-tbody');
  if (!list.length) {
    tb.innerHTML = '<tr class="td-empty"><td colspan="9">No users found</td></tr>';
    return;
  }

  tb.innerHTML = list.map((u, i) => `
    <tr class="row-enter">
      <td style="color:var(--text-muted);font-size:10px">${i + 1}</td>
      <td class="td-primary">${escHtml(u.username)}${u.id === SESSION.id ? '<span class="self-tag">you</span>' : ''}</td>
      <td>${escHtml(u.full_name || '—')}</td>
      <td>${escHtml(u.email || '—')}</td>
      <td>${roleBadgeHtml(u.role)}</td>
      <td>${u.is_active
        ? '<span class="status-online"><span class="status-bullet" style="background:var(--green)"></span>Active</span>'
        : '<span class="status-offline"><span class="status-bullet" style="background:var(--red)"></span>Inactive</span>'}</td>
      <td>${escHtml(u.created_by || '—')}</td>
      <td>${formatDate(u.created_date)}</td>
      <td>
        <div style="display:flex;gap:4px">
          <button class="btn-sm btn-sm-cyan" onclick="openEditUser('${u.id}')">Edit</button>
          <button class="btn-sm btn-sm-gold" onclick="openChangePw('${u.id}')">Password</button>
          <button class="btn-sm btn-sm-purple" onclick="openResetPw('${u.id}')">Reset</button>
          ${u.id !== SESSION.id ? `
            <button class="btn-sm ${u.is_active ? 'btn-sm-red' : 'btn-sm-green'}" onclick="toggleUserActive('${u.id}',${!u.is_active})">${u.is_active ? 'Disable' : 'Enable'}</button>
            <button class="btn-sm btn-sm-red" onclick="openDeleteUser('${u.id}')">Delete</button>
          ` : ''}
        </div>
      </td>
    </tr>
  `).join('');
}

function openCreateUser() {
  _editUserId = null;
  document.getElementById('m-user-title').textContent = 'New User';
  document.getElementById('m-user-btn').textContent   = 'Create User';
  document.getElementById('m-uname').value             = '';
  document.getElementById('m-fullname').value          = '';
  document.getElementById('m-email').value             = '';
  document.getElementById('m-role').value              = 'viewer';
  document.getElementById('m-pw').value                = '';
  document.getElementById('m-pw-wrap').style.display   = 'block';
  applyPwBars(0, ['mpb1','mpb2','mpb3','mpb4']);
  clearErrors('m-err-uname','m-err-fullname','m-err-pw');
  openModal('m-user');
  setTimeout(() => document.getElementById('m-uname').focus(), 200);
}

function openEditUser(id) {
  const u = _allUsers.find(x => x.id === id);
  if (!u) return;
  _editUserId = id;
  document.getElementById('m-user-title').textContent = 'Edit User';
  document.getElementById('m-user-btn').textContent   = 'Save Changes';
  document.getElementById('m-uname').value             = u.username;
  document.getElementById('m-fullname').value          = u.full_name || '';
  document.getElementById('m-email').value             = u.email || '';
  document.getElementById('m-role').value              = u.role;
  document.getElementById('m-pw-wrap').style.display   = 'none';
  clearErrors('m-err-uname','m-err-fullname','m-err-pw');
  openModal('m-user');
}

async function submitUser() {
  clearErrors('m-err-uname','m-err-fullname','m-err-pw');
  const username = document.getElementById('m-uname').value.trim().toLowerCase();
  const fullName = document.getElementById('m-fullname').value.trim();
  const email    = document.getElementById('m-email').value.trim();
  const role     = document.getElementById('m-role').value;
  const pw       = document.getElementById('m-pw').value;
  let valid      = true;

  if (!username) { document.getElementById('m-err-uname').textContent = 'Username required'; valid = false; }
  if (!fullName) { document.getElementById('m-err-fullname').textContent = 'Full name required'; valid = false; }
  if (!_editUserId && !pw)      { document.getElementById('m-err-pw').textContent = 'Password required'; valid = false; }
  if (!_editUserId && pw && pw.length < 8) { document.getElementById('m-err-pw').textContent = 'Min 8 characters'; valid = false; }
  if (!valid) return;

  setBtnLoading('m-user-btn', true, _editUserId ? 'Save Changes' : 'Create User');
  const res = _editUserId
    ? await Auth.updateUser(_editUserId, { fullName, email, role })
    : await Auth.createUser({ username, fullName, email, role, password: pw });
  setBtnLoading('m-user-btn', false, _editUserId ? 'Save Changes' : 'Create User');

  if (!res.ok) {
    toast(res.error, 'error');
    if (res.error.includes('username')) document.getElementById('m-err-uname').textContent = res.error;
    return;
  }

  closeModal('m-user');
  toast(_editUserId ? '✓ User updated' : `✓ User "${username}" created`, 'success');
  await loadUsers();
}

function openChangePw(id) {
  const u = _allUsers.find(x => x.id === id);
  if (!u) return;
  _pwUserId = id;
  document.getElementById('mpw-user').value    = u.username;
  document.getElementById('mpw-new').value     = '';
  document.getElementById('mpw-confirm').value = '';
  applyPwBars(0, ['ppb1','ppb2','ppb3','ppb4']);
  clearErrors('mpw-err','mpw-err2');
  openModal('m-pw');
  setTimeout(() => document.getElementById('mpw-new').focus(), 200);
}

async function submitChangePw() {
  clearErrors('mpw-err','mpw-err2');
  const p1 = document.getElementById('mpw-new').value;
  const p2 = document.getElementById('mpw-confirm').value;
  let valid = true;
  if (!p1 || p1.length < 8) { document.getElementById('mpw-err').textContent = 'Min 8 characters'; valid = false; }
  if (p1 !== p2)             { document.getElementById('mpw-err2').textContent = 'Passwords do not match'; valid = false; }
  if (!valid) return;

  setBtnLoading('mpw-btn', true, 'Save Password');
  const res = await Auth.changePassword(_pwUserId, p1);
  setBtnLoading('mpw-btn', false, 'Save Password');
  if (!res.ok) { toast(res.error, 'error'); return; }
  closeModal('m-pw');
  toast('✓ Password changed', 'success');
}

function openResetPw(id) {
  const u = _allUsers.find(x => x.id === id);
  if (!u) return;
  _resetUserId = id;
  _tmpPwStr    = Array.from({ length: 12 }, () =>
    'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#!'[Math.floor(Math.random() * 60)]
  ).join('');
  document.getElementById('mreset-name').textContent = `${u.full_name} (${u.username})`;
  document.getElementById('mreset-tmpw').textContent = _tmpPwStr;
  openModal('m-reset');
}

function copyTmpPw() {
  navigator.clipboard?.writeText(_tmpPwStr).then(() => toast('Copied!', 'info'));
}

async function confirmReset() {
  setBtnLoading('mreset-btn', true, 'Confirm Reset');
  const res = await Auth.changePassword(_resetUserId, _tmpPwStr);
  setBtnLoading('mreset-btn', false, 'Confirm Reset');
  if (!res.ok) { toast(res.error, 'error'); return; }
  closeModal('m-reset');
  toast('✓ Password reset', 'success');
}

async function toggleUserActive(id, state) {
  const res = await Auth.setUserActive(id, state);
  if (!res.ok) { toast(res.error, 'error'); return; }
  toast(state ? '✓ User enabled' : '✓ User disabled', 'success');
  await loadUsers();
}

function openDeleteUser(id) {
  const u = _allUsers.find(x => x.id === id);
  if (!u) return;
  _delUserId = id;
  document.getElementById('mdel-name').textContent = `${u.full_name} (${u.username})`;
  openModal('m-del');
}

async function confirmDelete() {
  setBtnLoading('mdel-btn', true, 'Delete User');
  const res = await Auth.deleteUser(_delUserId);
  setBtnLoading('mdel-btn', false, 'Delete User');
  if (!res.ok) { toast(res.error, 'error'); return; }
  closeModal('m-del');
  toast('✓ User deleted', 'success');
  await loadUsers();
}


/* ── Own password change ────────────────────────────────────────── */
async function submitOwnPwChange() {
  clearErrors('cpw-err-current','cpw-err-new','cpw-err-confirm');
  const cur = document.getElementById('cpw-current').value;
  const nw  = document.getElementById('cpw-new').value;
  const cf  = document.getElementById('cpw-confirm').value;
  let valid = true;

  if (!cur)              { document.getElementById('cpw-err-current').textContent = 'Required'; valid = false; }
  if (!nw || nw.length < 8) { document.getElementById('cpw-err-new').textContent = 'Min 8 characters'; valid = false; }
  if (nw !== cf)         { document.getElementById('cpw-err-confirm').textContent = 'Passwords do not match'; valid = false; }
  if (!valid) return;

  const verify = await Auth.login(SESSION.username, cur);
  if (!verify.ok) { document.getElementById('cpw-err-current').textContent = 'Current password is incorrect'; return; }

  const btn = document.getElementById('cpw-btn');
  btn.disabled = true; btn.textContent = 'Saving...';
  const res = await Auth.changePassword(SESSION.id, nw);
  btn.disabled = false; btn.textContent = 'Change Password';

  if (!res.ok) { toast(res.error, 'error'); return; }

  ['cpw-current','cpw-new','cpw-confirm'].forEach(id => document.getElementById(id).value = '');
  applyPwBars(0, ['cpb1','cpb2','cpb3','cpb4']);
  toast('✓ Password changed', 'success');
}


/* ══════════════════════════════════════════════════════════════════
   ROLE MANAGEMENT
══════════════════════════════════════════════════════════════════ */

let _allRoles  = [];
let _editRoleId = null;

async function loadRoles() {
  setTableLoading('r-loading', true);
  try {
    _allRoles = await Auth.getRoles() || [];
    _filterRoles();
    document.getElementById('r-stat-total').textContent = _allRoles.length;
    document.getElementById('d-roles').textContent      = _allRoles.length;
  } catch (e) {
    toast('Load roles failed: ' + e.message, 'error');
  } finally {
    setTableLoading('r-loading', false);
  }
}

function filterRoles() { _filterRoles(); }

function _filterRoles() {
  const q        = document.getElementById('r-search').value.trim().toLowerCase();
  const filtered = _allRoles.filter(r => !q || r.role_name.includes(q) || (r.description || '').toLowerCase().includes(q));
  const tb       = document.getElementById('r-tbody');

  if (!filtered.length) {
    tb.innerHTML = '<tr class="td-empty"><td colspan="6">No roles found</td></tr>';
    return;
  }
  tb.innerHTML = filtered.map((r, i) => `
    <tr class="row-enter">
      <td style="color:var(--text-muted);font-size:10px">${i + 1}</td>
      <td class="td-primary">${escHtml(r.role_name)}</td>
      <td>${escHtml(r.description || '—')}</td>
      <td>${escHtml(r.created_by || '—')}</td>
      <td>${formatDate(r.created_date)}</td>
      <td>
        <div style="display:flex;gap:4px">
          <button class="btn-sm btn-sm-cyan" onclick="openEditRole('${r.id}')">Edit</button>
          <button class="btn-sm btn-sm-red" onclick="deleteRole('${r.id}')">Delete</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function openCreateRole() {
  _editRoleId = null;
  document.getElementById('m-role-title').textContent = 'New Role';
  document.getElementById('mr-btn').textContent       = 'Create Role';
  document.getElementById('mr-name').value             = '';
  document.getElementById('mr-desc').value             = '';
  clearErrors('mr-err-name');
  openModal('m-role');
  setTimeout(() => document.getElementById('mr-name').focus(), 200);
}

function openEditRole(id) {
  const r = _allRoles.find(x => x.id === id);
  if (!r) return;
  _editRoleId = id;
  document.getElementById('m-role-title').textContent = 'Edit Role';
  document.getElementById('mr-btn').textContent       = 'Save Changes';
  document.getElementById('mr-name').value             = r.role_name;
  document.getElementById('mr-desc').value             = r.description || '';
  clearErrors('mr-err-name');
  openModal('m-role');
}

async function submitRole() {
  clearErrors('mr-err-name');
  const rn   = document.getElementById('mr-name').value.trim();
  const desc = document.getElementById('mr-desc').value.trim();
  if (!rn) { document.getElementById('mr-err-name').textContent = 'Role name required'; return; }

  setBtnLoading('mr-btn', true, _editRoleId ? 'Save Changes' : 'Create Role');
  const res = _editRoleId
    ? await Auth.updateRole(_editRoleId, { roleName: rn, description: desc })
    : await Auth.createRole({ roleName: rn, description: desc });
  setBtnLoading('mr-btn', false, _editRoleId ? 'Save Changes' : 'Create Role');

  if (!res.ok) { toast(res.error, 'error'); return; }
  closeModal('m-role');
  toast(_editRoleId ? '✓ Role updated' : '✓ Role created', 'success');
  await loadRoles();
}

async function deleteRole(id) {
  if (!confirm('Delete this role?')) return;
  const res = await Auth.deleteRole(id);
  if (!res.ok) { toast(res.error, 'error'); return; }
  toast('✓ Role deleted', 'success');
  await loadRoles();
}


/* ══════════════════════════════════════════════════════════════════
   AUDIT LOGS
══════════════════════════════════════════════════════════════════ */

async function loadLogs() {
  try {
    const logs = await db.getLogs(100) || [];
    const tb   = document.getElementById('log-tbody');
    if (!logs.length) {
      tb.innerHTML = '<tr class="td-empty"><td colspan="5">No logs found</td></tr>';
      return;
    }
    tb.innerHTML = logs.map((l, i) => `
      <tr class="row-enter">
        <td style="color:var(--text-muted);font-size:10px">${i + 1}</td>
        <td class="td-primary">${escHtml(l.action)}</td>
        <td>${escHtml(l.resource || '—')}</td>
        <td><span class="badge ${l.result === 'SUCCESS' ? 'badge-success' : 'badge-danger'}">${escHtml(l.result || '—')}</span></td>
        <td>${formatDate(l.created_at)}</td>
      </tr>
    `).join('');
  } catch (e) {
    toast('Load logs failed: ' + e.message, 'error');
  }
}


/* ══════════════════════════════════════════════════════════════════
   FILE UPLOAD HISTORY
══════════════════════════════════════════════════════════════════ */

async function loadFileHistory() {
  try {
    const files = await db.getFiles() || [];
    const tb    = document.getElementById('fh-tbody');
    if (!files.length) {
      tb.innerHTML = '<tr class="td-empty"><td colspan="7">No files saved yet</td></tr>';
      return;
    }
    tb.innerHTML = files.map((f, i) => `
      <tr class="row-enter">
        <td style="color:var(--text-muted);font-size:10px">${i + 1}</td>
        <td class="td-primary">${escHtml(f.file_name)}</td>
        <td style="color:var(--cyan)">${escHtml(f.format || '—')}</td>
        <td>${f.row_count || 0}</td>
        <td>${formatBytes(f.file_size)}</td>
        <td>${formatDate(f.uploaded_at)}</td>
        <td><span class="badge badge-info">${escHtml(f.status || 'PARSED')}</span></td>
      </tr>
    `).join('');
  } catch (e) {
    toast('Load history failed: ' + e.message, 'error');
  }
}


/* ══════════════════════════════════════════════════════════════════
   PW STRENGTH WIRING (modal inputs)
══════════════════════════════════════════════════════════════════ */

function onMUserPwInput()  { applyPwBars(pwScore(document.getElementById('m-pw').value),    ['mpb1','mpb2','mpb3','mpb4']); }
function onMPwInput()      { applyPwBars(pwScore(document.getElementById('mpw-new').value),  ['ppb1','ppb2','ppb3','ppb4']); }
function onCpwInput()      { applyPwBars(pwScore(document.getElementById('cpw-new').value),  ['cpb1','cpb2','cpb3','cpb4']); }
