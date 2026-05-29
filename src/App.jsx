import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import Toastify from "toastify-js";
import { supabase, STOCK_TABLE } from "./supabase";
import * as XLSX from 'xlsx';
// ─── CONSTANTS ─────────────────────────────────────────────────────────────

const LOW_THRESHOLDS = {
  bottle: 24, wbottle: 24, ltr: 1, l: 1, gltr: 12, kg: 1, gm: 250,
  pcs: 6, vpiece: 1, piece: 1, bunch: 1, cans: 2, can: 2, cpcs: 30,
  dozen: 0.5, packet: 1, tpacket: 10, tray: 1, sltr: 0.75,
};

const PS_DEFAULT = [
  { name: "Sandwich Bread", qty: 1 }, { name: "Banana Cake", qty: 1 },
  { name: "Carrot Cake", qty: 4 }, { name: "Blueberry Muffin", qty: 2 },
  { name: "Chocolate Muffin", qty: 4 }, { name: "Veg Puff", qty: 1 },
  { name: "Paneer Puff", qty: 0 }, { name: "Sandwich Bread", qty: 1 },
  { name: "Honey Cake", qty: 1 }, { name: "Egg Puff", qty: 0 },
  { name: "Chocolate Cake", qty: 4 }, { name: "Black Forest Cake", qty: 1 },
  { name: "Burger Bun", qty: 7 },
  { name: "Flat Bread", qty: 0 },
];

const EMPLOYEES = [
  { value: "Bijoy", label: "Bijoy" },
  { value: "Aravind", label: "Aravind" },
  { value: "Suresh", label: "Hiteswar" },
];

// ─── HELPERS ───────────────────────────────────────────────────────────────

function getLowThreshold(units) {
  if (!units) return null;
  return LOW_THRESHOLDS[units.toLowerCase()] ?? null;
}

function getStatus(item) {
  const available = Number(item.available_stock) || 0;
  const threshold = getLowThreshold(item.units);
  const minimum = threshold ?? (Number(item.minimum_stock) || 0);
  if (available === 0) return "out";
  if (minimum > 0 && available <= minimum) return "low";
  return "ok";
}

function formatTime(iso) {
  return iso ? new Date(iso).toLocaleTimeString() : "-";
}

function formatDate(iso) {
  return iso ? new Date(iso).toLocaleDateString() : "-";
}

function openWhatsApp(msg) {
  const encoded = encodeURIComponent(msg);
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isIOS) {
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    document.body.appendChild(iframe);
    iframe.src = `whatsapp://send?text=${encoded}`;
    setTimeout(() => {
      document.body.removeChild(iframe);
      window.open(`https://api.whatsapp.com/send?text=${encoded}`, "_blank");
    }, 800);
  } else {
    window.open(`https://wa.me/?text=${encoded}`, "_blank");
  }
}

function buildTimestamp() {
  const now = new Date();
  const date = now.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const time = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
  return `${date} ${time}`;
}

// ─── SMALL REUSABLE COMPONENTS ─────────────────────────────────────────────

function Badge({ status }) {
  const map = { ok: "badge-ok", low: "badge-low", out: "badge-out" };
  const label = { ok: "OK", low: "LOW", out: "OUT" };
  return <span className={`badge ${map[status]}`}>{label[status]}</span>;
}

function QtyControl({ value, onMinus, onPlus, itemId, editingId, editingField, editingValue, setEditingId, setEditingField, setEditingValue, onSave }) {
  const isEditing = editingId === itemId && editingField === "available_stock";
  return (
    <div className="qty-wrap">
      <button type="button" className="qty-btn" onClick={(e) => { e.stopPropagation(); onMinus(); }}>−</button>
      {isEditing ? (
        <input
          type="number"
          value={editingValue}
          autoFocus
          className="qty-input"
          onChange={(e) => setEditingValue(e.target.value)}
          onBlur={() => onSave(itemId, "available_stock")}
          onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
        />
      ) : (
        <span
          className="qty-display"
          onClick={(e) => {
            e.stopPropagation();
            setEditingId(itemId);
            setEditingField("available_stock");
            setEditingValue(value);
          }}
        >
          {value}
        </span>
      )}
      <button type="button" className="qty-btn" onClick={(e) => { e.stopPropagation(); onPlus(); }}>+</button>
    </div>
  );
}

function StatCard({ label, value, variant, onClick }) {
  return (
    <div className={`stat-card stat-${variant}`} onClick={onClick}>
      <div className="stat-lbl">{label}</div>
      <div className="stat-val">{value}</div>
    </div>
  );
}

// ─── ICONS ─────────────────────────────────────────────────────────────────

const IconMenu = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
  </svg>
);
const IconLogout = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
    <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
  </svg>
);
const IconChevron = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <polyline points="15 18 9 12 15 6"/>
  </svg>
);
const IconClose = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);

function SelectWrapper({ value, onChange, children, className = "" }) {
  return (
    <div className={`select-wrap ${className}`}>
      <select value={value} onChange={onChange}>
        {children}
      </select>
      <svg className="select-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </div>
  );
}

const NAV_ITEMS = [
  {
    id: "dashboard", label: "Dashboard",
    icon: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>,
  },
  {
    id: "physical", label: "Daily Stock",
    icon: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>,
  },
  {
    id: "attendance", label: "Attendance",
    icon: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 2v4M8 2v4M3 10h18"/><rect x="3" y="4" width="18" height="18" rx="2"/></svg>,
  },
];

// ─── TOAST ─────────────────────────────────────────────────────────────────

function useToast() {
  return useCallback((msg, color = "#007aff") => {
    Toastify({
      text: msg, duration: 2500, gravity: "top", position: "right",
      style: {
        background: color, borderRadius: "12px",
        fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
        fontWeight: "600", boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
      },
    }).showToast();
  }, []);
}

// ─── SIDEBAR ───────────────────────────────────────────────────────────────

function Sidebar({ activePage, onNavigate, onLogout, collapsed, onToggleCollapse, mobileOpen, onOverlayClick }) {
  return (
    <>
      <div className={`sidebar-overlay ${mobileOpen ? "show" : ""}`} onClick={onOverlayClick} />
      <aside className={`sidebar ${collapsed ? "collapsed" : ""} ${mobileOpen ? "open" : ""}`}>
        <div className="sidebar-logo">
          <svg width="28" height="28" viewBox="0 0 40 40" fill="none" style={{ flexShrink: 0 }}>
            <rect width="40" height="40" rx="12" fill="rgba(0,122,255,0.15)" stroke="rgba(0,122,255,0.3)" strokeWidth="0.5"/>
            <path d="M10 14h20M10 20h14M10 26h18" stroke="#5aabff" strokeWidth="2.5" strokeLinecap="round"/>
          </svg>
          <span className="logo-title">Inventory</span>
          <button className="sidebar-toggle" onClick={onToggleCollapse} aria-label="Toggle sidebar">
            <IconChevron />
          </button>
        </div>
        <nav className="sidebar-nav">
          {NAV_ITEMS.map(({ id, label, icon }) => (
            <button
              key={id}
              className={`nav-item ${activePage === id ? "active" : ""}`}
              data-label={label}
              onClick={() => onNavigate(id)}
            >
              {icon}
              <span className="nav-label">{label}</span>
            </button>
          ))}
        </nav>
        {/* <button className="sidebar-logout" onClick={onLogout}>
          <IconLogout />
          <span className="logout-label">Logout</span>
        </button> */}
      </aside>
    </>
  );
}

// ─── TOPBAR ────────────────────────────────────────────────────────────────

function Topbar({ title, onMenuOpen, children }) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="mobile-menu-btn" onClick={onMenuOpen} aria-label="Open menu">
          <IconMenu />
        </button>
        <h2 className="page-title">{title}</h2>
      </div>
      <div className="topbar-right">{children}</div>
    </header>
  );
}

// ─── MODAL ─────────────────────────────────────────────────────────────────

