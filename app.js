// ═══════════════════════════════════════════════
// RoofIgnite Client Portal
// ═══════════════════════════════════════════════

const SHEET_ID = CONFIG.SHEET_ID;
const SHEETS = CONFIG.SHEETS;

let currentUser = null;   // { email }
let isAdmin = false;
let allowedAccounts = [];
let allAccounts = [];
let allCycles = [];
let allLeads = [];
let activeLeadFilter = 'all';
let currentAccountName = '';

// ═══════════════════════════════════════════════
//  FIREBASE AUTH
// ═══════════════════════════════════════════════

firebase.initializeApp(CONFIG.FIREBASE);
const auth = firebase.auth();

// Check URL params for invite signup flow
const _urlParams = new URLSearchParams(window.location.search);
const _inviteEmail = _urlParams.get('email');
const _inviteAccount = _urlParams.get('account');

function initAuth() {
  auth.onAuthStateChanged(user => {
    if (user) {
      onAuthSuccess({ email: user.email });
    } else {
      showAuthGate();
    }
  });
}

function showAuthGate() {
  document.getElementById('auth-gate').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
  document.getElementById('loading-state').classList.add('hidden');
  document.getElementById('access-denied').classList.add('hidden');

  // If invite link, show signup form with pre-filled email
  if (_inviteEmail) {
    showSignupForm();
    document.getElementById('signup-email').value = _inviteEmail;
    if (_inviteAccount) {
      document.getElementById('signup-msg').textContent = 'Create your account to view ' + _inviteAccount + "'s dashboard";
    }
  }
}

function showLoginForm() {
  document.getElementById('login-form').classList.remove('hidden');
  document.getElementById('signup-form').classList.add('hidden');
  document.getElementById('reset-form').classList.add('hidden');
  document.getElementById('auth-error').textContent = '';
}

function showSignupForm() {
  document.getElementById('login-form').classList.add('hidden');
  document.getElementById('signup-form').classList.remove('hidden');
  document.getElementById('reset-form').classList.add('hidden');
  document.getElementById('signup-error').textContent = '';
}

function showResetForm() {
  document.getElementById('login-form').classList.add('hidden');
  document.getElementById('signup-form').classList.add('hidden');
  document.getElementById('reset-form').classList.remove('hidden');
  document.getElementById('reset-error').textContent = '';
}

