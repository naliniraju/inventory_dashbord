// ---------- CONFIG ----------
const SUPABASE_URL="https://lmyizgwxxdfmwvwlvlum.supabase.co";
const API_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxteWl6Z3d4eGRmbXd2d2x2bHVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2ODcwNTQsImV4cCI6MjA4ODI2MzA1NH0.7ffes53M8XXQuIAAS_80-RPqVHCI56NIyw79T3uxk2w";
const TABLE="Stock";


const supabaseClient = supabase.createClient(SUPABASE_URL, API_KEY);

let editId          = null;
let realtimeChannel = null;
let activeStatus    = 'all';
let allData         = [];

// ---------- LOW STOCK THRESHOLDS BY UNIT ----------
const LOW_THRESHOLDS = {
  "Bottle":  24, "bottle":  24,
  "WBottle": 24, "wbottle": 24,
  "Ltr":     1,  "ltr":     1,  "L": 1,
  "GLtr":    12, "gltr":    12,
  "Kg":      1,  "kg":      1,
  "gm":      250,"Gm":      250,
  "Pcs":     6,  "pcs":     6,
  "Vpiece":  1,  "vpiece":  1,
  "Piece":   1,  "piece":   1,
  "Bunch":   1,  "bunch":   1,
  "CANS":    2,  "cans":    2,  "Can": 2,
  "CPCS":    30, "cpcs":    30,
  "Dozen":   0.5,"dozen":   0.5,
  "Packet":  1,  "packet":  1,
  "TPacket": 10, "tpacket": 10,
  "Tray":    1,  "tray":    1,
  "SLtr":    0.75,"sltr":   0.75,"sLtr": 0.75,
};

function getLowThreshold(units) {
  if (!units) return null;
  if (LOW_THRESHOLDS[units] !== undefined) return LOW_THRESHOLDS[units];
  const lower = units.toLowerCase();
  for (const key in LOW_THRESHOLDS) {
    if (key.toLowerCase() === lower) return LOW_THRESHOLDS[key];
  }
  return null;
}

function getStatus(item) {
  const available = Number(item.available_stock) || 0;
  const threshold = getLowThreshold(item.units);
  const minimum   = threshold !== null ? threshold : (Number(item.minimum_stock) || 0);
  if (available === 0)                         return 'out';
  if (minimum > 0 && available <= minimum)     return 'low';
  return 'ok';
}

// ── LOGIN ────────────────────────────────────────────
async function login() {
  const email    = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  if (!email || !password) { showToast("Enter email and password", "#ff3b30"); return; }
  const btn = document.querySelector('.btn-primary.full-width');
  if (btn) { btn.textContent = "Signing in…"; btn.disabled = true; }
  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    showDashboard();
    startApp();
  } catch(e) {
    showToast("Login failed: " + e.message, "#ff3b30");
  } finally {
    if (btn) { btn.textContent = "Sign In"; btn.disabled = false; }
  }
}

// ── SESSION ──────────────────────────────────────────
async function checkSession() {
  try {
    const { data, error } = await supabaseClient.auth.getSession();
    if (data && data.session) {
      showDashboard();
      startApp();
    } else {
      showLogin();
    }
  } catch(e) {
    console.error("Session check failed:", e);
    showLogin();
  }
}

function showLogin() {
  document.getElementById("loginScreen").style.display = "flex";
  document.getElementById("dashboard").style.display   = "none";
}

function showDashboard() {
  document.getElementById("loginScreen").style.display = "none";
  document.getElementById("dashboard").style.display   = "block";
}

// ── START ────────────────────────────────────────────
function startApp() {
  loadCategories();
  loadItems();
  enableRealtime();
}

// ── MODAL ────────────────────────────────────────────
function openModal(data = null) {
  document.getElementById("modal").style.display = "flex";
  if (data) {
    document.getElementById("modalTitle").innerText      = "Edit Item";
    document.getElementById("modalItem").value           = data.item_name;
    document.getElementById("modalCategory").value       = data.category;
    document.getElementById("modalAvailableStock").value = data.available_stock;
    document.getElementById("modalMinStock").value       = data.minimum_stock;
    document.getElementById("modalUnits").value          = data.units;
    editId = data.id;
  } else {
    document.getElementById("modalTitle").innerText      = "Add Item";
    document.getElementById("modalItem").value           = "";
    document.getElementById("modalCategory").value       = "";
    document.getElementById("modalAvailableStock").value = "";
    document.getElementById("modalMinStock").value       = "";
    document.getElementById("modalUnits").value          = "";
    editId = null;
  }
}
function closeModal() {
  document.getElementById("modal").style.display = "none";
}