function ItemModal({ open, onClose, onSave, editData }) {
  const [form, setForm] = useState({ item_name: "", category: "", available_stock: "", minimum_stock: "", units: "" });

  useEffect(() => {
    if (editData) {
      setForm({
        item_name: editData.item_name || "",
        category: editData.category || "",
        available_stock: editData.available_stock ?? "",
        minimum_stock: editData.minimum_stock ?? "",
        units: editData.units || "",
      });
    } else {
      setForm({ item_name: "", category: "", available_stock: "", minimum_stock: "", units: "" });
    }
  }, [editData, open]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = (e) => {
    e.preventDefault();
    const { item_name, category, units, available_stock, minimum_stock } = form;
    if (!item_name.trim() || !category.trim() || !units.trim() || available_stock === "" || minimum_stock === "") {
      alert("Please fill all fields"); return;
    }
    const available = Number(available_stock), minimum = Number(minimum_stock);
    if (isNaN(available) || isNaN(minimum)) { alert("Stock values must be numbers"); return; }
    onSave({ item_name: item_name.trim(), category: category.trim(), available_stock: available, minimum_stock: minimum, units: units.trim() });
  };

  if (!open) return null;
  return (
    <div className="modal-backdrop">
      <div className="modal-card">
        <div className="modal-header">
          <h3>{editData ? "Edit Item" : "Add Item"}</h3>
          <button className="modal-close" onClick={onClose}><IconClose /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {[["item_name", "Item Name", "e.g. Basmati Rice"], ["category", "Category", "e.g. Grains"], ["units", "Units", "e.g. kg, pcs, L"]].map(([key, label, ph]) => (
              <div className="field-group" key={key}>
                <label>{label}</label>
                <input placeholder={ph} value={form[key]} onChange={set(key)} required />
              </div>
            ))}
            <div className="modal-row">
              {[["available_stock", "Available Stock"], ["minimum_stock", "Minimum Stock"]].map(([key, label]) => (
                <div className="field-group" key={key}>
                  <label>{label}</label>
                  <input type="number" placeholder="0" min="0" value={form[key]} onChange={set(key)} required />
                </div>
              ))}
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary">Save Item</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── DASHBOARD PAGE ────────────────────────────────────────────────────────

function DashboardPage({ allData, setAllData, onMenuOpen, onSendWhatsApp }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [activeStatus, setActiveStatus] = useState("all");
  const [editingId, setEditingId] = useState(null);
  const [editingField, setEditingField] = useState("");
  const [editingValue, setEditingValue] = useState("");
  const showToast = useToast();

  const stats = useMemo(() => {
    let low = 0, out = 0, ok = 0;
    allData.forEach((i) => { const s = getStatus(i); if (s === "out") out++; else if (s === "low") low++; else ok++; });
    return { total: allData.length, low, out, ok };
  }, [allData]);

  const categories = useMemo(() => [...new Set(allData.map((i) => i.category).filter(Boolean))].sort(), [allData]);

  const filteredData = useMemo(() => {
    return allData.filter((i) => {
      if (searchQuery.trim()) {
        const s = searchQuery.toLowerCase();
        if (!i.item_name?.toLowerCase().includes(s) && !i.category?.toLowerCase().includes(s)) return false;
      }
      if (categoryFilter && i.category !== categoryFilter) return false;
      if (activeStatus !== "all" && getStatus(i) !== activeStatus) return false;
      return true;
    });
  }, [allData, searchQuery, categoryFilter, activeStatus]);

  const changeQty = async (id, current, delta) => {
    const newQty = Math.max(0, current + delta);
    setAllData(prev => prev.map(item => item.id === id ? { ...item, available_stock: newQty } : item));
    try {
      const { error } = await supabase.from(STOCK_TABLE).update({ available_stock: newQty }).eq("id", id);
      if (error) throw error;
    } catch (err) { 
      showToast("Update failed: " + err.message, "#ff3b30");
      setAllData(prev => prev.map(item => item.id === id ? { ...item, available_stock: current } : item));
    }
  };

  const handleInlineSave = async (id, field) => {
    const newVal = String(editingValue).trim();
    if (isNaN(newVal) || newVal === "") { showToast("Invalid number", "#ff3b30"); setEditingId(null); return; }
    const numericVal = Number(newVal);
    
    setAllData(prev => prev.map(item => item.id === id ? { ...item, [field]: numericVal } : item));
    try {
      const { error } = await supabase.from(STOCK_TABLE).update({ [field]: numericVal }).eq("id", id);
      if (error) throw error;
      showToast("Updated", "#34c759");
    } catch (err) { 
      showToast("Update failed: " + err.message, "#ff3b30");
    }
    setEditingId(null); setEditingField(""); setEditingValue("");
  };

  return (
    <div className="page active" >
      <Topbar title="Dashboard" onMenuOpen={onMenuOpen}>
        <button className="whatsapp-btn" onClick={onSendWhatsApp}>⚠ Low Stock Alert</button>
      </Topbar>

      <div className="stats-row" >
        {[
          { label: "Total Items", value: stats.total, variant: "total", status: "all" },
          { label: "Low Stock", value: stats.low, variant: "low", status: "low" },
          { label: "Out of Stock", value: stats.out, variant: "out", status: "out" },
          { label: "Healthy", value: stats.ok, variant: "ok", status: "ok" },
        ].map(({ label, value, variant, status }) => (
          <StatCard key={status} label={label} value={value} variant={variant} onClick={() => setActiveStatus(status)} />
        ))}
      </div>

      <div className="filters-bar">
        <input placeholder="Search items..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
        <SelectWrapper value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} >
          <option value="">All Categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </SelectWrapper>
      </div>

      <div className="table-wrapper" style={{ margin:"0 30px 30px 30px" }}>
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Available</th>
              <th>Units</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredData.map((item) => (
              <tr key={item.id} className={getStatus(item) === "out" ? "out-stock" : getStatus(item) === "low" ? "low" : ""}>
                <td>{item.item_name}</td>
                <td>
                  <QtyControl
                    value={item.available_stock}
                    itemId={item.id}
                    editingId={editingId}
                    editingField={editingField}
                    editingValue={editingValue}
                    setEditingId={setEditingId}
                    setEditingField={setEditingField}
                    setEditingValue={setEditingValue}
                    onMinus={() => changeQty(item.id, item.available_stock, -1)}
                    onPlus={() => changeQty(item.id, item.available_stock, 1)}
                    onSave={handleInlineSave}
                  />
                </td>
                <td>{item.units}</td>
                <td><Badge status={getStatus(item)} /></td>
              </tr>
            ))}
            {filteredData.length === 0 && (
              <tr><td colSpan={5} style={{ textAlign: "center", padding: "32px", color: "#8e8e93" }}>No items found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── PHYSICAL STOCK PAGE ──────────────────────────────────────────────────

function PhysicalStockPage({ onMenuOpen }) {
  const [psItems, setPsItems] = useState([]);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("psItems") || "[]");
      setPsItems(Array.isArray(saved) && saved.length ? saved.map((i) => ({ name: String(i.name || ""), qty: Number(i.qty) ?? 0 })) : PS_DEFAULT.map((i) => ({ ...i })));
    } catch { setPsItems(PS_DEFAULT.map((i) => ({ ...i }))); }
  }, []);

  const save = (items) => { setPsItems(items); localStorage.setItem("psItems", JSON.stringify(items)); };

  const buildMessage = () => {
    const lines = psItems.filter((i) => i.name.trim()).map((i, idx) => `${idx + 1}. ${i.name}  -  ${i.qty}`).join("\n");
    return `📦 DAILY STOCK REPORT\n----------------------------\n\n${lines || "No items"}\n\n----------------------------\nTotal Items: ${psItems.filter((i) => i.name.trim()).length}\n\nGenerated: ${buildTimestamp()}\n\nSriSathyaSaiMetro LEVISTA CAFE`;
  };

  // return (
  //   <div className="page active">
  //     <Topbar title="Daily Stock" onMenuOpen={onMenuOpen}>
  //       <button className="btn-ghost" onClick={() => setShowPreview((p) => !p)}>{showPreview ? "Hide" : "Preview"}</button>
  //       <button className="btn-primary" onClick={() => openWhatsApp(buildMessage())}>Send Report</button>
  //     </Topbar>

  //     <div className="ps-container">
  //       {showPreview && (
  //         <div className="ps-preview">{buildMessage()}</div>
  //       )}

  //       <div className="ps-list tablepadding">
  //         <div className="ps-list-header">
  //           <div>Item Name</div>
  //           <div className="col-qty">Quantity</div>
  //           <div className="col-del" />
  //         </div>

  //         {psItems.map((item, idx) => (
  //           <div key={idx} className={`ps-row ${item.qty === 0 ? "zero" : ""}`}>
  //             <input
  //               className="ps-row-name"
  //               value={item.name}
  //               placeholder="Item name..."
  //               onChange={(e) => save(psItems.map((it, i) => i === idx ? { ...it, name: e.target.value } : it))}
  //             />
  //             <div className="ps-row-qty">
  //               <button type="button" className="ps-qty-btn" onClick={() => save(psItems.map((it, i) => i === idx ? { ...it, qty: Math.max(0, it.qty - 1) } : it))}>−</button>
  //               <input
  //                 className="ps-qty-val"
  //                 type="number"
  //                 inputMode="numeric"
  //                 value={item.qty}
  //                 onFocus={(e) => e.target.select()}
  //                 onChange={(e) => {
  //                   const v = parseInt(e.target.value, 10);
  //                   save(psItems.map((it, i) => i === idx ? { ...it, qty: isNaN(v) || v < 0 ? 0 : v } : it));
  //                 }}
  //               />
  //               <button type="button" className="ps-qty-btn" onClick={() => save(psItems.map((it, i) => i === idx ? { ...it, qty: it.qty + 1 } : it))}>+</button>
  //             </div>
  //             <div className="ps-row-del">
  //               <button type="button" className="ps-del-btn badge-out" onClick={() => save(psItems.filter((_, i) => i !== idx))}>✕</button>
  //             </div>
  //           </div>
  //         ))}

  //         <button type="button" className="ps-add-row" onClick={() => save([...psItems, { name: "", qty: 0 }])}>+ Add Item</button>
  //       </div>
  //     </div>
  //   </div>
  // );
//}
return (
  <div className="page active">
    <Topbar title="Daily Stock" onMenuOpen={onMenuOpen}>
      <button
        className="btn-ghost"
        onClick={() => setShowPreview((p) => !p)}
      >
        {showPreview ? "Hide" : "Preview"}
      </button>

      <button
        className="btn-primary"
        onClick={() => openWhatsApp(buildMessage())}
      >
        Send Report
      </button>
    </Topbar>

    <div className="ps-container">
      {showPreview && (
        <div className="ps-preview">{buildMessage()}</div>
      )}

      <div className="ps-list tablepadding">
        <div className="ps-list-header">
          <div>Item Name</div>
          <div className="col-qty">Quantity</div>
          <div className="col-del" />
        </div>

        {psItems.map((item, idx) => (
          <div key={idx} className={`ps-row ${item.qty === 0 ? "zero" : ""}`}>
            
            {/* NAME */}
            <input
              className="ps-row-name"
              value={item.name}
              placeholder="Item name..."
              onChange={(e) =>
                save(
                  psItems.map((it, i) =>
                    i === idx ? { ...it, name: e.target.value } : it
                  )
                )
              }
            />

            {/* QUANTITY */}
            <div className="ps-row-qty">
              
              {/* MINUS */}
              <button
                type="button"
                className="ps-qty-btn"
                onClick={() =>
                  save(
                    psItems.map((it, i) =>
                      i === idx
                        ? { ...it, qty: Math.max(0, +(it.qty - 0.1).toFixed(2)) }
                        : it
                    )
                  )
                }
              >
                −
              </button>

              {/* INPUT (FLOAT SUPPORT) */}
              <input
                className="ps-qty-val"
                type="number"
                step="0.1"   // ✅ allows decimals
                inputMode="decimal"
                value={item.qty}
                onFocus={(e) => e.target.select()}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);

                  save(
                    psItems.map((it, i) =>
                      i === idx
                        ? {
                            ...it,
                            qty: isNaN(v) || v < 0 ? 0 : +v.toFixed(2),
                          }
                        : it
                    )
                  );
                }}
              />

              {/* PLUS */}
              <button
                type="button"
                className="ps-qty-btn"
                onClick={() =>
                  save(
                    psItems.map((it, i) =>
                      i === idx
                        ? { ...it, qty: +(it.qty + 0.1).toFixed(2) }
                        : it
                    )
                  )
                }
              >
                +
              </button>
            </div>

            {/* DELETE */}
            <div className="ps-row-del">
              <button
                type="button"
                className="ps-del-btn badge-out"
                onClick={() =>
                  save(psItems.filter((_, i) => i !== idx))
                }
              >
                ✕
              </button>
            </div>
          </div>
        ))}

        <button
          type="button"
          className="ps-add-row"
          onClick={() => save([...psItems, { name: "", qty: 0 }])}
        >
          + Add Item
        </button>
      </div>
    </div>
  </div>
);
}

// ─── ATTENDANCE PAGE ───────────────────────────────────────────────────────
// function AttendancePage({ onMenuOpen }) {
//   const [loading, setLoading] = useState(false);
//   const [username, setUsername] = useState("");
//   const [password, setPassword] = useState("");
//   const [attendanceData, setAttendanceData] = useState([]);
//   const [allUsersData, setAllUsersData] = useState([]);
//   const [loggedInUser, setLoggedInUser] = useState(null);
//   const [isSuperUser, setIsSuperUser] = useState(false);
//   const [isAdmin, setIsAdmin] = useState(false);

//   const [selectedMonth, setSelectedMonth] = useState(() => {
//     const now = new Date();
//     return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
//   });

//   useEffect(() => {
//     if (!loggedInUser) return;
//     fetchAttendanceData();
//     if (isSuperUser || isAdmin) fetchAllUsersData();
//     const interval = setInterval(() => {
//       fetchAttendanceData();
//       if (isSuperUser || isAdmin) fetchAllUsersData();
//     }, 30000);
//     return () => clearInterval(interval);
//   }, [loggedInUser, isSuperUser, isAdmin]);

//   const fetchAttendanceData = async () => {
//     if (!loggedInUser) return;
//     const { data } = await supabase
//       .from("Attendance")
//       .select("*")
//       .eq("name", loggedInUser)
//       .order("login_time", { ascending: false });
//     setAttendanceData(data || []);
//   };

//   const fetchAllUsersData = async () => {
//     const { data } = await supabase
//       .from("Attendance")
//       .select("*")
//       .order("date", { ascending: false });
//     setAllUsersData(data || []);
//   };

//   const handleAttLogin = async (e) => {
//     e.preventDefault();
//     setLoading(true);

//     const { data: userInfo, error: authError } = await supabase
//       .rpc("check_user_credentials", { p_username: username, p_password: password });

//     if (authError || !userInfo) {
//       Toastify({ text: "Invalid credentials", style: { background: "#dc3545" } }).showToast();
//       setLoading(false);
//       return;
//     }

//     const superUser = userInfo.role === "superuser";
//     setIsSuperUser(superUser);

//     const adminUser = username.toLowerCase() === "havelyninc";
//     setIsAdmin(adminUser);

//     if (!superUser) {
//       const { data: activeSession } = await supabase
//         .from("Attendance")
//         .select("id")
//         .eq("name", username)
//         .is("logout_time", null)
//         .maybeSingle();

//       if (activeSession) {
//         Toastify({ text: "Session already active.", style: { background: "#ff9500" } }).showToast();
//       } else {
//         await supabase.from("Attendance").insert([{
//           name: username,
//           date: new Date().toISOString().split("T")[0],
//           login_time: new Date().toISOString(),
//         }]);
//         Toastify({ text: "Clocked in!", style: { background: "#28a745" } }).showToast();
//       }
//     }

//     setLoggedInUser(username);
//     setLoading(false);
//   };

//   const handleLogout = async (name) => {
//     setLoading(true);
//     const { data: session } = await supabase
//       .from("Attendance")
//       .select("id")
//       .eq("name", name)
//       .is("logout_time", null)
//       .maybeSingle();
//     if (session) {
//       await supabase
//         .from("Attendance")
//         .update({ logout_time: new Date().toISOString() })
//         .eq("id", session.id);
//       fetchAttendanceData();
//       if (isSuperUser || isAdmin) fetchAllUsersData();
//       Toastify({ text: "Clocked out!", style: { background: "#28a745" } }).showToast();
//     }
//     setLoading(false);
//   };

