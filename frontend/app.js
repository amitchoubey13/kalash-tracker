'use strict';

// ══════════════════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════════════════
let currentUser = null;
let settings = null;
let currentTab = 'tasks';
let allUsers = [];
let allTasks = [];
let allAttendance = [];
let allPayments = [];
let allInventory = [];
let inventoryHistory = [];
let allExpenses = [];
let expenseCategories = [];
let inventoryCategories = [];
let selectedMonth = '';
let selectedAttendanceDate = '';
let selectedInventoryCategory = 'All';
let invHistoryView = false;
let invLowStockOnly = false;
let invPurchaseMode = false;
let invPurchaseSelected = {}; // id → {name, nameHindi, unit, qty}
let invPurchaseLogView = false;
let taskStatusFilter = 'All';
let taskCategoryFilter = 'All';
let pendingConfirmCallback = null;
let syncIntervalId = null;
let alertIntervalId = null;
let kitchenAlertLastNotified = {};
let dutyReminderSent = {};   // userId → timestamp, tracks who was reminded today
let invQtyDebounce = {};
let allShifts = [];
let editingPaymentUserId = null;
let editingExpenseId = null;
let salarySelectedUserId = null;

// ══════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════
async function api(method, path, body) {
  const opts = { method, headers: { 'ngrok-skip-browser-warning': 'true' } };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'HTTP ' + res.status);
  }
  return res.json();
}

function formatDate(s) {
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return d + '/' + m + '/' + y;
}

function formatCurrency(n) {
  return '₹' + Number(n || 0).toLocaleString('en-IN');
}

function todayDate() {
  return new Date().toISOString().split('T')[0];
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function getCurrentTime() {
  const now = new Date();
  return String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');
}

function getUserName(id) {
  if (!id) return '';
  const u = allUsers.find(u => u.id === id);
  return u ? u.name : 'Unknown';
}

function getUserPhone(id) {
  if (!id) return '';
  const u = allUsers.find(u => u.id === id);
  return u ? (u.phone || '') : '';
}

function getUserById(id) {
  return allUsers.find(u => u.id === id) || null;
}

function isOwnerOrManager() {
  return currentUser && (currentUser.role === 'Owner' || currentUser.role === 'Manager');
}

function canAccessInventory() {
  return isOwnerOrManager() || (currentUser && currentUser.role === 'Kitchen Staff');
}

function getFirstOwnerOrManager() {
  return allUsers.find(u => u.role === 'Owner') || allUsers.find(u => u.role === 'Manager') || null;
}

let toastTimer = null;
function showToast(msg, type) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast toast-' + (type || 'info');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3000);
}

function showConfirm(msg, onYes) {
  pendingConfirmCallback = onYes;
  const box = document.querySelector('#confirm-modal .modal-box');
  box.innerHTML = `
    <div class="modal-header"><span class="modal-title">Confirm</span></div>
    <p class="confirm-body">${msg}</p>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal('confirm-modal')">Cancel</button>
      <button class="btn btn-danger" id="confirm-yes-btn">Yes, Confirm</button>
    </div>`;
  document.getElementById('confirm-yes-btn').onclick = () => {
    closeModal('confirm-modal');
    if (pendingConfirmCallback) pendingConfirmCallback();
  };
  document.querySelector('#confirm-modal .modal-backdrop').onclick = () => closeModal('confirm-modal');
  openModal('confirm-modal');
}

function openModal(id) {
  document.getElementById(id).hidden = false;
}

function closeModal(id) {
  document.getElementById(id).hidden = true;
}

function openWhatsApp(phone, message) {
  const clean = String(phone).replace(/\D/g, '');
  const num = clean.startsWith('91') ? clean : '91' + clean;
  window.open('https://wa.me/' + num + '?text=' + encodeURIComponent(message), '_blank', 'noopener');
}

function openWhatsAppAny(message) {
  window.open('https://wa.me/?text=' + encodeURIComponent(message), '_blank', 'noopener');
}

function openSMS(phone, message) {
  const clean = String(phone).replace(/\D/g, '');
  window.open('sms:+91' + clean + '?body=' + encodeURIComponent(message), '_blank', 'noopener');
}

function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = e => res(e.target.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function categoryBadgeClass(cat) {
  const map = {
    'Housekeeping': 'badge-housekeeping', 'Maintenance': 'badge-maintenance',
    'Guest Request': 'badge-guest', 'General': 'badge-general',
    'Purchase Request': 'badge-purchase', 'Kitchen Equipment': 'badge-kitchen',
    'Inventory Purchase': 'badge-inventory'
  };
  return 'badge ' + (map[cat] || 'badge-general');
}

function priorityBadgeClass(p) {
  const map = { Low: 'badge-low', Normal: 'badge-normal', High: 'badge-high', Urgent: 'badge-urgent' };
  return 'badge ' + (map[p] || 'badge-normal');
}

function statusBadgeClass(s) {
  const map = { Pending: 'badge-pending', 'In Progress': 'badge-in-progress', Done: 'badge-done' };
  return 'badge ' + (map[s] || 'badge-pending');
}

function roleCssClass(role) {
  const map = { Owner: 'owner', Manager: 'manager', Staff: 'staff', 'Kitchen Staff': 'kitchen' };
  return map[role] || 'staff';
}

function isOverdue(task) {
  return task.dueDate && task.status !== 'Done' && task.dueDate < todayDate();
}

// ══════════════════════════════════════════════════════════════
//  BOOT
// ══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', init);

async function init() {
  // Wire sign-out button
  document.getElementById('signout-btn').addEventListener('click', signOut);
  // Wire tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => renderTab(btn.dataset.tab));
  });
  // Wire banner close buttons
  document.querySelectorAll('.alert-banner__close').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById(btn.dataset.dismiss).style.display = 'none';
    });
  });

  try {
    settings = await api('GET', '/api/settings');
  } catch (e) {
    document.body.innerHTML = '<div style="padding:30px;text-align:center;color:#c62828"><h2>Cannot connect to server</h2><p>Make sure the app is running: <strong>npm start</strong></p></div>';
    return;
  }

  if (!settings.setupDone) {
    showSetupScreen();
  } else {
    await showSigninScreen();
  }
}

// ══════════════════════════════════════════════════════════════
//  SETUP SCREEN
// ══════════════════════════════════════════════════════════════
function showSetupScreen() {
  document.getElementById('setup-screen').hidden = false;
  document.getElementById('signin-screen').hidden = true;
  document.getElementById('app').hidden = true;

  document.getElementById('setup-form').onsubmit = async function(e) {
    e.preventDefault();
    const name = document.getElementById('setup-name').value.trim();
    const phone = document.getElementById('setup-phone').value.trim();
    const pin = document.getElementById('setup-pin').value;
    const pinConfirm = document.getElementById('setup-pin-confirm').value;
    const resortName = document.getElementById('setup-resort-name').value.trim();
    const shiftTime = document.getElementById('setup-shift-time').value;
    const errEl = document.getElementById('setup-error');

    if (pin !== pinConfirm) {
      errEl.textContent = 'PINs do not match.'; errEl.hidden = false; return;
    }
    if (pin.length < 4) {
      errEl.textContent = 'PIN must be at least 4 digits.'; errEl.hidden = false; return;
    }
    errEl.hidden = true;

    try {
      const result = await api('POST', '/api/setup', { name, phone, pin, resortName });
      settings = result.settings;
      if (shiftTime) await api('PUT', '/api/settings', { shiftStartTime: shiftTime });
      settings.shiftStartTime = shiftTime || '10:00';
      showToast('Setup complete! Welcome, ' + name, 'success');
      document.getElementById('setup-screen').hidden = true;
      await showSigninScreen();
    } catch (err) {
      errEl.textContent = err.message; errEl.hidden = false;
    }
  };
}

// ══════════════════════════════════════════════════════════════
//  SIGN-IN SCREEN
// ══════════════════════════════════════════════════════════════
async function showSigninScreen() {
  document.getElementById('setup-screen').hidden = true;
  document.getElementById('signin-screen').hidden = false;
  document.getElementById('app').hidden = true;

  document.getElementById('signin-resort-name').textContent = settings.resortName || 'Resort Manager';

  let users = [];
  try { users = await api('GET', '/api/users'); } catch (e) {}

  // Replace name input with text + datalist
  const nameInput = document.getElementById('signin-name');
  nameInput.setAttribute('list', 'user-names-list');
  let dl = document.getElementById('user-names-list');
  if (!dl) { dl = document.createElement('datalist'); dl.id = 'user-names-list'; nameInput.parentNode.appendChild(dl); }
  dl.innerHTML = users.map(u => `<option value="${escHtml(u.name)}">`).join('');

  document.getElementById('signin-form').onsubmit = async function(e) {
    e.preventDefault();
    const name = document.getElementById('signin-name').value.trim();
    const pin = document.getElementById('signin-pin').value;
    const errEl = document.getElementById('signin-error');
    errEl.hidden = true;
    try {
      const user = await api('POST', '/api/signin', { name, pin });
      await signedIn(user);
    } catch (err) {
      errEl.textContent = err.message === 'HTTP 401' ? 'Invalid name or PIN.' : err.message;
      errEl.hidden = false;
    }
  };
}

// ══════════════════════════════════════════════════════════════
//  SIGNED IN
// ══════════════════════════════════════════════════════════════
async function signedIn(user) {
  currentUser = user;
  selectedMonth = currentMonth();
  selectedAttendanceDate = todayDate();

  document.getElementById('header-resort-name').textContent = settings.resortName || 'Resort Manager';
  document.getElementById('header-user-display').textContent = user.name + ' · ' + user.role;
  document.getElementById('signin-screen').hidden = true;
  document.getElementById('signin-pin').value = '';
  document.getElementById('app').hidden = false;

  applyRoleVisibility();
  await loadInitialData();
  renderTab('tasks');
  startPolling();
  checkAlertsAndBanners();
}

function applyRoleVisibility() {
  const role = currentUser.role;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const tab = btn.dataset.tab;
    let hide = false;
    if (role === 'Staff') hide = (tab === 'salary' || tab === 'inventory' || tab === 'expenses');
    if (role === 'Kitchen Staff') hide = (tab === 'salary' || tab === 'expenses');
    btn.style.display = hide ? 'none' : '';
  });
}

async function loadInitialData() {
  try {
    const [users, tasks, attendance, payments, inventory, invCats, expCats, expenses, shifts] = await Promise.all([
      api('GET', '/api/users'),
      api('GET', '/api/tasks'),
      api('GET', '/api/attendance?month=' + currentMonth()),
      api('GET', '/api/payments?month=' + currentMonth()),
      api('GET', '/api/inventory'),
      api('GET', '/api/inventoryCategories'),
      api('GET', '/api/expenseCategories'),
      api('GET', '/api/expenses?month=' + currentMonth()),
      api('GET', '/api/shifts'),
    ]);
    allUsers = users; allTasks = tasks; allAttendance = attendance;
    allPayments = payments; allInventory = inventory;
    inventoryCategories = invCats; expenseCategories = expCats; allExpenses = expenses;
    allShifts = shifts;
  } catch (e) {
    showToast('Error loading data: ' + e.message, 'error');
  }
}

function startPolling() {
  syncIntervalId = setInterval(syncActiveTab, 30000);
  alertIntervalId = setInterval(checkAlertsAndBanners, 5 * 60 * 1000);
}

function stopPolling() {
  clearInterval(syncIntervalId);
  clearInterval(alertIntervalId);
}

async function syncActiveTab() {
  if (!currentUser) return;
  try {
    allTasks = await api('GET', '/api/tasks');
    allInventory = await api('GET', '/api/inventory');
    allAttendance = await api('GET', '/api/attendance?month=' + currentMonth());
    allUsers = await api('GET', '/api/users');
    renderTab(currentTab);
  } catch (e) {}
}

async function checkAlertsAndBanners() {
  if (!currentUser) return;
  try { allInventory = await api('GET', '/api/inventory'); } catch(e) {}
  try { allTasks = await api('GET', '/api/tasks'); } catch(e) {}

  if (canAccessInventory()) {
    const low = allInventory.filter(i => Number(i.quantity) <= Number(i.threshold) && Number(i.threshold) > 0);
    const banner = document.getElementById('lowstock-alert-banner');
    const textEl = document.getElementById('lowstock-alert-text');
    if (low.length > 0) {
      const names = low.slice(0, 4).map(i => i.name).join(', ') + (low.length > 4 ? ' +' + (low.length - 4) + ' more' : '');
      textEl.innerHTML = `⚠️ Low Stock (${low.length}): ${escHtml(names)} <button onclick="renderTab('inventory')" style="margin-left:6px">View</button>`;
      banner.style.display = 'flex';
    } else {
      banner.style.display = 'none';
    }
  }

  if (isOwnerOrManager()) {
    const today = todayDate();
    const overdue = allTasks.filter(t =>
      t.category === 'Kitchen Equipment' && t.status !== 'Done' &&
      t.priority === 'High' && t.dueDate && t.dueDate < today
    );
    const kitBanner = document.getElementById('kitchen-alert-banner');
    const kitText = document.getElementById('kitchen-alert-text');
    if (overdue.length > 0) {
      const task = overdue[0];
      const last = kitchenAlertLastNotified[task.id] || 0;
      if (Date.now() - last > 55 * 60 * 1000) {
        kitText.innerHTML = `🍳 Kitchen Equip overdue: "${escHtml(task.title)}" `;
        const btn = document.createElement('button');
        btn.textContent = 'Notify Now';
        btn.onclick = () => {
          kitchenAlertLastNotified[task.id] = Date.now();
          const phone = getUserPhone(task.assignedTo) || getUserPhone(task.requestedBy);
          const msg = `Kitchen Equipment Reminder: "${task.title}" is overdue and needs attention.\n— ${settings.resortName}`;
          if (phone) openWhatsApp(phone, msg); else openWhatsAppAny(msg);
          kitBanner.style.display = 'none';
        };
        kitText.appendChild(btn);
        kitBanner.style.display = 'flex';
      }
    } else {
      kitBanner.style.display = 'none';
    }

    // Missed duty: check 1 hour after each staff member's duty start time
    try { allAttendance = await api('GET', '/api/attendance?date=' + todayDate()); } catch(e) {}
    const staffUsers = allUsers.filter(u => u.role === 'Staff' || u.role === 'Kitchen Staff');
    const presentIds = new Set(allAttendance.filter(a => a.date === todayDate() && (a.dutyIn || a.onLeave)).map(a => a.userId));
    const nowMs = Date.now();
    const nowHHMM = getCurrentTime();

    // Find staff who are more than 1 hour past their duty start and haven't checked in
    const overdueStaff = staffUsers.filter(u => {
      if (presentIds.has(u.id)) return false;
      const todayRec = allAttendance.find(a => a.date === todayDate() && a.userId === u.id);
      const assignedShift = allShifts.find(s => s.id === todayRec?.shiftId);
      const shift = assignedShift?.startTime || u.shiftStartTime || settings?.shiftStartTime || '10:00';
      // Calculate shift + 1 hour
      const [sh, sm] = shift.split(':').map(Number);
      const shiftPlusOneHour = String(sh + 1).padStart(2,'0') + ':' + String(sm).padStart(2,'0');
      return nowHHMM >= shiftPlusOneHour;
    });

    const banner = document.getElementById('missed-duty-banner');
    const textEl = document.getElementById('missed-duty-text');

    if (overdueStaff.length > 0) {
      const chips = overdueStaff.map(u => {
        const phone = getUserPhone(u.id);
        const shift = u.shiftStartTime || settings?.shiftStartTime || '10:00';
        const alreadyNotified = dutyReminderSent[u.id] && (nowMs - dutyReminderSent[u.id] < 60 * 60 * 1000);
        const msg = `Hello ${u.name}, your duty started at ${shift}. Please check in or inform your manager.\n— ${settings.resortName}`;
        const btnLabel = alreadyNotified ? 'Reminded ✓' : 'Send Reminder';
        const btn = phone
          ? ` <button onclick="sendDutyReminder('${u.id}','${escHtml(phone)}','${msg.replace(/\\/g,'\\\\').replace(/'/g,"\\'")}')" ${alreadyNotified?'style="opacity:0.5"':''}>${btnLabel}</button>`
          : '';
        return `<span>⏰ ${escHtml(u.name)} (duty: ${shift})${btn}</span>`;
      }).join(' ');
      textEl.innerHTML = `📋 Missed Duty In: ` + chips;
      banner.style.display = 'flex';
    } else {
      banner.style.display = 'none';
    }
  }
}

function sendDutyReminder(userId, phone, msg) {
  dutyReminderSent[userId] = Date.now();
  openWhatsApp(phone, msg);
  checkAlertsAndBanners();
}

// ══════════════════════════════════════════════════════════════
//  TAB ROUTING
// ══════════════════════════════════════════════════════════════
function renderTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  const tc = document.getElementById('tab-content');
  switch (tab) {
    case 'tasks':      renderTasksTab(); break;
    case 'attendance': renderAttendanceTab(); break;
    case 'salary':     renderSalaryTab(); break;
    case 'notify':     renderNotifyTab(); break;
    case 'inventory':  renderInventoryTab(); break;
    case 'expenses':   renderExpensesTab(); break;
    default: tc.innerHTML = '';
  }
}