// ── TOAST ────────────────────────────────────────────
function showToast(msg, color = "#007aff") {
  Toastify({
    text: msg, duration: 2500, gravity: "top", position: "right",
    style: {
      background: color, borderRadius: "12px",
      fontFamily: "'DM Sans', sans-serif", fontSize: "14px", fontWeight: "600",
      boxShadow: "0 4px 20px rgba(0,0,0,0.4)"
    }
  }).showToast();
}

// ── STAT CARD FILTER ─────────────────────────────────
function filterByStatus(status) {
  activeStatus = status;
  document.querySelectorAll('.stat-card').forEach(c => c.classList.remove('active-filter'));
  if (status !== 'all') {
    document.querySelector(`.stat-card.${status}`)?.classList.add('active-filter');
  }
  const chip      = document.getElementById('statusChip');
  const chipLabel = document.getElementById('statusChipLabel');
  if (status === 'all') {
    chip.classList.remove('visible');
  } else {
    const labels = { low: 'Low Stock', out: 'Out of Stock', ok: 'Healthy' };
    chipLabel.textContent = labels[status];
    chip.classList.add('visible');
  }
  applyFilters();
}

// ── APPLY ALL FILTERS ────────────────────────────────
function applyFilters() {
  const search   = document.getElementById("search").value.trim().toLowerCase();
  const category = document.getElementById("categoryFilter").value;

  const filtered = allData.filter(i => {
    if (search) {
      if (!i.item_name.toLowerCase().includes(search) &&
          !i.category.toLowerCase().includes(search)) return false;
    }
    if (category && i.category !== category) return false;
    if (activeStatus !== 'all' && getStatus(i) !== activeStatus) return false;
    return true;
  });

  renderTable(filtered);
}

// ── LOAD ITEMS ───────────────────────────────────────
async function loadItems() {
  const tableBody = document.getElementById("tableBody");
  tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:#48484a;font-size:14px;">Loading…</td></tr>`;

  const res  = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?select=*&order=id.asc`, {
    headers: { apikey: API_KEY, Authorization: `Bearer ${API_KEY}` }
  });
  const data = await res.json();

  allData = data;
  updateStats(data);
  applyFilters();
}

// ── STATS ─────────────────────────────────────────────
function updateStats(data) {
  let low = 0, out = 0, ok = 0;
  data.forEach(i => {
    const s = getStatus(i);
    if (s === 'out') out++;
    else if (s === 'low') low++;
    else ok++;
  });
  document.getElementById("statTotal").textContent = data.length;
  document.getElementById("statLow").textContent   = low;
  document.getElementById("statOut").textContent   = out;
  document.getElementById("statOk").textContent    = ok;
}

// ── RENDER TABLE ──────────────────────────────────────
function renderTable(data) {
  const tableBody = document.getElementById("tableBody");
  tableBody.innerHTML = "";

  if (!data.length) {
    tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:48px;color:#48484a;font-size:14px;">No items found</td></tr>`;
    return;
  }

  data.forEach(i => {
    const available = Number(i.available_stock);
    const status    = getStatus(i);

    let badge = "", rowClass = "";
    if (status === 'out') {
      badge    = `<span class="badge badge-out"><span class="badge-dot"></span>Out of Stock</span>`;
      rowClass = "out-stock";
    } else if (status === 'low') {
      badge    = `<span class="badge badge-low"><span class="badge-dot"></span>Low Stock</span>`;
      rowClass = "low";
    } else {
      badge = `<span class="badge badge-ok"><span class="badge-dot"></span>In Stock</span>`;
    }

    const row = document.createElement("tr");
    if (rowClass) row.classList.add(rowClass);

    row.innerHTML = `
      <td>${i.item_name}</td>
      <td><span class="cat-pill">${i.category}</span></td>
      <td>
        <div class="qty-wrap">
          <button class="qty-btn" data-id="${i.id}" data-delta="-1" aria-label="Decrease">−</button>
          <span contenteditable="true"
            onfocus="storeOldValue(this)"
            onblur="updateField('${i.id}','available_stock',this)">${available}</span>
          <button class="qty-btn" data-id="${i.id}" data-delta="1" aria-label="Increase">+</button>
        </div>
      </td>
      <td contenteditable="true" style="color:var(--text-4)"
        onfocus="storeOldValue(this)"
        onblur="updateField('${i.id}','minimum_stock',this)">${Number(i.minimum_stock)}</td>
      <td style="color:var(--text-4)">${i.units}</td>
      <td>${badge}</td>
      <td><button class="btn-delete" data-id="${i.id}">Delete</button></td>
    `;
    tableBody.appendChild(row);

    row.querySelectorAll('.qty-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const span    = btn.closest('.qty-wrap').querySelector('span[contenteditable]');
        const current = parseInt(span.innerText.trim(), 10) || 0;
        const delta   = parseInt(btn.dataset.delta, 10);
        const newQty  = Math.max(0, current + delta);
        changeQty(btn.dataset.id, newQty);
      });
    });

    row.querySelector('.btn-delete').addEventListener('click', () => {
      deleteItem(i.id);
    });
  });
}