//   const handleSignOut = () => {
//     setLoggedInUser(null);
//     setIsSuperUser(false);
//     setIsAdmin(false);
//     setAttendanceData([]);
//     setAllUsersData([]);
//     setUsername("");
//     setPassword("");
//   };

//   const userStats = useMemo(() => {
//     const stats = {};
//     const todayStr = new Date().toISOString().split("T")[0];
//     attendanceData.forEach((row) => {
//       if (!row.logout_time) return;
//       const hours = (new Date(row.logout_time) - new Date(row.login_time)) / 3600000;
//       if (!stats[row.name]) stats[row.name] = { today: 0, monthly: 0 };
//       if (row.date === todayStr) stats[row.name].today += hours;
//       stats[row.name].monthly += hours;
//     });
//     return stats;
//   }, [attendanceData]);

//   const exportMyData = () => {
//     if (attendanceData.length === 0) {
//       Toastify({ text: "No data to export!", style: { background: "#dc3545" } }).showToast();
//       return;
//     }
//     const rows = attendanceData.map((row) => {
//       const login = new Date(row.login_time);
//       const logout = row.logout_time ? new Date(row.logout_time) : null;
//       return {
//         Name: row.name,
//         Date: row.date,
//         "Login Time": login.toLocaleTimeString(),
//         "Logout Time": logout ? logout.toLocaleTimeString() : "Working...",
//         "Total Hours Worked": logout ? ((logout - login) / 3600000).toFixed(2) : "In Progress",
//         Status: logout ? "Present" : "Working",
//       };
//     });
//     const ws = XLSX.utils.json_to_sheet(rows);
//     const wb = XLSX.utils.book_new();
//     XLSX.utils.book_append_sheet(wb, ws, "My Attendance");
//     XLSX.writeFile(wb, `Attendance_${loggedInUser}_${new Date().toLocaleDateString()}.xlsx`);
//   };

//   const exportAllData = () => {
//     if (allUsersData.length === 0) {
//       Toastify({ text: "No data to export!", style: { background: "#dc3545" } }).showToast();
//       return;
//     }
//     const rows = allUsersData.map((row) => {
//       const login = new Date(row.login_time);
//       const logout = row.logout_time ? new Date(row.logout_time) : null;
//       return {
//         Name: row.name,
//         Date: row.date,
//         "Login Time": login.toLocaleTimeString(),
//         "Logout Time": logout ? logout.toLocaleTimeString() : "Working...",
//         "Total Hours Worked": logout ? ((logout - login) / 3600000).toFixed(2) : "In Progress",
//         Status: logout ? "Present" : "Working",
//       };
//     });
//     const ws = XLSX.utils.json_to_sheet(rows);
//     const wb = XLSX.utils.book_new();
//     XLSX.utils.book_append_sheet(wb, ws, "All Attendance");
//     XLSX.writeFile(wb, `All_Users_Attendance_${new Date().toLocaleDateString()}.xlsx`);
//   };

//   const adminMonthData = useMemo(() => {
//     return allUsersData.filter((row) => row.date && row.date.startsWith(selectedMonth));
//   }, [allUsersData, selectedMonth]);

//   // ── KEY CHANGE: one row per user, active sessions counted up to click time ──
//   const exportAdminMonthData = () => {
//     if (adminMonthData.length === 0) {
//       Toastify({ text: "No data for this month!", style: { background: "#dc3545" } }).showToast();
//       return;
//     }

//     const now = new Date(); // snapshot at exact click time

//     const userTotals = {};
//     adminMonthData.forEach((row) => {
//       const login  = new Date(row.login_time);
//       const logout = row.logout_time ? new Date(row.logout_time) : now; // active = up to now
//       const hours  = (logout - login) / 3600000;

//       if (!userTotals[row.name]) {
//         userTotals[row.name] = { totalHours: 0, sessions: 0, hasActive: false };
//       }
//       userTotals[row.name].totalHours += hours;
//       userTotals[row.name].sessions   += 1;
//       if (!row.logout_time) userTotals[row.name].hasActive = true;
//     });

//     const rows = Object.entries(userTotals).map(([name, data]) => ({
//       Name:                 name,
//       Month:                selectedMonth,
//       "Total Sessions":     data.sessions,
//       "Total Hours Worked": data.totalHours.toFixed(2),
//       "Note": data.hasActive
//         ? `Includes live session (as of ${now.toLocaleTimeString()})`
//         : "All sessions completed",
//     }));

//     const ws = XLSX.utils.json_to_sheet(rows);
//     const wb = XLSX.utils.book_new();
//     XLSX.utils.book_append_sheet(wb, ws, "Attendance Summary");
//     XLSX.writeFile(wb, `Attendance_Summary_${selectedMonth}.xlsx`);
//   };

//   const activeSessions = useMemo(
//     () => allUsersData.filter((r) => !r.logout_time),
//     [allUsersData]
//   );

//   const ClockedInBadge = ({ name }) => (
//     <div style={{
//       display: "flex", flexDirection: "column",
//       alignItems: "center", justifyContent: "center",
//       gap: "14px", padding: "28px 20px",
//     }}>
//       <svg width="110" height="110" viewBox="0 0 110 110"
//         xmlns="http://www.w3.org/2000/svg" style={{ overflow: "visible" }}>
//         <style>{`
//           @keyframes att-ring-spin {
//             0%   { stroke-dashoffset: 251; }
//             60%  { stroke-dashoffset: 0; }
//             100% { stroke-dashoffset: 0; }
//           }
//           @keyframes att-check-draw {
//             0%   { stroke-dashoffset: 60; opacity: 0; }
//             40%  { opacity: 0; }
//             100% { stroke-dashoffset: 0; opacity: 1; }
//           }
//           @keyframes att-pulse-ring {
//             0%   { r: 46; opacity: 0.6; }
//             100% { r: 58; opacity: 0; }
//           }
//           @keyframes att-icon-pop {
//             0%   { transform: scale(0.7); opacity: 0; }
//             70%  { transform: scale(1.08); opacity: 1; }
//             100% { transform: scale(1); opacity: 1; }
//           }
//           @keyframes att-badge-float {
//             0%, 100% { transform: translateY(0px); }
//             50%       { transform: translateY(-5px); }
//           }
//           .att-badge-group {
//             animation: att-badge-float 3s ease-in-out infinite;
//             transform-origin: 55px 55px;
//           }
//           .att-icon-pop {
//             animation: att-icon-pop 0.7s cubic-bezier(0.34,1.56,0.64,1) 0.5s both;
//             transform-origin: 55px 55px;
//           }
//         `}</style>
//         <circle cx="55" cy="55" r="46"
//           fill="none" stroke="#28a745" strokeWidth="2" opacity="0"
//           style={{ animation: "att-pulse-ring 2s ease-out 0.8s infinite" }}
//         />
//         <g className="att-badge-group">
//           <circle cx="55" cy="55" r="46" fill="#e8f5e9" />
//           <circle cx="55" cy="55" r="40"
//             fill="none" stroke="#28a745" strokeWidth="5"
//             strokeLinecap="round"
//             strokeDasharray="251" strokeDashoffset="251"
//             transform="rotate(-90 55 55)"
//             style={{ animation: "att-ring-spin 1.2s cubic-bezier(0.4,0,0.2,1) 0.1s forwards" }}
//           />
//           <circle cx="55" cy="55" r="32" fill="#28a745" className="att-icon-pop" />
//           <polyline points="38,55 50,67 72,43"
//             fill="none" stroke="#fff" strokeWidth="5"
//             strokeLinecap="round" strokeLinejoin="round"
//             strokeDasharray="60" strokeDashoffset="60"
//             style={{ animation: "att-check-draw 0.5s ease-out 0.9s forwards" }}
//           />
//         </g>
//       </svg>
//       <div style={{ textAlign: "center" }}>
//         <div style={{ fontWeight: "700", fontSize: "16px", color: "#155724", letterSpacing: "0.3px" }}>
//           ✅ Clocked In
//         </div>
//         <div style={{ fontSize: "13px", color: "#555", marginTop: "4px" }}>
//           Welcome back, <strong>{name}</strong>
//         </div>
//         <div style={{
//           marginTop: "8px", fontSize: "12px",
//           background: "#d4edda", color: "#155724",
//           borderRadius: "20px", padding: "4px 14px", display: "inline-block",
//         }}>
//           Session active 🟢
//         </div>
//       </div>
//     </div>
//   );

//   return (
//     <div className="page active">
//       <Topbar title="Attendance" onMenuOpen={onMenuOpen} className="glossy-container" />
//       <div style={{ padding: "20px" }}>

//         {/* ════ NOT LOGGED IN ════ */}
//         {!loggedInUser && (
//           <div className="glossy-container" style={{ maxWidth: "400px", margin: "40px auto" }}>
//             <h3 style={{ marginTop: 0 }}>Clock In</h3>
//             <form onSubmit={handleAttLogin} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
//               <input
//                 className="input-field" placeholder="Username" value={username}
//                 onChange={(e) => setUsername(e.target.value)} required
//               />
//               <input
//                 type="password" className="input-field" placeholder="Password" value={password}
//                 onChange={(e) => setPassword(e.target.value)} required
//               />
//               <button type="submit" className="btn-primary" disabled={loading}>
//                 {loading ? "Please wait..." : "Mark Attendance"}
//               </button>
//             </form>
//           </div>
//         )}

//         {/* ════ NORMAL USER VIEW ════ */}
//         {loggedInUser && !isSuperUser && (
//           <>
//             <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
//               <span>👤 Logged in as <strong>{loggedInUser}</strong></span>
//               <button className="btn-secondary" onClick={handleSignOut}>Sign Out</button>
//             </div>

//             {/* Badge + Summary — hidden for admin */}
//             {!isAdmin && (
//               <div style={{ display: "flex", gap: "20px", flexWrap: "wrap", marginBottom: "20px" }}>
//                 <div className="glossy-container" style={{
//                   flex: "1", minWidth: "300px",
//                   display: "flex", alignItems: "center", justifyContent: "center",
//                 }}>
//                   <ClockedInBadge name={loggedInUser} />
//                 </div>
//                 <div className="glossy-container" style={{ flex: "1", minWidth: "300px" }}>
//                   <h3 style={{ marginTop: 0 }}>My Summary</h3>
//                   <button onClick={exportMyData} className="btn-secondary"
//                     style={{ width: "100%", marginBottom: "10px" }}>
//                     Export My Data 📊
//                   </button>
//                   <div className="table-scroll">
//                     <table>
//                       <thead>
//                         <tr><th>Name</th><th>Today</th><th>Monthly</th></tr>
//                       </thead>
//                       <tbody>
//                         {Object.entries(userStats).length > 0
//                           ? Object.entries(userStats).map(([name, data]) => (
//                               <tr key={name}>
//                                 <td>{name}</td>
//                                 <td>{data.today.toFixed(1)}h</td>
//                                 <td>{data.monthly.toFixed(1)}h</td>
//                               </tr>
//                             ))
//                           : (
//                             <tr>
//                               <td colSpan={3} style={{ textAlign: "center", opacity: 0.5 }}>
//                                 No completed sessions yet
//                               </td>
//                             </tr>
//                           )}
//                       </tbody>
//                     </table>
//                   </div>
//                 </div>
//               </div>
//             )}

//             {/* Full history — hidden for admin */}
//             {!isAdmin && (
//               <div className="glossy-container">
//                 <h3 style={{ marginTop: 0 }}>My Full History</h3>
//                 <div className="table-scroll">
//                   <table>
//                     <thead>
//                       <tr><th>Name</th><th>Date</th><th>Login</th><th>Logout</th></tr>
//                     </thead>
//                     <tbody>
//                       {attendanceData.length > 0
//                         ? attendanceData.map((row) => (
//                             <tr key={row.id}>
//                               <td>{row.name}</td>
//                               <td>{row.date}</td>
//                               <td>{new Date(row.login_time).toLocaleTimeString()}</td>
//                               <td>{row.logout_time ? new Date(row.logout_time).toLocaleTimeString() : "Working..."}</td>
//                             </tr>
//                           ))
//                         : (
//                           <tr>
//                             <td colSpan={5} style={{ textAlign: "center", opacity: 0.5 }}>No history found</td>
//                           </tr>
//                         )}
//                     </tbody>
//                   </table>
//                 </div>
//               </div>
//             )}