async function handleLogin() {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const errEl = document.getElementById('auth-error');
  errEl.textContent = '';
  if (!email || !password) { errEl.textContent = 'Enter email and password'; return; }
  try {
    await auth.signInWithEmailAndPassword(email, password);
  } catch(e) {
    if (e.code === 'auth/user-not-found') errEl.textContent = 'No account found with this email.';
    else if (e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential') errEl.textContent = 'Incorrect password.';
    else if (e.code === 'auth/too-many-requests') errEl.textContent = 'Too many attempts. Try again later.';
    else errEl.textContent = e.message;
  }
}

async function handleSignup() {
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const confirm = document.getElementById('signup-confirm').value;
  const errEl = document.getElementById('signup-error');
  errEl.textContent = '';
  if (!email) { errEl.textContent = 'Email is required'; return; }
  if (password.length < 6) { errEl.textContent = 'Password must be at least 6 characters'; return; }
  if (password !== confirm) { errEl.textContent = 'Passwords do not match'; return; }
  try {
    await auth.createUserWithEmailAndPassword(email, password);
    // Clean up URL params after successful signup
    window.history.replaceState({}, '', window.location.pathname);
  } catch(e) {
    if (e.code === 'auth/email-already-in-use') errEl.textContent = 'An account with this email already exists. Try signing in.';
    else if (e.code === 'auth/weak-password') errEl.textContent = 'Password is too weak.';
    else errEl.textContent = e.message;
  }
}

async function handleReset() {
  const email = document.getElementById('reset-email').value.trim();
  const errEl = document.getElementById('reset-error');
  errEl.textContent = '';
  if (!email) { errEl.textContent = 'Enter your email'; return; }
  try {
    await auth.sendPasswordResetEmail(email);
    errEl.style.color = '#34d399';
    errEl.textContent = 'Reset email sent. Check your inbox.';
  } catch(e) {
    errEl.style.color = '#f87171';
    if (e.code === 'auth/user-not-found') errEl.textContent = 'No account found with this email.';
    else errEl.textContent = e.message;
  }
}

function onAuthSuccess(user) {
  currentUser = user;
  isAdmin = user.email.endsWith('@' + CONFIG.ADMIN_DOMAIN);
  document.getElementById('auth-gate').classList.add('hidden');
  document.getElementById('user-email').textContent = user.email;
  if (isAdmin) document.getElementById('admin-badge').classList.remove('hidden');
  document.getElementById('loading-state').classList.remove('hidden');
  loadAndRender();
}

function handleSignOut() {
  auth.signOut();
  currentUser = null;
  isAdmin = false;
  document.getElementById('app').classList.add('hidden');
  document.getElementById('access-denied').classList.add('hidden');
  document.getElementById('loading-state').classList.add('hidden');
  showAuthGate();
}

// ═══════════════════════════════════════════════
//  DATA LOADING
// ═══════════════════════════════════════════════

async function loadAndRender() {
  try {
    // 1. Discover pods from Apps Script (same as Command Centre)
    await discoverPods();

    // 2. Fetch client access mapping + pod data + lead data in parallel
    const [accessMap, podResults, leadResults] = await Promise.all([
      fetchClientAccess(),
      fetchAllPods(),
      fetchAllLeads()
    ]);

    // 3. Merge pod + lead results
    allAccounts = [];
    allCycles = [];
    allLeads = leadResults.flat();
    for (const result of podResults) {
      if (!result) continue;
      allAccounts.push(...result.accounts);
      allCycles.push(...result.cycles);
    }

    // Link cycles to accounts
    for (const acct of allAccounts) {
      acct.cycles = allCycles.filter(c => c.account === acct.name && c.adAccountId === acct.adAccountId);
      if (!acct.cycles.length) acct.cycles = allCycles.filter(c => c.account === acct.name);
    }

    // 4. Access control
    if (isAdmin) {
      allowedAccounts = allAccounts.map(a => a.name);
    } else {
      const email = currentUser.email.toLowerCase();
      allowedAccounts = (accessMap[email] || []);
    }

    if (allowedAccounts.length === 0 && !isAdmin) {
      document.getElementById('loading-state').classList.add('hidden');
      document.getElementById('access-denied').classList.remove('hidden');
      return;
    }

    // 5. Render
    document.getElementById('loading-state').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');

    if (isAdmin || allowedAccounts.length > 1) {
      showAccountPicker(allowedAccounts);
    }

    const defaultAccount = allowedAccounts[0];
    renderDashboard(defaultAccount);

  } catch(err) {
    console.error('Load error:', err);
    document.getElementById('loading-state').classList.add('hidden');
    document.getElementById('dashboard-content').innerHTML = `<div class="glass" style="padding:40px;text-align:center;"><p style="color:#f87171;">Failed to load data</p><p style="color:#64748b;font-size:13px;margin-top:8px;">${err.message}</p></div>`;
    document.getElementById('app').classList.remove('hidden');
  }
}

async function discoverPods() {
  try {
    const resp = await fetch(CONFIG.APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'getPodRegistry' }),
      redirect: 'follow',
    });
    const text = await resp.text();
    const data = JSON.parse(text);
    if (data.ok && data.pods) {
      for (const pod of data.pods) {
        if (pod.active && pod.name && pod.gid !== undefined) {
          SHEETS[pod.name] = parseInt(pod.gid);
        }
      }
    }
  } catch(e) {
    console.warn('Pod discovery failed, using defaults:', e);
  }
}

async function fetchClientAccess() {
  // Returns { 'email@example.com': ['Account Name 1', 'Account Name 2'] }
  const map = {};
  try {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=Client%20Access`;
    const resp = await fetch(url);
    const text = await resp.text();
    const json = JSON.parse(text.match(/google\.visualization\.Query\.setResponse\((.+)\)/)[1]);
    const rows = json.table.rows;
    for (const row of rows) {
      if (!row.c || !row.c[0] || !row.c[1]) continue;
      const email = String(row.c[0].v || '').trim().toLowerCase();
      const account = String(row.c[1].v || '').trim();
      if (!email || !account) continue;
      if (!map[email]) map[email] = [];
      if (!map[email].includes(account)) map[email].push(account);
    }
  } catch(e) {
    console.warn('Client Access tab not found or empty:', e.message);
  }
  return map;
}

async function fetchAllPods() {
  const entries = Object.entries(SHEETS);
  return Promise.all(entries.map(([name, gid]) => fetchPodData(name, gid)));
}

async function fetchPodData(podName, gid) {
  try {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&gid=${gid}`;
    const resp = await fetch(url);
    const text = await resp.text();
    const json = JSON.parse(text.match(/google\.visualization\.Query\.setResponse\((.+)\)/)[1]);
    return parseSheetData(json, podName);
  } catch(e) {
    console.warn(`Failed to fetch ${podName}:`, e.message);
    return null;
  }
}

