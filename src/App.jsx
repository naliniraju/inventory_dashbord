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


function AttendancePage({ onMenuOpen }) {
  const [loading, setLoading] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [attendanceData, setAttendanceData] = useState([]);

  useEffect(() => {
    fetchAttendanceData();
    const interval = setInterval(fetchAttendanceData, 30000); // Poll for updates
    return () => clearInterval(interval);
  }, []);

  const fetchAttendanceData = async () => {
    const { data } = await supabase.from("Attendance").select("*").order("login_time", { ascending: false });
    setAttendanceData(data || []);
  };

  const handleAttLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    const { data: userId, error: authError } = await supabase
      .rpc('check_user_credentials', { p_username: username, p_password: password });

    if (authError || !userId) {
      Toastify({ text: "Invalid credentials", style: { background: "#dc3545" } }).showToast();
      setLoading(false); return;
    }

    const { data: activeSession } = await supabase
      .from("Attendance").select("id").eq("name", username).is("logout_time", null).maybeSingle();

    if (activeSession) {
      Toastify({ text: "Session already active for this user.", style: { background: "#ff9500" } }).showToast();
    } else {
      await supabase.from("Attendance").insert([{ name: username, date: new Date().toISOString().split('T')[0], login_time: new Date().toISOString() }]);
      fetchAttendanceData();
      Toastify({ text: "Clocked in!", style: { background: "#28a745" } }).showToast();
    }
    setLoading(false);
  };

  const handleLogout = async (name) => {
    setLoading(true);
    const { data: session } = await supabase
      .from("Attendance").select("id").eq("name", name).is("logout_time", null).maybeSingle();
    if (session) {
      await supabase.from("Attendance").update({ logout_time: new Date().toISOString() }).eq("id", session.id);
      fetchAttendanceData();
    }
    setLoading(false);
  };

  const userStats = useMemo(() => {
    const stats = {};
    const todayStr = new Date().toISOString().split('T')[0];
    attendanceData.forEach(row => {
      if (!row.logout_time) return;
      const hours = (new Date(row.logout_time) - new Date(row.login_time)) / 3600000;
      if (!stats[row.name]) stats[row.name] = { today: 0, monthly: 0 };
      if (row.date === todayStr) stats[row.name].today += hours;
      stats[row.name].monthly += hours;
    });
    return stats;
  }, [attendanceData]);

const exportToExcel = () => {
  if (attendanceData.length === 0) {
    showToast("No data to export!", "#dc3545");
    return;
  }

  // 1. Map the raw data into a formatted report
  const formattedData = attendanceData.map((row) => {
    const login = new Date(row.login_time);
    const logout = row.logout_time ? new Date(row.logout_time) : null;
    
    // Calculate total hours worked
    const totalHours = logout 
      ? ((logout - login) / 3600000).toFixed(2) 
      : "In Progress";

    return {
      "User Name": row.name,
      "Date": row.date,
      "Login Time": login.toLocaleTimeString(),
      "Logout Time": logout ? logout.toLocaleTimeString() : "Working...",
      "Total Hours Worked": totalHours
    };
  });

  // 2. Create and export the worksheet
  const ws = XLSX.utils.json_to_sheet(formattedData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Attendance Report");
  XLSX.writeFile(wb, `Attendance_Report_${new Date().toLocaleDateString()}.xlsx`);
};

  return (
    <div className="page active">
      {/* Unified Header */}
      <Topbar title="Attendance" onMenuOpen={onMenuOpen} className="glossy-container"/> 
    
      <div style={{ padding: "20px" }}>
        {/* TOP SECTION: LOGIN & SUMMARY */}
        <div style={{ display: "flex", gap: "20px", flexWrap: "wrap", marginBottom: "20px" }}>
          
          {/* LOGIN FORM */}
          <div className="glossy-container" style={{ flex: "1", minWidth: "300px" }}>
            <h3 style={{ marginTop: 0 }}>Clock In</h3>
            <form onSubmit={handleAttLogin} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <input className="input-field" placeholder="Username" onChange={(e) => setUsername(e.target.value)} required />
              <input type="password" className="input-field" placeholder="Password" onChange={(e) => setPassword(e.target.value)} required />
              <button type="submit" className="btn-primary" disabled={loading}>Mark Attendance</button>
            </form>
          </div>

          {/* SUMMARY TABLE */}
          <div className="glossy-container" style={{ flex: "1", minWidth: "300px" }}>
            <h3>User Summary</h3>
            <button onClick={exportToExcel} className="btn-secondary" style={{ width: "100%", marginBottom: "10px" }}>Export All Data 📊</button>
            <div className="table-scroll">
              <table>
                <thead><tr><th>Name</th><th>Today</th><th>Monthly</th></tr></thead>
                <tbody>
                  {Object.entries(userStats).map(([name, data]) => (
                    <tr key={name}>
                      <td>{name}</td>
                      <td>{data.today.toFixed(1)}h</td>
                      <td>{data.monthly.toFixed(1)}h</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* BOTTOM SECTION: HISTORY TABLE */}
        <div className="glossy-container">
          <h3>Full History</h3>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Name</th><th>Date</th><th>Login</th><th>Logout</th><th>Action</th></tr></thead>
              <tbody>
                {attendanceData.map((row) => (
                  <tr key={row.id}>
                    <td>{row.name}</td>
                    <td>{row.date}</td>
                    <td>{new Date(row.login_time).toLocaleTimeString()}</td>
                    <td>{row.logout_time ? new Date(row.logout_time).toLocaleTimeString() : "Working..."}</td>
                    <td>
                      {!row.logout_time && (
                        <button className="btn-secondary" onClick={() => handleLogout(row.name)}>Logout</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
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