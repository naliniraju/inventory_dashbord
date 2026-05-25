import React, { useState, useEffect, useMemo, useRef } from "react";
import Toastify from "toastify-js";
import { supabase, STOCK_TABLE } from "./supabase";

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
  if (available === 0)                     return 'out';
  if (minimum > 0 && available <= minimum)     return 'low';
  return 'ok';
}

const PS_DEFAULT = [
  { name: "Veg Samosa",         qty: 0 },
  { name: "Banana Cake",        qty: 1 },
  { name: "Carrot Cake",        qty: 4 },
  { name: "Blueberry Muffin",   qty: 2 },
  { name: "Chocolate Muffin",   qty: 4 },
  { name: "Veg Puff",           qty: 1 },
  { name: "Paneer Puff",        qty: 0 },
  { name: "Sandwich Bread",     qty: 1 },
  { name: "Honey Cake",         qty: 1 },
  { name: "Egg Puff",           qty: 0 },
  { name: "Chocolate Cake",     qty: 4 },
  { name: "Black Forest Cake",  qty: 1 },
  { name: "Doughnut Chocolate", qty: 0 },
  { name: "Burger Bun",         qty: 7 },
  { name: "Flat Bread",         qty: 0 }
];

// Inline editable cell component
function EditableCell({ tagName: Tag = "span", value, onSave, className, style }) {
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current && document.activeElement !== ref.current) {
      ref.current.innerText = value;
    }
  }, [value]);

  const handleBlur = () => {
    const newVal = ref.current.innerText.trim();
    onSave(newVal);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      ref.current.blur();
    }
  };

  return (
    <Tag
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      className={className}
      style={style}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    />
  );
}

// Custom component for physical stock quantity input to allow free typing before blur
function PsQtyInput({ value, onBlur }) {
  const [localVal, setLocalVal] = useState(String(value));

  useEffect(() => {
    setLocalVal(String(value));
  }, [value]);

  const handleChange = (e) => {
    setLocalVal(e.target.value);
  };

  const handleBlurInternal = () => {
    onBlur(localVal);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.target.blur();
    }
  };

  return (
    <input
      className="ps-qty-val"
      type="text"
      inputMode="numeric"
      value={localVal}
      onFocus={(e) => e.target.select()}
      onChange={handleChange}
      onBlur={handleBlurInternal}
      onKeyDown={handleKeyDown}
    />
  );
}