// ═══════════════════════════════════════════════
//  LEAD DATA
// ═══════════════════════════════════════════════

async function fetchAllLeads() {
  const entries = Object.entries(CONFIG.LEAD_SHEETS || {});
  const results = await Promise.all(entries.map(([name, gid]) => fetchLeadData(name, gid)));
  return results;
}

async function fetchLeadData(sheetName, gid) {
  try {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;
    const resp = await fetch(url);
    const text = await resp.text();
    return parseLeadCSV(text, sheetName);
  } catch(e) {
    console.warn(`Failed to fetch leads ${sheetName}:`, e.message);
    return [];
  }
}

function parseLeadCSV(csvText, source) {
  const lines = csvText.split('\n');
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());

  const iDate = headers.findIndex(h => h === 'date');
  const iSub = headers.findIndex(h => h.includes('subaccount') || h.includes('sub account') || h === 'business' || h === 'business name');
  const iName = headers.findIndex(h => h === 'name');
  const iStatus = headers.findIndex(h => h === 'status');
  const iAddress = headers.findIndex(h => h === 'address');
  const iDistance = headers.findIndex(h => h.includes('distance'));

  // Find follow-up note columns
  const noteIdxs = [];
  headers.forEach((h, i) => { if (/call|follow|day/.test(h)) noteIdxs.push(i); });

  if (iDate < 0 || iSub < 0) return [];

  const leads = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = parseCSVLine(lines[i]);
    const subAccount = (cols[iSub] || '').trim();
    if (!subAccount) continue;

    // Parse date (M/D/YYYY → YYYY-MM-DD)
    let date = (cols[iDate] || '').trim();
    const dm = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (dm) date = `${dm[3]}-${dm[1].padStart(2,'0')}-${dm[2].padStart(2,'0')}`;

    // Last non-empty follow-up note
    let lastNote = '';
    for (let ni = noteIdxs.length - 1; ni >= 0; ni--) {
      const v = (cols[noteIdxs[ni]] || '').trim();
      if (v) { lastNote = v; break; }
    }

    leads.push({
      source,
      date,
      subAccount,
      name: (cols[iName] || '').trim(),
      status: (cols[iStatus] || '').trim(),
      address: (cols[iAddress] || '').trim(),
      distance: (cols[iDistance] || '').trim(),
      lastNote,
    });
  }
  return leads;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === ',' && !inQuotes) { result.push(current); current = ''; }
    else { current += ch; }
  }
  result.push(current);
  return result;
}

function getLeadsForAccount(accountName, startDate, endDate) {
  return allLeads.filter(l => {
    const nameMatch = l.subAccount.toLowerCase().includes(accountName.toLowerCase()) ||
                      accountName.toLowerCase().includes(l.subAccount.toLowerCase());
    if (!nameMatch) return false;
    if (startDate && endDate && l.date) return l.date >= startDate && l.date <= endDate;
    return true;
  });
}

function isBookedStatus(s) { const low = (s||'').toLowerCase(); return (low.includes('confirmed') && !low.includes('unconfirmed')) || low.includes('manual booked'); }
function isClientHandles(s) { const low = (s||'').toLowerCase(); return low.includes('client handles') || low.includes('satellite') || low.includes('sat quote') || low.includes('sat. qt'); }
function isCancelledStatus(s) { const low = (s||'').toLowerCase(); return low.includes('cancel') || low.includes('invalid') || low.includes('not responding') || low === 'nr'; }
function isOpenStatus(s) { return !isBookedStatus(s) && !isClientHandles(s) && !isCancelledStatus(s); }
function leadStatusColor(s) { if (isBookedStatus(s)) return 'lead-booked'; if (isClientHandles(s)) return 'lead-client'; if (isCancelledStatus(s)) return 'lead-cancelled'; return 'lead-open'; }
function leadStatusLabel(s) { if (isBookedStatus(s)) return 'Booked'; if (isClientHandles(s)) return 'Client Handles'; if (isCancelledStatus(s)) return 'Lost'; return 'Open'; }

// ═══════════════════════════════════════════════
//  SHEET PARSER (simplified from Command Centre)
// ═══════════════════════════════════════════════

function buildColumnMap(cols) {
  const map = {};
  if (!cols) return map;
  cols.forEach((col, idx) => {
    const label = (col.label || '').trim();
    if (label) map[label.toLowerCase()] = idx;
  });
  return map;
}

function colIdx(colMap, ...names) {
  for (const name of names) {
    const key = name.toLowerCase();
    if (colMap[key] !== undefined) return colMap[key];
  }
  const keys = Object.keys(colMap);
  for (const name of names) {
    const lower = name.toLowerCase();
    const found = keys.find(k => k.includes(lower) || lower.includes(k));
    if (found !== undefined) return colMap[found];
  }
  return -1;
}