// ══════════════════════════════════════════════════════════════
//  TASKS TAB
// ══════════════════════════════════════════════════════════════
function renderTasksTab() {
  const tc = document.getElementById('tab-content');

  let tasks = [...allTasks];
  if (!isOwnerOrManager()) {
    tasks = tasks.filter(t => t.assignedTo === currentUser.id || t.requestedBy === currentUser.id);
  }
  if (taskStatusFilter !== 'All') tasks = tasks.filter(t => t.status === taskStatusFilter);
  if (taskCategoryFilter !== 'All') tasks = tasks.filter(t => t.category === taskCategoryFilter);
  const order = { Pending: 0, 'In Progress': 1, Done: 2 };
  tasks.sort((a, b) => {
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    return 0;
  });

  const categories = ['All', 'Housekeeping', 'Maintenance', 'Guest Request', 'General', 'Purchase Request', 'Kitchen Equipment', 'Inventory Purchase'];

  let html = '';

  if (isOwnerOrManager()) {
    html += renderManageStaffPanelHTML();
  }

  html += `<div class="filter-bar">
    ${['All','Pending','In Progress','Done'].map(s => `<button class="filter-pill ${taskStatusFilter===s?'active':''}" onclick="setTaskFilter('status','${s}')">${s}</button>`).join('')}
  </div>
  <div style="padding:0 12px 8px">
    <select onchange="setTaskFilter('category',this.value)" style="font-size:13px!important;padding:6px 10px!important">
      ${categories.map(c => `<option value="${c}" ${taskCategoryFilter===c?'selected':''}>${c}</option>`).join('')}
    </select>
  </div>`;

  if (tasks.length === 0) {
    html += `<div class="empty-state"><span class="empty-state-icon">📋</span><div class="empty-state-text">No tasks</div><div class="empty-state-sub">Tap + to create a task</div></div>`;
  } else {
    html += tasks.map(t => taskCardHTML(t)).join('');
  }

  tc.innerHTML = html;

  // FAB
  let fab = document.getElementById('tasks-fab');
  if (!fab) { fab = document.createElement('button'); fab.id = 'tasks-fab'; fab.className = 'fab'; fab.textContent = '+'; document.body.appendChild(fab); }
  fab.style.display = '';
  fab.onclick = () => {
    if (currentUser.role === 'Staff') openStaffRequestModal();
    else if (currentUser.role === 'Kitchen Staff') openKitchenEquipmentModal();
    else openTaskModal(null);
  };

  // Hide fab on other tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.tab !== 'tasks' && fab) fab.style.display = 'none';
    });
  });

  wireCollapsibles();
}

function setTaskFilter(type, val) {
  if (type === 'status') taskStatusFilter = val;
  if (type === 'category') taskCategoryFilter = val;
  renderTasksTab();
}

function taskCardHTML(task) {
  const over = isOverdue(task);
  const assigneeName = task.assignedTo ? getUserName(task.assignedTo) : '';
  const requesterName = (task.requestedBy && task.requestedBy !== task.assignedTo) ? getUserName(task.requestedBy) : '';
  const tid = task.id;
  return `<div class="card ${over ? 'card-overdue' : ''}">
    <div class="card-meta">
      <span class="${categoryBadgeClass(task.category)}">${escHtml(task.category)}</span>
      <span class="${priorityBadgeClass(task.priority)}">${escHtml(task.priority)}</span>
      <span class="${statusBadgeClass(task.status)}">${escHtml(task.status)}</span>
      ${over ? '<span class="badge badge-overdue">Overdue</span>' : ''}
      ${task.dueDate ? '<span style="font-size:11px;color:var(--text-muted)">📅 ' + formatDate(task.dueDate) + '</span>' : ''}
      ${task.repeatType && task.repeatType !== 'None' ? '<span style="font-size:11px;color:var(--text-muted)">🔁 ' + task.repeatType + '</span>' : ''}
    </div>
    <div class="card-title">${escHtml(task.title)}</div>
    ${task.description ? '<div class="card-desc">' + escHtml(task.description) + '</div>' : ''}
    <div class="card-meta">
      ${assigneeName ? '👤 ' + escHtml(assigneeName) : ''}
      ${requesterName ? ' · Req: ' + escHtml(requesterName) : ''}
    </div>
    ${task.attachmentUrl ? '<img src="' + task.attachmentUrl + '" style="max-height:100px;border-radius:6px;margin-top:6px;cursor:pointer" onclick="showPhotoModalSrc(this.src)">' : ''}
    ${task.category === 'Inventory Purchase' && task.buyingListItems && task.buyingListItems.length > 0 ? `
    <div style="margin-top:8px;border:1px solid var(--border);border-radius:8px;overflow:hidden">
      <div style="background:#f5f5f5;padding:5px 10px;font-size:11px;font-weight:700;color:var(--text-muted);letter-spacing:0.5px">🛒 PURCHASE LIST / खरीद सूची</div>
      ${task.buyingListItems.map(it => `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 10px;border-top:1px solid var(--border);font-size:13px">
        <span>${escHtml(it.name)}</span>
        <span style="font-weight:700;color:var(--primary)">${it.qty} ${escHtml(it.unit||'')}</span>
      </div>`).join('')}
    </div>` : ''}
    <div class="card-actions">
      <div class="status-btn-group">
        <button class="status-btn ${task.status==='Pending'?'active-pending':''}" onclick="updateTaskStatus('${tid}','Pending')">Pending</button>
        <button class="status-btn ${task.status==='In Progress'?'active-in-progress':''}" onclick="updateTaskStatus('${tid}','In Progress')">In Progress</button>
        <button class="status-btn ${task.status==='Done'?'active-done':''}" onclick="updateTaskStatus('${tid}','Done')">Done</button>
      </div>
      <button class="btn btn-wa btn-xs" onclick="shareTask('${tid}')">📤 Send</button>
      ${isOwnerOrManager() ? `<button class="btn-icon" onclick="openTaskModalById('${tid}')">✏️</button><button class="btn-icon" onclick="deleteTask('${tid}')">🗑️</button>` : ''}
    </div>
  </div>`;
}

function openTaskModalById(id) {
  const task = allTasks.find(t => t.id === id);
  if (task) openTaskModal(task);
}

function shareTask(id) {
  const task = allTasks.find(t => t.id === id);
  if (!task) return;
  const msg = `📋 Task: ${task.title}\nCategory: ${task.category}\nPriority: ${task.priority}\nStatus: ${task.status}${task.dueDate ? '\nDue: ' + formatDate(task.dueDate) : ''}${task.description ? '\nDetails: ' + task.description : ''}\n— ${settings.resortName}`;
  openWhatsAppAny(msg);
}

async function updateTaskStatus(taskId, newStatus) {
  try {
    const result = await api('PUT', '/api/tasks/' + taskId, { status: newStatus });
    const idx = allTasks.findIndex(t => t.id === taskId);
    if (idx !== -1) allTasks[idx] = result.task;

    if (result.doneInventoryPurchase && result.task.buyingListItems && result.task.buyingListItems.length > 0) {
      showReceiveItemsModal(result.task);
    }
    if (result.doneKitchenEquipment) {
      const phone = getUserPhone(result.task.assignedTo) || getUserPhone(result.task.requestedBy);
      const msg = `✅ Kitchen Equipment task "${result.task.title}" has been resolved.\n— ${settings.resortName}`;
      if (phone) openWhatsApp(phone, msg);
    }
    renderTasksTab();
  } catch (e) { showToast(e.message, 'error'); }
}

async function deleteTask(id) {
  showConfirm('Delete this task?', async () => {
    try {
      await api('DELETE', '/api/tasks/' + id);
      allTasks = allTasks.filter(t => t.id !== id);
      closeModal('task-modal');
      renderTasksTab();
      showToast('Task deleted', 'success');
    } catch (e) { showToast(e.message, 'error'); }
  });
}

function openTaskModal(task) {
  const users = allUsers;
  const box = document.querySelector('#task-modal .modal-box');
  const isEdit = !!task;
  const cats = ['Housekeeping','Maintenance','Guest Request','General','Purchase Request','Kitchen Equipment','Inventory Purchase'];
  const priorities = ['Low','Normal','High','Urgent'];
  const repeats = ['None','Daily','Weekly','Monthly'];

  box.innerHTML = `
    <div class="modal-header">
      <span class="modal-title">${isEdit ? 'Edit Task' : 'New Task'}</span>
      <button class="modal-close" onclick="closeModal('task-modal')">×</button>
    </div>
    <form id="task-form">
      <div class="form-group"><label>Title *<input type="text" id="tf-title" value="${escHtml(task?.title||'')}" required></label></div>
      <div class="form-group"><label>Description<textarea id="tf-desc">${escHtml(task?.description||'')}</textarea></label></div>
      <div class="form-group"><label>Category<select id="tf-category" onchange="onTaskCatChange()">
        ${cats.map(c => `<option value="${c}" ${task?.category===c?'selected':''}>${c}</option>`).join('')}
      </select></label></div>
      <div class="form-group"><label>Assign To<select id="tf-assignee">
        <option value="">— Unassigned —</option>
        ${users.map(u => `<option value="${u.id}" ${task?.assignedTo===u.id?'selected':''}>${escHtml(u.name)} (${u.role})</option>`).join('')}
      </select></label></div>
      <div class="form-row">
        <div class="form-group"><label>Priority<select id="tf-priority">
          ${priorities.map(p => `<option value="${p}" ${task?.priority===p?'selected':''}>${p}</option>`).join('')}
        </select></label></div>
        <div class="form-group"><label>Repeat<select id="tf-repeat">
          ${repeats.map(r => `<option value="${r}" ${task?.repeatType===r?'selected':''}>${r}</option>`).join('')}
        </select></label></div>
      </div>
      <div class="form-group"><label>Due Date<input type="date" id="tf-due" value="${task?.dueDate||''}"></label></div>
      <div class="form-group"><label>Photo Attachment<input type="file" id="tf-photo" accept="image/*" onchange="previewTaskPhoto(this)"></label>
        <div id="tf-photo-preview">${task?.attachmentUrl ? '<img src="'+task.attachmentUrl+'" style="max-height:120px;border-radius:6px;margin-top:6px">' : ''}</div>
      </div>
      <div id="tf-buying-section" style="${task?.category==='Inventory Purchase'?'':'display:none'}">
        <div style="font-weight:600;margin-bottom:8px">Buying List Items</div>
        <div id="tf-buying-items">
          ${(task?.buyingListItems||[]).map((item,i) => buyingRowHTML(i, item)).join('')}
        </div>
        <button type="button" class="btn btn-ghost btn-sm" onclick="addBuyingListRow()">+ Add Item</button>
      </div>
      <div class="modal-footer">
        ${isEdit ? `<button type="button" class="btn btn-danger btn-sm" onclick="deleteTask('${task.id}')">Delete</button>` : ''}
        <button type="submit" class="btn btn-primary">${isEdit ? 'Save Changes' : 'Create Task'}</button>
      </div>
    </form>`;

  document.getElementById('task-form').onsubmit = async function(e) {
    e.preventDefault();
    await saveTask(task?.id || null);
  };

  document.querySelector('#task-modal .modal-backdrop').onclick = () => closeModal('task-modal');
  openModal('task-modal');
  if (!task?.buyingListItems?.length) window._buyingRows = 0;
  else window._buyingRows = task.buyingListItems.length;
}

function buyingRowHTML(i, item) {
  return `<div class="buying-list-item" id="buying-row-${i}">
    <input type="text" placeholder="Item name" value="${escHtml(item?.name||item?.itemName||'')}" id="bi-name-${i}" style="flex:2;font-size:14px!important;padding:6px!important">
    <input type="number" placeholder="Qty" value="${item?.qty||''}" id="bi-qty-${i}" style="width:60px;font-size:14px!important;padding:6px!important" min="0">
    <select id="bi-unit-${i}" style="width:70px;font-size:13px!important;padding:6px!important">
      ${['kg','gram','liter','ml','pcs','dozen','packet','box','bottle','bag','tin'].map(u=>`<option value="${u}" ${item?.unit===u?'selected':''}>${u}</option>`).join('')}
    </select>
    <input type="number" placeholder="₹ Rate" value="${item?.rate||''}" id="bi-rate-${i}" style="width:70px;font-size:14px!important;padding:6px!important" min="0">
    <button type="button" class="buying-list-remove" onclick="removeBuyingRow(${i})">×</button>
  </div>`;
}

function addBuyingListRow() {
  window._buyingRows = (window._buyingRows || 0) + 1;
  const i = window._buyingRows - 1;
  const container = document.getElementById('tf-buying-items');
  const div = document.createElement('div');
  div.innerHTML = buyingRowHTML(i, {});
  container.appendChild(div.firstElementChild);
}

function removeBuyingRow(i) {
  const el = document.getElementById('buying-row-' + i);
  if (el) el.remove();
}

function onTaskCatChange() {
  const cat = document.getElementById('tf-category')?.value;
  const sec = document.getElementById('tf-buying-section');
  if (sec) sec.style.display = cat === 'Inventory Purchase' ? '' : 'none';
}

async function previewTaskPhoto(input) {
  if (!input.files[0]) return;
  const b64 = await fileToBase64(input.files[0]);
  document.getElementById('tf-photo-preview').innerHTML = `<img src="${b64}" style="max-height:120px;border-radius:6px;margin-top:6px">`;
}

async function saveTask(taskId) {
  const title = document.getElementById('tf-title').value.trim();
  const description = document.getElementById('tf-desc').value.trim();
  const category = document.getElementById('tf-category').value;
  const assignedTo = document.getElementById('tf-assignee').value || null;
  const priority = document.getElementById('tf-priority').value;
  const repeatType = document.getElementById('tf-repeat').value;
  const dueDate = document.getElementById('tf-due').value || null;
  const photoInput = document.getElementById('tf-photo');

  let attachmentUrl = taskId ? (allTasks.find(t=>t.id===taskId)?.attachmentUrl||null) : null;
  if (photoInput.files[0]) {
    try {
      const fd = new FormData();
      fd.append('photo', photoInput.files[0]);
      const r = await fetch('/api/upload', { method: 'POST', body: fd });
      const j = await r.json();
      attachmentUrl = j.url;
    } catch (e) {}
  }

  // Collect buying list items
  const buyingListItems = [];
  if (category === 'Inventory Purchase') {
    let i = 0;
    while (document.getElementById('bi-name-' + i)) {
      const nameEl = document.getElementById('bi-name-' + i);
      const qtyEl = document.getElementById('bi-qty-' + i);
      const unitEl = document.getElementById('bi-unit-' + i);
      const rateEl = document.getElementById('bi-rate-' + i);
      if (nameEl && nameEl.value.trim()) {
        buyingListItems.push({ name: nameEl.value.trim(), qty: parseFloat(qtyEl?.value)||0, unit: unitEl?.value||'kg', rate: parseFloat(rateEl?.value)||0 });
      }
      i++;
    }
  }

  const data = { title, description, category, assignedTo, priority, repeatType, dueDate, attachmentUrl, buyingListItems, requestedBy: taskId ? undefined : null };

  try {
    if (taskId) {
      const result = await api('PUT', '/api/tasks/' + taskId, data);
      const idx = allTasks.findIndex(t => t.id === taskId);
      if (idx !== -1) allTasks[idx] = result.task || result;
      showToast('Task updated', 'success');
    } else {
      const newTask = await api('POST', '/api/tasks', data);
      allTasks.push(newTask);
      // WhatsApp notify assignee
      if (assignedTo) {
        const phone = getUserPhone(assignedTo);
        if (phone) {
          const msg = `नमस्ते ${getUserName(assignedTo)}!\nआपको एक नया कार्य सौंपा गया है:\n📋 ${title}${dueDate?'\nDue: '+formatDate(dueDate):''}\nPriority: ${priority}\n— ${settings.resortName}`;
          openWhatsApp(phone, msg);
        }
      }
      showToast('Task created', 'success');
    }
    closeModal('task-modal');
    renderTasksTab();
  } catch (e) { showToast(e.message, 'error'); }
}

async function autoUpdateInventoryFromPurchase(task) {
  const items = task.buyingListItems || [];
  const entries = [];
  const unmatched = [];
  items.forEach(item => {
    const invItem = allInventory.find(inv => inv.name.toLowerCase() === item.name.toLowerCase());
    if (invItem) entries.push({ id: invItem.id, qty: item.qty, rate: item.rate || 0 });
    else unmatched.push(item.name);
  });
  if (entries.length > 0) {
    try {
      await api('POST', '/api/inventory/bulk-add', { entries, loggedBy: currentUser.id, source: 'Purchase', date: todayDate() });
      allInventory = await api('GET', '/api/inventory');
      showToast(`✅ ${entries.length} item(s) added to stock automatically`, 'success');
    } catch(e) { showToast('Stock update failed: ' + e.message, 'error'); }
  }
  if (unmatched.length > 0) showToast(`⚠️ Not found in inventory: ${unmatched.join(', ')}`, 'info');
}

function showReceiveItemsModal(task) {
  const box = document.querySelector('#buying-list-modal .modal-box');
  const items = task.buyingListItems || [];
  box.innerHTML = `
    <div class="modal-header">
      <span class="modal-title">✅ Mark Items Received</span>
      <button class="modal-close" onclick="closeModal('buying-list-modal')">×</button>
    </div>
    <p style="padding:10px 16px 4px;font-size:13px;color:var(--text-muted)">Tick only items that arrived. Set actual qty and rate received.</p>
    <div style="padding:0 12px 8px">
      ${items.map((item,i) => `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);flex-wrap:wrap">
        <input type="checkbox" id="blc-chk-${i}" checked style="width:18px;height:18px;flex-shrink:0;cursor:pointer">
        <span style="flex:1;font-size:14px;font-weight:500;min-width:80px">${escHtml(item.name)}</span>
        <input type="number" id="blc-qty-${i}" value="${item.qty}" min="0" style="width:64px;font-size:13px!important;padding:5px!important;border:1px solid var(--border);border-radius:6px;text-align:center">
        <span style="font-size:12px;color:var(--text-muted);min-width:24px">${escHtml(item.unit||'')}</span>
        <input type="number" id="blc-rate-${i}" value="${item.rate||''}" min="0" placeholder="₹ rate" style="width:68px;font-size:13px!important;padding:5px!important;border:1px solid var(--border);border-radius:6px;text-align:right">
      </div>`).join('')}
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal('buying-list-modal')">Skip</button>
      <button class="btn btn-primary" onclick="confirmReceivedItems(${JSON.stringify(items).replace(/"/g,'&quot;')})">Add to Inventory</button>
    </div>`;
  document.querySelector('#buying-list-modal .modal-backdrop').onclick = () => closeModal('buying-list-modal');
  openModal('buying-list-modal');
}