//             {/* ════ ADMIN PANEL ════ */}
//             {isAdmin && (
//               <div className="glossy-container" style={{ marginTop: "20px" }}>
//                 <div style={{
//                   display: "flex", justifyContent: "space-between",
//                   alignItems: "center", marginBottom: "14px", flexWrap: "wrap", gap: "10px",
//                 }}>
//                   <h3 style={{ margin: 0 }}>
//                     🏢 Admin — All Users Attendance
//                     <span style={{
//                       marginLeft: "10px", background: "#0d6efd", color: "#fff",
//                       borderRadius: "4px", padding: "2px 8px", fontSize: "12px",
//                     }}>Admin</span>
//                   </h3>
//                   <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
//                     <label style={{ fontSize: "13px", fontWeight: "600" }}>📅 Month:</label>
//                     <input
//                       type="month" className="input-field" value={selectedMonth}
//                       onChange={(e) => setSelectedMonth(e.target.value)}
//                       style={{ padding: "6px 10px", fontSize: "13px", width: "auto" }}
//                     />
//                     <button onClick={exportAdminMonthData} className="btn-secondary">
//                       Export Excel 📊
//                     </button>
//                   </div>
//                 </div>

//                 <div className="table-scroll">
//                   <table>
//                     <thead>
//                       <tr>
//                         <th>Name</th><th>Date</th><th>Logged In</th>
//                         <th>Logged Out</th><th>Total Hours</th><th>Status</th>
//                       </tr>
//                     </thead>
//                     <tbody>
//                       {adminMonthData.length > 0
//                         ? adminMonthData.map((row) => {
//                             const login   = new Date(row.login_time);
//                             const logout  = row.logout_time ? new Date(row.logout_time) : null;
//                             const hours   = logout ? ((logout - login) / 3600000).toFixed(2) : null;
//                             const working = !row.logout_time;
//                             return (
//                               <tr key={row.id}>
//                                 <td>{row.name}</td>
//                                 <td>{row.date}</td>
//                                 <td>{login.toLocaleTimeString()}</td>
//                                 <td>{logout ? logout.toLocaleTimeString() : "—"}</td>
//                                 <td>{hours ? `${hours}h` : "In Progress"}</td>
//                                 <td>
//                                   <span style={{
//                                     padding: "2px 10px", borderRadius: "12px",
//                                     fontSize: "12px", fontWeight: "600",
//                                     background: working ? "#fff3cd" : "#d4edda",
//                                     color:      working ? "#856404" : "#155724",
//                                   }}>
//                                     {working ? "Working" : "Present"}
//                                   </span>
//                                 </td>
//                               </tr>
//                             );
//                           })
//                         : (
//                           <tr>
//                             <td colSpan={6} style={{ textAlign: "center", opacity: 0.5 }}>
//                               No records for {selectedMonth}
//                             </td>
//                           </tr>
//                         )}
//                     </tbody>
//                   </table>
//                 </div>
//               </div>
//             )}
//           </>
//         )}

//         {/* ════ SUPER USER VIEW ════ */}
//         {loggedInUser && isSuperUser && (
//           <>
//             <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
//               <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
//                 🛡️ Logged in as <strong>{loggedInUser}</strong>
//                 <span style={{
//                   background: "#6f42c1", color: "#fff",
//                   borderRadius: "4px", padding: "2px 8px", fontSize: "12px",
//                 }}>Super User</span>
//               </span>
//               <button className="btn-secondary" onClick={handleSignOut}>Sign Out</button>
//             </div>

//             <div className="glossy-container" style={{ marginBottom: "20px" }}>
//               <h3 style={{ marginTop: 0 }}>
//                 🟢 Currently Working
//                 <span style={{
//                   marginLeft: "10px", background: "#28a745", color: "#fff",
//                   borderRadius: "12px", padding: "2px 10px", fontSize: "13px",
//                 }}>{activeSessions.length}</span>
//               </h3>
//               {activeSessions.length > 0 ? (
//                 <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
//                   {activeSessions.map((row) => (
//                     <div key={row.id} style={{
//                       display: "flex", alignItems: "center", gap: "8px",
//                       background: "#d4edda", color: "#155724",
//                       borderRadius: "20px", padding: "6px 14px", fontSize: "13px",
//                     }}>
//                       <span>👤 <strong>{row.name}</strong></span>
//                       <span style={{ opacity: 0.7 }}>since {new Date(row.login_time).toLocaleTimeString()}</span>
//                       <button
//                         onClick={() => handleLogout(row.name)}
//                         style={{
//                           background: "none", border: "1px solid #155724",
//                           borderRadius: "10px", padding: "1px 8px",
//                           cursor: "pointer", fontSize: "11px", color: "#155724",
//                         }}
//                       >
//                         Clock Out
//                       </button>
//                     </div>
//                   ))}
//                 </div>
//               ) : (
//                 <p style={{ margin: 0, opacity: 0.5 }}>No one is currently clocked in.</p>
//               )}
//             </div>

//             <div className="glossy-container">
//               <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
//                 <h3 style={{ margin: 0 }}>📋 All Users — Attendance Report</h3>
//                 <button onClick={exportAllData} className="btn-secondary">Export All Data 📊</button>
//               </div>
//               <div className="table-scroll">
//                 <table>
//                   <thead>
//                     <tr>
//                       <th>Name</th><th>Date</th><th>Login Time</th>
//                       <th>Logout Time</th><th>Total Hours</th><th>Status</th><th>Action</th>
//                     </tr>
//                   </thead>
//                   <tbody>
//                     {allUsersData.length > 0
//                       ? allUsersData.map((row) => {
//                           const login   = new Date(row.login_time);
//                           const logout  = row.logout_time ? new Date(row.logout_time) : null;
//                           const hours   = logout ? ((logout - login) / 3600000).toFixed(2) : null;
//                           const working = !row.logout_time;
//                           return (
//                             <tr key={row.id}>
//                               <td>{row.name}</td>
//                               <td>{row.date}</td>
//                               <td>{login.toLocaleTimeString()}</td>
//                               <td>{logout ? logout.toLocaleTimeString() : "—"}</td>
//                               <td>{hours ? `${hours}h` : "In Progress"}</td>
//                               <td>
//                                 <span style={{
//                                   padding: "2px 10px", borderRadius: "12px",
//                                   fontSize: "12px", fontWeight: "600",
//                                   background: working ? "#fff3cd" : "#d4edda",
//                                   color:      working ? "#856404" : "#155724",
//                                 }}>
//                                   {working ? "Working" : "Present"}
//                                 </span>
//                               </td>
//                               <td>
//                                 {working && (
//                                   <button className="btn-secondary" onClick={() => handleLogout(row.name)}>
//                                     Clock Out
//                                   </button>
//                                 )}
//                               </td>
//                             </tr>
//                           );
//                         })
//                       : (
//                         <tr>
//                           <td colSpan={7} style={{ textAlign: "center", opacity: 0.5 }}>No records found</td>
//                         </tr>
//                       )}
//                   </tbody>
//                 </table>
//               </div>
//             </div>
//           </>
//         )}

//       </div>
//     </div>
//   );
// }
// function AttendancePage({ onMenuOpen }) {
//   const [loading, setLoading] = useState(false);
//   const [username, setUsername] = useState("");
//   const [password, setPassword] = useState("");
//   const [attendanceData, setAttendanceData] = useState([]);
//   const [allUsersData, setAllUsersData] = useState([]);
//   const [loggedInUser, setLoggedInUser] = useState(null);
//   const [isSuperUser, setIsSuperUser] = useState(false);
//   const [isAdmin, setIsAdmin] = useState(false);

//   const [selectedMonth, setSelectedMonth] = useState(() => {
//     const now = new Date();
//     return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
//   });

//   // ── Restore session on mount ──
//   useEffect(() => {
//     const saved = sessionStorage.getItem("att_session");
//     if (saved) {
//       try {
//         const { user, isSuper, isAdm } = JSON.parse(saved);
//         setLoggedInUser(user);
//         setIsSuperUser(isSuper);
//         setIsAdmin(isAdm);
//       } catch {
//         sessionStorage.removeItem("att_session");
//       }
//     }
//   }, []);

//   useEffect(() => {
//     if (!loggedInUser) return;
//     fetchAttendanceData();
//     if (isSuperUser || isAdmin) fetchAllUsersData();
//     const interval = setInterval(() => {
//       fetchAttendanceData();
//       if (isSuperUser || isAdmin) fetchAllUsersData();
//     }, 30000);
//     return () => clearInterval(interval);
//   }, [loggedInUser, isSuperUser, isAdmin]);

//   const fetchAttendanceData = async () => {
//     if (!loggedInUser) return;
//     const { data } = await supabase
//       .from("Attendance")
//       .select("*")
//       .eq("name", loggedInUser)
//       .order("login_time", { ascending: false });
//     setAttendanceData(data || []);
//   };

//   const fetchAllUsersData = async () => {
//     const { data } = await supabase
//       .from("Attendance")
//       .select("*")
//       .order("date", { ascending: false });
//     setAllUsersData(data || []);
//   };

//   const handleAttLogin = async (e) => {
//     e.preventDefault();
//     setLoading(true);

//     const { data: userInfo, error: authError } = await supabase
//       .rpc("check_user_credentials", { p_username: username, p_password: password });

//     if (authError || !userInfo) {
//       Toastify({ text: "Invalid credentials ❌", style: { background: "#dc3545" } }).showToast();
//       setLoading(false);
//       return;
//     }

//     const superUser = userInfo.role === "superuser";
//     setIsSuperUser(superUser);

//     const adminUser = username.toLowerCase() === "havelyninc";
//     setIsAdmin(adminUser);

//     if (!superUser && !adminUser) {
//       const { data: activeSession } = await supabase
//         .from("Attendance")
//         .select("id")
//         .eq("name", username)
//         .is("logout_time", null)
//         .maybeSingle();

//       if (activeSession) {
//         Toastify({ text: "Session already active ⚠️", style: { background: "#ff9500" } }).showToast();
//       } else {
//         await supabase.from("Attendance").insert([{
//           name: username,
//           date: new Date().toISOString().split("T")[0],
//           login_time: new Date().toISOString(),
//         }]);
//         Toastify({ text: "Clocked in! ✅", style: { background: "#28a745" } }).showToast();
//       }
//     }

//     // ── Role-specific welcome toasts ──
//     if (superUser) {
//       Toastify({ text: `Welcome, ${username} 🛡️`, style: { background: "#6f42c1" } }).showToast();
//     } else if (adminUser) {
//       Toastify({ text: `Welcome, ${username} 🏢`, style: { background: "#0d6efd" } }).showToast();
//     }

//     setLoggedInUser(username);

//     // ── Persist session ──
//     sessionStorage.setItem("att_session", JSON.stringify({
//       user: username,
//       isSuper: superUser,
//       isAdm: adminUser,
//     }));

//     setLoading(false);
//   };

//   const handleLogout = async (name) => {
//     setLoading(true);
//     const { data: session } = await supabase
//       .from("Attendance")
//       .select("id")
//       .eq("name", name)
//       .is("logout_time", null)
//       .maybeSingle();
//     if (session) {
//       await supabase
//         .from("Attendance")
//         .update({ logout_time: new Date().toISOString() })
//         .eq("id", session.id);
//       fetchAttendanceData();
//       if (isSuperUser || isAdmin) fetchAllUsersData();
//       Toastify({ text: `${name} clocked out! ✅`, style: { background: "#28a745" } }).showToast();
//     } else {
//       Toastify({ text: "No active session found ⚠️", style: { background: "#ff9500" } }).showToast();
//     }
//     setLoading(false);
//   };

//   const handleSignOut = () => {
//     Toastify({ text: "Signed out successfully 👋", style: { background: "#6c757d" } }).showToast();
//     sessionStorage.removeItem("att_session");
//     setLoggedInUser(null);
//     setIsSuperUser(false);
//     setIsAdmin(false);
//     setAttendanceData([]);
//     setAllUsersData([]);
//     setUsername("");
//     setPassword("");
//   };