// ── SAVE ITEM ────────────────────────────────────────
async function saveItem() {
  const item_name       = document.getElementById("modalItem").value.trim();
  const category        = document.getElementById("modalCategory").value.trim();
  const available_stock = Number(document.getElementById("modalAvailableStock").value);
  const minimum_stock   = Number(document.getElementById("modalMinStock").value);
  const units           = document.getElementById("modalUnits").value.trim();

  if (!item_name || !category || !units || isNaN(available_stock) || isNaN(minimum_stock)) {
    alert("Please fill all fields"); return;
  }

  const payload = { item_name, category, available_stock, minimum_stock, units };
  let url    = `${SUPABASE_URL}/rest/v1/${TABLE}`;
  let method = "POST";
  if (editId) { url += `?id=eq.${editId}`; method = "PATCH"; }

  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", apikey: API_KEY, Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify(payload)
  });

  if (!res.ok) { showToast("Error saving item", "#ff3b30"); return; }
  showToast(editId ? "Item updated" : "Item added");
  closeModal();
  loadItems();
  loadCategories();
}

// ── DELETE ───────────────────────────────────────────
async function deleteItem(id) {
  if (!confirm("Delete this item?")) return;
  await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?id=eq.${id}`, {
    method: "DELETE",
    headers: { apikey: API_KEY, Authorization: `Bearer ${API_KEY}` }
  });
  showToast("Item deleted", "#ff3b30");
  loadItems();
}

// ── INLINE EDIT ──────────────────────────────────────
async function updateField(id, field, el) {
  const newValue = el.innerText.trim();
  const oldValue = el.dataset.oldValue || "";
  if (newValue === oldValue) return;
  if (isNaN(newValue) || newValue === "") { el.innerText = oldValue; return; }

  const payload = {};
  payload[field] = Number(newValue);

  const res = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?id=eq.${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", apikey: API_KEY, Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify(payload)
  });

  if (!res.ok) { el.innerText = oldValue; showToast("Update failed", "#ff3b30"); return; }
  showToast("Updated");
  loadItems();
}

// ── CHANGE QTY ───────────────────────────────────────
async function changeQty(id, newQty) {
  if (newQty < 0) newQty = 0;
  await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?id=eq.${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", apikey: API_KEY, Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ available_stock: newQty })
  });
  loadItems();
}

// ── CATEGORIES ───────────────────────────────────────
async function loadCategories() {
  const res  = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?select=category`, {
    headers: { apikey: API_KEY, Authorization: `Bearer ${API_KEY}` }
  });
  const data = await res.json();
  const cats = [...new Set(data.map(i => i.category))].sort();
  const sel  = document.getElementById("categoryFilter");
  const cur  = sel.value;
  sel.innerHTML = `<option value="">All Categories</option>`;
  cats.forEach(cat => {
    const opt = document.createElement("option");
    opt.value = cat; opt.textContent = cat;
    sel.appendChild(opt);
  });
  if (cur) sel.value = cur;
}