async function confirmReceivedItems(items) {
  const entries = [];
  const skipped = [];
  const unmatched = [];
  items.forEach((item, i) => {
    const checked = document.getElementById('blc-chk-'+i)?.checked;
    if (!checked) { skipped.push(item.name); return; }
    const qty = parseFloat(document.getElementById('blc-qty-'+i)?.value) || item.qty;
    const rate = parseFloat(document.getElementById('blc-rate-'+i)?.value) || item.rate || 0;
    const invItem = allInventory.find(inv => inv.name.toLowerCase() === item.name.toLowerCase());
    if (invItem) entries.push({ id: invItem.id, qty, rate });
    else unmatched.push(item.name);
  });
  if (entries.length > 0) {
    try {
      await api('POST', '/api/inventory/bulk-add', { entries, loggedBy: currentUser.id, source: 'Purchase', date: todayDate() });
      allInventory = await api('GET', '/api/inventory');
      showToast(`✅ ${entries.length} item(s) added to stock`, 'success');
    } catch(e) { showToast(e.message, 'error'); return; }
  }
  if (unmatched.length > 0) showToast(`⚠️ Not in inventory: ${unmatched.join(', ')}`, 'info');
  if (skipped.length > 0) showToast(`⏭ Skipped (not received): ${skipped.join(', ')}`, 'info');
  closeModal('buying-list-modal');
}

// ── Staff Request (Staff role) ──
function openStaffRequestModal() {
  const box = document.querySelector('#task-modal .modal-box');
  const owner = getFirstOwnerOrManager();
  box.innerHTML = `
    <div class="modal-header">
      <span class="modal-title">Purchase Request</span>
      <button class="modal-close" onclick="closeModal('task-modal')">×</button>
    </div>
    <form id="staff-req-form">
      <div class="form-group"><label>Item / Request *<input type="text" id="sr-title" required></label></div>
      <div class="form-group"><label>Reason / Details<textarea id="sr-desc"></textarea></label></div>
      <div class="form-group"><label>Priority<select id="sr-priority"><option>Low</option><option selected>Normal</option><option>High</option><option>Urgent</option></select></label></div>
      <div class="form-group"><label>Photo (optional)<input type="file" id="sr-photo" accept="image/*"></label></div>
      <div class="modal-footer">
        <button type="submit" class="btn btn-primary">Submit Request</button>
      </div>
    </form>`;
  document.getElementById('staff-req-form').onsubmit = async function(e) {
    e.preventDefault();
    const title = document.getElementById('sr-title').value.trim();
    const description = document.getElementById('sr-desc').value.trim();
    const priority = document.getElementById('sr-priority').value;
    let attachmentUrl = null;
    const photoFile = document.getElementById('sr-photo').files[0];
    if (photoFile) {
      const fd = new FormData(); fd.append('photo', photoFile);
      const r = await fetch('/api/upload', { method:'POST', body:fd });
      const j = await r.json(); attachmentUrl = j.url;
    }
    try {
      const task = await api('POST', '/api/tasks', { title, description, category: 'Purchase Request', priority, requestedBy: currentUser.id, assignedTo: owner?.id||null, status:'Pending', attachmentUrl });
      allTasks.push(task);
      if (owner?.phone) {
        const msg = `Purchase Request from ${currentUser.name}:\n${title}\n${description?'Details: '+description+'\n':''}Priority: ${priority}\n— ${settings.resortName}`;
        openWhatsApp(owner.phone, msg);
      }
      closeModal('task-modal');
      renderTasksTab();
      showToast('Request submitted', 'success');
    } catch(e) { showToast(e.message, 'error'); }
  };
  document.querySelector('#task-modal .modal-backdrop').onclick = () => closeModal('task-modal');
  openModal('task-modal');
}

// ── Kitchen Equipment (Kitchen Staff) ──
function openKitchenEquipmentModal() {
  const box = document.querySelector('#task-modal .modal-box');
  const owner = getFirstOwnerOrManager();
  box.innerHTML = `
    <div class="modal-header">
      <span class="modal-title">Kitchen Equipment Request</span>
      <button class="modal-close" onclick="closeModal('task-modal')">×</button>
    </div>
    <form id="ke-form">
      <div class="form-group"><label>Equipment Name *<input type="text" id="ke-title" required></label></div>
      <div class="form-group"><label>Reason / Details *<textarea id="ke-desc" required></textarea></label></div>
      <div class="form-group"><label>Urgency<select id="ke-priority"><option>Normal</option><option>High</option><option>Urgent</option></select></label></div>
      <div class="modal-footer">
        <button type="submit" class="btn btn-primary">Submit</button>
        ${owner?.phone ? `<button type="button" class="btn btn-wa" onclick="notifyOwnerKitchen()">📲 Also Notify</button>` : ''}
      </div>
    </form>`;
  document.getElementById('ke-form').onsubmit = async function(e) {
    e.preventDefault();
    const title = document.getElementById('ke-title').value.trim();
    const description = document.getElementById('ke-desc').value.trim();
    const priority = document.getElementById('ke-priority').value;
    try {
      const task = await api('POST', '/api/tasks', { title, description, category:'Kitchen Equipment', priority, requestedBy:currentUser.id, assignedTo:owner?.id||null, status:'Pending' });
      allTasks.push(task);
      closeModal('task-modal');
      renderTasksTab();
      showToast('Equipment request submitted', 'success');
    } catch(e) { showToast(e.message, 'error'); }
  };
  window.notifyOwnerKitchen = function() {
    const title = document.getElementById('ke-title')?.value || '';
    const desc = document.getElementById('ke-desc')?.value || '';
    const urgency = document.getElementById('ke-priority')?.value || '';
    if (owner?.phone) {
      const msg = `Kitchen Equipment Request:\nItem: ${title}\nReason: ${desc}\nUrgency: ${urgency}\nRequested by: ${currentUser.name}\n— ${settings.resortName}`;
      openWhatsApp(owner.phone, msg);
    }
  };
  document.querySelector('#task-modal .modal-backdrop').onclick = () => closeModal('task-modal');
  openModal('task-modal');
}

// ══════════════════════════════════════════════════════════════
//  MANAGE STAFF PANEL (Owner/Manager)
// ══════════════════════════════════════════════════════════════
function renderManageStaffPanelHTML() {
  const staffWithPhone = allUsers.filter(u => u.phone);
  const chips = staffWithPhone.map(u => `
    <span class="contact-chip">${escHtml(u.name)}
      <a href="tel:+91${escHtml(u.phone)}" title="Call">☎️</a>
      <a href="#" onclick="openWhatsApp('${escHtml(u.phone)}','Hello ${escHtml(u.name)}, — ${escHtml(settings.resortName)}');return false" title="WhatsApp">💬</a>
    </span>`).join('');

  const staffRows = allUsers.filter(u => u.id !== currentUser.id).map(u => `
    <div class="staff-row">
      <div class="staff-info">
        <div class="staff-name">${escHtml(u.name)} <span class="role-badge role-${roleCssClass(u.role)}">${u.role}</span></div>
        ${u.phone ? `<div class="staff-phone">📞 ${escHtml(u.phone)}</div>` : ''}
        ${u.monthlySalary ? `<div class="staff-phone">₹${Number(u.monthlySalary).toLocaleString('en-IN')}/mo</div>` : ''}
      </div>
      <div class="staff-actions">
        <button class="btn-icon" onclick="openStaffModal('${u.id}')">✏️</button>
        <button class="btn-icon" onclick="deleteStaff('${u.id}')">🗑️</button>
      </div>
    </div>`).join('');

  return `
    <div style="margin:8px 12px;background:var(--surface);border-radius:10px;box-shadow:var(--shadow);overflow:hidden">
      <div class="collapsible-header" onclick="toggleCollapsible(this)">
        👥 Manage Staff <span class="chevron">▼</span>
      </div>
      <div class="collapsible-body">
        <div class="contact-chips">${chips}</div>
        ${staffRows}
        <button class="btn btn-primary btn-sm" style="margin-top:10px" onclick="openStaffModal(null)">+ Add Staff</button>
      </div>
    </div>`;
}

function toggleCollapsible(headerOrId) {
  if (typeof headerOrId === 'string') {
    // id-based toggle (shift panel)
    const body = document.getElementById(headerOrId);
    if (!body) return;
    const isOpen = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : 'block';
    const header = body.previousElementSibling;
    if (header) { const ch = header.querySelector('.chevron'); if (ch) ch.style.transform = isOpen ? '' : 'rotate(180deg)'; }
  } else {
    // element-based toggle (manage staff, etc.)
    headerOrId.classList.toggle('open');
    const body = headerOrId.nextElementSibling;
    if (body) body.classList.toggle('open');
  }
}

function wireCollapsibles() {
  document.querySelectorAll('.collapsible-header').forEach(h => {
    h.onclick = function() { toggleCollapsible(this); };
  });
}

function openStaffModal(userId) {
  const user = userId ? allUsers.find(u => u.id === userId) : null;
  const isEdit = !!user;
  const box = document.querySelector('#staff-modal .modal-box');
  const roles = ['Manager','Staff','Kitchen Staff'];
  box.innerHTML = `
    <div class="modal-header">
      <span class="modal-title">${isEdit ? 'Edit Staff' : 'Add Staff'}</span>
      <button class="modal-close" onclick="closeModal('staff-modal')">×</button>
    </div>
    <form id="staff-form">
      <div class="form-group"><label>Name *<input type="text" id="sf-name" value="${escHtml(user?.name||'')}" required></label></div>
      <div class="form-group"><label>Phone<input type="tel" id="sf-phone" value="${escHtml(user?.phone||'')}" placeholder="10-digit number"></label></div>
      <div class="form-group"><label>${isEdit ? 'New PIN (leave blank to keep)' : 'PIN * (4–6 digits)'}<input type="password" id="sf-pin" inputmode="numeric" minlength="4" maxlength="6" ${isEdit?'':'required'} placeholder="${isEdit?'Leave blank to keep current':'Choose a PIN'}"></label></div>
      ${!isEdit ? `<div class="form-group"><label>Confirm PIN *<input type="password" id="sf-pin2" inputmode="numeric" minlength="4" maxlength="6" required placeholder="Re-enter PIN"></label></div>` : ''}
      <div class="form-group"><label>Role<select id="sf-role">
        ${roles.map(r => `<option value="${r}" ${user?.role===r?'selected':''}>${r}</option>`).join('')}
      </select></label></div>
      <div class="form-group"><label>Monthly Salary (₹)<input type="number" id="sf-salary" value="${user?.monthlySalary||0}" min="0"></label></div>
      <div class="form-group"><label>Duty Start Time <small style="color:var(--text-muted)">(leave blank to use global: ${settings?.shiftStartTime||'10:00'})</small><input type="time" id="sf-shift" value="${escHtml(user?.shiftStartTime||'')}"></label></div>
      <p id="sf-error" class="form-error" hidden></p>
      <div class="modal-footer">
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>`;
  document.getElementById('staff-form').onsubmit = async function(e) {
    e.preventDefault();
    await saveStaff(user?.id || null);
  };
  document.querySelector('#staff-modal .modal-backdrop').onclick = () => closeModal('staff-modal');
  openModal('staff-modal');
}

async function saveStaff(userId) {
  const name = document.getElementById('sf-name').value.trim();
  const phone = document.getElementById('sf-phone').value.replace(/\D/g,'');
  const pin = document.getElementById('sf-pin').value;
  const pin2El = document.getElementById('sf-pin2');
  const role = document.getElementById('sf-role').value;
  const monthlySalary = parseFloat(document.getElementById('sf-salary').value) || 0;
  const errEl = document.getElementById('sf-error');

  if (!userId) {
    if (pin !== (pin2El?.value||'')) { errEl.textContent='PINs do not match'; errEl.hidden=false; return; }
    if (pin.length < 4) { errEl.textContent='PIN must be at least 4 digits'; errEl.hidden=false; return; }
  }
  errEl.hidden = true;

  const shiftStartTime = document.getElementById('sf-shift')?.value || '';
  const data = { name, phone, role, monthlySalary, shiftStartTime };
  if (pin) data.pin = pin;

  try {
    if (userId) {
      const updated = await api('PUT', '/api/users/' + userId, data);
      const idx = allUsers.findIndex(u => u.id === userId);
      if (idx !== -1) allUsers[idx] = updated;
      showToast('Staff updated', 'success');
    } else {
      const newUser = await api('POST', '/api/users', { ...data, pin: pin });
      allUsers.push(newUser);
      showToast('Staff added', 'success');
    }
    closeModal('staff-modal');
    renderTasksTab();
  } catch(e) { errEl.textContent=e.message; errEl.hidden=false; }
}

async function deleteStaff(id) {
  showConfirm('Remove this staff member?', async () => {
    try {
      await api('DELETE', '/api/users/' + id);
      allUsers = allUsers.filter(u => u.id !== id);
      closeModal('staff-modal');
      renderTasksTab();
      showToast('Staff removed', 'success');
    } catch(e) { showToast(e.message, 'error'); }
  });
}

async function updateUserShift(userId, shiftStartTime) {
  try {
    const updated = await api('PUT', '/api/users/' + userId, { shiftStartTime });
    const idx = allUsers.findIndex(u => u.id === userId);
    if (idx !== -1) allUsers[idx] = updated;
    showToast('Duty time updated', 'success');
  } catch(e) { showToast(e.message, 'error'); }
}

// ══════════════════════════════════════════════════════════════
//  ATTENDANCE TAB
// ══════════════════════════════════════════════════════════════
let attMonthView = false;

async function renderAttendanceTab() {
  try { allShifts = await api('GET', '/api/shifts'); } catch(e) {}
  const tc = document.getElementById('tab-content');

  const shiftMgmtPanel = isOwnerOrManager() ? renderShiftManagementPanel() : '';

  tc.innerHTML = `
    ${shiftMgmtPanel}
    <div style="padding:8px 12px 4px">
      <div class="picker-bar">
        <input type="date" id="att-date-picker" value="${selectedAttendanceDate}" onchange="selectedAttendanceDate=this.value; renderAttendanceDay()">
        ${isOwnerOrManager() ? `<button class="btn btn-ghost btn-sm" onclick="toggleAttMonthView()">${attMonthView?'Day View':'Month View'}</button>` : ''}
      </div>
    </div>
    <div id="att-content"></div>`;

  if (attMonthView && isOwnerOrManager()) {
    renderAttendanceMonth();
  } else {
    renderAttendanceDay();
  }
}

function renderShiftManagementPanel() {
  const shiftRows = allShifts.map(s => `
    <div class="shift-row" id="shift-row-${s.id}">
      <span class="shift-color-dot" style="background:${escHtml(s.color)};width:12px;height:12px;border-radius:50%;display:inline-block;margin-right:6px;flex-shrink:0"></span>
      <span style="flex:1;font-size:13px;font-weight:600">${escHtml(s.name)}</span>
      <span style="font-size:12px;color:var(--text-muted);margin-right:8px">${escHtml(s.startTime)} – ${escHtml(s.endTime)}</span>
      <button class="btn-icon" onclick="openEditShiftModal('${s.id}')" title="Edit">✏️</button>
      <button class="btn-icon" onclick="deleteShift('${s.id}')" title="Delete">🗑️</button>
    </div>`).join('');

  return `
    <div class="collapsible-header" onclick="toggleCollapsible('shift-panel')" style="background:var(--primary-lt);border-bottom:1px solid var(--border)">
      <span>🕐 Shift Management (${allShifts.length} shifts)</span>
      <span class="chevron">▼</span>
    </div>
    <div class="collapsible-body" id="shift-panel" style="display:block;padding:12px;background:#fff;border-bottom:1px solid var(--border)">
      <div id="shift-list" style="margin-bottom:10px">
        ${allShifts.length === 0 ? '<p style="color:var(--text-muted);font-size:13px">No shifts yet. Add one below.</p>' : shiftRows}
      </div>
      <button class="btn btn-primary btn-sm" onclick="openAddShiftModal()">+ Add Shift</button>
    </div>`;
}


function openAddShiftModal() {
  openShiftModal(null);
}

function openEditShiftModal(shiftId) {
  const shift = allShifts.find(s => s.id === shiftId);
  openShiftModal(shift);
}

function openShiftModal(shift) {
  const box = document.querySelector('#message-modal .modal-box');
  const isEdit = !!shift;
  box.innerHTML = `
    <div class="modal-header">
      <span class="modal-title">${isEdit ? 'Edit Shift' : 'Add Shift'}</span>
      <button class="modal-close" onclick="closeModal('message-modal')">×</button>
    </div>
    <form id="shift-form">
      <div class="form-group"><label>Shift Name *<input type="text" id="shf-name" value="${escHtml(shift?.name||'')}" placeholder="e.g. Morning" required></label></div>
      <div class="form-row">
        <div class="form-group"><label>Start Time *<input type="time" id="shf-start" value="${escHtml(shift?.startTime||'07:00')}" required></label></div>
        <div class="form-group"><label>End Time *<input type="time" id="shf-end" value="${escHtml(shift?.endTime||'15:00')}" required></label></div>
      </div>
      <div class="form-group"><label>Color
        <input type="color" id="shf-color" value="${escHtml(shift?.color||'#2e7d32')}" style="width:60px;height:36px;padding:2px;border-radius:6px;cursor:pointer;margin-top:4px">
      </label></div>
      <p id="shf-error" class="form-error" hidden></p>
      <div class="modal-footer">
        <button type="button" class="btn btn-ghost" onclick="closeModal('message-modal')">Cancel</button>
        <button type="submit" class="btn btn-primary">Save Shift</button>
      </div>
    </form>`;
  document.getElementById('shift-form').onsubmit = async (e) => {
    e.preventDefault();
    const data = {
      name: document.getElementById('shf-name').value.trim(),
      startTime: document.getElementById('shf-start').value,
      endTime: document.getElementById('shf-end').value,
      color: document.getElementById('shf-color').value,
    };
    try {
      if (isEdit) {
        const updated = await api('PUT', '/api/shifts/' + shift.id, data);
        const idx = allShifts.findIndex(s => s.id === shift.id);
        if (idx !== -1) allShifts[idx] = updated;
      } else {
        const newShift = await api('POST', '/api/shifts', data);
        allShifts.push(newShift);
      }
      closeModal('message-modal');
      showToast(isEdit ? 'Shift updated' : 'Shift added', 'success');
      renderAttendanceTab();
    } catch(err) {
      document.getElementById('shf-error').textContent = err.message;
      document.getElementById('shf-error').hidden = false;
    }
  };
  document.querySelector('#message-modal .modal-backdrop').onclick = () => closeModal('message-modal');
  openModal('message-modal');
}