//   const userStats = useMemo(() => {
//     const stats = {};
//     const todayStr = new Date().toISOString().split("T")[0];
//     attendanceData.forEach((row) => {
//       if (!row.logout_time) return;
//       const hours = (new Date(row.logout_time) - new Date(row.login_time)) / 3600000;
//       if (!stats[row.name]) stats[row.name] = { today: 0, monthly: 0 };
//       if (row.date === todayStr) stats[row.name].today += hours;
//       stats[row.name].monthly += hours;
//     });
//     return stats;
//   }, [attendanceData]);

//   const exportMyData = () => {
//     if (attendanceData.length === 0) {
//       Toastify({ text: "No data to export! ❌", style: { background: "#dc3545" } }).showToast();
//       return;
//     }
//     const rows = attendanceData.map((row) => {
//       const login = new Date(row.login_time);
//       const logout = row.logout_time ? new Date(row.logout_time) : null;
//       return {
//         Name: row.name,
//         Date: row.date,
//         "Login Time": login.toLocaleTimeString(),
//         "Logout Time": logout ? logout.toLocaleTimeString() : "Working...",
//         "Total Hours Worked": logout ? ((logout - login) / 3600000).toFixed(2) : "In Progress",
//         Status: logout ? "Present" : "Working",
//       };
//     });
//     const ws = XLSX.utils.json_to_sheet(rows);
//     const wb = XLSX.utils.book_new();
//     XLSX.utils.book_append_sheet(wb, ws, "My Attendance");
//     XLSX.writeFile(wb, `Attendance_${loggedInUser}_${new Date().toLocaleDateString()}.xlsx`);
//   };

//   const exportAllData = () => {
//     if (allUsersData.length === 0) {
//       Toastify({ text: "No data to export! ❌", style: { background: "#dc3545" } }).showToast();
//       return;
//     }
//     const rows = allUsersData.map((row) => {
//       const login = new Date(row.login_time);
//       const logout = row.logout_time ? new Date(row.logout_time) : null;
//       return {
//         Name: row.name,
//         Date: row.date,
//         "Login Time": login.toLocaleTimeString(),
//         "Logout Time": logout ? logout.toLocaleTimeString() : "Working...",
//         "Total Hours Worked": logout ? ((logout - login) / 3600000).toFixed(2) : "In Progress",
//         Status: logout ? "Present" : "Working",
//       };
//     });
//     const ws = XLSX.utils.json_to_sheet(rows);
//     const wb = XLSX.utils.book_new();
//     XLSX.utils.book_append_sheet(wb, ws, "All Attendance");
//     XLSX.writeFile(wb, `All_Users_Attendance_${new Date().toLocaleDateString()}.xlsx`);
//   };

//   const adminMonthData = useMemo(() => {
//     return allUsersData.filter((row) => row.date && row.date.startsWith(selectedMonth));
//   }, [allUsersData, selectedMonth]);

//   const exportAdminMonthData = () => {
//     if (adminMonthData.length === 0) {
//       Toastify({ text: "No data for this month! ❌", style: { background: "#dc3545" } }).showToast();
//       return;
//     }

//     const now = new Date();

//     const userTotals = {};
//     adminMonthData.forEach((row) => {
//       const login  = new Date(row.login_time);
//       const logout = row.logout_time ? new Date(row.logout_time) : now;
//       const hours  = (logout - login) / 3600000;
//       if (!userTotals[row.name]) {
//         userTotals[row.name] = { totalHours: 0, sessions: 0, hasActive: false };
//       }
//       userTotals[row.name].totalHours += hours;
//       userTotals[row.name].sessions   += 1;
//       if (!row.logout_time) userTotals[row.name].hasActive = true;
//     });

//     const rows = Object.entries(userTotals).map(([name, data]) => ({
//       Name:                 name,
//       Month:                selectedMonth,
//       "Total Sessions":     data.sessions,
//       "Total Hours Worked": data.totalHours.toFixed(2),
//       "Note": data.hasActive
//         ? `Includes live session (as of ${now.toLocaleTimeString()})`
//         : "All sessions completed",
//     }));

//     const ws = XLSX.utils.json_to_sheet(rows);
//     const wb = XLSX.utils.book_new();
//     XLSX.utils.book_append_sheet(wb, ws, "Attendance Summary");
//     XLSX.writeFile(wb, `Attendance_Summary_${selectedMonth}.xlsx`);
//     Toastify({ text: "Exported successfully 📊", style: { background: "#28a745" } }).showToast();
//   };

//   const activeSessions = useMemo(
//     () => allUsersData.filter((r) => !r.logout_time),
//     [allUsersData]
//   );

//   const ClockedInBadge = ({ name }) => (
//     <div style={{
//       display: "flex", flexDirection: "column",
//       alignItems: "center", justifyContent: "center",
//       gap: "14px", padding: "28px 20px",
//     }}>
//       <svg width="110" height="110" viewBox="0 0 110 110"
//         xmlns="http://www.w3.org/2000/svg" style={{ overflow: "visible" }}>
//         <style>{`
//           @keyframes att-ring-spin {
//             0%   { stroke-dashoffset: 251; }
//             60%  { stroke-dashoffset: 0; }
//             100% { stroke-dashoffset: 0; }
//           }
//           @keyframes att-check-draw {
//             0%   { stroke-dashoffset: 60; opacity: 0; }
//             40%  { opacity: 0; }
//             100% { stroke-dashoffset: 0; opacity: 1; }
//           }
//           @keyframes att-pulse-ring {
//             0%   { r: 46; opacity: 0.6; }
//             100% { r: 58; opacity: 0; }
//           }
//           @keyframes att-icon-pop {
//             0%   { transform: scale(0.7); opacity: 0; }
//             70%  { transform: scale(1.08); opacity: 1; }
//             100% { transform: scale(1); opacity: 1; }
//           }
//           @keyframes att-badge-float {
//             0%, 100% { transform: translateY(0px); }
//             50%       { transform: translateY(-5px); }
//           }
//           .att-badge-group {
//             animation: att-badge-float 3s ease-in-out infinite;
//             transform-origin: 55px 55px;
//           }
//           .att-icon-pop {
//             animation: att-icon-pop 0.7s cubic-bezier(0.34,1.56,0.64,1) 0.5s both;
//             transform-origin: 55px 55px;
//           }
//         `}</style>
//         <circle cx="55" cy="55" r="46"
//           fill="none" stroke="#28a745" strokeWidth="2" opacity="0"
//           style={{ animation: "att-pulse-ring 2s ease-out 0.8s infinite" }}
//         />
//         <g className="att-badge-group">
//           <circle cx="55" cy="55" r="46" fill="#e8f5e9" />
//           <circle cx="55" cy="55" r="40"
//             fill="none" stroke="#28a745" strokeWidth="5"
//             strokeLinecap="round"
//             strokeDasharray="251" strokeDashoffset="251"
//             transform="rotate(-90 55 55)"
//             style={{ animation: "att-ring-spin 1.2s cubic-bezier(0.4,0,0.2,1) 0.1s forwards" }}
//           />
//           <circle cx="55" cy="55" r="32" fill="#28a745" className="att-icon-pop" />
//           <polyline points="38,55 50,67 72,43"
//             fill="none" stroke="#fff" strokeWidth="5"
//             strokeLinecap="round" strokeLinejoin="round"
//             strokeDasharray="60" strokeDashoffset="60"
//             style={{ animation: "att-check-draw 0.5s ease-out 0.9s forwards" }}
//           />
//         </g>
//       </svg>
//       <div style={{ textAlign: "center" }}>
//         <div style={{ fontWeight: "700", fontSize: "16px", color: "#155724", letterSpacing: "0.3px" }}>
//           ✅ Clocked In
//         </div>
//         <div style={{ fontSize: "13px", color: "#555", marginTop: "4px" }}>
//           Welcome back, <strong>{name}</strong>
//         </div>
//         <div style={{
//           marginTop: "8px", fontSize: "12px",
//           background: "#d4edda", color: "#155724",
//           borderRadius: "20px", padding: "4px 14px", display: "inline-block",
//         }}>
//           Session active 🟢
//         </div>
//       </div>
//     </div>
//   );

//   return (
//     <div className="page active">
//       <Topbar title="Attendance" onMenuOpen={onMenuOpen} className="glossy-container" />
//       <div style={{ padding: "20px" }}>

//         {/* ════ NOT LOGGED IN ════ */}
//         {!loggedInUser && (
//           <div className="glossy-container" style={{ maxWidth: "400px", margin: "40px auto" }}>
//             <h3 style={{ marginTop: 0 }}>Clock In</h3>
//             <form onSubmit={handleAttLogin} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
//               <input
//                 className="input-field" placeholder="Username" value={username}
//                 onChange={(e) => setUsername(e.target.value)} required
//               />
//               <input
//                 type="password" className="input-field" placeholder="Password" value={password}
//                 onChange={(e) => setPassword(e.target.value)} required
//               />
//               <button type="submit" className="btn-primary" disabled={loading}>
//                 {loading ? "Please wait..." : "Mark Attendance"}
//               </button>
//             </form>
//           </div>
//         )}

//         {/* ════ NORMAL USER VIEW ════ */}
//         {loggedInUser && !isSuperUser && (
//           <>
//             <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
//               <span>👤 Logged in as <strong>{loggedInUser}</strong></span>
//               <button className="btn-secondary" onClick={handleSignOut}>Sign Out</button>
//             </div>

//             {/* Badge + Summary — hidden for admin */}
//             {!isAdmin && (
//               <div style={{ display: "flex", gap: "20px", flexWrap: "wrap", marginBottom: "20px" }}>
//                 <div className="glossy-container" style={{
//                   flex: "1", minWidth: "300px",
//                   display: "flex", alignItems: "center", justifyContent: "center",
//                 }}>
//                   <ClockedInBadge name={loggedInUser} />
//                 </div>
//                 <div className="glossy-container" style={{ flex: "1", minWidth: "300px" }}>
//                   <h3 style={{ marginTop: 0 }}>My Summary</h3>
//                   <button onClick={exportMyData} className="btn-secondary"
//                     style={{ width: "100%", marginBottom: "10px" }}>
//                     Export My Data 📊
//                   </button>
//                   <div className="table-scroll">
//                     <table>
//                       <thead>
//                         <tr><th>Name</th><th>Today</th><th>Monthly</th></tr>
//                       </thead>
//                       <tbody>
//                         {Object.entries(userStats).length > 0
//                           ? Object.entries(userStats).map(([name, data]) => (
//                               <tr key={name}>
//                                 <td>{name}</td>
//                                 <td>{data.today.toFixed(1)}h</td>
//                                 <td>{data.monthly.toFixed(1)}h</td>
//                               </tr>
//                             ))
//                           : (
//                             <tr>
//                               <td colSpan={3} style={{ textAlign: "center", opacity: 0.5 }}>
//                                 No completed sessions yet
//                               </td>
//                             </tr>
//                           )}
//                       </tbody>
//                     </table>
//                   </div>
//                 </div>
//               </div>
//             )}

//             {/* Full history — hidden for admin */}
//             {!isAdmin && (
//               <div className="glossy-container">
//                 <h3 style={{ marginTop: 0 }}>My Full History</h3>
//                 <div className="table-scroll">
//                   <table>
//                     <thead>
//                       <tr><th>Name</th><th>Date</th><th>Login</th><th>Logout</th></tr>
//                     </thead>
//                     <tbody>
//                       {attendanceData.length > 0
//                         ? attendanceData.map((row) => (
//                             <tr key={row.id}>
//                               <td>{row.name}</td>
//                               <td>{row.date}</td>
//                               <td>{new Date(row.login_time).toLocaleTimeString()}</td>
//                               <td>{row.logout_time ? new Date(row.logout_time).toLocaleTimeString() : "Working..."}</td>
//                             </tr>
//                           ))
//                         : (
//                           <tr>
//                             <td colSpan={4} style={{ textAlign: "center", opacity: 0.5 }}>No history found</td>
//                           </tr>
//                         )}
//                     </tbody>
//                   </table>
//                 </div>
//               </div>
//             )}