// ── WHATSAPP — STOCK ALERT (plain format, no icons/subheadings) ──
async function sendLowStockWhatsApp() {
  const res  = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?select=item_name,category,available_stock,minimum_stock,units`, {
    headers: { apikey: API_KEY, Authorization: `Bearer ${API_KEY}` }
  });
  const data = await res.json();

  const now  = new Date();
  const date = now.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
  const time = now.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', hour12: true });

  const outItems = [];
  const lowItems = [];

  data.forEach(i => {
    const status    = getStatus(i);
    const a         = Number(i.available_stock);
    const threshold = getLowThreshold(i.units);
    const m         = threshold !== null ? threshold : (Number(i.minimum_stock) || 0);
    const u         = i.units || "";

    if (status === 'out') {
      outItems.push(`${i.item_name}: 0`);
    } else if (status === 'low') {
      lowItems.push(`${i.item_name}: ${a} (min ${m} ${u})`);
    }
  });

  const hasIssues = outItems.length || lowItems.length;
  let msg = `STOCK ALERT\n${date} ${time}\n\n`;

  if (!hasIssues) {
    msg += `All items are well stocked.\n`;
  } else {
    if (outItems.length) {
      msg += `Out of Stock\n`;
      outItems.forEach(line => { msg += `${line}\n`; });
      msg += `\n`;
    }
    if (lowItems.length) {
      msg += `Low Stock\n`;
      lowItems.forEach(line => { msg += `${line}\n`; });
      msg += `\n`;
    }
    msg += `Please restock immediately.`;
  }

  msg += `\nSriSathyaSaiMetro LEVISTA CAFE`;
  openWhatsApp(msg);
}

// ── WHATSAPP OPEN — iOS compatible ───────────────────
function openWhatsApp(msg) {
  const encoded = encodeURIComponent(msg);
  const isIOS   = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  // iOS requires the whatsapp:// deep-link or api.whatsapp.com; wa.me without a number fails
  if (isIOS) {
    // Try native app first, fall back to web
    const appUrl = `whatsapp://send?text=${encoded}`;
    const webUrl = `https://api.whatsapp.com/send?text=${encoded}`;
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    document.body.appendChild(iframe);
    iframe.src = appUrl;
    setTimeout(() => {
      document.body.removeChild(iframe);
      // If app didn't open, fall back to web URL
      window.open(webUrl, '_blank');
    }, 800);
  } else {
    window.open(`https://wa.me/?text=${encoded}`, '_blank');
  }
}

// ── REALTIME ─────────────────────────────────────────
function enableRealtime() {
  if (realtimeChannel) return;
  realtimeChannel = supabaseClient
    .channel('inventory-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'Stock' }, () => { loadItems(); })
    .subscribe();
}
//------toggleSidebarCollapse-------------------
function toggleSidebarCollapse() {
  /* Only collapse on desktop — mobile uses overlay */
  if (window.innerWidth <= 900) return;
  const s = document.getElementById('sidebar');
  const c = s.classList.toggle('collapsed');
  document.body.classList.toggle('sidebar-collapsed', c);
  localStorage.setItem('sidebarCollapsed', c);
}

document.addEventListener('DOMContentLoaded', function() {
  /* Restore collapse state only on desktop */
  if (localStorage.getItem('sidebarCollapsed') === 'true'
      && window.innerWidth > 900) {
    document.getElementById('sidebar').classList.add('collapsed');
    document.body.classList.add('sidebar-collapsed');
  }
  /* Clear collapsed class if window resizes to mobile */
  window.addEventListener('resize', function() {
    if (window.innerWidth <= 900) {
      document.getElementById('sidebar').classList.remove('collapsed');
      document.body.classList.remove('sidebar-collapsed');
    }
  });
});
// ── LOGOUT ───────────────────────────────────────────
async function logout() {
  await supabaseClient.auth.signOut();
  if (realtimeChannel) { supabaseClient.removeChannel(realtimeChannel); realtimeChannel = null; }
  showLogin();
}

// ── HELPERS ──────────────────────────────────────────
function storeOldValue(el) { el.dataset.oldValue = el.innerText.trim(); }

// ── INIT ─────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  checkSession();
  document.getElementById("search").addEventListener("input", applyFilters);
  document.getElementById("categoryFilter").addEventListener("change", applyFilters);
});
document.body.classList.toggle("sidebar-collapsed");