async function deleteShift(id) {
  showConfirm('Delete this shift?', async () => {
    try {
      await api('DELETE', '/api/shifts/' + id);
      allShifts = allShifts.filter(s => s.id !== id);
      showToast('Shift deleted', 'success');
      renderAttendanceTab();
    } catch(e) { showToast(e.message, 'error'); }
  });
}

function toggleAttMonthView() {
  attMonthView = !attMonthView;
  renderAttendanceTab();
}

async function renderAttendanceDay() {
  const date = selectedAttendanceDate;
  let records = [];
  try { records = await api('GET', '/api/attendance?date=' + date); } catch(e) {}

  const container = document.getElementById('att-content');
  if (!container) return;

  if (!isOwnerOrManager()) {
    // Own record only — editable so staff can mark their own duty in/out
    const rec = records.find(r => r.userId === currentUser.id);
    container.innerHTML = renderAttCardHTML(currentUser, rec, date, false);
    return;
  }

  const nonOwners = allUsers.filter(u => u.id !== currentUser.id);
  container.innerHTML = renderAttOwnerSummary(nonOwners, records, date);
}

function renderAttOwnerSummary(users, records, date) {
  if (users.length === 0) return '<div class="empty-state"><span class="empty-state-icon">👥</span><div class="empty-state-text">No staff found</div></div>';

  const rows = users.map(u => {
    const rec = records.find(r => r.userId === u.id);
    let status, statusColor;
    if (!rec) { status = 'Absent'; statusColor = '#ef5350'; }
    else if (rec.onLeave) { status = 'On Leave'; statusColor = '#ff9800'; }
    else if (rec.dutyIn) { status = 'Present'; statusColor = '#43a047'; }
    else { status = 'Absent'; statusColor = '#ef5350'; }

    const timeVal = (v) => v ? `<span style="font-weight:600;color:var(--text)">${v}</span>` : `<span style="color:var(--text-muted)">—</span>`;

    return `<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border);flex-wrap:wrap">
      <div style="min-width:120px">
        <div style="font-weight:600;font-size:14px">${escHtml(u.name)}</div>
        <span class="role-badge role-${roleCssClass(u.role)}" style="font-size:11px">${u.role}</span>
      </div>
      <span style="font-size:12px;font-weight:700;padding:2px 10px;border-radius:20px;background:${statusColor}22;color:${statusColor};min-width:72px;text-align:center">${status}</span>
      <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:13px">
        <span>In: ${timeVal(rec?.dutyIn)}</span>
        <span>Out: ${timeVal(rec?.dutyOut)}</span>
        <span>Break: ${timeVal(rec?.breakStart)}${rec?.breakStart||rec?.breakEnd?' – ':' '}${timeVal(rec?.breakEnd)}</span>
      </div>
      ${rec?.lateReason ? `<span style="font-size:11px;color:#f57c00;background:#fff3e0;padding:2px 8px;border-radius:10px">Late: ${escHtml(rec.lateReason)}</span>` : ''}
      ${rec?.leaveReason ? `<span style="font-size:11px;color:#7b1fa2;background:#f3e5f5;padding:2px 8px;border-radius:10px">Leave: ${escHtml(rec.leaveReason)}</span>` : ''}
    </div>`;
  }).join('');

  const present = records.filter(r => r.dutyIn && !r.onLeave).length;
  const onLeave = records.filter(r => r.onLeave).length;
  const absent = users.length - present - onLeave;

  return `
    <div style="display:flex;gap:10px;padding:10px 14px;background:var(--surface);border-bottom:2px solid var(--border)">
      <span style="font-size:13px;font-weight:600;color:#43a047">✓ Present: ${present}</span>
      <span style="font-size:13px;font-weight:600;color:#ff9800">⟳ Leave: ${onLeave}</span>
      <span style="font-size:13px;font-weight:600;color:#ef5350">✗ Absent: ${absent}</span>
    </div>
    <div>${rows}</div>`;
}

function getShiftForRecord(rec) {
  if (!rec?.shiftId) return null;
  return allShifts.find(s => s.id === rec.shiftId) || null;
}

function renderAttCardHTML(user, rec, date, readonly) {
  const uid = user.id;
  const assignedShift = getShiftForRecord(rec);
  const shiftStart = assignedShift ? assignedShift.startTime : (user.shiftStartTime || settings?.shiftStartTime || '10:00');

  const shiftOptions = allShifts.map(s =>
    `<option value="${s.id}" ${rec?.shiftId === s.id ? 'selected' : ''}>${escHtml(s.name)} (${s.startTime}–${s.endTime})</option>`
  ).join('');

  const shiftDisplay = assignedShift
    ? `<span style="display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:600;padding:2px 8px;border-radius:10px;background:${assignedShift.color}22;color:${assignedShift.color};border:1px solid ${assignedShift.color}">● ${escHtml(assignedShift.name)} ${assignedShift.startTime}–${assignedShift.endTime}</span>`
    : `<span style="font-size:11px;color:var(--text-muted)">No shift assigned</span>`;

  return `<div class="attendance-card" id="att-card-${uid}">
    <div class="attendance-staff-header">
      <div style="flex:1">
        <strong>${escHtml(user.name)}</strong> <span class="role-badge role-${roleCssClass(user.role)}">${user.role}</span>
        <div style="margin-top:5px">
          ${!readonly ? `
            <select id="shift-sel-${uid}" style="font-size:12px;padding:4px 6px;border:1px solid var(--border);border-radius:6px;background:#fff;max-width:220px">
              <option value="">— No shift —</option>
              ${shiftOptions}
            </select>` : shiftDisplay}
        </div>
      </div>
      ${!readonly ? `<button class="btn btn-primary btn-sm" onclick="saveAttendanceCard('${uid}','${date}')">Save</button>` : ''}
    </div>
    <div class="checkbox-row">
      <input type="checkbox" id="onleave-${uid}" ${rec?.onLeave?'checked':''} onchange="toggleLeaveUI('${uid}')">
      <label for="onleave-${uid}">On Leave</label>
    </div>
    <div id="time-fields-${uid}" ${rec?.onLeave?'style="display:none"':''}>
      ${attTimeRow('Duty In', 'dutyin', uid, rec?.dutyIn||'', readonly)}
      ${attTimeRow('Duty Out', 'dutyout', uid, rec?.dutyOut||'', readonly)}
      ${attTimeRow('Break Start', 'breakstart', uid, rec?.breakStart||'', readonly)}
      ${attTimeRow('Break End', 'breakend', uid, rec?.breakEnd||'', readonly)}
      ${!readonly ? `<div class="form-group" style="margin-top:6px"><label style="font-size:12px">Late Reason<input type="text" id="latereason-${uid}" value="${escHtml(rec?.lateReason||'')}" style="font-size:14px!important"></label></div>` : ''}
    </div>
    <div id="leave-fields-${uid}" ${!rec?.onLeave?'style="display:none"':''}>
      ${!readonly ? `<div class="form-group"><label style="font-size:12px">Leave Reason<input type="text" id="leavereason-${uid}" value="${escHtml(rec?.leaveReason||'')}" style="font-size:14px!important"></label></div>` : ''}
      ${readonly && rec?.leaveReason ? `<div style="font-size:13px;color:var(--text-muted)">Reason: ${escHtml(rec.leaveReason)}</div>` : ''}
    </div>
    ${rec ? `<div style="font-size:11px;color:var(--text-muted);margin-top:6px">Record ID: ${rec.id.slice(0,8)}…</div>` : ''}
  </div>`;
}

function attTimeRow(label, key, uid, val, readonly) {
  return `<div class="attendance-time-row">
    <span class="attendance-time-label">${label}</span>
    <input type="time" id="${key}-${uid}" class="attendance-time-input" value="${escHtml(val)}" ${readonly?'readonly':''}>
    ${!readonly ? `<button class="now-btn" onclick="setNow('${key}-${uid}')">Now</button>` : ''}
  </div>`;
}

function setNow(inputId) {
  const el = document.getElementById(inputId);
  if (el) el.value = getCurrentTime();
}

function toggleLeaveUI(uid) {
  const cb = document.getElementById('onleave-' + uid);
  const tf = document.getElementById('time-fields-' + uid);
  const lf = document.getElementById('leave-fields-' + uid);
  if (tf) tf.style.display = cb.checked ? 'none' : '';
  if (lf) lf.style.display = cb.checked ? '' : 'none';
}

async function saveAttendanceCard(userId, date) {
  const onLeave = document.getElementById('onleave-' + userId)?.checked || false;
  const dutyIn = document.getElementById('dutyin-' + userId)?.value || '';
  const dutyOut = document.getElementById('dutyout-' + userId)?.value || '';
  const breakStart = document.getElementById('breakstart-' + userId)?.value || '';
  const breakEnd = document.getElementById('breakend-' + userId)?.value || '';
  const lateReason = document.getElementById('latereason-' + userId)?.value || '';
  const leaveReason = document.getElementById('leavereason-' + userId)?.value || '';
  const shiftId = document.getElementById('shift-sel-' + userId)?.value || '';

  // Determine effective shift start time for late detection
  const assignedShift = allShifts.find(s => s.id === shiftId);
  const user = getUserById(userId);
  const effectiveShiftStart = assignedShift?.startTime || user?.shiftStartTime || settings?.shiftStartTime || '10:00';

  // Late detection: if duty-in is after shift start time on today
  if (dutyIn && date === todayDate() && dutyIn > effectiveShiftStart) {
    const managers = allUsers.filter(u => (u.role === 'Owner' || u.role === 'Manager') && u.phone);
    showLateModal(dutyIn, user?.name || '', managers, effectiveShiftStart);
  }

  const data = { userId, date, dutyIn, dutyOut, breakStart, breakEnd, onLeave, leaveReason, lateReason, shiftId, loggedBy: currentUser.id };

  try {
    const existing = allAttendance.find(r => r.userId === userId && r.date === date);
    if (existing) {
      const updated = await api('PUT', '/api/attendance/' + existing.id, data);
      const idx = allAttendance.findIndex(r => r.id === existing.id);
      if (idx !== -1) allAttendance[idx] = updated;
    } else {
      const newRec = await api('POST', '/api/attendance', data);
      allAttendance.push(newRec);
    }
    showToast('Attendance saved', 'success');
  } catch(e) { showToast(e.message, 'error'); }
}

function showLateModal(dutyIn, staffName, managers, shiftStart) {
  const box = document.querySelector('#late-modal .modal-box');
  box.innerHTML = `
    <div class="modal-header">
      <span class="modal-title">Late Check-In Detected</span>
      <button class="modal-close" onclick="closeModal('late-modal')">×</button>
    </div>
    <p style="margin-bottom:12px">Duty In marked at <strong>${dutyIn}</strong> — shift started at <strong>${shiftStart||'10:00'}</strong>. Please provide a reason:</p>
    <div class="form-group"><textarea id="late-reason-input" rows="3" placeholder="Reason for being late..."></textarea></div>
    <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">
      ${managers.map(m => `<button class="btn btn-wa" onclick="sendLateNotification('${escHtml(m.phone)}','${escHtml(m.name)}')">Send to ${escHtml(m.name)}</button>`).join('')}
      <button class="btn btn-ghost" onclick="closeModal('late-modal')">Skip, don't send</button>
    </div>`;
  document.querySelector('#late-modal .modal-backdrop').onclick = () => closeModal('late-modal');
  openModal('late-modal');
}

function sendLateNotification(phone, managerName) {
  const reason = document.getElementById('late-reason-input')?.value || '(no reason given)';
  const msg = `Late Duty-In Notification\nFrom: ${currentUser.name}\nTime: ${getCurrentTime()}\nReason: ${reason}\n— ${settings.resortName}`;
  openWhatsApp(phone, msg);
  closeModal('late-modal');
}

async function renderAttendanceMonth() {
  const container = document.getElementById('att-content');
  if (!container) return;
  const month = selectedMonth;
  let records = [];
  try { records = await api('GET', '/api/attendance?month=' + month); } catch(e) {}

  const daysInMonth = new Date(parseInt(month.split('-')[0]), parseInt(month.split('-')[1]), 0).getDate();
  const days = Array.from({length: daysInMonth}, (_, i) => String(i+1).padStart(2,'0'));
  const staffList = allUsers.filter(u => u.role !== 'Owner');

  const shiftStart = settings.shiftStartTime || '10:00';

  let html = `<div class="month-grid"><table>
    <thead><tr>
      <th class="staff-name-cell">Staff</th>
      ${days.map(d => `<th>${d}</th>`).join('')}
      <th>P</th>
    </tr></thead>
    <tbody>`;

  staffList.forEach(u => {
    let presentCount = 0;
    html += `<tr><td class="staff-name-cell">${escHtml(u.name)}</td>`;
    days.forEach(d => {
      const dateStr = month + '-' + d;
      const rec = records.find(r => r.userId === u.id && r.date === dateStr);
      let cls = 'att-dot--empty';
      if (rec) {
        if (rec.onLeave) cls = 'att-dot--leave';
        else if (rec.dutyIn) {
          presentCount++;
          cls = rec.dutyIn > shiftStart ? 'att-dot--late' : 'att-dot--present';
        }
      }
      html += `<td><span class="att-dot ${cls}" title="${dateStr}"></span></td>`;
    });
    html += `<td style="font-weight:600;color:var(--primary)">${presentCount}</td></tr>`;
  });

  html += `</tbody></table></div>
    <div style="padding:8px 12px;display:flex;gap:12px;font-size:11px;color:var(--text-muted)">
      <span>🟢 Present &nbsp;🟠 Late &nbsp;⚫ Leave &nbsp;⬜ No record</span>
    </div>`;
  container.innerHTML = html;
}

// ══════════════════════════════════════════════════════════════
//  SALARY TAB
// ══════════════════════════════════════════════════════════════
async function renderSalaryTab() {
  const tc = document.getElementById('tab-content');
  if (!isOwnerOrManager()) {
    tc.innerHTML = `<div class="access-denied"><div class="access-denied-icon">🔒</div><p>Salary information is only visible to Owner and Manager.</p></div>`;
    return;
  }

  const staffList = allUsers.filter(u => u.id !== currentUser.id || currentUser.role !== 'Owner');
  if (!salarySelectedUserId && staffList.length > 0) salarySelectedUserId = staffList[0].id;

  tc.innerHTML = `
    <div style="padding:10px 12px;background:var(--surface);border-bottom:1px solid var(--border)">
      <div class="form-row">
        <div><label style="font-size:12px;margin-bottom:2px">Staff Member<select id="salary-user-select" onchange="salarySelectedUserId=this.value;loadSalaryView()" style="font-size:14px!important;padding:7px 10px!important;margin-top:2px">
          ${allUsers.map(u => `<option value="${u.id}" ${u.id===salarySelectedUserId?'selected':''}>${escHtml(u.name)}</option>`).join('')}
        </select></label></div>
        <div><label style="font-size:12px;margin-bottom:2px">Month<input type="month" id="salary-month-picker" value="${selectedMonth}" onchange="selectedMonth=this.value;loadSalaryView()" style="font-size:14px!important;padding:7px 10px!important;margin-top:2px"></label></div>
      </div>
    </div>
    <div id="salary-content"></div>`;

  await loadSalaryView();
}

async function loadSalaryView() {
  const userId = salarySelectedUserId || (allUsers[0]?.id);
  const month = selectedMonth || currentMonth();
  if (!userId) return;

  const user = allUsers.find(u => u.id === userId);
  if (!user) return;

  let payments = [], attendance = [];
  try { payments = await api('GET', '/api/payments?userId=' + userId + '&month=' + month); } catch(e) {}
  try { attendance = await api('GET', '/api/attendance?userId=' + userId + '&month=' + month); } catch(e) {}

  allPayments = payments;

  const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
  const daysPresent = attendance.filter(r => r.dutyIn && !r.onLeave).length;
  const salary = user.monthlySalary || 0;
  const balance = salary - totalPaid;

  const container = document.getElementById('salary-content');
  if (!container) return;

  container.innerHTML = `
    <div class="salary-summary">
      <div class="summary-card"><div class="summary-card-value">${formatCurrency(salary)}</div><div class="summary-card-label">Monthly Salary</div></div>
      <div class="summary-card"><div class="summary-card-value">${daysPresent}</div><div class="summary-card-label">Days Present</div></div>
      <div class="summary-card"><div class="summary-card-value">${formatCurrency(totalPaid)}</div><div class="summary-card-label">Total Paid</div></div>
      <div class="summary-card"><div class="summary-card-value ${balance>0?'danger':''}">${formatCurrency(balance)}</div><div class="summary-card-label">Balance Due</div></div>
    </div>
    <div style="padding:0 12px;margin-bottom:8px">
      <button class="btn btn-primary btn-sm" onclick="openAddPaymentForm('${userId}')">+ Add Payment</button>
    </div>
    <div id="add-payment-form-area"></div>
    <div id="payment-list">
      ${payments.length === 0 ? '<div class="empty-state"><span class="empty-state-icon">💳</span><div class="empty-state-text">No payments this month</div></div>' :
        payments.sort((a,b)=>b.date.localeCompare(a.date)).map(p => paymentItemHTML(p, user)).join('')}
    </div>`;
}

function paymentItemHTML(p, user) {
  return `<div class="payment-item">
    ${p.photoData ? `<img src="${p.photoData}" class="payment-photo" onclick="showPhotoModalSrc('${p.id}')" onerror="this.style.display='none'">` : ''}
    <div class="payment-info">
      <div class="payment-amount">${formatCurrency(p.amount)}</div>
      <div class="payment-date">${formatDate(p.date)}</div>
      ${p.note ? `<div class="payment-note">${escHtml(p.note)}</div>` : ''}
    </div>
    <div class="payment-actions">
      ${user?.phone ? `<button class="btn btn-wa btn-xs" onclick="sendSalaryWA('${p.id}','${user.id}','${p.amount}','${p.date}')">📲</button>` : ''}
      <button class="btn-icon" onclick="deletePayment('${p.id}')">🗑️</button>
    </div>
  </div>`;
}