function parseSheetData(data, podName) {
  const rows = data.table.rows;
  const accounts = [];
  const cycles = [];
  let currentAccountName = '';
  let currentAdAccountId = '';
  let currentMgr = '';

  const colMap = buildColumnMap(data.table.cols);
  const COL = {
    account:       colIdx(colMap, 'account', 'account name', 'client'),
    cycle:         colIdx(colMap, 'cycle', 'cycle label'),
    adAccountId:   colIdx(colMap, 'ad account id', 'ad account', 'ad acct id'),
    cycleStart:    colIdx(colMap, 'cycle start date', 'cycle start', 'start date'),
    cycleEnd:      colIdx(colMap, 'cycle end date', 'cycle end', 'end date'),
    bookedGoal:    colIdx(colMap, 'booked appointment goal', 'booked appt goal', 'appointment goal'),
    totalLeads:    colIdx(colMap, 'total leads', 'leads'),
    osaPct:        colIdx(colMap, 'osa', 'osa %', 'osa rate'),
    bookedAppts:   colIdx(colMap, 'booked appointments', 'booked appts', 'booked'),
    estBooked:     colIdx(colMap, 'est. booked', 'est booked', 'estimated booked'),
    cpa:           colIdx(colMap, 'cpa', 'cpl', 'cost per lead'),
    dailyBudget:   colIdx(colMap, 'daily budget'),
    monthlyBudget: colIdx(colMap, 'monthly budget'),
    amountSpent:   colIdx(colMap, 'amount spent', 'spent'),
    linkCTR:       colIdx(colMap, 'link ctr', 'ctr'),
    linkCPC:       colIdx(colMap, 'link cpc', 'cpc'),
    cpm:           colIdx(colMap, 'cpm'),
    frequency:     colIdx(colMap, 'frequency', 'freq'),
    surveyPct:     colIdx(colMap, 'survey', 'survey %'),
    manager:       colIdx(colMap, 'account manager', 'manager'),
  };

  const iA = COL.account >= 0 ? COL.account : 0;
  const iC = COL.cycle >= 0 ? COL.cycle : 1;

  function getStr(row, idx) { return (idx >= 0 && row.c && row.c[idx]) ? String(row.c[idx].v || '').trim() : ''; }
  function getNum(row, idx) { if (idx < 0 || !row.c || !row.c[idx]) return null; const v = row.c[idx].v; return (v !== null && v !== undefined) ? Number(v) || 0 : null; }
  function getDate(row, idx) {
    if (idx < 0 || !row.c || !row.c[idx]) return null;
    const v = row.c[idx].v;
    if (!v) return null;
    if (typeof v === 'string' && v.includes('Date(')) {
      const m = v.match(/Date\((\d+),(\d+),(\d+)/);
      if (m) return `${m[1]}-${String(Number(m[2])+1).padStart(2,'0')}-${m[3].padStart(2,'0')}`;
    }
    const cell = row.c[idx];
    if (cell.f) { const d = new Date(cell.f); if (!isNaN(d)) return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); return cell.f; }
    if (typeof v === 'string') { const d = new Date(v); if (!isNaN(d)) return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
    return null;
  }
  function normPct(v) { return (v !== null && v > 0 && v <= 1) ? v * 100 : v; }

  // Pre-scan: find account names (rows with a cycle label)
  const knownAccountNames = new Set();
  const knownSubSections = ['kpi','roof ignite','roofignite','roofers ignite','hvac ignite','pending','expansion','active','inactive','cign ignite','solar ignite','contractorsignite','contractors ignite','paused','pause','winter'];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]; if (!r.c) continue;
    const a = r.c[iA] ? String(r.c[iA].v || '').trim() : '';
    const b = r.c[iC] ? String(r.c[iC].v || '').trim() : '';
    if (a && b && b.toLowerCase().startsWith('cycle')) knownAccountNames.add(a);
  }

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]; if (!row.c) continue;
    const cellA = row.c[iA] ? String(row.c[iA].v || '').trim() : '';
    const cellB = row.c[iC] ? String(row.c[iC].v || '').trim() : '';
    if (!cellA && !cellB) continue;

    // Section header (manager, sub-section)
    if (cellA && !cellB && !knownAccountNames.has(cellA)) {
      if (!knownSubSections.includes(cellA.toLowerCase())) currentMgr = cellA;
      continue;
    }

    // Account header
    if (cellA && knownAccountNames.has(cellA) && !(cellB.toLowerCase().startsWith('cycle'))) {
      currentAccountName = cellA;
      const adIdx = COL.adAccountId >= 0 ? COL.adAccountId : 2;
      const adCell = row.c[adIdx];
      currentAdAccountId = adCell ? String(adCell.f || adCell.v || '').replace(/[\s,]/g,'') : '';
      const mgr = getStr(row, COL.manager);
      if (mgr) currentMgr = mgr;
      if (!accounts.find(a => a.name === currentAccountName)) {
        accounts.push({ name: currentAccountName, adAccountId: currentAdAccountId, pod: podName, manager: currentMgr || 'Unassigned', cycles: [] });
      }
      continue;
    }

    // Cycle row
    if (cellB && cellB.toLowerCase().startsWith('cycle')) {
      if (cellA && cellA !== currentAccountName) currentAccountName = cellA;
      const mgr = getStr(row, COL.manager);
      if (mgr) currentMgr = mgr;

      const cycleData = {
        account: currentAccountName,
        adAccountId: currentAdAccountId,
        pod: podName,
        cycle: cellB,
        cycleStartDate: getDate(row, COL.cycleStart),
        cycleEndDate: getDate(row, COL.cycleEnd),
        bookedGoal: getNum(row, COL.bookedGoal),
        totalLeads: getNum(row, COL.totalLeads),
        osaPct: normPct(getNum(row, COL.osaPct)),
        bookedAppts: getNum(row, COL.bookedAppts),
        estBookedAppts: getNum(row, COL.estBooked),
        cpa: getNum(row, COL.cpa),
        dailyBudget: getNum(row, COL.dailyBudget),
        monthlyBudget: getNum(row, COL.monthlyBudget),
        amountSpent: getNum(row, COL.amountSpent),
        linkCTR: getNum(row, COL.linkCTR),
        linkCPC: getNum(row, COL.linkCPC),
        cpm: getNum(row, COL.cpm),
        frequency: getNum(row, COL.frequency),
        surveyPct: normPct(getNum(row, COL.surveyPct)),
        manager: mgr || currentMgr,
      };
      cycleData.isExtended = isExtendedCycle(cycleData);
      cycles.push(cycleData);

      let parent = accounts.find(a => a.name === currentAccountName);
      if (parent) parent.cycles.push(cycleData);
    }
  }
  return { accounts, cycles };
}

