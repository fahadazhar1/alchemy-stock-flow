/* global React, I */

const Sidebar = ({ route, setRoute, collapsed, setCollapsed }) => {
  const items = [
    { section: "Main" },
    { id: "dashboard", label: "Dashboard", icon: "Dashboard" },
    { id: "products", label: "Products", icon: "Package", badge: "496" },
    { id: "orders", label: "Orders", icon: "Cart", badge: "52", attention: true },
    { id: "pricing", label: "Pricing", icon: "Tag" },
    { section: "Marketing" },
    { id: "campaigns", label: "Campaigns", icon: "Megaphone" },
    { id: "reports", label: "Reports", icon: "Reports" },
    { section: "Inventory" },
    { id: "wms", label: "WMS", icon: "Warehouse" },
    { id: "replenishment", label: "Replenishment", icon: "Truck" },
    { id: "expiry", label: "Expiry Monitor", icon: "Clock" },
    { section: "Intelligence" },
    { id: "copilot", label: "AI Co-Pilot", icon: "Sparkles" },
    { id: "autopilot", label: "Auto-Pilot", icon: "Bot" },
    { id: "approvals", label: "Approvals", icon: "CheckCircle", badge: "6", alert: true },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="logo">
          <I.Beaker size={14} stroke={2} />
        </div>
        <span className="name">Inv. Alchemist</span>
        <button className="collapse-btn" onClick={() => setCollapsed(!collapsed)} title="Collapse sidebar">
          <I.PanelLeft size={14} />
        </button>
      </div>
      {items.map((it, i) => {
        if (it.section) return <div key={i} className="sidebar-section-label">{it.section}</div>;
        return (
          <div
            key={it.id}
            className={"sidebar-item" + (route === it.id ? " active" : "")}
            onClick={() => setRoute(it.id)}
          >
            {React.createElement(I[it.icon], { size: 16 })}
            <span>{it.label}</span>
            {it.badge && (
              <span className={"badge" + (it.alert ? " alert" : it.attention ? " attention" : "")}>{it.badge}</span>
            )}
          </div>
        );
      })}
      <div className="sidebar-footer">
        <div className="sidebar-item">
          <I.Settings size={16} />
          <span>Settings</span>
        </div>
        <div className="sidebar-item">
          <I.Help size={16} />
          <span>Help & Support</span>
        </div>
        <div className="sidebar-user">
          <div className="avatar">RM</div>
          <div className="info">
            <div className="name">Riya Mehta</div>
            <div className="role">Operations · Admin</div>
          </div>
        </div>
      </div>
    </aside>
  );
};

const Topbar = ({ route, theme, setTheme, store, setStore }) => {
  const titles = {
    dashboard: "Dashboard",
    orders: "Orders",
    reports: "Reports",
    products: "Products",
    pricing: "Pricing",
    campaigns: "Campaigns",
    wms: "WMS",
    replenishment: "Replenishment",
    expiry: "Expiry Monitor",
    copilot: "AI Co-Pilot",
    autopilot: "Auto-Pilot",
    approvals: "Approvals",
  };

  return (
    <div className="topbar">
      <div className="crumb">
        <span>Workspace</span>
        <I.Chevron size={12} />
        <span className="current">{titles[route] || route}</span>
      </div>
      <div className="spacer"></div>
      <div className="search">
        <I.Search size={14} />
        <input placeholder="Search products, orders, vendors..." />
        <span className="kbd">⌘K</span>
      </div>
      <button className="btn">
        <I.Store size={14} />
        <span>{store}</span>
        <I.ChevronDown size={12} />
      </button>
      <button className="btn">
        <I.Calendar size={14} />
        <span>May 2026</span>
      </button>
      <div className="row" style={{ gap: 4, padding: "0 4px", borderLeft: "1px solid var(--border)", marginLeft: 4, height: 28 }}>
        <button className="icon-btn" title="Notifications" style={{ position: "relative" }}>
          <I.Bell size={15} />
          <span style={{ position: "absolute", top: 4, right: 4, width: 6, height: 6, borderRadius: 3, background: "var(--red)" }}></span>
        </button>
        <button className="icon-btn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} title="Toggle theme">
          {theme === "dark" ? <I.Sun size={15} /> : <I.Moon size={15} />}
        </button>
      </div>
    </div>
  );
};

window.Shell = { Sidebar, Topbar };