function openAddPaymentForm(userId) {
  const area = document.getElementById('add-payment-form-area');
  if (!area) return;
  area.innerHTML = `
    <div class="card" style="margin:0 12px 12px">
      <div style="font-weight:600;margin-bottom:10px">New Payment</div>
      <div class="form-group"><label>Amount (₹) *<input type="number" id="pay-amount" min="0" required></label></div>
      <div class="form-group"><label>Date *<input type="date" id="pay-date" value="${todayDate()}"></label></div>
      <div class="form-group"><label>Note (optional)<input type="text" id="pay-note"></label></div>
      <div class="form-group"><label>Receipt Photo (optional)<input type="file" id="pay-photo" accept="image/*" onchange="previewPayPhoto(this)"></label>
        <div id="pay-photo-preview"></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn btn-primary" onclick="submitAddPayment('${userId}')">Save Payment</button>
        <button class="btn btn-ghost" onclick="document.getElementById('add-payment-form-area').innerHTML=''">Cancel</button>
      </div>
    </div>`;
}

async function previewPayPhoto(input) {
  if (!input.files[0]) return;
  const b64 = await fileToBase64(input.files[0]);
  document.getElementById('pay-photo-preview').innerHTML = `<img src="${b64}" style="max-height:100px;border-radius:6px;margin-top:6px">`;
}

async function submitAddPayment(userId) {
  const amount = parseFloat(document.getElementById('pay-amount')?.value);
  const date = document.getElementById('pay-date')?.value;
  const note = document.getElementById('pay-note')?.value || '';
  const photoFile = document.getElementById('pay-photo')?.files[0];
  if (!amount || amount <= 0) { showToast('Enter a valid amount', 'error'); return; }
  let photoData = null;
  if (photoFile) photoData = await fileToBase64(photoFile);
  try {
    const p = await api('POST', '/api/payments', { userId, amount, date, note, photoData, loggedBy: currentUser.id });
    allPayments.push(p);
    showToast('Payment recorded', 'success');
    await loadSalaryView();
  } catch(e) { showToast(e.message, 'error'); }
}

async function deletePayment(id) {
  showConfirm('Delete this payment record?', async () => {
    try {
      await api('DELETE', '/api/payments/' + id);
      allPayments = allPayments.filter(p => p.id !== id);
      await loadSalaryView();
      showToast('Payment deleted', 'success');
    } catch(e) { showToast(e.message, 'error'); }
  });
}

function sendSalaryWA(paymentId, userId, amount, date) {
  const user = getUserById(userId);
  if (!user?.phone) { showToast('No phone number for this staff', 'info'); return; }
  const msg = `${user.name} जी,\nआपकी ${formatCurrency(amount)} salary ${formatDate(date)} को दी गई है।\n— ${settings.resortName}`;
  openWhatsApp(user.phone, msg);
}

function showPhotoModalSrc(src) {
  // src might be a payment ID or actual URL
  const box = document.querySelector('#photo-modal .modal-box');
  let imgSrc = src;
  if (!src.startsWith('data:') && !src.startsWith('/') && !src.startsWith('http')) {
    const p = allPayments.find(pay => pay.id === src);
    imgSrc = p?.photoData || src;
  }
  box.innerHTML = `
    <button class="modal-close" onclick="closeModal('photo-modal')" style="position:absolute;top:10px;right:10px;z-index:1">×</button>
    <img src="${imgSrc}" style="max-width:100%;border-radius:8px">`;
  document.querySelector('#photo-modal .modal-backdrop').onclick = () => closeModal('photo-modal');
  openModal('photo-modal');
}

// ══════════════════════════════════════════════════════════════
//  NOTIFY TAB
// ══════════════════════════════════════════════════════════════
let notifySubTab = 'messages';

function renderNotifyTab() {
  const tc = document.getElementById('tab-content');
  tc.innerHTML = `
    <div style="display:flex;border-bottom:2px solid var(--border);background:var(--surface);overflow-x:auto">
      <button class="notify-subtab ${notifySubTab==='messages'?'active':''}" onclick="switchNotifyTab('messages')">💬 Messages</button>
      <button class="notify-subtab ${notifySubTab==='vehicle'?'active':''}" onclick="switchNotifyTab('vehicle')" style="${notifySubTab==='vehicle'?'':'color:#c62828'}">🚗 Vehicle</button>
      <button class="notify-subtab ${notifySubTab==='food'?'active':''}" onclick="switchNotifyTab('food')" style="${notifySubTab==='food'?'':'color:#f57c00'}">🍽️ Food</button>
    </div>
    <div id="notify-subtab-content"></div>`;
  renderNotifySubTab();
}

function switchNotifyTab(tab) {
  notifySubTab = tab;
  renderNotifyTab();
}

async function renderNotifySubTab() {
  const tc = document.getElementById('notify-subtab-content');
  if (!tc) return;
  if (notifySubTab === 'vehicle') { await renderVehiclePermissionTab(tc); return; }
  if (notifySubTab === 'food')    { await renderFoodMenuTab(tc); return; }
  renderMessagesSubTab(tc);
}

function renderMessagesSubTab(tc) {

  if (isOwnerOrManager()) {
    const staffOptions = allUsers.map(u => `<option value="${u.id}">${escHtml(u.name)} (${u.role})</option>`).join('');
    const taskOptions = allTasks.filter(t => t.status !== 'Done').map(t => `<option value="${t.id}">${escHtml(t.title)}</option>`).join('');

    tc.innerHTML = `
      <div class="notify-section">
        <div class="notify-section-title">Send Message</div>
        <div class="form-group"><label>Recipient<select id="notify-recipient">
          <option value="all">— All Staff —</option>
          ${staffOptions}
        </select></label></div>
        <div class="form-group"><label>Type
          <select id="notify-type" onchange="updateNotifyTemplate()">
            <option value="message">Message</option>
            <option value="reminder">Reminder</option>
            <option value="warning">Warning</option>
          </select>
        </label></div>
        <div class="form-group"><label>Message<textarea id="notify-message" rows="4"></textarea></label></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
          <button class="btn btn-wa" onclick="sendNotifyWA()">📲 Send via WhatsApp</button>
          <button class="btn btn-sms" onclick="sendNotifySMS()">💬 Send via SMS</button>
          <span id="notify-call-link"></span>
        </div>
      </div>
      <div class="divider-section"></div>
      <div class="notify-section">
        <div class="notify-section-title">Task Reminder</div>
        <div class="form-group"><label>Select Task<select id="notify-task-select">
          <option value="">— Select a task —</option>
          ${taskOptions}
        </select></label></div>
        <button class="btn btn-primary btn-sm" onclick="sendTaskReminder()">📋 Send Task Reminder</button>
      </div>`;
    updateNotifyTemplate();
  } else {
    const owners = allUsers.filter(u => (u.role === 'Owner' || u.role === 'Manager') && u.phone);
    tc.innerHTML = `
      <div class="notify-section">
        <div class="notify-section-title">Notify Owner / Manager</div>
        <div class="form-group"><label>Date<input type="date" id="notify-date" value="${todayDate()}"></label></div>
        <div class="form-group"><label>Type<select id="notify-type2">
          <option value="Delay">Delay</option>
          <option value="Leave">Leave</option>
        </select></label></div>
        <div class="form-group"><label>Reason<textarea id="notify-reason" rows="3" placeholder="Explain the reason..."></textarea></label></div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px">
          ${owners.map(m => `<button class="btn btn-wa" onclick="sendStaffNotify('${escHtml(m.phone)}','${escHtml(m.name)}')">Send to ${escHtml(m.name)}</button>`).join('')}
          <button class="btn btn-ghost" onclick="sendStaffNotifyAny()">📤 Send to Anyone</button>
        </div>
      </div>`;
  }
}

function updateNotifyTemplate() {
  const type = document.getElementById('notify-type')?.value;
  const recipId = document.getElementById('notify-recipient')?.value;
  const recipName = recipId === 'all' ? 'Team' : getUserName(recipId);
  const templates = {
    message: `Hello ${recipName}, [your message here]. — ${settings.resortName}`,
    reminder: `Reminder for ${recipName}: Please complete your pending tasks. — ${settings.resortName}`,
    warning: `Warning for ${recipName}: Please maintain punctuality and work standards. — ${settings.resortName}`
  };
  const ta = document.getElementById('notify-message');
  if (ta) ta.value = templates[type] || '';

  const callLink = document.getElementById('notify-call-link');
  if (callLink) {
    const phone = recipId !== 'all' ? getUserPhone(recipId) : '';
    callLink.innerHTML = phone ? `<a href="tel:+91${phone}" class="btn btn-ghost">☎️ Call</a>` : '';
  }
}

function sendNotifyWA() {
  const recipId = document.getElementById('notify-recipient')?.value;
  const msg = document.getElementById('notify-message')?.value || '';
  if (recipId === 'all') { openWhatsAppAny(msg); return; }
  const phone = getUserPhone(recipId);
  if (phone) openWhatsApp(phone, msg); else openWhatsAppAny(msg);
}

function sendNotifySMS() {
  const recipId = document.getElementById('notify-recipient')?.value;
  const msg = document.getElementById('notify-message')?.value || '';
  const phone = recipId !== 'all' ? getUserPhone(recipId) : '';
  if (phone) openSMS(phone, msg); else showToast('No phone number available', 'info');
}

function sendTaskReminder() {
  const taskId = document.getElementById('notify-task-select')?.value;
  if (!taskId) { showToast('Select a task', 'info'); return; }
  const task = allTasks.find(t => t.id === taskId);
  if (!task) return;
  const phone = getUserPhone(task.assignedTo);
  const msg = `Task Reminder: "${task.title}"\nPriority: ${task.priority}${task.dueDate?'\nDue: '+formatDate(task.dueDate):''}\nPlease complete this task.\n— ${settings.resortName}`;
  if (phone) openWhatsApp(phone, msg); else openWhatsAppAny(msg);
}

function sendStaffNotify(phone, name) {
  const date = document.getElementById('notify-date')?.value || todayDate();
  const type = document.getElementById('notify-type2')?.value || 'Delay';
  const reason = document.getElementById('notify-reason')?.value || '';
  const msg = `${type} Notification\nDate: ${formatDate(date)}\nReason: ${reason || '(no reason given)'}\n— ${currentUser.name}, ${settings.resortName}`;
  openWhatsApp(phone, msg);
}

function sendStaffNotifyAny() {
  const date = document.getElementById('notify-date')?.value || todayDate();
  const type = document.getElementById('notify-type2')?.value || 'Delay';
  const reason = document.getElementById('notify-reason')?.value || '';
  const msg = `${type} Notification\nDate: ${formatDate(date)}\nReason: ${reason || '(no reason given)'}\n— ${currentUser.name}, ${settings.resortName}`;
  openWhatsAppAny(msg);
}

// ══════════════════════════════════════════════════════════════
//  FOOD MENU TAB
// ══════════════════════════════════════════════════════════════
async function renderFoodMenuTab(tc) {
  let menus = [];
  try { menus = await api('GET', '/api/food-menus?date=' + todayDate()); } catch(e) {}

  const mealOrder = { Breakfast: 0, Lunch: 1, Dinner: 2 };
  menus.sort((a, b) => (mealOrder[a.mealType]||0) - (mealOrder[b.mealType]||0));

  const canSetMenu = currentUser.role === 'Kitchen Staff' || isOwnerOrManager();
  const mealEmoji = { Breakfast: '🌅', Lunch: '☀️', Dinner: '🌙' };

  let html = `<div class="notify-section">
    <div class="notify-section-title" style="color:#f57c00">🍽️ Today's Staff Food — ${formatDate(todayDate())}</div>
    ${canSetMenu ? `<button class="btn btn-primary btn-sm" style="margin-bottom:12px" onclick="openSetMenuModal()">+ Set Meal Menu</button>` : ''}`;

  if (menus.length === 0) {
    html += `<div class="empty-state"><span class="empty-state-icon">🍽️</span><div class="empty-state-text">No menu set for today</div><div class="empty-state-sub">${canSetMenu ? 'Tap "+ Set Meal Menu" to add' : 'Kitchen staff will set the menu soon'}</div></div>`;
  } else {
    menus.forEach(menu => {
      const myResponse = menu.responses.find(r => r.userId === currentUser.id);
      const totalRoti  = menu.responses.filter(r => r.confirmed).reduce((s,r) => s + (r.roti||0), 0);
      const totalPuri  = menu.responses.filter(r => r.confirmed).reduce((s,r) => s + (r.puri||0), 0);
      const totalRice  = menu.responses.filter(r => r.confirmed && r.rice !== false).length;
      const confirmed  = menu.responses.filter(r => r.confirmed).length;
      const declined   = menu.responses.filter(r => !r.confirmed).length;

      html += `<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;margin-bottom:14px;overflow:hidden;box-shadow:var(--shadow)">
        <div style="background:#fff8e1;padding:10px 14px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
          <div>
            <span style="font-size:18px">${mealEmoji[menu.mealType]||'🍽️'}</span>
            <strong style="font-size:15px;margin-left:6px">${menu.mealType}</strong>
            ${menu.timing ? `<span style="font-size:12px;color:var(--text-muted);margin-left:8px">⏰ ${menu.timing}</span>` : ''}
          </div>
          <div style="display:flex;gap:6px">
            ${canSetMenu ? `<button class="btn-icon" onclick="openEditMenuModal('${menu.id}')">✏️</button>` : ''}
            ${isOwnerOrManager() ? `<button class="btn-icon" onclick="deleteFoodMenu('${menu.id}')">🗑️</button>` : ''}
          </div>
        </div>
        <div style="padding:10px 14px">
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">
            ${(menu.items||[]).map(item => `<span style="padding:3px 10px;background:#e8f5e9;color:#2e7d32;border-radius:12px;font-size:13px;font-weight:500">${escHtml(item)}</span>`).join('')}
          </div>
          ${isOwnerOrManager() ? `
          <div style="display:flex;gap:10px;font-size:12px;color:var(--text-muted);margin-bottom:10px;flex-wrap:wrap">
            <span>✅ Eating: <strong>${confirmed}</strong></span>
            <span>❌ Skipping: <strong>${declined}</strong></span>
            ${totalRoti > 0 ? `<span>🫓 Roti: <strong>${totalRoti}</strong></span>` : ''}
            ${totalPuri > 0 ? `<span>🫓 Puri: <strong>${totalPuri}</strong></span>` : ''}
            ${totalRice > 0 ? `<span>🍚 Rice: <strong>${totalRice} ppl</strong></span>` : ''}
          </div>
          <div style="margin-bottom:8px">
            ${menu.responses.length === 0 ? '<p style="font-size:12px;color:var(--text-muted)">No responses yet</p>' :
              menu.responses.map(r => {
                const u = getUserById(r.userId);
                const skips = r.skipItems?.length ? ' · Skip: ' + r.skipItems.join(', ') : '';
                const qtys = [r.roti > 0 ? r.roti + ' Roti' : '', r.puri > 0 ? r.puri + ' Puri' : '', r.rice === false ? 'No Rice' : ''].filter(Boolean).join(', ');
                return `<div style="font-size:12px;padding:4px 0;border-bottom:1px solid var(--border);display:flex;gap:6px;align-items:center">
                  <span>${r.confirmed ? '✅' : '❌'}</span>
                  <span style="flex:1"><strong>${escHtml(u?.name||'?')}</strong>${qtys ? ' · ' + qtys : ''}${skips ? escHtml(skips) : ''}${r.note ? ' · ' + escHtml(r.note) : ''}</span>
                </div>`;
              }).join('')}
          </div>` : ''}
          ${myResponse ? `
          <div style="background:#f1f8ff;border:1px solid #bbdefb;border-radius:8px;padding:8px 10px;font-size:13px;margin-bottom:8px">
            Your response: ${myResponse.confirmed ? '✅ Eating' : '❌ Skipping'}
            ${myResponse.roti > 0 ? ` · ${myResponse.roti} Roti` : ''}
            ${myResponse.puri > 0 ? ` · ${myResponse.puri} Puri` : ''}
            ${myResponse.rice === false ? ' · No Rice' : ''}
            ${myResponse.skipItems?.length ? ' · Skip: ' + myResponse.skipItems.join(', ') : ''}
            ${myResponse.note ? ` · "${escHtml(myResponse.note)}"` : ''}
          </div>` : ''}
          <button class="btn btn-primary btn-sm" onclick="openFoodResponseModal('${menu.id}','${menu.mealType}',${JSON.stringify(menu.items||[]).replace(/"/g,'&quot;')})">
            ${myResponse ? '✏️ Update Response' : '🍽️ Respond'}
          </button>
        </div>
      </div>`;
    });
  }
  html += '</div>';
  tc.innerHTML = html;
}