//             {/* ════ ADMIN PANEL ════ */}
//             {isAdmin && (
//               <div className="glossy-container" style={{ marginTop: "20px" }}>
//                 <div style={{
//                   display: "flex", justifyContent: "space-between",
//                   alignItems: "center", marginBottom: "14px", flexWrap: "wrap", gap: "10px",
//                 }}>
//                   <h3 style={{ margin: 0 }}>
//                     🏢 Admin — All Users Attendance
//                     <span style={{
//                       marginLeft: "10px", background: "#0d6efd", color: "#fff",
//                       borderRadius: "4px", padding: "2px 8px", fontSize: "12px",
//                     }}>Admin</span>
//                   </h3>
//                   <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
//                     <label style={{ fontSize: "13px", fontWeight: "600" }}>📅 Month:</label>
//                     <input
//                       type="month" className="input-field" value={selectedMonth}
//                       onChange={(e) => setSelectedMonth(e.target.value)}
//                       style={{ padding: "6px 10px", fontSize: "13px", width: "auto" }}
//                     />
//                     <button onClick={exportAdminMonthData} className="btn-success">
//                       Export Excel 📊
//                     </button>
//                   </div>
//                 </div>
//                 <div className="table-scroll">
//                   <table>
//                     <thead>
//                       <tr>
//                         <th>Name</th><th>Date</th><th>Logged In</th>
//                         <th>Logged Out</th><th>Total Hours</th><th>Status</th>
//                       </tr>
//                     </thead>
//                     <tbody>
//                       {adminMonthData.length > 0
//                         ? adminMonthData.map((row) => {
//                             const login   = new Date(row.login_time);
//                             const logout  = row.logout_time ? new Date(row.logout_time) : null;
//                             const hours   = logout ? ((logout - login) / 3600000).toFixed(2) : null;
//                             const working = !row.logout_time;
//                             return (
//                               <tr key={row.id}>
//                                 <td>{row.name}</td>
//                                 <td>{row.date}</td>
//                                 <td>{login.toLocaleTimeString()}</td>
//                                 <td>{logout ? logout.toLocaleTimeString() : "—"}</td>
//                                 <td>{hours ? `${hours}h` : "In Progress"}</td>
//                                 <td>
//                                   <span style={{
//                                     padding: "2px 10px", borderRadius: "12px",
//                                     fontSize: "12px", fontWeight: "600",
//                                     background: working ? "#fff3cd" : "#d4edda",
//                                     color:      working ? "#856404" : "#155724",
//                                   }}>
//                                     {working ? "Working" : "Present"}
//                                   </span>
//                                 </td>
//                               </tr>
//                             );
//                           })
//                         : (
//                           <tr>
//                             <td colSpan={6} style={{ textAlign: "center", opacity: 0.5 }}>
//                               No records for {selectedMonth}
//                             </td>
//                           </tr>
//                         )}
//                     </tbody>
//                   </table>
//                 </div>
//               </div>
//             )}
//           </>
//         )}

//         {/* ════ SUPER USER VIEW ════ */}
//         {loggedInUser && isSuperUser && (
//           <>
//             <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
//               <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
//                 🛡️ Logged in as <strong>{loggedInUser}</strong>
//                 <span style={{
//                   background: "#6f42c1", color: "#fff",
//                   borderRadius: "4px", padding: "2px 8px", fontSize: "12px",
//                 }}>Super User</span>
//               </span>
//               <button className="btn-secondary" onClick={handleSignOut}>Sign Out</button>
//             </div>

//             <div className="glossy-container" style={{ marginBottom: "20px" }}>
//               <h3 style={{ marginTop: 0 }}>
//                 🟢 Currently Working
//                 <span style={{
//                   marginLeft: "10px", background: "#28a745", color: "#fff",
//                   borderRadius: "12px", padding: "2px 10px", fontSize: "13px",
//                 }}>{activeSessions.length}</span>
//               </h3>
//               {activeSessions.length > 0 ? (
//                 <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
//                   {activeSessions.map((row) => (
//                     <div key={row.id} style={{
//                       display: "flex", alignItems: "center", gap: "8px",
//                       background: "#d4edda", color: "#155724",
//                       borderRadius: "20px", padding: "6px 14px", fontSize: "13px",
//                     }}>
//                       <span>👤 <strong>{row.name}</strong></span>
//                       <span style={{ opacity: 0.7 }}>since {new Date(row.login_time).toLocaleTimeString()}</span>
//                       <button
//                         onClick={() => handleLogout(row.name)}
//                         style={{
//                           background: "none", border: "1px solid #155724",
//                           borderRadius: "10px", padding: "1px 8px",
//                           cursor: "pointer", fontSize: "11px", color: "#155724",
//                         }}
//                       >
//                         Clock Out
//                       </button>
//                     </div>
//                   ))}
//                 </div>
//               ) : (
//                 <p style={{ margin: 0, opacity: 0.5 }}>No one is currently clocked in.</p>
//               )}
//             </div>

//             <div className="glossy-container">
//               <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
//                 <h3 style={{ margin: 0 }}>📋 All Users — Attendance Report</h3>
//                 <button onClick={exportAllData} className="btn-secondary">Export All Data 📊</button>
//               </div>
//               <div className="table-scroll">
//                 <table>
//                   <thead>
//                     <tr>
//                       <th>Name</th><th>Date</th><th>Login Time</th>
//                       <th>Logout Time</th><th>Total Hours</th><th>Status</th><th>Action</th>
//                     </tr>
//                   </thead>
//                   <tbody>
//                     {allUsersData.length > 0
//                       ? allUsersData.map((row) => {
//                           const login   = new Date(row.login_time);
//                           const logout  = row.logout_time ? new Date(row.logout_time) : null;
//                           const hours   = logout ? ((logout - login) / 3600000).toFixed(2) : null;
//                           const working = !row.logout_time;
//                           return (
//                             <tr key={row.id}>
//                               <td>{row.name}</td>
//                               <td>{row.date}</td>
//                               <td>{login.toLocaleTimeString()}</td>
//                               <td>{logout ? logout.toLocaleTimeString() : "—"}</td>
//                               <td>{hours ? `${hours}h` : "In Progress"}</td>
//                               <td>
//                                 <span style={{
//                                   padding: "2px 10px", borderRadius: "12px",
//                                   fontSize: "12px", fontWeight: "600",
//                                   background: working ? "#fff3cd" : "#d4edda",
//                                   color:      working ? "#856404" : "#155724",
//                                 }}>
//                                   {working ? "Working" : "Present"}
//                                 </span>
//                               </td>
//                               <td>
//                                 {working && (
//                                   <button className="btn-secondary" onClick={() => handleLogout(row.name)}>
//                                     Clock Out
//                                   </button>
//                                 )}
//                               </td>
//                             </tr>
//                           );
//                         })
//                       : (
//                         <tr>
//                           <td colSpan={7} style={{ textAlign: "center", opacity: 0.5 }}>No records found</td>
//                         </tr>
//                       )}
//                   </tbody>
//                 </table>
//               </div>
//             </div>
//           </>
//         )}