// ═══════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════

function parseLocalDate(s) {
  if (!s) return null;
  const p = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (p) return new Date(Number(p[1]), Number(p[2])-1, Number(p[3]));
  const d = new Date(s + 'T00:00:00');
  return isNaN(d) ? null : d;
}

function isExtendedCycle(cycle) {
  if (!cycle || !cycle.cycleStartDate || !cycle.cycleEndDate) return false;
  const start = parseLocalDate(cycle.cycleStartDate);
  const end = parseLocalDate(cycle.cycleEndDate);
  if (!start || !end) return false;
  const today = new Date(); today.setHours(0,0,0,0);
  return Math.round((today - start) / 86400000) > 28 && today <= end;
}

function getActiveCycle(acct) {
  if (!acct || !acct.cycles || !acct.cycles.length) return null;
  const today = getTodayStr();
  // Find all cycles that contain today, then pick the latest one (highest start date)
  const active = acct.cycles
    .filter(c => c.cycleStartDate && c.cycleEndDate && c.cycleStartDate <= today && c.cycleEndDate >= today)
    .sort((a, b) => b.cycleStartDate.localeCompare(a.cycleStartDate));
  return active[0] || acct.cycles[acct.cycles.length - 1];
}

function getTodayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function fmt(v) { return v !== null && v !== undefined ? Math.round(v).toLocaleString() : '--'; }
function fmtDollar(v, dec) { return v !== null && v !== undefined ? '$' + Number(v).toFixed(dec || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '--'; }
function fmtPct(v) { return v !== null && v !== undefined ? v.toFixed(1) + '%' : '--'; }
function fmtDate(s) {
  if (!s) return '--';
  const d = parseLocalDate(s);
  return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : s;
}
function fmtDateShort(s) {
  if (!s) return '--';
  const d = parseLocalDate(s);
  return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : s;
}

function isOnTrack(c) {
  if (!c || !c.cycleStartDate || !c.cycleEndDate || !c.bookedGoal || c.bookedGoal <= 0) return null;
  const start = parseLocalDate(c.cycleStartDate);
  const end = parseLocalDate(c.cycleEndDate);
  if (!start || !end) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  const totalMs = Math.max(1, end - start);
  const elapsedMs = Math.max(0, Math.min(today - start, totalMs));
  const frac = elapsedMs / totalMs;
  const expected = c.bookedGoal * frac;
  const est = c.estBookedAppts || c.bookedAppts || 0;
  return est >= expected * 0.85;
}

// ═══════════════════════════════════════════════
//  ACCOUNT PICKER
// ═══════════════════════════════════════════════

function showAccountPicker(accountNames) {
  const picker = document.getElementById('account-picker');
  const sorted = [...new Set(accountNames)].sort();
  picker.innerHTML = sorted.map(n => `<option value="${n}">${n}</option>`).join('');
  picker.classList.remove('hidden');
}

function onAccountChange(name) {
  renderDashboard(name);
}

// ═══════════════════════════════════════════════
//  RENDER
// ═══════════════════════════════════════════════

function renderDashboard(accountName) {
  const el = document.getElementById('dashboard-content');
  const acct = allAccounts.find(a => a.name === accountName);
  if (!acct) {
    el.innerHTML = `<div class="glass" style="padding:40px;text-align:center;color:#64748b;">Account "${accountName}" not found.</div>`;
    return;
  }

  const active = getActiveCycle(acct);
  const pastCycles = (acct.cycles || []).slice().reverse();
  const today = getTodayStr();
  const hasActive = active && active.cycleStartDate <= today && active.cycleEndDate >= today;

  document.getElementById('header-sub').textContent = accountName;

  // ── Current Cycle ──
  let currentHtml = '';
  if (active) {
    const daysIn = active.cycleStartDate ? Math.max(0, Math.round((new Date() - parseLocalDate(active.cycleStartDate)) / 86400000)) : 0;
    const totalDays = (active.cycleStartDate && active.cycleEndDate) ? Math.round((parseLocalDate(active.cycleEndDate) - parseLocalDate(active.cycleStartDate)) / 86400000) : 0;

    currentHtml = `
      <div class="glass" style="padding:24px;margin-bottom:24px;">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:4px;">
          <div class="cycle-bar" style="margin-bottom:0;">
            <span class="badge badge-blue">${active.cycle}</span>
            <span style="color:#94a3b8;font-size:13px;">${fmtDateShort(active.cycleStartDate)} - ${fmtDateShort(active.cycleEndDate)}</span>
            ${active.isExtended ? '<span class="badge badge-purple">EXTENDED</span>' : ''}
            ${hasActive ? `<span style="color:#64748b;font-size:12px;">Day ${daysIn} of ${totalDays}</span>` : '<span class="badge badge-gray">Cycle Ended</span>'}
          </div>
          <button class="btn-invite" onclick="openInviteModal('${accountName.replace(/'/g,"\\'")}')">+ Invite</button>
        </div>

        <div class="kpi-grid">
          <div class="kpi-card">
            <div class="kpi-label">Leads</div>
            <div class="kpi-value">${fmt(active.totalLeads)}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Booked Appointments</div>
            <div class="kpi-value" style="color:#34d399;">${fmt(active.bookedAppts)}</div>
            <div class="kpi-sub">Goal: ${fmt(active.bookedGoal)}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Projected Bookings</div>
            <div class="kpi-value">${fmt(active.estBookedAppts)}</div>
            <div class="kpi-sub">of ${fmt(active.bookedGoal)} goal</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Ad Spend</div>
            <div class="kpi-value">${fmtDollar(active.amountSpent)}</div>
            <div class="kpi-sub">Budget: ${fmtDollar(active.monthlyBudget)}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Cost Per Lead</div>
            <div class="kpi-value">${fmtDollar(active.cpa, 2)}</div>
          </div>
        </div>
        <div class="projection-disclaimer">
          * Projected Bookings is an estimate based on current pacing. This number typically increases as the cycle progresses — leads from earlier in the cycle often convert to booked appointments later through follow-up calls, callbacks, and rescheduled consultations. Final results are usually higher than mid-cycle projections.
        </div>
      </div>
    `;
  } else {
    currentHtml = `<div class="glass" style="padding:40px;text-align:center;margin-bottom:24px;"><p style="color:#64748b;">No active cycle found.</p></div>`;
  }

  // ── Lead Widget ──
  currentAccountName = accountName;
  activeLeadFilter = 'all';
  const leadHtml = renderLeadWidget(accountName, active);

  // ── Cycle History ──
  let historyHtml = '';
  if (pastCycles.length > 0) {
    const historyRows = pastCycles.map(c => `
      <tr>
        <td>${c.cycle}${c.isExtended ? ' <span class="badge badge-purple" style="font-size:9px;">EXT</span>' : ''}</td>
        <td>${fmtDateShort(c.cycleStartDate)} - ${fmtDateShort(c.cycleEndDate)}</td>
        <td class="num">${fmt(c.totalLeads)}</td>
        <td class="num" style="color:#34d399;">${fmt(c.bookedAppts)}</td>
        <td class="num">${fmt(c.bookedGoal)}</td>
        <td class="num">${fmtDollar(c.amountSpent)}</td>
        <td class="num">${fmtDollar(c.cpa, 2)}</td>
      </tr>
    `).join('');

    historyHtml = `
      <div class="glass" style="padding:24px;">
        <h3 style="color:#fff;font-size:16px;font-weight:700;margin-bottom:16px;">Cycle History</h3>
        <div style="overflow-x:auto;">
          <table class="history-table">
            <thead>
              <tr>
                <th>Cycle</th>
                <th>Dates</th>
                <th class="num">Leads</th>
                <th class="num">Booked</th>
                <th class="num">Goal</th>
                <th class="num">Spent</th>
                <th class="num">CPL</th>
              </tr>
            </thead>
            <tbody>${historyRows}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  // ── Access Management (admin only) ──
  let accessHtml = '';
  if (isAdmin) {
    accessHtml = `
      <div class="glass" style="padding:24px;margin-top:24px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
          <h3 style="color:#fff;font-size:16px;font-weight:700;">Manage Access</h3>
          <button class="btn-invite" onclick="openInviteModal('${accountName.replace(/'/g,"\\'")}')">+ Invite</button>
        </div>
        <div id="access-list"><p style="color:#64748b;font-size:13px;">Loading...</p></div>
      </div>
    `;
  }

  el.innerHTML = currentHtml + leadHtml + historyHtml + accessHtml;

  // Load access list after DOM is rendered
  if (isAdmin) loadAccessList(accountName);
}

// ═══════════════════════════════════════════════
//  APPS SCRIPT COMMUNICATION
// ═══════════════════════════════════════════════

async function writeToSheet(action, data) {
  const resp = await fetch(CONFIG.APPS_SCRIPT_URL, {
    method: 'POST',
    body: JSON.stringify({ action, ...data }),
    redirect: 'follow',
  });
  const text = await resp.text();
  try { return JSON.parse(text); } catch { return { ok: false, error: text }; }
}

// ═══════════════════════════════════════════════
//  TOAST NOTIFICATIONS
// ═══════════════════════════════════════════════

function showToast(msg, type) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast toast-' + (type || 'success');
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; setTimeout(() => toast.remove(), 300); }, 4000);
}

// ═══════════════════════════════════════════════
//  INVITE SYSTEM
// ═══════════════════════════════════════════════

function openInviteModal(accountName) {
  document.getElementById('invite-modal-sub').textContent = 'Invite someone to view ' + accountName + "'s dashboard.";
  document.getElementById('invite-email').value = '';
  document.getElementById('invite-submit-btn').disabled = false;
  document.getElementById('invite-submit-btn').textContent = 'Send Invite';
  document.getElementById('invite-modal').classList.remove('hidden');
  document.getElementById('invite-modal').dataset.account = accountName;
  setTimeout(() => document.getElementById('invite-email').focus(), 100);
}

function closeInviteModal() {
  document.getElementById('invite-modal').classList.add('hidden');
}

async function submitInvite() {
  const email = document.getElementById('invite-email').value.trim().toLowerCase();
  const accountName = document.getElementById('invite-modal').dataset.account;
  if (!email || !email.includes('@')) { showToast('Enter a valid email address', 'error'); return; }

  const btn = document.getElementById('invite-submit-btn');
  btn.disabled = true;
  btn.textContent = 'Sending...';

  const result = await writeToSheet('sendClientInvite', {
    email,
    accountName,
    invitedBy: currentUser.email,
  });

  if (result.ok) {
    if (result.emailError) {
      showToast('Access granted but email failed: ' + result.emailError, 'error');
    } else {
      showToast('Invite sent to ' + email, 'success');
    }
    closeInviteModal();
    // Refresh access list if admin
    if (isAdmin) loadAccessList(accountName);
  } else {
    showToast(result.error || 'Failed to send invite', 'error');
    btn.disabled = false;
    btn.textContent = 'Send Invite';
  }
}

async function loadAccessList(accountName) {
  const result = await writeToSheet('getClientAccessList', { accountName });
  if (!result.ok) return;
  const container = document.getElementById('access-list');
  if (!container) return;
  if (result.emails.length === 0) {
    container.innerHTML = '<p style="color:#64748b;font-size:13px;">No one has been invited yet.</p>';
    return;
  }
  container.innerHTML = result.emails.map(e => `
    <div class="access-row">
      <div>
        <div class="access-email">${e.email}</div>
        <div class="access-meta">Invited by ${e.invitedBy || 'unknown'} ${e.date ? '· ' + fmtDateShort(e.date) : ''}</div>
      </div>
      <button class="btn-remove" onclick="removeAccess('${e.email}','${accountName.replace(/'/g,"\\'")}')">Remove</button>
    </div>
  `).join('');
}

async function removeAccess(email, accountName) {
  const result = await writeToSheet('removeClientAccess', { email, accountName });
  if (result.ok) {
    showToast('Access removed for ' + email, 'success');
    loadAccessList(accountName);
  } else {
    showToast(result.error || 'Failed to remove access', 'error');
  }
}

// ═══════════════════════════════════════════════
//  LEAD WIDGET
// ═══════════════════════════════════════════════

function renderLeadWidget(accountName, activeCycle) {
  const startDate = activeCycle ? activeCycle.cycleStartDate : null;
  const endDate = activeCycle ? activeCycle.cycleEndDate : null;
  const leads = getLeadsForAccount(accountName, startDate, endDate);

  if (leads.length === 0) {
    return `<div class="glass" style="padding:24px;margin-bottom:24px;">
      <h3 style="color:#fff;font-size:16px;font-weight:700;margin-bottom:12px;">Lead Activity</h3>
      <p style="color:#64748b;text-align:center;padding:20px 0;">No leads found for this cycle.</p>
    </div>`;
  }

  const booked = leads.filter(l => isBookedStatus(l.status)).length;
  const clientH = leads.filter(l => isClientHandles(l.status)).length;
  const cancelled = leads.filter(l => isCancelledStatus(l.status)).length;
  const open = leads.filter(l => isOpenStatus(l.status)).length;

  const fActive = (f) => activeLeadFilter === f ? 'active' : '';

  // Filter leads
  let filtered = leads;
  if (activeLeadFilter === 'booked') filtered = leads.filter(l => isBookedStatus(l.status));
  else if (activeLeadFilter === 'client') filtered = leads.filter(l => isClientHandles(l.status));
  else if (activeLeadFilter === 'cancelled') filtered = leads.filter(l => isCancelledStatus(l.status));
  else if (activeLeadFilter === 'open') filtered = leads.filter(l => isOpenStatus(l.status));

  // Group by date
  const byDate = {};
  for (const l of filtered) {
    const d = l.date || 'Unknown';
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(l);
  }
  const dates = Object.keys(byDate).sort().reverse();

  const rows = dates.map(d => {
    const dayLeads = byDate[d];
    return dayLeads.map((l, idx) => `
      <tr>
        ${idx === 0 ? `<td rowspan="${dayLeads.length}" style="vertical-align:top;color:#94a3b8;white-space:nowrap;">${fmtDateShort(d)} <span style="color:#475569;">(${dayLeads.length})</span></td>` : ''}
        <td class="${leadStatusColor(l.status)}" style="font-weight:500;">${l.name || '--'}</td>
        <td class="${leadStatusColor(l.status)}">${leadStatusLabel(l.status)}</td>
        <td style="color:#64748b;" class="mobile-hide">${l.lastNote || '--'}</td>
      </tr>
    `).join('');
  }).join('');

  return `
    <div class="glass" style="padding:24px;margin-bottom:24px;">
      <h3 style="color:#fff;font-size:16px;font-weight:700;margin-bottom:16px;">Lead Activity</h3>
      <div class="lead-filters">
        <span class="filter-badge fb-green ${fActive('booked')}" onclick="setLeadFilter('booked')">${booked} booked</span>
        <span class="filter-badge fb-yellow ${fActive('client')}" onclick="setLeadFilter('client')">${clientH} other</span>
        <span class="filter-badge fb-red ${fActive('cancelled')}" onclick="setLeadFilter('cancelled')">${cancelled} lost</span>
        <span class="filter-badge fb-white ${fActive('open')}" onclick="setLeadFilter('open')">${open} open</span>
        <span class="filter-badge fb-blue ${fActive('all')}" onclick="setLeadFilter('all')">${leads.length} total</span>
      </div>
      <div style="overflow-x:auto;max-height:500px;overflow-y:auto;">
        <table class="lead-table">
          <thead><tr>
            <th>Date</th>
            <th>Name</th>
            <th>Status</th>
            <th class="mobile-hide">Last Note</th>
          </tr></thead>
          <tbody>${rows || '<tr><td colspan="4" style="text-align:center;color:#64748b;padding:20px;">No leads match this filter.</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;
}

function setLeadFilter(filter) {
  activeLeadFilter = activeLeadFilter === filter ? 'all' : filter;
  renderDashboard(currentAccountName);
}

// ═══════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => initAuth());