function openSetMenuModal(menuId, existing) {
  const box = document.querySelector('#message-modal .modal-box');
  const isEdit = !!existing;
  const meals = ['Breakfast','Lunch','Dinner'];
  const commonItems = ['Roti','Puri','Rice','Dal','Sabzi','Salad','Paneer','Chicken','Fish','Soup','Sweet','Papad','Pickle','Curd','Raita'];

  box.innerHTML = `
    <div class="modal-header">
      <span class="modal-title">${isEdit ? 'Edit' : 'Set'} Meal Menu</span>
      <button class="modal-close" onclick="closeModal('message-modal')">×</button>
    </div>
    <form id="menu-form">
      <div class="form-group"><label>Meal Type *<select id="menu-meal">
        ${meals.map(m => `<option value="${m}" ${existing?.mealType===m?'selected':''}>${m}</option>`).join('')}
      </select></label></div>
      <div class="form-group"><label>Meal Time *<input type="time" id="menu-time" value="${existing?.timing||''}" required></label></div>
      <div class="form-group">
        <label>Menu Items *</label>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px" id="menu-item-chips">
          ${(existing?.items||[]).map(item => menuItemChip(item)).join('')}
        </div>
        <div style="display:flex;gap:6px">
          <input type="text" id="menu-item-input" placeholder="Type item name..." style="flex:1;font-size:14px!important">
          <button type="button" class="btn btn-ghost btn-sm" onclick="addMenuItemChip()">Add</button>
        </div>
        <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:4px">
          ${commonItems.map(i => `<button type="button" class="btn btn-ghost btn-sm" style="font-size:11px;padding:3px 8px" onclick="addMenuItemChipValue('${i}')">${i}</button>`).join('')}
        </div>
      </div>
      <p id="menu-error" class="form-error" hidden></p>
      <div class="modal-footer">
        <button type="button" class="btn btn-ghost" onclick="closeModal('message-modal')">Cancel</button>
        <button type="submit" class="btn btn-primary">${isEdit ? 'Save' : 'Set Menu'}</button>
      </div>
    </form>`;

  document.getElementById('menu-form').onsubmit = async function(e) {
    e.preventDefault();
    const items = Array.from(document.querySelectorAll('.menu-chip-item')).map(el => el.dataset.item).filter(Boolean);
    if (items.length === 0) { document.getElementById('menu-error').textContent='Add at least one item'; document.getElementById('menu-error').hidden=false; return; }
    const data = { mealType: document.getElementById('menu-meal').value, timing: document.getElementById('menu-time').value, items, date: todayDate(), createdBy: currentUser.id };
    try {
      if (isEdit) await api('PUT', '/api/food-menus/' + menuId, data);
      else {
        const menu = await api('POST', '/api/food-menus', data);
        // Notify all staff via WhatsApp
        const msg = `🍽️ ${data.mealType} Menu for today (${formatDate(todayDate())})\n⏰ Time: ${data.timing}\nItems: ${items.join(', ')}\nPlease respond in the app with your food preference.\n— ${settings.resortName}`;
        const staffWithPhone = allUsers.filter(u => u.phone && u.id !== currentUser.id);
        if (staffWithPhone.length > 0) openWhatsApp(staffWithPhone[0].phone, msg);
      }
      closeModal('message-modal');
      showToast(isEdit ? 'Menu updated' : 'Menu set & staff notified', 'success');
      notifySubTab = 'food';
      renderNotifyTab();
    } catch(err) { document.getElementById('menu-error').textContent=err.message; document.getElementById('menu-error').hidden=false; }
  };
  document.querySelector('#message-modal .modal-backdrop').onclick = () => closeModal('message-modal');
  openModal('message-modal');
}

function menuItemChip(item) {
  return `<span class="menu-chip-item" data-item="${escHtml(item)}" style="display:inline-flex;align-items:center;gap:4px;background:#e8f5e9;color:#2e7d32;border-radius:12px;padding:3px 10px;font-size:13px">
    ${escHtml(item)} <span onclick="this.parentElement.remove()" style="cursor:pointer;font-size:14px;line-height:1;margin-left:2px">×</span>
  </span>`;
}

function addMenuItemChip() {
  const input = document.getElementById('menu-item-input');
  const val = input?.value.trim();
  if (!val) return;
  document.getElementById('menu-item-chips').insertAdjacentHTML('beforeend', menuItemChip(val));
  input.value = '';
}

function addMenuItemChipValue(val) {
  document.getElementById('menu-item-chips').insertAdjacentHTML('beforeend', menuItemChip(val));
}

async function openEditMenuModal(menuId) {
  let menus = [];
  try { menus = await api('GET', '/api/food-menus?date=' + todayDate()); } catch(e) {}
  const menu = menus.find(m => m.id === menuId);
  if (menu) openSetMenuModal(menuId, menu);
}

function openFoodResponseModal(menuId, mealType, items) {
  const box = document.querySelector('#task-modal .modal-box');
  box.innerHTML = `
    <div class="modal-header">
      <span class="modal-title">🍽️ ${mealType} Response</span>
      <button class="modal-close" onclick="closeModal('task-modal')">×</button>
    </div>
    <form id="food-resp-form">
      <div class="form-group">
        <label style="font-weight:600">Will you eat ${mealType}?</label>
        <div style="display:flex;gap:10px;margin-top:6px">
          <label style="display:flex;align-items:center;gap:6px;font-weight:400"><input type="radio" name="food-confirm" value="yes" checked> ✅ Yes, I'll eat</label>
          <label style="display:flex;align-items:center;gap:6px;font-weight:400"><input type="radio" name="food-confirm" value="no"> ❌ Skip</label>
        </div>
      </div>
      <div id="food-qty-section">
        <div style="font-weight:600;font-size:13px;margin-bottom:8px">How many do you want?</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px">
          <div class="form-group" style="margin:0"><label style="font-size:13px">Roti<input type="number" id="resp-roti" value="2" min="0" max="20" style="width:60px!important;font-size:15px!important;padding:6px!important;margin-top:4px"></label></div>
          <div class="form-group" style="margin:0"><label style="font-size:13px">Puri<input type="number" id="resp-puri" value="0" min="0" max="20" style="width:60px!important;font-size:15px!important;padding:6px!important;margin-top:4px"></label></div>
        </div>
        <div class="form-group">
          <label style="font-weight:600;font-size:13px">Skip items (select what you don't want):</label>
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">
            ${items.map(item => `<label style="display:flex;align-items:center;gap:5px;font-size:13px;font-weight:400;background:var(--bg);padding:4px 10px;border-radius:10px">
              <input type="checkbox" class="skip-item-chk" value="${escHtml(item)}"> ${escHtml(item)}
            </label>`).join('')}
          </div>
        </div>
      </div>
      <div class="form-group"><label>Note (optional)<input type="text" id="resp-note" placeholder="e.g. Less spice, no onion..."></label></div>
      <div class="modal-footer">
        <button type="button" class="btn btn-ghost" onclick="closeModal('task-modal')">Cancel</button>
        <button type="submit" class="btn btn-primary">Submit Response</button>
      </div>
    </form>`;

  document.querySelectorAll('input[name="food-confirm"]').forEach(r => {
    r.addEventListener('change', () => {
      document.getElementById('food-qty-section').style.display = r.value === 'yes' ? '' : 'none';
    });
  });

  document.getElementById('food-resp-form').onsubmit = async function(e) {
    e.preventDefault();
    const confirmed = document.querySelector('input[name="food-confirm"]:checked')?.value === 'yes';
    const roti = parseInt(document.getElementById('resp-roti')?.value)||0;
    const puri = parseInt(document.getElementById('resp-puri')?.value)||0;
    const skipItems = Array.from(document.querySelectorAll('.skip-item-chk:checked')).map(c => c.value);
    const rice = !skipItems.includes('Rice');
    const note = document.getElementById('resp-note')?.value||'';
    try {
      await api('POST', '/api/food-menus/' + menuId + '/respond', { userId: currentUser.id, confirmed, roti, puri, rice, skipItems, note });
      closeModal('task-modal');
      showToast('Response saved', 'success');
      notifySubTab = 'food';
      renderNotifyTab();
    } catch(err) { showToast(err.message, 'error'); }
  };
  document.querySelector('#task-modal .modal-backdrop').onclick = () => closeModal('task-modal');
  openModal('task-modal');
}

async function deleteFoodMenu(id) {
  showConfirm('Delete this meal menu?', async () => {
    try { await api('DELETE', '/api/food-menus/' + id); showToast('Deleted','success'); renderNotifyTab(); }
    catch(e) { showToast(e.message,'error'); }
  });
}

// ══════════════════════════════════════════════════════════════
//  VEHICLE PERMISSION TAB
// ══════════════════════════════════════════════════════════════
async function renderVehiclePermissionTab(tc) {
  let perms = [];
  try { perms = await api('GET', '/api/vehicle-permissions'); } catch(e) {}
  perms.sort((a,b) => b.createdAt.localeCompare(a.createdAt));

  const statusBadge = s => {
    const map = { Pending:'#f57c00', Approved:'#2e7d32', Denied:'#c62828' };
    return `<span style="padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;background:${map[s]||'#999'}22;color:${map[s]||'#999'};border:1px solid ${map[s]||'#999'}">${s}</span>`;
  };

  if (isOwnerOrManager()) {
    const pending = perms.filter(p => p.status === 'Pending');
    const others  = perms.filter(p => p.status !== 'Pending');

    tc.innerHTML = `
      <div class="notify-section">
        <div class="notify-section-title" style="color:#c62828">🚗 Vehicle Permission Requests</div>
        <button class="btn btn-primary btn-sm" style="margin-bottom:12px" onclick="openVehicleRequestModal()">+ New Request</button>

        ${pending.length === 0 ? '<p style="color:var(--text-muted);font-size:13px">No pending requests</p>' :
          pending.map(p => vehiclePermCardHTML(p, statusBadge, true)).join('')}

        ${others.length > 0 ? `
          <div style="font-weight:600;font-size:13px;margin:14px 0 8px;color:var(--text-muted)">Past Requests</div>
          ${others.map(p => vehiclePermCardHTML(p, statusBadge, false)).join('')}` : ''}
      </div>`;
  } else {
    const mine = perms.filter(p => p.requestedBy === currentUser.id);
    tc.innerHTML = `
      <div class="notify-section">
        <div class="notify-section-title" style="color:#c62828">🚗 Vehicle Permission</div>
        <p style="font-size:13px;color:var(--text-muted);margin-bottom:10px">Request owner approval before using any resort vehicle.</p>
        <button class="btn btn-primary btn-sm" style="margin-bottom:12px" onclick="openVehicleRequestModal()">+ Request Permission</button>
        ${mine.length === 0 ? '<p style="color:var(--text-muted);font-size:13px">No requests yet</p>' :
          mine.map(p => vehiclePermCardHTML(p, statusBadge, false)).join('')}
      </div>`;
  }
}