function App() {
  // Authentication States
  const [session, setSession] = useState(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signingIn, setSigningIn] = useState(false);

  // App Layout States
  const [activePage, setActivePage] = useState("dashboard");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Inventory Stock States
  const [allData, setAllData] = useState([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [activeStatus, setActiveStatus] = useState("all");

  // Modal States
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editItemData, setEditItemData] = useState(null);
  const [modalItemName, setModalItemName] = useState("");
  const [modalCategory, setModalCategory] = useState("");
  const [modalAvailableStock, setModalAvailableStock] = useState("");
  const [modalMinStock, setModalMinStock] = useState("");
  const [modalUnits, setModalUnits] = useState("");

  // Physical Stock States
  const [psItems, setPsItems] = useState([]);
  const [psPreviewVisible, setPsPreviewVisible] = useState(false);

  // Toasts
  const showToast = (msg, color = "#007aff") => {
    Toastify({
      text: msg,
      duration: 2500,
      gravity: "top",
      position: "right",
      style: {
        background: color,
        borderRadius: "12px",
        fontFamily: "'DM Sans', sans-serif",
        fontSize: "14px",
        fontWeight: "600",
        boxShadow: "0 4px 20px rgba(0,0,0,0.4)"
      }
    }).showToast();
  };

  // Auth Session check
  useEffect(() => {
    const checkSession = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        setSession(data?.session || null);
      } catch (e) {
        console.error("Session check failed:", e);
      } finally {
        setLoadingSession(false);
      }
    };
    checkSession();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Handle Login
  const handleLogin = async (e) => {
    if (e) e.preventDefault();
    if (!email.trim() || !password) {
      showToast("Enter email and password", "#ff3b30");
      return;
    }
    setSigningIn(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      setSession(data.session);
    } catch (err) {
      showToast("Login failed: " + err.message, "#ff3b30");
    } finally {
      setSigningIn(false);
    }
  };

  // Handle Logout
  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
      setSession(null);
      showToast("Signed out", "#ff3b30");
    } catch (e) {
      console.error("Sign out failed:", e);
    }
  };

  // Sidebar settings on load & window resize
  useEffect(() => {
    const isCollapsed = localStorage.getItem("sidebarCollapsed") === "true";
    if (isCollapsed && window.innerWidth > 900) {
      setSidebarCollapsed(true);
      document.body.classList.add("sidebar-collapsed");
    }

    const handleResize = () => {
      if (window.innerWidth <= 900) {
        setSidebarCollapsed(false);
        document.body.classList.remove("sidebar-collapsed");
      } else {
        const collapsed = localStorage.getItem("sidebarCollapsed") === "true";
        setSidebarCollapsed(collapsed);
        document.body.classList.toggle("sidebar-collapsed", collapsed);
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const toggleSidebarCollapse = () => {
    if (window.innerWidth <= 900) return;
    const nextCollapsed = !sidebarCollapsed;
    setSidebarCollapsed(nextCollapsed);
    document.body.classList.toggle("sidebar-collapsed", nextCollapsed);
    localStorage.setItem("sidebarCollapsed", String(nextCollapsed));
  };

  // Load items from Supabase
  const loadItems = async () => {
    setLoadingItems(true);
    try {
      const { data, error } = await supabase
        .from(STOCK_TABLE)
        .select("*")
        .order("id", { ascending: true });
      if (error) throw error;
      setAllData(data || []);
    } catch (err) {
      console.error("Failed to load items:", err);
      showToast("Failed to load items", "#ff3b30");
    } finally {
      setLoadingItems(false);
    }
  };

  // Real-time synchronization
  useEffect(() => {
    if (!session) return;
    loadItems();

    const channel = supabase
      .channel("inventory-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: STOCK_TABLE },
        () => {
          loadItems();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session]);

  // Load physical stock items from localStorage
  useEffect(() => {
    if (activePage === "physical") {
      const saved = localStorage.getItem("psItems");
      let itemsList = null;
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            itemsList = parsed
              .filter(item => item && typeof item === "object")
              .map(item => ({
                name: String(item.name || ""),
                qty: Number(item.qty) || 0
              }));
          }
        } catch (e) {
          console.error("Failed to parse psItems from localStorage:", e);
        }
      }
      
      if (itemsList && itemsList.length > 0) {
        setPsItems(itemsList);
      } else {
        setPsItems(PS_DEFAULT.map(i => ({ ...i })));
      }
    }
  }, [activePage]);

  // Derived stock statistics
  const stats = useMemo(() => {
    let total = allData.length;
    let low = 0;
    let out = 0;
    let ok = 0;
    allData.forEach(i => {
      const s = getStatus(i);
      if (s === 'out') out++;
      else if (s === 'low') low++;
      else ok++;
    });
    return { total, low, out, ok };
  }, [allData]);

  // Dynamic category options
  const categories = useMemo(() => {
    const cats = allData.map(item => item.category).filter(Boolean);
    return [...new Set(cats)].sort();
  }, [allData]);

  // Filtered dataset
  const filteredData = useMemo(() => {
    return allData.filter(i => {
      if (searchQuery.trim()) {
        const search = searchQuery.toLowerCase();
        if (!i.item_name?.toLowerCase().includes(search) &&
            !i.category?.toLowerCase().includes(search)) return false;
      }
      if (categoryFilter && i.category !== categoryFilter) return false;
      if (activeStatus !== 'all' && getStatus(i) !== activeStatus) return false;
      return true;
    });
  }, [allData, searchQuery, categoryFilter, activeStatus]);

  // CRUD Operations
  const handleUpdateField = async (id, field, newValueStr, oldValue) => {
    const newValue = newValueStr.trim();
    if (newValue === String(oldValue)) return;
    if (isNaN(newValue) || newValue === "") {
      showToast("Invalid number", "#ff3b30");
      // Trigger a state refresh to reset elements back to old values
      setAllData(prev => [...prev]);
      return;
    }

    const numericVal = Number(newValue);
    try {
      const { error } = await supabase
        .from(STOCK_TABLE)
        .update({ [field]: numericVal })
        .eq("id", id);
      if (error) throw error;
      showToast("Updated successfully", "#34c759");
      // Update local state instantly for responsiveness
      setAllData(prev => prev.map(item => item.id === id ? { ...item, [field]: numericVal } : item));
    } catch (err) {
      showToast("Update failed: " + err.message, "#ff3b30");
      setAllData(prev => [...prev]);
    }
  };

  const changeQty = async (id, currentQty, delta) => {
    const newQty = Math.max(0, currentQty + delta);
    try {
      const { error } = await supabase
        .from(STOCK_TABLE)
        .update({ available_stock: newQty })
        .eq("id", id);
      if (error) throw error;
      setAllData(prev => prev.map(item => item.id === id ? { ...item, available_stock: newQty } : item));
    } catch (err) {
      showToast("Update failed: " + err.message, "#ff3b30");
    }
  };

  const handleDeleteItem = async (id) => {
    if (!window.confirm("Delete this item?")) return;
    try {
      const { error } = await supabase
        .from(STOCK_TABLE)
        .delete()
        .eq("id", id);
      if (error) throw error;
      showToast("Item deleted", "#ff3b30");
      loadItems();
    } catch (err) {
      showToast("Delete failed: " + err.message, "#ff3b30");
    }
  };

  // Modal Dialog Open/Save
  const openModal = (data = null) => {
    if (data) {
      setEditItemData(data);
      setModalItemName(data.item_name || "");
      setModalCategory(data.category || "");
      setModalAvailableStock(data.available_stock ?? "");
      setModalMinStock(data.minimum_stock ?? "");
      setModalUnits(data.units || "");
    } else {
      setEditItemData(null);
      setModalItemName("");
      setModalCategory("");
      setModalAvailableStock("");
      setModalMinStock("");
      setModalUnits("");
    }
    setIsModalOpen(true);
  };

  const handleSaveItem = async (e) => {
    e.preventDefault();
    if (!modalItemName.trim() || !modalCategory.trim() || !modalUnits.trim() || modalAvailableStock === "" || modalMinStock === "") {
      alert("Please fill all fields");
      return;
    }
    const available = Number(modalAvailableStock);
    const minimum = Number(modalMinStock);
    if (isNaN(available) || isNaN(minimum)) {
      alert("Stock values must be numbers");
      return;
    }

    const payload = {
      item_name: modalItemName.trim(),
      category: modalCategory.trim(),
      available_stock: available,
      minimum_stock: minimum,
      units: modalUnits.trim()
    };

    try {
      if (editItemData) {
        const { error } = await supabase
          .from(STOCK_TABLE)
          .update(payload)
          .eq("id", editItemData.id);
        if (error) throw error;
        showToast("Item updated");
      } else {
        const { error } = await supabase
          .from(STOCK_TABLE)
          .insert([payload]);
        if (error) throw error;
        showToast("Item added");
      }
      setIsModalOpen(false);
      loadItems();
    } catch (err) {
      showToast("Error saving item: " + err.message, "#ff3b30");
    }
  };

  // WhatsApp Alert Formatting
  const openWhatsApp = (msg) => {
    const encoded = encodeURIComponent(msg);
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (isIOS) {
      const appUrl = `whatsapp://send?text=${encoded}`;
      const webUrl = `https://api.whatsapp.com/send?text=${encoded}`;
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      document.body.appendChild(iframe);
      iframe.src = appUrl;
      setTimeout(() => {
        document.body.removeChild(iframe);
        window.open(webUrl, '_blank');
      }, 800);
    } else {
      window.open(`https://wa.me/?text=${encoded}`, '_blank');
    }
  };

  const sendLowStockWhatsApp = () => {
    const now = new Date();
    const date = now.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
    const time = now.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', hour12: true });

    const outItems = [];
    const lowItems = [];

    allData.forEach(i => {
      const status = getStatus(i);
      const a = Number(i.available_stock);
      const threshold = getLowThreshold(i.units);
      const m = threshold !== null ? threshold : (Number(i.minimum_stock) || 0);
      const u = i.units || "";

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
  };

  // Physical Stock State Setters
  const savePsItems = (items) => {
    setPsItems(items);
    localStorage.setItem('psItems', JSON.stringify(items));
  };
 const handlePsSendWhatsApp = () => {
  const msg = psBuildMessage();
  openWhatsApp(msg);
};
  const handlePsUpdateName = (idx, value) => {
    const updated = psItems.map((item, i) => i === idx ? { ...item, name: value } : item);
    savePsItems(updated);
  };

  const handlePsChangeQty = (idx, delta) => {
    const updated = psItems.map((item, i) => i === idx ? { ...item, qty: Math.max(0, item.qty + delta) } : item);
    savePsItems(updated);
  };

  const handlePsQtyBlur = (idx, valStr) => {
    const v = parseInt(valStr, 10);
    const qty = (isNaN(v) || v < 0) ? 0 : v;
    const updated = psItems.map((item, i) => i === idx ? { ...item, qty } : item);
    savePsItems(updated);
  };

  const handlePsAddRow = () => {
    const updated = [...psItems, { name: '', qty: 0 }];
    savePsItems(updated);
  };

  const handlePsDeleteRow = (idx) => {
    const updated = psItems.filter((_, i) => i !== idx);
    savePsItems(updated);
  };

  const handlePsResetToDefault = () => {
    if (!window.confirm('Reset to default items? Your current list will be replaced.')) return;
    savePsItems(PS_DEFAULT.map(i => ({...i})));
    showToast('Reset to defaults');
  };

  const psBuildMessage = () => {
    const now = new Date();
    const date = now.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
    const time = now.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', hour12: true });
    let msg = `DAILY STOCK COUNT\n${date} ${time}\n\n`;
    if (Array.isArray(psItems)) {
      psItems.forEach(i => {
        if (!i || !i.name || !i.name.trim()) return;
        msg += `${i.name}: ${i.qty}\n`;
      });
    }
    msg += `\nSriSathyaSaiMetro LEVISTA CAFE`;
    return msg;
  };

  // Nav routing
  const navigateTo = (pageName) => {
    setActivePage(pageName);
    setSidebarOpen(false); // Close overlay drawer on mobile selection
  };

  // Loading Session
  if (loadingSession) {
    return (
      <div className="login-screen">
        <div className="login-card" style={{ alignItems: "center", justifyContent: "center" }}>
          <div className="login-logo">
            <svg width="48" height="48" viewBox="0 0 40 40" fill="none" className="loading-spinner">
              <rect width="40" height="40" rx="14" fill="rgba(0,122,255,0.15)" stroke="rgba(0,122,255,0.3)" stroke-width="0.5"/>
              <path d="M10 14h20M10 20h14M10 26h18" stroke="#5aabff" strokeWidth="2.5" strokeLinecap="round"/>
            </svg>
          </div>
          <p style={{ color: "var(--text-3)", fontSize: "14px", marginTop: "12px" }}>Connecting to session...</p>
        </div>
      </div>
    );
  }

  // Login Screen View
  if (!session) {
    return (
      <div className="login-screen">
        <form className="login-card" onSubmit={handleLogin}>
          <div className="login-logo">
            <svg width="48" height="48" viewBox="0 0 40 40" fill="none">
              <rect width="40" height="40" rx="14" fill="rgba(0,122,255,0.15)" stroke="rgba(0,122,255,0.3)" strokeWidth="0.5"/>
              <path d="M10 14h20M10 20h14M10 26h18" stroke="#5aabff" strokeWidth="2.5" strokeLinecap="round"/>
            </svg>
          </div>
          <h1 className="login-title">Inventory<br /><span>Dashboard</span></h1>
          <p className="login-sub">Sign in to manage your stock</p>
          
          <div className="field-group">
            <label htmlFor="loginEmail">Email</label>
            <input
              id="loginEmail"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="field-group">
            <label htmlFor="loginPassword">Password</label>
            <input
              id="loginPassword"
              type="password"
              placeholder="••••••••"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button type="submit" className="btn-primary full-width" disabled={signingIn}>
            {signingIn ? "Signing in…" : "Sign In"}
          </button>
        </form>
      </div>
    );
  }

  // Dashboard Main View
  return (
    <div>
      {/* SIDEBAR */}
      <aside className={`sidebar ${sidebarCollapsed ? "collapsed" : ""} ${sidebarOpen ? "open" : ""}`} id="sidebar">
        <div className="sidebar-logo">
          <svg width="28" height="28" viewBox="0 0 40 40" fill="none" style={{ flexShrink: 0 }}>
            <rect width="40" height="40" rx="12" fill="rgba(0,122,255,0.15)" stroke="rgba(0,122,255,0.3)" strokeWidth="0.5"/>
            <path d="M10 14h20M10 20h14M10 26h18" stroke="#5aabff" strokeWidth="2.5" strokeLinecap="round"/>
          </svg>
          <span className="logo-text">Inventory</span>
          <button className="sidebar-toggle" onClick={toggleSidebarCollapse} aria-label="Toggle sidebar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
        </div>
        <nav className="sidebar-nav">
          <button
            className={`nav-item ${activePage === "dashboard" ? "active" : ""}`}
            id="nav-dashboard"
            data-label="Dashboard"
            onClick={() => navigateTo("dashboard")}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
              <rect x="3" y="3" width="7" height="7"/>
              <rect x="14" y="3" width="7" height="7"/>
              <rect x="3" y="14" width="7" height="7"/>
              <rect x="14" y="14" width="7" height="7"/>
            </svg>
            <span className="nav-label">Dashboard</span>
          </button>
          <button
            className={`nav-item ${activePage === "physical" ? "active" : ""}`}
            id="nav-physical"
            data-label="Physical Stock"
            onClick={() => navigateTo("physical")}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
              <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/>
              <line x1="7" y1="7" x2="7.01" y2="7"/>
            </svg>
            <span className="nav-label">Physical Stock</span>
          </button>
        </nav>
        <button className="sidebar-logout" onClick={handleLogout}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          <span className="logout-label">Logout</span>
        </button>
      </aside>

      {/* MOBILE OVERLAY */}
      <div className={`sidebar-overlay ${sidebarOpen ? "show" : ""}`} id="sidebarOverlay" onClick={() => setSidebarOpen(false)}></div>

      {/* MAIN CONTENT AREA */}
      <main className="main-content">
        {activePage === "dashboard" ? (
          /* PAGE: DASHBOARD */
          <div className="page active" id="page-dashboard">
            <header className="topbar">
              <div className="topbar-left">
                <button className="mobile-menu-btn" onClick={() => setSidebarOpen(true)} aria-label="Menu">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <line x1="3" y1="6" x2="21" y2="6"/>
                    <line x1="3" y1="12" x2="21" y2="12"/>
                    <line x1="3" y1="18" x2="21" y2="18"/>
                  </svg>
                </button>
                <div>
                  <h2 className="page-title">Stock Overview</h2>
                  <p className="page-sub">Real-time inventory tracking</p>
                </div>
              </div>
              <div className="topbar-right">
                <button className="btn-icon-action whatsapp-btn" onClick={sendLowStockWhatsApp} title="Low Stock Report">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                  </svg>
                  <span className="btn-label">Low Stock Report</span>
                </button>
                <button className="btn-primary add-btn" onClick={() => openModal()}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="12" y1="5" x2="12" y2="19"/>
                    <line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                  Add Item
                </button>
              </div>
            </header>

            {/* STATS ROW */}
            <div className="stats-row" id="statsRow">
              <div
                className={`stat-card total ${activeStatus === "all" ? "active-filter" : ""}`}
                onClick={() => setActiveStatus("all")}
                title="Show all items"
              >
                <div className="stat-lbl">Total Items</div>
                <div className="stat-val">{loadingItems ? "..." : stats.total}</div>
                <div className="stat-sub">tracked</div>
              </div>
              <div
                className={`stat-card low ${activeStatus === "low" ? "active-filter" : ""}`}
                onClick={() => setActiveStatus("low")}
                title="Show low stock items"
              >
                <div className="stat-lbl">Low Stock</div>
                <div className="stat-val">{loadingItems ? "..." : stats.low}</div>
                <div className="stat-sub">need reorder</div>
              </div>
              <div
                className={`stat-card out ${activeStatus === "out" ? "active-filter" : ""}`}
                onClick={() => setActiveStatus("out")}
                title="Show out of stock items"
              >
                <div className="stat-lbl">Out of Stock</div>
                <div className="stat-val">{loadingItems ? "..." : stats.out}</div>
                <div className="stat-sub">unavailable</div>
              </div>
              <div
                className={`stat-card ok ${activeStatus === "ok" ? "active-filter" : ""}`}
                onClick={() => setActiveStatus("ok")}
                title="Show healthy items"
              >
                <div className="stat-lbl">Healthy</div>
                <div className="stat-val">{loadingItems ? "..." : stats.ok}</div>
                <div className="stat-sub">well stocked</div>
              </div>
            </div>

            {/* FILTERS BAR */}
            <div className="filters-bar">
              <div className="search-wrap">
                <svg className="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8"/>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <input
                  type="text"
                  id="search"
                  placeholder="Search items or categories…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              
              <select
                id="categoryFilter"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="">All Categories</option>
                {categories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>

              <span
                className={`active-filter-chip ${activeStatus !== "all" ? "visible" : ""}`}
                id="statusChip"
                onClick={() => setActiveStatus("all")}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
                <span>
                  {activeStatus === "low" && "Low Stock"}
                  {activeStatus === "out" && "Out of Stock"}
                  {activeStatus === "ok" && "Healthy"}
                </span>
              </span>
            </div>

            {/* ITEMS TABLE */}
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Category</th>
                    <th>Available</th>
                    <th>Min</th>
                    <th>Units</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody id="tableBody">
                  {loadingItems && allData.length === 0 ? (
                    <tr>
                      <td colSpan="7" style={{ textAlign: "center", padding: "40px", color: "#48484a", fontSize: "14px" }}>
                        Loading…
                      </td>
                    </tr>
                  ) : filteredData.length === 0 ? (
                    <tr>
                      <td colSpan="7" style={{ textAlign: "center", padding: "48px", color: "#48484a", fontSize: "14px" }}>
                        No items found
                      </td>
                    </tr>
                  ) : (
                    filteredData.map(i => {
                      const available = Number(i.available_stock);
                      const status = getStatus(i);

                      let badge = "";
                      let rowClass = "";
                      if (status === 'out') {
                        badge = <span className="badge badge-out"><span className="badge-dot"></span>Out of Stock</span>;
                        rowClass = "out-stock";
                      } else if (status === 'low') {
                        badge = <span className="badge badge-low"><span className="badge-dot"></span>Low Stock</span>;
                        rowClass = "low";
                      } else {
                        badge = <span className="badge badge-ok"><span className="badge-dot"></span>In Stock</span>;
                      }

                      return (
                        <tr key={i.id} className={rowClass}>
                          <td>{i.item_name}</td>
                          <td><span className="cat-pill">{i.category}</span></td>
                          <td>
                            <div className="qty-wrap">
                              <button className="qty-btn" onClick={() => changeQty(i.id, available, -1)} aria-label="Decrease">−</button>
                              <EditableCell
                                value={available}
                                onSave={(val) => handleUpdateField(i.id, "available_stock", val, available)}
                              />
                              <button className="qty-btn" onClick={() => changeQty(i.id, available, 1)} aria-label="Increase">+</button>
                            </div>
                          </td>
                          <EditableCell
                            tagName="td"
                            value={Number(i.minimum_stock)}
                            onSave={(val) => handleUpdateField(i.id, "minimum_stock", val, i.minimum_stock)}
                            style={{ color: "var(--text-4)" }}
                          />
                          <td style={{ color: "var(--text-4)" }}>{i.units}</td>
                          <td>{badge}</td>
                          <td style={{ whiteSpace: "nowrap" }}>
                            <button
                              className="btn-edit"
                              style={{
                                fontFamily: "var(--font)",
                                fontSize: "12px",
                                fontWeight: "600",
                                background: "rgba(0,122,255,0.08)",
                                color: "#5aabff",
                                border: "0.5px solid rgba(0,122,255,0.2)",
                                borderRadius: "var(--radius-sm)",
                                padding: "5px 10px",
                                cursor: "pointer",
                                transition: "background .12s, box-shadow .12s",
                                marginRight: "8px"
                              }}
                              onClick={() => openModal(i)}
                            >
                              Edit
                            </button>
                            <button className="btn-delete" onClick={() => handleDeleteItem(i.id)}>
                              Delete
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          /* PAGE: PHYSICAL STOCK */
          <div className="page active" id="page-physical">
            <header className="topbar">
              <div className="topbar-left">
                <button className="mobile-menu-btn" onClick={() => setSidebarOpen(true)} aria-label="Menu">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <line x1="3" y1="6" x2="21" y2="6"/>
                    <line x1="3" y1="12" x2="21" y2="12"/>
                    <line x1="3" y1="18" x2="21" y2="18"/>
                  </svg>
                </button>
                <div>
                  <h2 className="page-title">Physical Stock</h2>
                  <p className="page-sub">Count &amp; send via WhatsApp</p>
                </div>
              </div>
              <div className="topbar-right">
                <button className="btn-ghost" onClick={handlePsResetToDefault}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ marginRight: "4px", flexShrink: 0 }}>
                    <polyline points="1 4 1 10 7 10"/>
                    <path d="M3.51 15a9 9 0 102.13-9.36L1 10"/>
                  </svg>
                  Reset
                </button>
              </div>
            </header>

            <div className="ps-container">
              <div className="ps-header-row">
                <span className="ps-title">Today's Count</span>
                <button className="ps-preview-toggle" onClick={() => setPsPreviewVisible(!psPreviewVisible)}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                  <span>{psPreviewVisible ? "Hide preview" : "Preview message"}</span>
                </button>
              </div>
              
              <pre className={`ps-preview ${psPreviewVisible ? "show" : ""}`}>
                {psBuildMessage()}
              </pre>

              <div className="ps-list">
                <div className="ps-list-header">
                  <span>Item</span>
                  <span style={{ textAlign: "center" }}>Qty</span>
                  <span></span>
                </div>
                
                <div id="psRows">
                  {psItems.map((item, idx) => (
                    <div key={idx} className={`ps-row ${item.qty === 0 ? "zero" : ""}`}>
                      <input
                        className="ps-row-name"
                        value={item.name}
                        placeholder="Item name"
                        onChange={(e) => handlePsUpdateName(idx, e.target.value)}
                      />
                      <div className="ps-row-qty">
                        <button className="ps-qty-btn" onClick={() => handlePsChangeQty(idx, -1)}>−</button>
                        <PsQtyInput
                          value={item.qty}
                          onBlur={(val) => handlePsQtyBlur(idx, val)}
                        />
                        <button className="ps-qty-btn" onClick={() => handlePsChangeQty(idx, 1)}>+</button>
                      </div>
                      <div className="ps-row-del">
                        <button className="ps-del-btn" onClick={() => handlePsDeleteRow(idx)} title="Remove">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <button className="ps-add-row" onClick={handlePsAddRow}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="12" y1="5" x2="12" y2="19"/>
                    <line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                  Add item
                </button>
              </div>

              <button className="ps-send-btn" onClick={handlePsSendWhatsApp}>
                <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: "4px" }}>
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
                Send Physical Stock Report
              </button>
            </div>
          </div>
        )}
      </main>

      {/* ADD / EDIT ITEM MODAL */}
      <div className="modal-backdrop" id="modal" style={{ display: isModalOpen ? "flex" : "none" }}>
        <div className="modal-card">
          <div className="modal-header">
            <h3 id="modalTitle">{editItemData ? "Edit Item" : "Add Item"}</h3>
            <button className="modal-close" onClick={() => setIsModalOpen(false)}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
          <form onSubmit={handleSaveItem}>
            <div className="modal-body">
              <div className="field-group">
                <label htmlFor="modalItem">Item Name</label>
                <input
                  id="modalItem"
                  placeholder="e.g. Basmati Rice"
                  value={modalItemName}
                  onChange={(e) => setModalItemName(e.target.value)}
                  required
                />
              </div>
              <div className="field-group">
                <label htmlFor="modalCategory">Category</label>
                <input
                  id="modalCategory"
                  placeholder="e.g. Grains"
                  value={modalCategory}
                  onChange={(e) => setModalCategory(e.target.value)}
                  required
                />
              </div>
              <div className="modal-row">
                <div className="field-group">
                  <label htmlFor="modalAvailableStock">Available Stock</label>
                  <input
                    id="modalAvailableStock"
                    type="number"
                    placeholder="0"
                    min="0"
                    value={modalAvailableStock}
                    onChange={(e) => setModalAvailableStock(e.target.value)}
                    required
                  />
                </div>
                <div className="field-group">
                  <label htmlFor="modalMinStock">Minimum Stock</label>
                  <input
                    id="modalMinStock"
                    type="number"
                    placeholder="0"
                    min="0"
                    value={modalMinStock}
                    onChange={(e) => setModalMinStock(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="field-group">
                <label htmlFor="modalUnits">Units</label>
                <input
                  id="modalUnits"
                  placeholder="e.g. kg, pcs, L"
                  value={modalUnits}
                  onChange={(e) => setModalUnits(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn-ghost" onClick={() => setIsModalOpen(false)}>Cancel</button>
              <button type="submit" className="btn-primary">Save Item</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default App;