//       </div>
//     </div>
//   );
// }
function AttendancePage({ onMenuOpen }) {
  const [loading, setLoading] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [attendanceData, setAttendanceData] = useState([]);
  const [allUsersData, setAllUsersData] = useState([]);
  const [loggedInUser, setLoggedInUser] = useState(null);
  const [isSuperUser, setIsSuperUser] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminSelectedUser, setAdminSelectedUser] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });

  // ── Restore session on mount ──
  useEffect(() => {
    const saved = sessionStorage.getItem("att_session");
    if (saved) {
      try {
        const { user, isSuper, isAdm } = JSON.parse(saved);
        setLoggedInUser(user);
        setIsSuperUser(isSuper);
        setIsAdmin(isAdm);
      } catch {
        sessionStorage.removeItem("att_session");
      }
    }
  }, []);

  useEffect(() => {
    if (!loggedInUser) return;
    fetchAttendanceData();
    if (isSuperUser || isAdmin) fetchAllUsersData();
    const interval = setInterval(() => {
      fetchAttendanceData();
      if (isSuperUser || isAdmin) fetchAllUsersData();
    }, 30000);
    return () => clearInterval(interval);
  }, [loggedInUser, isSuperUser, isAdmin]);

  const fetchAttendanceData = async () => {
    if (!loggedInUser) return;
    const { data } = await supabase
      .from("Attendance")
      .select("*")
      .eq("name", loggedInUser)
      .order("login_time", { ascending: false });
    setAttendanceData(data || []);
  };

  const fetchAllUsersData = async () => {
    const { data } = await supabase
      .from("Attendance")
      .select("*")
      .order("date", { ascending: false });
    setAllUsersData(data || []);
  };

  const handleAttLogin = async (e) => {
    e.preventDefault();
    setLoading(true);

    const { data: userInfo, error: authError } = await supabase
      .rpc("check_user_credentials", { p_username: username, p_password: password });

    if (authError || !userInfo) {
      Toastify({ text: "Invalid credentials ❌", style: { background: "#dc3545" } }).showToast();
      setLoading(false);
      return;
    }

    const superUser = userInfo.role === "superuser";
    setIsSuperUser(superUser);

    const adminUser = username.toLowerCase() === "havelyninc";
    setIsAdmin(adminUser);

    if (!superUser && !adminUser) {
      const { data: activeSession } = await supabase
        .from("Attendance")
        .select("id")
        .eq("name", username)
        .is("logout_time", null)
        .maybeSingle();

      if (activeSession) {
        Toastify({ text: "Session already active ⚠️", style: { background: "#ff9500" } }).showToast();
      } else {
        await supabase.from("Attendance").insert([{
          name: username,
          date: new Date().toISOString().split("T")[0],
          login_time: new Date().toISOString(),
        }]);
        Toastify({ text: "Clocked in! ✅", style: { background: "#28a745" } }).showToast();
      }
    }

    if (superUser) {
      Toastify({ text: `Welcome, ${username} 🛡️`, style: { background: "#6f42c1" } }).showToast();
    } else if (adminUser) {
      Toastify({ text: `Welcome, ${username} 🏢`, style: { background: "#0d6efd" } }).showToast();
    }

    setLoggedInUser(username);
    sessionStorage.setItem("att_session", JSON.stringify({
      user: username,
      isSuper: superUser,
      isAdm: adminUser,
    }));
    setLoading(false);
  };

  const handleLogout = async (name) => {
    setLoading(true);
    const { data: session } = await supabase
      .from("Attendance")
      .select("id")
      .eq("name", name)
      .is("logout_time", null)
      .maybeSingle();
    if (session) {
      await supabase
        .from("Attendance")
        .update({ logout_time: new Date().toISOString() })
        .eq("id", session.id);
      fetchAttendanceData();
      if (isSuperUser || isAdmin) fetchAllUsersData();
      Toastify({ text: `${name} clocked out! ✅`, style: { background: "#28a745" } }).showToast();
    } else {
      Toastify({ text: "No active session found ⚠️", style: { background: "#ff9500" } }).showToast();
    }
    setLoading(false);
  };

  const handleSignOut = () => {
    Toastify({ text: "Signed out successfully 👋", style: { background: "#6c757d" } }).showToast();
    sessionStorage.removeItem("att_session");
    setLoggedInUser(null);
    setIsSuperUser(false);
    setIsAdmin(false);
    setAttendanceData([]);
    setAllUsersData([]);
    setUsername("");
    setPassword("");
  };

  const userStats = useMemo(() => {
    const stats = {};
    const todayStr = new Date().toISOString().split("T")[0];
    attendanceData.forEach((row) => {
      if (!row.logout_time) return;
      const hours = (new Date(row.logout_time) - new Date(row.login_time)) / 3600000;
      if (!stats[row.name]) stats[row.name] = { today: 0, monthly: 0 };
      if (row.date === todayStr) stats[row.name].today += hours;
      stats[row.name].monthly += hours;
    });
    return stats;
  }, [attendanceData]);

  // ── Unique user list for admin dropdown ──
  const allUserNames = useMemo(() => {
    return [...new Set(allUsersData.map((r) => r.name))].sort();
  }, [allUsersData]);

  // ── Filtered data for admin table ──
  const adminFilteredData = useMemo(() => {
    return allUsersData.filter((row) => {
      const matchUser = adminSelectedUser === "all" || row.name === adminSelectedUser;
      const matchFrom = !dateFrom || row.date >= dateFrom;
      const matchTo   = !dateTo   || row.date <= dateTo;
      return matchUser && matchFrom && matchTo;
    });
  }, [allUsersData, adminSelectedUser, dateFrom, dateTo]);

  // ── Export: current user only ──
  const exportMyData = () => {
    if (attendanceData.length === 0) {
      Toastify({ text: "No data to export! ❌", style: { background: "#dc3545" } }).showToast();
      return;
    }
    const rows = attendanceData.map((row) => {
      const login  = new Date(row.login_time);
      const logout = row.logout_time ? new Date(row.logout_time) : null;
      return {
        "Name":               row.name,
        "Date":               row.date,
        "Login Time":         login.toLocaleTimeString(),
        "Logout Time":        logout ? logout.toLocaleTimeString() : "Working...",
        "Total Hours Worked": logout ? ((logout - login) / 3600000).toFixed(2) : "In Progress",
        "Status":             logout ? "Present" : "Working",
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "My Attendance");
    XLSX.writeFile(wb, `Attendance_${loggedInUser}_${new Date().toLocaleDateString()}.xlsx`);
  };

  // ── Export: superuser all data ──
  const exportAllData = () => {
    if (allUsersData.length === 0) {
      Toastify({ text: "No data to export! ❌", style: { background: "#dc3545" } }).showToast();
      return;
    }
    const rows = allUsersData.map((row) => {
      const login  = new Date(row.login_time);
      const logout = row.logout_time ? new Date(row.logout_time) : null;
      return {
        "Name":               row.name,
        "Date":               row.date,
        "Login Time":         login.toLocaleTimeString(),
        "Logout Time":        logout ? logout.toLocaleTimeString() : "Working...",
        "Total Hours Worked": logout ? ((logout - login) / 3600000).toFixed(2) : "In Progress",
        "Status":             logout ? "Present" : "Working",
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "All Attendance");
    XLSX.writeFile(wb, `All_Users_Attendance_${new Date().toLocaleDateString()}.xlsx`);
  };

  // ── Export: admin filtered data (user + date range) with summary sheet ──
  const exportAdminFilteredData = () => {
    if (adminFilteredData.length === 0) {
      Toastify({ text: "No data for selected filters! ❌", style: { background: "#dc3545" } }).showToast();
      return;
    }

    const now = new Date();

    // Detail rows
    const rows = adminFilteredData.map((row) => {
      const login  = new Date(row.login_time);
      const logout = row.logout_time ? new Date(row.logout_time) : now;
      return {
        "Name":               row.name,
        "Date":               row.date,
        "Login Time":         login.toLocaleTimeString(),
        "Logout Time":        row.logout_time
          ? logout.toLocaleTimeString()
          : `In Progress (as of ${now.toLocaleTimeString()})`,
        "Total Hours Worked": ((logout - login) / 3600000).toFixed(2),
        "Status":             row.logout_time ? "Present" : "Working",
      };
    });

    // Summary rows (per user totals)
    const userTotals = {};
    adminFilteredData.forEach((row) => {
      const login  = new Date(row.login_time);
      const logout = row.logout_time ? new Date(row.logout_time) : now;
      const hours  = (logout - login) / 3600000;
      if (!userTotals[row.name]) userTotals[row.name] = { sessions: 0, totalHours: 0, hasActive: false };
      userTotals[row.name].sessions   += 1;
      userTotals[row.name].totalHours += hours;
      if (!row.logout_time) userTotals[row.name].hasActive = true;
    });

    const summaryRows = Object.entries(userTotals).map(([name, d]) => ({
      "Name":               name,
      "Total Sessions":     d.sessions,
      "Total Hours Worked": d.totalHours.toFixed(2),
      "Note": d.hasActive
        ? `Includes live session (as of ${now.toLocaleTimeString()})`
        : "All sessions completed",
    }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows),        "Attendance Detail");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), "Summary");

    const userLabel = adminSelectedUser === "all" ? "All_Users" : adminSelectedUser;
    const fromLabel = dateFrom || "start";
    const toLabel   = dateTo   || "end";
    XLSX.writeFile(wb, `Attendance_${userLabel}_${fromLabel}_to_${toLabel}.xlsx`);
    Toastify({ text: "Exported successfully 📊", style: { background: "#28a745" } }).showToast();
  };

  const activeSessions = useMemo(
    () => allUsersData.filter((r) => !r.logout_time),
    [allUsersData]
  );

  const ClockedInBadge = ({ name }) => (
    <div style={{
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      gap: "14px", padding: "28px 20px",
    }}>
      <svg width="110" height="110" viewBox="0 0 110 110"
        xmlns="http://www.w3.org/2000/svg" style={{ overflow: "visible" }}>
        <style>{`
          @keyframes att-ring-spin {
            0%   { stroke-dashoffset: 251; }
            60%  { stroke-dashoffset: 0; }
            100% { stroke-dashoffset: 0; }
          }
          @keyframes att-check-draw {
            0%   { stroke-dashoffset: 60; opacity: 0; }
            40%  { opacity: 0; }
            100% { stroke-dashoffset: 0; opacity: 1; }
          }
          @keyframes att-pulse-ring {
            0%   { r: 46; opacity: 0.6; }
            100% { r: 58; opacity: 0; }
          }
          @keyframes att-icon-pop {
            0%   { transform: scale(0.7); opacity: 0; }
            70%  { transform: scale(1.08); opacity: 1; }
            100% { transform: scale(1); opacity: 1; }
          }
          @keyframes att-badge-float {
            0%, 100% { transform: translateY(0px); }
            50%       { transform: translateY(-5px); }
          }
          .att-badge-group {
            animation: att-badge-float 3s ease-in-out infinite;
            transform-origin: 55px 55px;
          }
          .att-icon-pop {
            animation: att-icon-pop 0.7s cubic-bezier(0.34,1.56,0.64,1) 0.5s both;
            transform-origin: 55px 55px;
          }
        `}</style>
        <circle cx="55" cy="55" r="46"
          fill="none" stroke="#28a745" strokeWidth="2" opacity="0"
          style={{ animation: "att-pulse-ring 2s ease-out 0.8s infinite" }}
        />
        <g className="att-badge-group">
          <circle cx="55" cy="55" r="46" fill="#e8f5e9" />
          <circle cx="55" cy="55" r="40"
            fill="none" stroke="#28a745" strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray="251" strokeDashoffset="251"
            transform="rotate(-90 55 55)"
            style={{ animation: "att-ring-spin 1.2s cubic-bezier(0.4,0,0.2,1) 0.1s forwards" }}
          />
          <circle cx="55" cy="55" r="32" fill="#28a745" className="att-icon-pop" />
          <polyline points="38,55 50,67 72,43"
            fill="none" stroke="#fff" strokeWidth="5"
            strokeLinecap="round" strokeLinejoin="round"
            strokeDasharray="60" strokeDashoffset="60"
            style={{ animation: "att-check-draw 0.5s ease-out 0.9s forwards" }}
          />
        </g>
      </svg>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontWeight: "700", fontSize: "16px", color: "#155724", letterSpacing: "0.3px" }}>
          ✅ Clocked In
        </div>
        <div style={{ fontSize: "13px", color: "#555", marginTop: "4px" }}>
          Welcome back, <strong>{name}</strong>
        </div>
        <div style={{
          marginTop: "8px", fontSize: "12px",
          background: "#d4edda", color: "#155724",
          borderRadius: "20px", padding: "4px 14px", display: "inline-block",
        }}>
          Session active 🟢
        </div>
      </div>
    </div>
  );

  return (
    <div className="page active">
      <Topbar title="Attendance" onMenuOpen={onMenuOpen} className="glossy-container" />
      <div style={{ padding: "20px" }}>

        {/* ════════════════════════════════
             NOT LOGGED IN
            ════════════════════════════════ */}
        {!loggedInUser && (
          <div className="glossy-container" style={{ maxWidth: "400px", margin: "40px auto" }}>
            <h3 style={{ marginTop: 0 }}>Clock In</h3>
            <form onSubmit={handleAttLogin} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <input
                className="input-field" placeholder="Username" value={username}
                onChange={(e) => setUsername(e.target.value)} required
              />
              <input
                type="password" className="input-field" placeholder="Password" value={password}
                onChange={(e) => setPassword(e.target.value)} required
              />
              <button type="submit" className="btn-primary" disabled={loading}>
                {loading ? "Please wait..." : "Mark Attendance"}
              </button>
            </form>
          </div>
        )}

        {/* ════════════════════════════════
             NORMAL USER VIEW
            ════════════════════════════════ */}
        {loggedInUser && !isSuperUser && (
          <>
            {/* Identity bar */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <span>👤 Logged in as <strong>{loggedInUser}</strong></span>
              <button className="btn-secondary" onClick={handleSignOut}>Sign Out</button>
            </div>

            {/* Badge + Summary — normal users only */}
            {!isAdmin && (
              <div style={{ display: "flex", gap: "20px", flexWrap: "wrap", marginBottom: "20px" }}>
                <div className="glossy-container" style={{
                  flex: "1", minWidth: "300px",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <ClockedInBadge name={loggedInUser} />
                </div>
                <div className="glossy-container" style={{ flex: "1", minWidth: "300px" }}>
                  <h3 style={{ marginTop: 0 }}>My Summary</h3>
                  <button onClick={exportMyData} className="btn-secondary"
                    style={{ width: "100%", marginBottom: "10px" }}>
                    Export My Data 📊
                  </button>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr><th>Name</th><th>Today</th><th>Monthly</th></tr>
                      </thead>
                      <tbody>
                        {Object.entries(userStats).length > 0
                          ? Object.entries(userStats).map(([name, data]) => (
                              <tr key={name}>
                                <td>{name}</td>
                                <td>{data.today.toFixed(1)}h</td>
                                <td>{data.monthly.toFixed(1)}h</td>
                              </tr>
                            ))
                          : (
                            <tr>
                              <td colSpan={3} style={{ textAlign: "center", opacity: 0.5 }}>
                                No completed sessions yet
                              </td>
                            </tr>
                          )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* Full history — normal users only */}
            {!isAdmin && (
              <div className="glossy-container">
                <h3 style={{ marginTop: 0 }}>My Full History</h3>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr><th>Name</th><th>Date</th><th>Login</th><th>Logout</th></tr>
                    </thead>
                    <tbody>
                      {attendanceData.length > 0
                        ? attendanceData.map((row) => (
                            <tr key={row.id}>
                              <td>{row.name}</td>
                              <td>{row.date}</td>
                              <td>{new Date(row.login_time).toLocaleTimeString()}</td>
                              <td>{row.logout_time ? new Date(row.logout_time).toLocaleTimeString() : "Working..."}</td>
                            </tr>
                          ))
                        : (
                          <tr>
                            <td colSpan={4} style={{ textAlign: "center", opacity: 0.5 }}>No history found</td>
                          </tr>
                        )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ════ ADMIN PANEL ════ */}
            {isAdmin && (
              <div className="glossy-container" style={{ marginTop: "20px" }}>

                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "10px" }}>
                  <h3 style={{ margin: 0 }}>
                    🏢 Admin — All Users Attendance
                    <span style={{
                      marginLeft: "10px", background: "#0d6efd", color: "#fff",
                      borderRadius: "4px", padding: "2px 8px", fontSize: "12px",
                    }}>Admin</span>
                  </h3>
                </div>

                {/* Filter bar */}
                <div style={{
                  display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "flex-end",
                  background: "rgba(13,110,253,0.05)", borderRadius: "10px",
                  padding: "14px 16px", marginBottom: "16px",
                }}>
                  {/* User dropdown */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <label style={{ fontSize: "12px", fontWeight: "600", opacity: 0.7 }}>👤 User</label>
                    <select
                      className="input-field"
                      value={adminSelectedUser}
                      onChange={(e) => setAdminSelectedUser(e.target.value)}
                      style={{ padding: "7px 10px", fontSize: "13px", minWidth: "160px" }}
                    >
                      <option value="all">All Users</option>
                      {allUserNames.map((name) => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                  </div>

                  {/* From date */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <label style={{ fontSize: "12px", fontWeight: "600", opacity: 0.7 }}>📅 From</label>
                    <input
                      type="date" className="input-field"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      style={{ padding: "7px 10px", fontSize: "13px" }}
                    />
                  </div>

                  {/* To date */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <label style={{ fontSize: "12px", fontWeight: "600", opacity: 0.7 }}>📅 To</label>
                    <input
                      type="date" className="input-field"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                      style={{ padding: "7px 10px", fontSize: "13px" }}
                    />
                  </div>

                  {/* Clear */}
                  <button
                    className="btn-secondary"
                    onClick={() => { setAdminSelectedUser("all"); setDateFrom(""); setDateTo(""); }}
                    style={{ alignSelf: "flex-end", padding: "7px 14px", fontSize: "13px" }}
                  >
                    Clear ✕
                  </button>

                  {/* Export */}
                  <button
                    onClick={exportAdminFilteredData}
                    className="btn-success"
                    style={{ marginLeft: "auto", alignSelf: "flex-end", padding: "7px 16px", fontSize: "13px" }}
                  >
                    Export Excel 📊
                  </button>
                </div>

                {/* Result count */}
                <div style={{ fontSize: "12px", opacity: 0.6, marginBottom: "10px" }}>
                  Showing <strong>{adminFilteredData.length}</strong> record{adminFilteredData.length !== 1 ? "s" : ""}
                  {adminSelectedUser !== "all" && <> for <strong>{adminSelectedUser}</strong></>}
                  {dateFrom && <> from <strong>{dateFrom}</strong></>}
                  {dateTo   && <> to <strong>{dateTo}</strong></>}
                </div>

                {/* Table */}
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th><th>Date</th><th>Logged In</th>
                        <th>Logged Out</th><th>Total Hours</th><th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adminFilteredData.length > 0
                        ? adminFilteredData.map((row) => {
                            const login   = new Date(row.login_time);
                            const logout  = row.logout_time ? new Date(row.logout_time) : null;
                            const hours   = logout ? ((logout - login) / 3600000).toFixed(2) : null;
                            const working = !row.logout_time;
                            return (
                              <tr key={row.id}>
                                <td>{row.name}</td>
                                <td>{row.date}</td>
                                <td>{login.toLocaleTimeString()}</td>
                                <td>{logout ? logout.toLocaleTimeString() : "—"}</td>
                                <td>{hours ? `${hours}h` : "In Progress"}</td>
                                <td>
                                  <span style={{
                                    padding: "2px 10px", borderRadius: "12px",
                                    fontSize: "12px", fontWeight: "600",
                                    background: working ? "#fff3cd" : "#d4edda",
                                    color:      working ? "#856404" : "#155724",
                                  }}>
                                    {working ? "Working" : "Present"}
                                  </span>
                                </td>
                              </tr>
                            );
                          })
                        : (
                          <tr>
                            <td colSpan={6} style={{ textAlign: "center", opacity: 0.5, padding: "20px" }}>
                              No records found for selected filters
                            </td>
                          </tr>
                        )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {/* ════════════════════════════════
             SUPER USER VIEW
            ════════════════════════════════ */}
        {loggedInUser && isSuperUser && (
          <>
            {/* Identity bar */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                🛡️ Logged in as <strong>{loggedInUser}</strong>
                <span style={{
                  background: "#6f42c1", color: "#fff",
                  borderRadius: "4px", padding: "2px 8px", fontSize: "12px",
                }}>Super User</span>
              </span>
              <button className="btn-secondary" onClick={handleSignOut}>Sign Out</button>
            </div>

            {/* Currently working strip */}
            <div className="glossy-container" style={{ marginBottom: "20px" }}>
              <h3 style={{ marginTop: 0 }}>
                🟢 Currently Working
                <span style={{
                  marginLeft: "10px", background: "#28a745", color: "#fff",
                  borderRadius: "12px", padding: "2px 10px", fontSize: "13px",
                }}>{activeSessions.length}</span>
              </h3>
              {activeSessions.length > 0 ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {activeSessions.map((row) => (
                    <div key={row.id} style={{
                      display: "flex", alignItems: "center", gap: "8px",
                      background: "#d4edda", color: "#155724",
                      borderRadius: "20px", padding: "6px 14px", fontSize: "13px",
                    }}>
                      <span>👤 <strong>{row.name}</strong></span>
                      <span style={{ opacity: 0.7 }}>since {new Date(row.login_time).toLocaleTimeString()}</span>
                      <button
                        onClick={() => handleLogout(row.name)}
                        style={{
                          background: "none", border: "1px solid #155724",
                          borderRadius: "10px", padding: "1px 8px",
                          cursor: "pointer", fontSize: "11px", color: "#155724",
                        }}
                      >
                        Clock Out
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ margin: 0, opacity: 0.5 }}>No one is currently clocked in.</p>
              )}
            </div>

            {/* All users table */}
            <div className="glossy-container">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <h3 style={{ margin: 0 }}>📋 All Users — Attendance Report</h3>
                <button onClick={exportAllData} className="btn-secondary">Export All Data 📊</button>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th><th>Date</th><th>Login Time</th>
                      <th>Logout Time</th><th>Total Hours</th><th>Status</th><th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allUsersData.length > 0
                      ? allUsersData.map((row) => {
                          const login   = new Date(row.login_time);
                          const logout  = row.logout_time ? new Date(row.logout_time) : null;
                          const hours   = logout ? ((logout - login) / 3600000).toFixed(2) : null;
                          const working = !row.logout_time;
                          return (
                            <tr key={row.id}>
                              <td>{row.name}</td>
                              <td>{row.date}</td>
                              <td>{login.toLocaleTimeString()}</td>
                              <td>{logout ? logout.toLocaleTimeString() : "—"}</td>
                              <td>{hours ? `${hours}h` : "In Progress"}</td>
                              <td>
                                <span style={{
                                  padding: "2px 10px", borderRadius: "12px",
                                  fontSize: "12px", fontWeight: "600",
                                  background: working ? "#fff3cd" : "#d4edda",
                                  color:      working ? "#856404" : "#155724",
                                }}>
                                  {working ? "Working" : "Present"}
                                </span>
                              </td>
                              <td>
                                {working && (
                                  <button className="btn-secondary" onClick={() => handleLogout(row.name)}>
                                    Clock Out
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      : (
                        <tr>
                          <td colSpan={7} style={{ textAlign: "center", opacity: 0.5 }}>No records found</td>
                        </tr>
                      )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

      </div>
    </div>
  );
}
// ─── LOGIN SCREEN ──────────────────────────────────────────────────────────

function LoginScreen({ onLogin, loading }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  return (
    <div className="modal-backdrop">
      <form className="modal-card" style={{ maxWidth: "400px", padding: "32px" }} onSubmit={(e) => { e.preventDefault(); onLogin(email, password); }}>
        <h1 style={{ fontSize: "24px", fontWeight: "700", marginBottom: "4px", color: "var(--text-1)" }}>Inventory Management</h1>
        <p style={{ color: "var(--text-3)", fontSize: "14px", marginBottom: "24px" }}>Sign in to manage your cafe stock</p>
        <div className="field-group" style={{ marginBottom: "16px" }}>
          <label>Email</label>
          <input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="field-group" style={{ marginBottom: "24px" }}>
          <label>Password</label>
          <input type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <button type="submit" className="btn-primary" style={{ width: "100%" }} disabled={loading}>
          {loading ? "Signing in…" : "Sign In"}
        </button>
      </form>
    </div>
  );
}

// ─── ROOT APP ──────────────────────────────────────────────────────────────

export default function App() {
  const [session, setSession] = useState(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [activePage, setActivePage] = useState("dashboard");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [allData, setAllData] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editData, setEditData] = useState(null);
  const showToast = useToast();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data?.session || null); setLoadingSession(false); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const collapsed = localStorage.getItem("sidebarCollapsed") === "true";
    if (collapsed && window.innerWidth > 900) { setSidebarCollapsed(true); document.body.classList.add("sidebar-collapsed"); }
    const onResize = () => {
      if (window.innerWidth <= 900) { setSidebarCollapsed(false); document.body.classList.remove("sidebar-collapsed"); }
      else { const c = localStorage.getItem("sidebarCollapsed") === "true"; setSidebarCollapsed(c); document.body.classList.toggle("sidebar-collapsed", c); }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const toggleCollapse = () => {
    if (window.innerWidth <= 900) return;
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    document.body.classList.toggle("sidebar-collapsed", next);
    localStorage.setItem("sidebarCollapsed", String(next));
  };

  const loadItems = useCallback(async () => {
    const { data, error } = await supabase.from(STOCK_TABLE).select("*").order("id", { ascending: true });
    if (error) { showToast("Failed to load items", "#ff3b30"); return; }
    setAllData(data || []);
  }, [showToast]);

  useEffect(() => {
    loadItems();
    const ch = supabase.channel("inventory-live").on("postgres_changes", { event: "*", schema: "public", table: STOCK_TABLE }, loadItems).subscribe();
    return () => supabase.removeChannel(ch);
  }, [loadItems]);

  const handleLogin = async (email, password) => {
    if (!email.trim() || !password) { showToast("Enter email and password", "#ff3b30"); return; }
    setSigningIn(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) showToast(error.message, "#ff3b30");
    setSigningIn(false);
  };

  const handleLogout = () => supabase.auth.signOut();

  const sendLowStockWhatsApp = () => {
    const outItems = [], lowItems = [];
    allData.forEach((i) => {
      const status = getStatus(i);
      const a = Number(i.available_stock);
      const threshold = getLowThreshold(i.units);
      const m = threshold ?? (Number(i.minimum_stock) || 0);
      if (status === "out") outItems.push(`${i.item_name}  -  0`);
      else if (status === "low") lowItems.push(`${i.item_name}  -  ${a} (min ${m} ${i.units || ""})`);
    });
    let msg = `⚠️ LOW STOCK REPORT\n----------------------------\n\n`;
    if (!outItems.length && !lowItems.length) { msg += "All items are well stocked ✅\n"; }
    else {
      if (outItems.length) msg += `❌ OUT OF STOCK\n${outItems.map((l, i) => `${i + 1}. ${l}`).join("\n")}\n\n`;
      if (lowItems.length) msg += `⚠️ LOW STOCK\n${lowItems.map((l, i) => `${i + 1}. ${l}`).join("\n")}\n\n`;
    }
    msg += `----------------------------\nTotal Issues: ${outItems.length + lowItems.length}\n\nGenerated: ${buildTimestamp()}\n\nSriSathyaSaiMetro LEVISTA CAFE`;
    openWhatsApp(msg);
  };

  const handleSaveItem = async (payload) => {
    setModalOpen(false);
    loadItems();
  };

  // Login screen disabled — load dashboard directly
  // if (loadingSession) {
  //   return (
  //     <div className="modal-backdrop">
  //       <div className="modal-card" style={{ maxWidth: "200px", padding: "20px", textAlign: "center" }}>
  //         <p style={{ color: "var(--text-3)", fontSize: "14px" }}>Connecting…</p>
  //       </div>
  //     </div>
  //   );
  // }
  // if (!session) return <LoginScreen onLogin={handleLogin} loading={signingIn} />;

  const pageProps = { onMenuOpen: () => setSidebarOpen(true) };

  return (
    <div className="app-shell">
      <Sidebar
        activePage={activePage}
        onNavigate={(p) => { setActivePage(p); setSidebarOpen(false); }}
        onLogout={handleLogout}
        collapsed={sidebarCollapsed}
        onToggleCollapse={toggleCollapse}
        mobileOpen={sidebarOpen}
        onOverlayClick={() => setSidebarOpen(false)}
      />

      <main className="main-content">
        {activePage === "dashboard" && <DashboardPage allData={allData} setAllData={setAllData} onSendWhatsApp={sendLowStockWhatsApp} {...pageProps} />}
        {activePage === "physical" && <PhysicalStockPage {...pageProps} />}
        {activePage === "attendance" && <AttendancePage {...pageProps} />}
      </main>

      <ItemModal open={modalOpen} onClose={() => setModalOpen(false)} onSave={handleSaveItem} editData={editData} />
    </div>
  );
}