function vehiclePermCardHTML(p, statusBadge, canAction) {
  const requester = getUserById(p.requestedBy);
  return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:10px;box-shadow:var(--shadow)">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <strong style="font-size:14px">${escHtml(requester?.name || 'Unknown')}</strong>
      ${statusBadge(p.status)}
    </div>
    <div style="font-size:13px;color:var(--text-muted);display:grid;gap:3px">
      <span>🚗 Vehicle: <strong>${escHtml(p.vehicleType||'—')}</strong></span>
      <span>📍 Destination: <strong>${escHtml(p.destination||'—')}</strong></span>
      <span>📅 Date: <strong>${formatDate(p.date)}</strong> &nbsp; 🕐 ${escHtml(p.startTime||'—')} → ${escHtml(p.endTime||'—')}</span>
      <span>📝 Reason: ${escHtml(p.reason||'—')}</span>
      ${p.fine > 0 ? `<span style="color:#c62828;font-weight:600">⚠️ Fine: ₹${p.fine} — ${escHtml(p.fineReason)}</span>` : ''}
      ${p.notes ? `<span>💬 Note: ${escHtml(p.notes)}</span>` : ''}
    </div>
    ${canAction && isOwnerOrManager() ? `
    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
      <button class="btn btn-primary btn-sm" onclick="approveVehicle('${p.id}')">✅ Approve</button>
      <button class="btn btn-danger btn-sm" onclick="denyVehicle('${p.id}')">❌ Deny</button>
      <button class="btn btn-ghost btn-sm" onclick="openFineModal('${p.id}')">⚠️ Set Fine</button>
      ${requester?.phone ? `<button class="btn btn-wa btn-sm" onclick="notifyVehicleWA('${p.id}','${escHtml(requester.phone)}')">📲 Notify</button>` : ''}
    </div>` : ''}
    ${!canAction && isOwnerOrManager() && p.status !== 'Pending' ? `
    <div style="display:flex;gap:8px;margin-top:8px">
      <button class="btn btn-ghost btn-sm" onclick="openFineModal('${p.id}')">⚠️ Set Fine</button>
      <button class="btn-icon" onclick="deleteVehiclePerm('${p.id}')">🗑️</button>
    </div>` : ''}
  </div>`;
}

function openVehicleRequestModal() {
  const box = document.querySelector('#message-modal .modal-box');
  const vehicles = ['Car','Bike','Scooter','Auto','Truck','Other'];
  box.innerHTML = `
    <div class="modal-header">
      <span class="modal-title">🚗 Vehicle Permission Request</span>
      <button class="modal-close" onclick="closeModal('message-modal')">×</button>
    </div>
    <form id="vp-form">
      <div class="form-group"><label>Vehicle Type *<select id="vp-vehicle">
        ${vehicles.map(v=>`<option value="${v}">${v}</option>`).join('')}
      </select></label></div>
      <div class="form-group"><label>Destination / Region *<input type="text" id="vp-dest" placeholder="e.g. Market, City, Village" required></label></div>
      <div class="form-group"><label>Date *<input type="date" id="vp-date" value="${todayDate()}" required></label></div>
      <div class="form-row">
        <div class="form-group"><label>Start Time *<input type="time" id="vp-start" required></label></div>
        <div class="form-group"><label>End Time *<input type="time" id="vp-end" required></label></div>
      </div>
      <div class="form-group"><label>Reason *<textarea id="vp-reason" rows="2" placeholder="Purpose of vehicle use..." required></textarea></label></div>
      <p style="font-size:12px;color:#c62828;font-weight:500;margin-bottom:8px">⚠️ Using vehicle without owner approval may result in a fine.</p>
      <div class="modal-footer">
        <button type="button" class="btn btn-ghost" onclick="closeModal('message-modal')">Cancel</button>
        <button type="submit" class="btn btn-primary">Submit Request</button>
      </div>
    </form>`;
  document.getElementById('vp-form').onsubmit = async function(e) {
    e.preventDefault();
    const data = {
      requestedBy: currentUser.id,
      vehicleType: document.getElementById('vp-vehicle').value,
      destination: document.getElementById('vp-dest').value.trim(),
      date: document.getElementById('vp-date').value,
      startTime: document.getElementById('vp-start').value,
      endTime: document.getElementById('vp-end').value,
      reason: document.getElementById('vp-reason').value.trim(),
    };
    try {
      await api('POST', '/api/vehicle-permissions', data);
      // Notify owner via WhatsApp
      const owner = allUsers.find(u => u.role === 'Owner');
      if (owner?.phone) {
        const msg = `🚗 Vehicle Permission Request\nFrom: ${currentUser.name}\nVehicle: ${data.vehicleType}\nDestination: ${data.destination}\nDate: ${formatDate(data.date)}, ${data.startTime}–${data.endTime}\nReason: ${data.reason}\n— ${settings.resortName}`;
        openWhatsApp(owner.phone, msg);
      }
      closeModal('message-modal');
      showToast('Request submitted', 'success');
      notifySubTab = 'vehicle';
      renderNotifyTab();
    } catch(err) { showToast(err.message, 'error'); }
  };
  document.querySelector('#message-modal .modal-backdrop').onclick = () => closeModal('message-modal');
  openModal('message-modal');
}

async function approveVehicle(id) {
  try {
    const perm = await api('PUT', '/api/vehicle-permissions/' + id, { status: 'Approved', approvedBy: currentUser.id });
    const requester = getUserById(perm.requestedBy);
    if (requester?.phone) {
      const msg = `✅ Vehicle Permission Approved!\nVehicle: ${perm.vehicleType}\nDestination: ${perm.destination}\nDate: ${formatDate(perm.date)}, ${perm.startTime}–${perm.endTime}\nApproved by: ${currentUser.name}\n— ${settings.resortName}`;
      openWhatsApp(requester.phone, msg);
    }
    showToast('Approved & notified', 'success');
    renderNotifyTab();
  } catch(e) { showToast(e.message, 'error'); }
}

async function denyVehicle(id) {
  try {
    const perm = await api('PUT', '/api/vehicle-permissions/' + id, { status: 'Denied', approvedBy: currentUser.id });
    const requester = getUserById(perm.requestedBy);
    if (requester?.phone) {
      const msg = `❌ Vehicle Permission Denied\nVehicle: ${perm.vehicleType}\nDestination: ${perm.destination}\nDenied by: ${currentUser.name}\nPlease contact the owner for more info.\n— ${settings.resortName}`;
      openWhatsApp(requester.phone, msg);
    }
    showToast('Denied & notified', 'success');
    renderNotifyTab();
  } catch(e) { showToast(e.message, 'error'); }
}

function openFineModal(id) {
  const box = document.querySelector('#confirm-modal .modal-box');
  box.innerHTML = `
    <div class="modal-header"><span class="modal-title">⚠️ Set Fine</span></div>
    <p style="margin-bottom:10px;font-size:13px;color:var(--text-muted)">Set a fine for unauthorized or misuse of vehicle.</p>
    <div class="form-group"><label>Fine Amount (₹) *<input type="number" id="fine-amount" min="0" placeholder="e.g. 500"></label></div>
    <div class="form-group"><label>Reason *<input type="text" id="fine-reason" placeholder="e.g. Used without permission"></label></div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal('confirm-modal')">Cancel</button>
      <button class="btn btn-danger" onclick="saveFine('${id}')">Apply Fine</button>
    </div>`;
  openModal('confirm-modal');
}

async function saveFine(id) {
  const fine = parseFloat(document.getElementById('fine-amount')?.value) || 0;
  const fineReason = document.getElementById('fine-reason')?.value.trim() || '';
  if (!fine || !fineReason) { showToast('Enter fine amount and reason', 'error'); return; }
  try {
    const perm = await api('PUT', '/api/vehicle-permissions/' + id, { fine, fineReason, status: 'Denied' });
    const requester = getUserById(perm.requestedBy);
    if (requester?.phone) {
      const msg = `⚠️ Vehicle Fine Notice\nDear ${requester.name},\nA fine of ₹${fine} has been applied.\nReason: ${fineReason}\nThis will be deducted from your salary.\n— ${settings.resortName}`;
      openWhatsApp(requester.phone, msg);
    }
    closeModal('confirm-modal');
    showToast('Fine applied & notified', 'success');
    renderNotifyTab();
  } catch(e) { showToast(e.message, 'error'); }
}

function notifyVehicleWA(id, phone) {
  const perm = { id };
  const msg = `Regarding your vehicle permission request at ${settings.resortName} — please check the app for status.`;
  openWhatsApp(phone, msg);
}

async function deleteVehiclePerm(id) {
  showConfirm('Delete this vehicle permission record?', async () => {
    try {
      await api('DELETE', '/api/vehicle-permissions/' + id);
      showToast('Deleted', 'success');
      renderNotifyTab();
    } catch(e) { showToast(e.message, 'error'); }
  });
}

// ══════════════════════════════════════════════════════════════
//  INVENTORY TAB
// ══════════════════════════════════════════════════════════════
async function renderInventoryTab() {
  const tc = document.getElementById('tab-content');
  if (!canAccessInventory()) {
    tc.innerHTML = `<div class="access-denied"><div class="access-denied-icon">🔒</div><p>Inventory is only accessible to Owner, Manager, and Kitchen Staff.</p></div>`;
    return;
  }

  try { allInventory = await api('GET', '/api/inventory'); } catch(e) {}
  try { inventoryCategories = await api('GET', '/api/inventoryCategories'); } catch(e) {}

  const cats = ['All', ...inventoryCategories];
  let filteredItems = selectedInventoryCategory === 'All' ? allInventory : allInventory.filter(i => i.category === selectedInventoryCategory);
  if (invLowStockOnly) filteredItems = filteredItems.filter(i => Number(i.quantity) <= Number(i.threshold) && Number(i.threshold) > 0);

  let html = `
    <div class="category-tabs" id="inv-cat-tabs">
      ${cats.map(c => `<button class="cat-tab ${selectedInventoryCategory===c?'active':''}" onclick="setInvCategory('${escHtml(c)}')">${escHtml(c)}</button>`).join('')}
      <button class="cat-tab" onclick="showAddCategoryInput()" title="Add category">+</button>
    </div>
    <div id="new-inv-cat-row" style="display:none;padding:8px 12px;display:none;gap:8px;align-items:center;background:var(--surface);border-bottom:1px solid var(--border)">
      <input type="text" id="new-inv-cat-input" placeholder="New category name" style="flex:1;font-size:14px!important;padding:7px!important">
      <button class="btn btn-primary btn-sm" onclick="addInventoryCategory()">Add</button>
      <button class="btn btn-ghost btn-sm" onclick="document.getElementById('new-inv-cat-row').style.display='none'">Cancel</button>
    </div>
    <div style="display:flex;gap:6px;padding:8px 12px;flex-wrap:wrap;align-items:center">
      <button class="btn btn-sm ${!invHistoryView&&!invLowStockOnly&&!invPurchaseLogView?'btn-primary':'btn-ghost'}" onclick="invHistoryView=false;invLowStockOnly=false;invPurchaseMode=false;invPurchaseLogView=false;renderInventoryTab()">Items</button>
      <button class="btn btn-sm ${invHistoryView?'btn-primary':'btn-ghost'}" onclick="invHistoryView=true;invLowStockOnly=false;invPurchaseMode=false;invPurchaseLogView=false;renderInventoryTab()">History</button>
      <button class="btn btn-sm ${invPurchaseLogView?'btn-primary':'btn-ghost'}" onclick="invPurchaseLogView=true;invHistoryView=false;invLowStockOnly=false;invPurchaseMode=false;renderInventoryTab()">📅 Purchases</button>
      <button class="btn btn-sm ${invLowStockOnly?'btn-danger':'btn-ghost'}" onclick="invLowStockOnly=!invLowStockOnly;invHistoryView=false;invPurchaseMode=false;invPurchaseLogView=false;renderInventoryTab()">⚠️ Low Stock</button>
      <div style="flex:1"></div>
      ${currentUser.role === 'Kitchen Staff' ? `<button class="btn btn-sm ${invPurchaseMode?'btn-danger':'btn-ghost'}" onclick="togglePurchaseMode()">${invPurchaseMode?'✕ Cancel':'🛒 खरीद Request'}</button>` : `
      <button class="btn btn-primary btn-sm" onclick="openAddItemModal()">+ Item</button>
      <button class="btn btn-ghost btn-sm" onclick="openBulkAddModal()">📦 Bulk Add</button>`}
    </div>`;

  if (invPurchaseLogView) {
    html += await renderPurchaseLogHTML();
  } else if (invHistoryView) {
    html += await renderInventoryHistoryHTML();
  } else {
    if (filteredItems.length === 0) {
      html += `<div class="empty-state"><span class="empty-state-icon">📦</span><div class="empty-state-text">No items${invLowStockOnly?' low on stock':''}</div></div>`;
    } else {
      html += `<div id="inv-list">` + filteredItems.map(item => invItemHTML(item)).join('') + `</div>`;
    }
  }

  tc.innerHTML = html;

  // always remove stale bar first, then re-add if still in purchase mode
  document.getElementById('purchase-bar')?.remove();
  if (invPurchaseMode) {
    const bar = document.createElement('div');
    bar.id = 'purchase-bar';
    bar.style.cssText = 'position:fixed;bottom:56px;left:0;right:0;background:var(--primary);color:#fff;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;z-index:200;box-shadow:0 -2px 8px rgba(0,0,0,0.2)';
    const count = Object.keys(invPurchaseSelected).length;
    bar.innerHTML = `<span style="font-weight:600;font-size:14px">${count} item${count!==1?'s':''} selected<br><span style="font-size:11px;font-weight:400;opacity:0.85">Tap item to select, set qty needed</span></span>
      <button onclick="openPurchaseRequestModal()" ${count===0?'disabled':''} style="background:#fff;color:var(--primary);border:none;padding:8px 18px;border-radius:20px;font-weight:700;font-size:14px;cursor:pointer;opacity:${count===0?'0.5':'1'}">Send Request 📤</button>`;
    document.body.appendChild(bar);
  }
}

function togglePurchaseMode() {
  invPurchaseMode = !invPurchaseMode;
  if (!invPurchaseMode) invPurchaseSelected = {};
  renderInventoryTab();
}

function togglePurchaseItem(id) {
  if (invPurchaseSelected[id]) {
    delete invPurchaseSelected[id];
  } else {
    const item = allInventory.find(i => i.id === id);
    if (item) invPurchaseSelected[id] = { name: item.name, nameHindi: item.nameHindi||'', unit: item.unit, qty: 1 };
  }
  renderInventoryTab();
}

function updatePurchaseQty(id, val) {
  if (invPurchaseSelected[id]) invPurchaseSelected[id].qty = Math.max(1, parseInt(val)||1);
}

function openPurchaseRequestModal() {
  const items = Object.values(invPurchaseSelected);
  if (items.length === 0) { showToast('Select at least one item', 'info'); return; }
  const recipients = allUsers.filter(u => u.role === 'Owner' || u.role === 'Manager');
  const recipientNames = recipients.map(u => escHtml(u.name)).join(' & ') || 'Owner';
  const box = document.querySelector('#message-modal .modal-box');
  box.innerHTML = `
    <div class="modal-header">
      <span class="modal-title">🛒 Purchase Request / खरीद सूची</span>
      <button class="modal-close" onclick="closeModal('message-modal')">×</button>
    </div>
    <div style="padding:12px">
      <div style="font-size:13px;font-weight:600;margin-bottom:8px;color:var(--text-muted)">Items to purchase:</div>
      <div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:12px">
        ${items.map((it,i) => `<div style="display:flex;justify-content:space-between;padding:8px 12px;${i>0?'border-top:1px solid var(--border)':''}">
          <span style="font-size:14px">${escHtml(it.name)}${it.nameHindi?` / ${escHtml(it.nameHindi)}`:''}</span>
          <span style="font-weight:700;color:var(--primary)">${it.qty} ${escHtml(it.unit)}</span>
        </div>`).join('')}
      </div>
      <div class="form-group"><label>Note (optional)<input type="text" id="pr-note" placeholder="e.g. needed urgently for dinner" style="font-size:14px!important"></label></div>
      <p id="pr-error" class="form-error" hidden></p>
      <div class="modal-footer">
        <button class="btn btn-primary" onclick="submitPurchaseRequest()">Send to ${recipientNames} 📤</button>
      </div>
    </div>`;
  document.querySelector('#message-modal .modal-backdrop').onclick = () => closeModal('message-modal');
  openModal('message-modal');
}

async function submitPurchaseRequest() {
  const items = Object.values(invPurchaseSelected);
  const note = document.getElementById('pr-note')?.value.trim() || '';
  const recipients = allUsers.filter(u => u.role === 'Owner' || u.role === 'Manager');
  const primaryRecipient = recipients[0] || null;
  const buyingListItems = items.map(it => ({ name: it.name, qty: it.qty, unit: it.unit, rate: 0 }));
  try {
    await api('POST', '/api/tasks', {
      title: `Purchase Request by ${currentUser.name}${note?' — '+note:''}`,
      category: 'Inventory Purchase',
      assignedTo: primaryRecipient?.id || null,
      requestedBy: currentUser.id,
      priority: 'Normal',
      status: 'Pending',
      dueDate: todayDate(),
      notes: note,
      buyingListItems,
    });
    invPurchaseMode = false;
    invPurchaseSelected = {};
    closeModal('message-modal');
    showToast('Purchase request sent!', 'success');
    // Send WhatsApp to every Owner and Manager who has a phone number
    const list = items.map(it => `• ${it.name} — ${it.qty} ${it.unit}`).join('\n');
    const msg = `🛒 Purchase Request\nFrom: ${currentUser.name}\n\n${list}${note?'\n\nNote: '+note:''}\n— ${settings.resortName}`;
    recipients.filter(u => u.phone).forEach(u => openWhatsApp(u.phone, msg));
    renderInventoryTab();
  } catch(e) {
    const el = document.getElementById('pr-error');
    if (el) { el.textContent = e.message; el.hidden = false; }
  }
}

function setInvCategory(cat) {
  selectedInventoryCategory = cat;
  renderInventoryTab();
}

function showAddCategoryInput() {
  const row = document.getElementById('new-inv-cat-row');
  if (row) { row.style.display = 'flex'; document.getElementById('new-inv-cat-input')?.focus(); }
}

async function addInventoryCategory() {
  const name = document.getElementById('new-inv-cat-input')?.value.trim();
  if (!name) return;
  try {
    inventoryCategories = await api('POST', '/api/inventoryCategories', { name });
    selectedInventoryCategory = name;
    renderInventoryTab();
    showToast('Category added', 'success');
  } catch(e) { showToast(e.message, 'error'); }
}

function invItemHTML(item) {
  const low = Number(item.quantity) <= Number(item.threshold) && Number(item.threshold) > 0;
  const val = item.rate > 0 ? '₹' + (Number(item.quantity) * Number(item.rate)).toLocaleString('en-IN') : '';
  const sel = invPurchaseSelected[item.id];

  if (invPurchaseMode) {
    return `<div class="inv-item ${low?'low-stock':''} ${sel?'inv-item-selected':''}" data-id="${item.id}" onclick="togglePurchaseItem('${item.id}')" style="cursor:pointer">
      <div style="display:flex;align-items:center;gap:10px;flex:1">
        <input type="checkbox" ${sel?'checked':''} onclick="event.stopPropagation();togglePurchaseItem('${item.id}')" style="width:18px;height:18px;cursor:pointer;flex-shrink:0">
        <div class="inv-item-info" style="flex:1">
          <div class="inv-item-name">${escHtml(item.name)}${item.nameHindi?` / ${escHtml(item.nameHindi)}`:''}</div>
          <div class="inv-item-value">Stock: ${item.quantity} ${item.unit}${low?' ⚠️ Low':''}</div>
        </div>
      </div>
      ${sel ? `<div onclick="event.stopPropagation()" style="display:flex;align-items:center;gap:6px;flex-shrink:0">
        <input type="number" min="1" value="${sel.qty}" id="pqty-${item.id}"
          oninput="updatePurchaseQty('${item.id}',this.value)"
          style="width:64px;font-size:14px!important;padding:5px!important;border:1px solid var(--primary);border-radius:6px;text-align:center">
        <span style="font-size:12px;color:var(--text-muted)">${item.unit}</span>
      </div>` : ''}
    </div>`;
  }

  return `<div class="inv-item ${low?'low-stock':''}" data-id="${item.id}">
    <div class="inv-item-info">
      <div class="inv-item-name">${escHtml(item.name)}</div>
      ${item.nameHindi ? `<div class="inv-item-hindi">${escHtml(item.nameHindi)}</div>` : ''}
      ${val ? `<div class="inv-item-value">${val} stock · ₹${item.rate}/${item.unit}</div>` : `<div class="inv-item-value">${item.unit}</div>`}
      ${low ? `<div style="font-size:11px;color:var(--danger);font-weight:600">⚠️ Low stock (threshold: ${item.threshold})</div>` : ''}
    </div>
    <div class="inv-qty-controls">
      <button class="qty-btn" onclick="changeQty('${item.id}', -1)">−</button>
      <input type="number" class="qty-input" id="qty-${item.id}" value="${Number(item.quantity)}" min="0" onchange="onQtyChange('${item.id}', this.value)" onclick="this.select()">
      <button class="qty-btn" onclick="changeQty('${item.id}', 1)">+</button>
    </div>
    <div class="inv-item-actions">
      <button class="btn-icon" onclick="openEditItemModal('${item.id}')">✏️</button>
      <button class="btn-icon" onclick="deleteInventoryItem('${item.id}')">🗑️</button>
    </div>
  </div>`;
}

function changeQty(id, delta) {
  const input = document.getElementById('qty-' + id);
  if (!input) return;
  const newVal = Math.max(0, (parseFloat(input.value) || 0) + delta);
  input.value = newVal;
  onQtyChange(id, newVal);
}

function onQtyChange(id, val) {
  clearTimeout(invQtyDebounce[id]);
  invQtyDebounce[id] = setTimeout(() => updateInventoryQty(id, parseFloat(val) || 0), 800);
}

async function updateInventoryQty(id, newQty) {
  const item = allInventory.find(i => i.id === id);
  if (!item) return;
  const oldQty = Number(item.quantity);
  const diff = newQty - oldQty;
  try {
    await api('PUT', '/api/inventory/' + id, { quantity: newQty });
    item.quantity = newQty;
    if (diff > 0) {
      await api('POST', '/api/inventory/history', { date: todayDate(), category: item.category, name: item.name, nameHindi: item.nameHindi, qty: diff, unit: item.unit, rate: item.rate, source: 'Manual', loggedBy: currentUser.id });
    }
    // Update display without full re-render
    const el = document.getElementById('qty-' + id);
    if (el) { el.value = newQty; }
  } catch(e) { showToast(e.message, 'error'); }
}

function openAddItemModal() {
  const box = document.querySelector('#message-modal .modal-box');
  const units = ['kg','gram','liter','ml','pcs','dozen','packet','box','bottle','bag','tin'];
  const catOpts = inventoryCategories.map(c => `<option value="${c}" ${c===selectedInventoryCategory?'selected':''}>${escHtml(c)}</option>`).join('');
  box.innerHTML = `
    <div class="modal-header">
      <span class="modal-title">Add Inventory Item</span>
      <button class="modal-close" onclick="closeModal('message-modal')">×</button>
    </div>
    <form id="add-item-form">
      <div class="form-group"><label>Category<select id="ai-cat">${catOpts}</select></label></div>
      <div class="form-group"><label>Item Name (English) *<input type="text" id="ai-name" required></label></div>
      <div class="form-group"><label>Hindi Name (optional)<input type="text" id="ai-hindi" placeholder="e.g. आलू"></label></div>
      <div class="form-row">
        <div class="form-group"><label>Unit<select id="ai-unit">${units.map(u=>`<option value="${u}">${u}</option>`).join('')}</select></label></div>
        <div class="form-group"><label>Starting Qty<input type="number" id="ai-qty" value="0" min="0"></label></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Rate (₹/unit)<input type="number" id="ai-rate" value="0" min="0"></label></div>
        <div class="form-group"><label>Low Stock Alert<input type="number" id="ai-threshold" value="1" min="0"></label></div>
      </div>
      <div class="modal-footer">
        <button type="submit" class="btn btn-primary">Add Item</button>
      </div>
    </form>`;
  document.getElementById('add-item-form').onsubmit = async function(e) {
    e.preventDefault();
    const data = { category: document.getElementById('ai-cat').value, name: document.getElementById('ai-name').value.trim(), nameHindi: document.getElementById('ai-hindi').value.trim(), unit: document.getElementById('ai-unit').value, quantity: parseFloat(document.getElementById('ai-qty').value)||0, rate: parseFloat(document.getElementById('ai-rate').value)||0, threshold: parseFloat(document.getElementById('ai-threshold').value)||1 };
    try {
      const item = await api('POST', '/api/inventory', data);
      allInventory.push(item);
      closeModal('message-modal');
      renderInventoryTab();
      showToast('Item added', 'success');
    } catch(e) { showToast(e.message, 'error'); }
  };
  document.querySelector('#message-modal .modal-backdrop').onclick = () => closeModal('message-modal');
  openModal('message-modal');
}

function openEditItemModal(itemId) {
  const item = allInventory.find(i => i.id === itemId);
  if (!item) return;
  const units = ['kg','gram','liter','ml','pcs','dozen','packet','box','bottle','bag','tin'];
  const box = document.querySelector('#message-modal .modal-box');
  box.innerHTML = `
    <div class="modal-header">
      <span class="modal-title">Edit Item</span>
      <button class="modal-close" onclick="closeModal('message-modal')">×</button>
    </div>
    <form id="edit-item-form">
      <div class="form-group"><label>Name<input type="text" id="ei-name" value="${escHtml(item.name)}" required></label></div>
      <div class="form-group"><label>Hindi Name<input type="text" id="ei-hindi" value="${escHtml(item.nameHindi||'')}"></label></div>
      <div class="form-row">
        <div class="form-group"><label>Unit<select id="ei-unit">${units.map(u=>`<option value="${u}" ${item.unit===u?'selected':''}>${u}</option>`).join('')}</select></label></div>
        <div class="form-group"><label>Rate (₹)<input type="number" id="ei-rate" value="${item.rate||0}" min="0"></label></div>
      </div>
      <div class="form-group"><label>Low Stock Threshold<input type="number" id="ei-threshold" value="${item.threshold||1}" min="0"></label></div>
      <div class="modal-footer">
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>`;
  document.getElementById('edit-item-form').onsubmit = async function(e) {
    e.preventDefault();
    const updates = { name: document.getElementById('ei-name').value.trim(), nameHindi: document.getElementById('ei-hindi').value.trim(), unit: document.getElementById('ei-unit').value, rate: parseFloat(document.getElementById('ei-rate').value)||0, threshold: parseFloat(document.getElementById('ei-threshold').value)||1 };
    try {
      const updated = await api('PUT', '/api/inventory/' + item.id, updates);
      const idx = allInventory.findIndex(i => i.id === item.id);
      if (idx !== -1) allInventory[idx] = updated;
      closeModal('message-modal');
      renderInventoryTab();
      showToast('Item updated', 'success');
    } catch(e) { showToast(e.message, 'error'); }
  };
  document.querySelector('#message-modal .modal-backdrop').onclick = () => closeModal('message-modal');
  openModal('message-modal');
}

async function deleteInventoryItem(id) {
  showConfirm('Delete this inventory item?', async () => {
    try {
      await api('DELETE', '/api/inventory/' + id);
      allInventory = allInventory.filter(i => i.id !== id);
      renderInventoryTab();
      showToast('Item deleted', 'success');
    } catch(e) { showToast(e.message, 'error'); }
  });
}

function openBulkAddModal() {
  const box = document.querySelector('#buying-list-modal .modal-box');
  const items = selectedInventoryCategory === 'All' ? allInventory : allInventory.filter(i => i.category === selectedInventoryCategory);

  box.innerHTML = `
    <div class="modal-header">
      <span class="modal-title">Bulk Add Stock</span>
      <button class="modal-close" onclick="closeModal('buying-list-modal')">×</button>
    </div>
    <div class="search-box"><input type="text" class="search-input" id="bulk-search" placeholder="Search items..." oninput="filterBulkList(this.value)"></div>
    <div id="bulk-item-list">
      ${items.map(item => `
        <div class="buying-list-item bulk-item-row" data-name="${escHtml(item.name).toLowerCase()}">
          <input type="checkbox" id="blk-chk-${item.id}">
          <label for="blk-chk-${item.id}" style="flex:2;font-size:13px">${escHtml(item.name)}<br><small style="color:var(--text-muted)">${escHtml(item.nameHindi||'')} · ${item.quantity} ${item.unit}</small></label>
          <input type="number" id="blk-qty-${item.id}" placeholder="Qty" min="0" style="width:65px;font-size:14px!important;padding:6px!important">
          <input type="number" id="blk-rate-${item.id}" placeholder="₹" value="${item.rate||0}" min="0" style="width:65px;font-size:14px!important;padding:6px!important">
        </div>`).join('')}
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal('buying-list-modal')">Cancel</button>
      <button class="btn btn-primary" onclick="submitBulkAdd()">Add to Stock</button>
    </div>`;
  document.querySelector('#buying-list-modal .modal-backdrop').onclick = () => closeModal('buying-list-modal');
  openModal('buying-list-modal');
}

function filterBulkList(q) {
  document.querySelectorAll('.bulk-item-row').forEach(row => {
    row.style.display = row.dataset.name.includes(q.toLowerCase()) ? '' : 'none';
  });
}

async function submitBulkAdd() {
  const entries = [];
  allInventory.forEach(item => {
    const chk = document.getElementById('blk-chk-' + item.id);
    const qty = parseFloat(document.getElementById('blk-qty-' + item.id)?.value) || 0;
    const rate = parseFloat(document.getElementById('blk-rate-' + item.id)?.value) || item.rate || 0;
    if (chk?.checked && qty > 0) entries.push({ id: item.id, qty, rate });
  });
  if (entries.length === 0) { showToast('Select at least one item', 'info'); return; }
  try {
    await api('POST', '/api/inventory/bulk-add', { entries, loggedBy: currentUser.id, source: 'Bulk Add', date: todayDate() });
    allInventory = await api('GET', '/api/inventory');
    closeModal('buying-list-modal');
    renderInventoryTab();
    showToast(entries.length + ' items updated', 'success');
  } catch(e) { showToast(e.message, 'error'); }
}

async function renderInventoryHistoryHTML() {
  let history = [];
  try {
    const cat = selectedInventoryCategory !== 'All' ? '&category=' + encodeURIComponent(selectedInventoryCategory) : '';
    history = await api('GET', '/api/inventory/history?'+cat);
  } catch(e) {}
  history.sort((a,b) => b.date.localeCompare(a.date));
  if (history.length === 0) return '<div class="empty-state"><span class="empty-state-icon">📜</span><div class="empty-state-text">No history yet</div></div>';
  return `<div class="history-table-wrap"><table class="history-table">
    <thead><tr><th>Date</th><th>Item</th><th>Qty</th><th>Unit</th><th>Rate</th><th>Source</th></tr></thead>
    <tbody>${history.slice(0,100).map(h => `<tr>
      <td>${formatDate(h.date)}</td>
      <td>${escHtml(h.name)}<br><small style="color:var(--text-muted)">${escHtml(h.nameHindi||'')}</small></td>
      <td style="font-weight:600;color:var(--primary)">+${h.qty}</td>
      <td>${escHtml(h.unit)}</td>
      <td>${h.rate ? '₹'+h.rate : '—'}</td>
      <td style="font-size:11px">${escHtml(h.source||'')}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

async function renderPurchaseLogHTML() {
  let history = [];
  try {
    history = await api('GET', '/api/inventory/history');
  } catch(e) {}
  // Filter only purchase events
  const purchases = history.filter(h => h.source === 'Purchase' || h.source === 'Task' || h.source === 'Bulk Add');
  if (purchases.length === 0) return '<div class="empty-state"><span class="empty-state-icon">🛒</span><div class="empty-state-text">No purchases yet</div><div class="empty-state-sub">Mark an Inventory Purchase task as Done to record a purchase</div></div>';

  // Group by date
  const byDate = {};
  purchases.forEach(h => {
    if (!byDate[h.date]) byDate[h.date] = [];
    byDate[h.date].push(h);
  });
  const dates = Object.keys(byDate).sort((a,b) => b.localeCompare(a));

  return dates.map(date => {
    const rows = byDate[date];
    const total = rows.reduce((s, h) => s + (h.rate ? h.qty * h.rate : 0), 0);
    return `<div style="margin:8px 12px;background:var(--surface);border-radius:10px;box-shadow:var(--shadow);overflow:hidden">
      <div style="padding:10px 14px;background:var(--primary-lt);display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border)">
        <span style="font-weight:700;font-size:14px">📅 ${formatDate(date)}</span>
        ${total > 0 ? `<span style="font-size:13px;font-weight:600;color:var(--primary)">Total: ₹${total.toLocaleString('en-IN')}</span>` : ''}
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="background:#f5f5f5">
          <th style="padding:7px 12px;text-align:left;font-weight:600">Item</th>
          <th style="padding:7px 8px;text-align:center;font-weight:600">Qty</th>
          <th style="padding:7px 8px;text-align:center;font-weight:600">Unit</th>
          <th style="padding:7px 8px;text-align:right;font-weight:600">Rate</th>
          <th style="padding:7px 8px;text-align:right;font-weight:600">Amount</th>
        </tr></thead>
        <tbody>${rows.map((h,i) => `<tr style="${i%2===0?'':'background:#fafafa'}">
          <td style="padding:7px 12px">${escHtml(h.name)}${h.nameHindi?`<br><span style="font-size:11px;color:var(--text-muted)">${escHtml(h.nameHindi)}</span>`:''}</td>
          <td style="padding:7px 8px;text-align:center;font-weight:600;color:var(--primary)">+${h.qty}</td>
          <td style="padding:7px 8px;text-align:center">${escHtml(h.unit||'')}</td>
          <td style="padding:7px 8px;text-align:right">${h.rate ? '₹'+h.rate : '—'}</td>
          <td style="padding:7px 8px;text-align:right;font-weight:600">${h.rate ? '₹'+(h.qty*h.rate).toLocaleString('en-IN') : '—'}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════════
//  EXPENSES TAB
// ══════════════════════════════════════════════════════════════
async function renderExpensesTab() {
  const tc = document.getElementById('tab-content');
  if (!isOwnerOrManager()) {
    tc.innerHTML = `<div class="access-denied"><div class="access-denied-icon">🔒</div><p>Expenses are only visible to Owner and Manager.</p></div>`;
    return;
  }

  let expenses = allExpenses;
  const expCatFilter = document.getElementById('exp-cat-filter')?.value || 'All';

  tc.innerHTML = `
    <div style="padding:10px 12px 4px;background:var(--surface);border-bottom:1px solid var(--border)">
      <div class="form-row">
        <div><label style="font-size:12px">Month<input type="month" id="exp-month-picker" value="${selectedMonth}" onchange="selectedMonth=this.value;reloadExpenses()" style="font-size:14px!important;padding:7px!important;margin-top:2px"></label></div>
        <div><label style="font-size:12px">Category<select id="exp-cat-filter" onchange="renderExpensesTab()" style="font-size:14px!important;padding:7px!important;margin-top:2px">
          <option value="All">All</option>
          ${expenseCategories.map(c=>`<option value="${c}" ${expCatFilter===c?'selected':''}>${escHtml(c)}</option>`).join('')}
        </select></label></div>
      </div>
    </div>
    <div id="exp-content"></div>`;

  await renderExpensesContent();
}

async function reloadExpenses() {
  try { allExpenses = await api('GET', '/api/expenses?month=' + selectedMonth); } catch(e) {}
  renderExpensesContent();
}

async function renderExpensesContent() {
  const container = document.getElementById('exp-content');
  if (!container) return;

  const catFilter = document.getElementById('exp-cat-filter')?.value || 'All';
  let expenses = catFilter === 'All' ? allExpenses : allExpenses.filter(e => e.category === catFilter);
  expenses = expenses.sort((a,b) => b.date.localeCompare(a.date));

  const total = expenses.reduce((s,e) => s+e.amount, 0);
  const byCategory = {};
  allExpenses.forEach(e => { byCategory[e.category] = (byCategory[e.category]||0) + e.amount; });
  const maxVal = Math.max(...Object.values(byCategory), 1);

  let html = `
    <div class="expense-total">
      <div class="expense-total-label">Total Expenses — ${selectedMonth}</div>
      <div class="expense-total-amount">${formatCurrency(total)}</div>
    </div>
    <div class="expense-bar-section">
      ${Object.entries(byCategory).map(([cat, amt]) => `
        <div class="expense-bar-row">
          <span class="expense-bar-label">${escHtml(cat)}</span>
          <div class="expense-bar-track"><div class="expense-bar-fill" style="width:${Math.round(amt/maxVal*100)}%"></div></div>
          <span class="expense-bar-value">${formatCurrency(amt)}</span>
        </div>`).join('')}
    </div>
    <div style="padding:8px 12px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-primary btn-sm" onclick="openExpenseModal(null)">+ Add Expense</button>
      <button class="btn btn-ghost btn-sm" onclick="toggleManageExpCats()">⚙️ Categories</button>
    </div>
    <div id="manage-exp-cats" style="display:none;padding:8px 12px;background:var(--surface);border-bottom:1px solid var(--border)">
      <div style="font-size:12px;font-weight:600;margin-bottom:6px">Expense Categories</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">
        ${expenseCategories.map(c => `<span style="padding:3px 10px;background:var(--bg);border-radius:12px;font-size:12px">${escHtml(c)}</span>`).join('')}
      </div>
      <div class="cat-add-row">
        <input type="text" id="new-exp-cat-input" placeholder="New category" style="font-size:14px!important">
        <button class="btn btn-primary btn-sm" onclick="addExpenseCategory()">Add</button>
      </div>
    </div>`;

  if (expenses.length === 0) {
    html += `<div class="empty-state"><span class="empty-state-icon">💸</span><div class="empty-state-text">No expenses found</div></div>`;
  } else {
    html += expenses.map(e => expenseItemHTML(e)).join('');
  }

  container.innerHTML = html;
}

function toggleManageExpCats() {
  const el = document.getElementById('manage-exp-cats');
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

async function addExpenseCategory() {
  const name = document.getElementById('new-exp-cat-input')?.value.trim();
  if (!name) return;
  try {
    expenseCategories = await api('POST', '/api/expenseCategories', { name });
    renderExpensesTab();
    showToast('Category added', 'success');
  } catch(e) { showToast(e.message, 'error'); }
}

function expenseItemHTML(e) {
  return `<div class="expense-item">
    ${e.photoData ? `<img src="${e.photoData}" class="expense-photo" onclick="showPhotoModalSrc('${e.id}')" onerror="this.style.display='none'">` : ''}
    <div class="expense-info">
      <div class="expense-amount">${formatCurrency(e.amount)}</div>
      <div style="display:flex;gap:6px;align-items:center;margin-top:2px">
        <span class="badge badge-category">${escHtml(e.category)}</span>
        <span style="font-size:11px;color:var(--text-muted)">${formatDate(e.date)}</span>
      </div>
      ${e.description ? `<div class="expense-desc">${escHtml(e.description)}</div>` : ''}
      ${e.loggedBy ? `<div class="expense-meta">By: ${escHtml(getUserName(e.loggedBy))}</div>` : ''}
    </div>
    <div class="expense-actions">
      <button class="btn-icon" onclick="openExpenseModal('${e.id}')">✏️</button>
      <button class="btn-icon" onclick="deleteExpense('${e.id}')">🗑️</button>
    </div>
  </div>`;
}

function openExpenseModal(expenseId) {
  const expense = expenseId ? allExpenses.find(e => e.id === expenseId) : null;
  const isEdit = !!expense;
  const box = document.querySelector('#task-modal .modal-box');
  box.innerHTML = `
    <div class="modal-header">
      <span class="modal-title">${isEdit ? 'Edit Expense' : 'Add Expense'}</span>
      <button class="modal-close" onclick="closeModal('task-modal')">×</button>
    </div>
    <form id="expense-form">
      <div class="form-group"><label>Date *<input type="date" id="ef-date" value="${expense?.date||todayDate()}" required></label></div>
      <div class="form-group"><label>Category *<select id="ef-cat">
        ${expenseCategories.map(c=>`<option value="${c}" ${expense?.category===c?'selected':''}>${escHtml(c)}</option>`).join('')}
      </select></label></div>
      <div class="form-group"><label>Amount (₹) *<input type="number" id="ef-amount" value="${expense?.amount||''}" min="0" required></label></div>
      <div class="form-group"><label>Description<input type="text" id="ef-desc" value="${escHtml(expense?.description||'')}"></label></div>
      <div class="form-group"><label>Receipt Photo (optional)<input type="file" id="ef-photo" accept="image/*" onchange="previewExpensePhoto(this)"></label>
        <div id="ef-photo-preview">${expense?.photoData?`<img src="${expense.photoData}" style="max-height:100px;border-radius:6px;margin-top:6px">`:''}</div>
      </div>
      <div class="modal-footer">
        <button type="submit" class="btn btn-primary">${isEdit?'Save Changes':'Add Expense'}</button>
      </div>
    </form>`;
  document.getElementById('expense-form').onsubmit = async function(e) {
    e.preventDefault();
    await saveExpense(expenseId);
  };
  document.querySelector('#task-modal .modal-backdrop').onclick = () => closeModal('task-modal');
  openModal('task-modal');
}

async function previewExpensePhoto(input) {
  if (!input.files[0]) return;
  const b64 = await fileToBase64(input.files[0]);
  document.getElementById('ef-photo-preview').innerHTML = `<img src="${b64}" style="max-height:100px;border-radius:6px;margin-top:6px">`;
}

async function saveExpense(expenseId) {
  const date = document.getElementById('ef-date')?.value;
  const category = document.getElementById('ef-cat')?.value;
  const amount = parseFloat(document.getElementById('ef-amount')?.value) || 0;
  const description = document.getElementById('ef-desc')?.value || '';
  const photoFile = document.getElementById('ef-photo')?.files[0];
  let photoData = expenseId ? (allExpenses.find(e=>e.id===expenseId)?.photoData||null) : null;
  if (photoFile) photoData = await fileToBase64(photoFile);

  const data = { date, category, amount, description, photoData, loggedBy: currentUser.id };
  try {
    if (expenseId) {
      const updated = await api('PUT', '/api/expenses/' + expenseId, data);
      const idx = allExpenses.findIndex(e => e.id === expenseId);
      if (idx !== -1) allExpenses[idx] = updated;
      showToast('Expense updated', 'success');
    } else {
      const newExp = await api('POST', '/api/expenses', data);
      allExpenses.push(newExp);
      showToast('Expense added', 'success');
    }
    closeModal('task-modal');
    await reloadExpenses();
  } catch(e) { showToast(e.message, 'error'); }
}

async function deleteExpense(id) {
  showConfirm('Delete this expense?', async () => {
    try {
      await api('DELETE', '/api/expenses/' + id);
      allExpenses = allExpenses.filter(e => e.id !== id);
      await reloadExpenses();
      showToast('Expense deleted', 'success');
    } catch(e) { showToast(e.message, 'error'); }
  });
}

// ══════════════════════════════════════════════════════════════
//  SIGN OUT
// ══════════════════════════════════════════════════════════════
function signOut() {
  stopPolling();
  currentUser = null; settings = null;
  allUsers = []; allTasks = []; allAttendance = []; allPayments = [];
  allInventory = []; inventoryHistory = []; allExpenses = [];
  expenseCategories = []; inventoryCategories = [];
  kitchenAlertLastNotified = {};

  // Hide banners
  ['kitchen-alert-banner','lowstock-alert-banner','missed-duty-banner'].forEach(id => {
    document.getElementById(id).style.display = 'none';
  });

  // Remove fab
  const fab = document.getElementById('tasks-fab');
  if (fab) fab.remove();

  document.getElementById('app').hidden = true;
  document.getElementById('signin-name').value = '';

  api('GET', '/api/settings').then(s => {
    settings = s;
    showSigninScreen();
  }).catch(() => {});
}
