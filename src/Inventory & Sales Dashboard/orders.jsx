/* global React, I, Charts */
const { fmtGBP, fmtNum, orders, buildLineItems, channelLabels, statuses, stores } = window.MOCK;

const channelBadge = { web: "primary", pos: "green", shop: "pink", wholesale: "amber", sub: "cyan" };
const statusBadge = { Pending: "amber", Fulfilled: "green", Cancelled: "red", Refunded: "violet" };

function fmtDate(d) {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
function fmtDateTime(d) {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + " · " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

const OrderDrawer = ({ order, onClose }) => {
  if (!order) return null;
  const items = buildLineItems(order);
  const subtotal = items.reduce((s, x) => s + x.total, 0);
  const tax = Math.round(subtotal * 0.2 * 100) / 100;
  const shipping = subtotal > 80 ? 0 : 4.5;
  const total = subtotal + tax + shipping;

  return (
    <React.Fragment>
      <div className={"drawer-overlay" + (order ? " open" : "")} onClick={onClose}></div>
      <div className={"drawer" + (order ? " open" : "")}>
        <div className="drawer-header">
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{order.number}</h3>
              <span className={"badge " + statusBadge[order.status]}>{order.status}</span>
              <span className="badge">{order.payment}</span>
            </div>
            <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{fmtDateTime(order.date)} · {order.store}</div>
          </div>
          <div className="row" style={{ gap: 6, marginLeft: "auto" }}>
            <button className="icon-btn"><I.Copy size={14} /></button>
            <button className="icon-btn"><I.Edit size={14} /></button>
            <button className="icon-btn"><I.More size={14} /></button>
            <button className="icon-btn" onClick={onClose}><I.X size={14} /></button>
          </div>
        </div>
        <div className="drawer-body">
          {/* Customer + shipping */}
          <div className="grid cols-2" style={{ marginBottom: 16 }}>
            <div className="card">
              <div className="card-body tight">
                <div className="caption" style={{ marginBottom: 6 }}>Customer</div>
                <div className="row" style={{ gap: 10 }}>
                  <div className="thumb" style={{ width: 32, height: 32, background: "linear-gradient(135deg, var(--violet), var(--pink))", color: "#fff", border: "none" }}>
                    {order.customer.split(" ").map(s => s[0]).join("").slice(0, 2)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, fontSize: 13 }}>{order.customer}</div>
                    <div className="sub muted truncate">{order.email}</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 16, marginTop: 10, fontSize: 11.5 }}>
                  <span className="muted"><I.Hash size={11} style={{ verticalAlign: "-1px" }} /> 12 orders</span>
                  <span className="muted"><I.Pound size={11} style={{ verticalAlign: "-1px" }} /> £842 lifetime</span>
                </div>
              </div>
            </div>
            <div className="card">
              <div className="card-body tight">
                <div className="caption" style={{ marginBottom: 6 }}>Ship to</div>
                <div className="row" style={{ gap: 8, alignItems: "flex-start" }}>
                  <I.MapPin size={14} style={{ color: "var(--text-muted)", marginTop: 2 }} />
                  <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                    {order.customer}<br />
                    <span className="muted">42 Whitefield Lane<br />{order.city}, UK</span>
                  </div>
                </div>
                <div style={{ marginTop: 10 }}>
                  <span className="badge"><I.Truck size={10} stroke={2} /> Royal Mail · Tracked 24</span>
                </div>
              </div>
            </div>
          </div>

          {/* Line items */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <h3>Items <span className="sub">{items.length}</span></h3>
            </div>
            <div className="list">
              {items.map((it, i) => (
                <div className="list-row" key={i}>
                  <div className="thumb" style={{ fontSize: 18 }}>{it.img || "🌿"}</div>
                  <div className="meta">
                    <div className="title">{it.name}</div>
                    <div className="sub mono">{it.sku} · {it.vendor}</div>
                  </div>
                  <span className="muted tabular" style={{ fontSize: 12 }}>{it.qty} × £{it.price}</span>
                  <span className="num" style={{ fontWeight: 600, minWidth: 70, textAlign: "right" }}>{fmtGBP(it.total)}</span>
                </div>
              ))}
            </div>
            <div style={{ padding: "12px 14px", borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 6 }}>
              <div className="row between" style={{ fontSize: 12.5 }}><span className="muted">Subtotal</span><span className="tabular">{fmtGBP(subtotal)}</span></div>
              <div className="row between" style={{ fontSize: 12.5 }}><span className="muted">VAT (20%)</span><span className="tabular">{fmtGBP(tax)}</span></div>
              <div className="row between" style={{ fontSize: 12.5 }}><span className="muted">Shipping</span><span className="tabular">{shipping ? fmtGBP(shipping) : "Free"}</span></div>
              <div className="row between" style={{ fontSize: 14, fontWeight: 600, paddingTop: 6, borderTop: "1px dashed var(--border)" }}>
                <span>Total</span><span className="tabular">{fmtGBP(total)}</span>
              </div>
            </div>
          </div>

          {/* Timeline */}
          <div className="card">
            <div className="card-header"><h3>Timeline</h3></div>
            <div style={{ padding: "12px 16px" }}>
              {[
                { t: "Order placed", d: fmtDateTime(order.date), icon: "Cart", color: "var(--primary)" },
                { t: "Payment captured", d: fmtDateTime(order.date) + " · Stripe ••4242", icon: "CreditCard", color: "var(--green)" },
                { t: order.status === "Pending" ? "Awaiting fulfillment" : "Fulfilled", d: order.status === "Pending" ? "Picking queue · Warehouse 1" : "Royal Mail handover", icon: order.status === "Pending" ? "Clock" : "Truck", color: order.status === "Pending" ? "var(--amber)" : "var(--green)" },
              ].map((step, i, arr) => (
                <div key={i} style={{ display: "flex", gap: 12, position: "relative", paddingBottom: i === arr.length - 1 ? 0 : 14 }}>
                  {i !== arr.length - 1 && (
                    <span style={{ position: "absolute", left: 11, top: 22, bottom: 0, width: 2, background: "var(--border)" }}></span>
                  )}
                  <div style={{ width: 24, height: 24, borderRadius: 6, background: step.color + "22", color: step.color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {React.createElement(I[step.icon], { size: 12, stroke: 2 })}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, fontSize: 12.5 }}>{step.t}</div>
                    <div className="muted" style={{ fontSize: 11.5 }}>{step.d}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="drawer-footer">
          <button className="btn"><I.Mail size={13} /> Email customer</button>
          <button className="btn"><I.Download size={13} /> Invoice</button>
          <button className="btn primary"><I.CheckCircle size={13} /> Mark fulfilled</button>
        </div>
      </div>
    </React.Fragment>
  );
};

const Orders = () => {
  const [view, setView] = React.useState("All");
  const [search, setSearch] = React.useState("");
  const [filterChannel, setFilterChannel] = React.useState("");
  const [selected, setSelected] = React.useState(new Set());
  const [drawer, setDrawer] = React.useState(null);
  const [sort, setSort] = React.useState("date-desc");

  const counts = {
    All: orders.length,
    Pending: orders.filter(o => o.status === "Pending").length,
    Fulfilled: orders.filter(o => o.status === "Fulfilled").length,
    Cancelled: orders.filter(o => o.status === "Cancelled").length,
    Refunded: orders.filter(o => o.status === "Refunded").length,
  };

  const filtered = orders.filter(o => {
    if (view !== "All" && o.status !== view) return false;
    if (filterChannel && o.channel !== filterChannel) return false;
    if (search && !(o.number + " " + o.customer + " " + o.email).toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const toggleSel = (id) => {
    setSelected(s => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };
  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map(o => o.id)));
  };

  const totalRevenue = filtered.reduce((s, o) => s + o.total, 0);

  return (
    <div className="content">
      <div className="section-h" style={{ marginTop: 0 }}>
        <div className="left" style={{ flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
          <h2 style={{ fontSize: 22, letterSpacing: "-0.02em" }}>Orders</h2>
          <span className="desc">{filtered.length} orders · {fmtGBP(totalRevenue)} total</span>
        </div>
        <div className="right">
          <button className="btn"><I.Upload size={13} /> Import</button>
          <button className="btn"><I.Download size={13} /> Export CSV</button>
          <button className="btn primary"><I.Plus size={13} /> New order</button>
        </div>
      </div>

      {/* Saved views */}
      <div className="row" style={{ marginBottom: 14, gap: 14, justifyContent: "space-between", flexWrap: "wrap" }}>
        <div className="chips">
          {["All", "Pending", "Fulfilled", "Cancelled", "Refunded"].map(v => (
            <button key={v} className={"chip" + (view === v ? " active" : "")} onClick={() => { setView(v); setSelected(new Set()); }}>
              {v}<span className="count">{counts[v]}</span>
            </button>
          ))}
          <button className="chip" title="Save current view"><I.Plus size={11} /> Saved view</button>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <div className="search" style={{ width: 240 }}>
            <I.Search size={14} />
            <input placeholder="Search order, customer, email..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="input select" value={filterChannel} onChange={e => setFilterChannel(e.target.value)}>
            <option value="">All channels</option>
            {Object.entries(channelLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button className="btn"><I.Calendar size={13} /> Last 30 days</button>
          <button className="btn icon"><I.Sliders size={14} /></button>
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="banner" style={{ marginBottom: 12, borderColor: "var(--primary)", background: "var(--primary-soft)" }}>
          <span style={{ fontWeight: 600, fontSize: 12.5, color: "var(--primary-text)" }}>{selected.size} selected</span>
          <span className="banner-divider"></span>
          <button className="btn sm"><I.CheckCircle size={12} /> Mark fulfilled</button>
          <button className="btn sm"><I.Send size={12} /> Send invoice</button>
          <button className="btn sm"><I.Download size={12} /> Export</button>
          <button className="btn sm danger"><I.XCircle size={12} /> Cancel</button>
          <button className="btn sm ghost" onClick={() => setSelected(new Set())} style={{ marginLeft: "auto" }}>Clear</button>
        </div>
      )}

      <div className="card">
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 38 }}>
                  <input type="checkbox" checked={selected.size > 0 && selected.size === filtered.length} onChange={toggleAll} />
                </th>
                <th>Order</th>
                <th>Date</th>
                <th>Customer</th>
                <th>Channel</th>
                <th>Store</th>
                <th>Status</th>
                <th>Payment</th>
                <th className="num">Items</th>
                <th className="num">Total</th>
                <th style={{ width: 36 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 30).map(o => (
                <tr key={o.id} className={selected.has(o.id) ? "selected" : ""} onClick={() => setDrawer(o)}>
                  <td onClick={e => { e.stopPropagation(); toggleSel(o.id); }}>
                    <input type="checkbox" checked={selected.has(o.id)} onChange={() => {}} />
                  </td>
                  <td><span className="mono" style={{ fontWeight: 500 }}>{o.number}</span></td>
                  <td className="muted" style={{ fontSize: 11.5 }}>{fmtDate(o.date)}</td>
                  <td>
                    <div style={{ fontWeight: 500 }}>{o.customer}</div>
                    <div className="muted" style={{ fontSize: 11 }}>{o.city}</div>
                  </td>
                  <td><span className={"badge " + channelBadge[o.channel]}>{channelLabels[o.channel]}</span></td>
                  <td className="muted" style={{ fontSize: 12 }}>{o.store}</td>
                  <td><span className={"badge dot " + statusBadge[o.status]}>{o.status}</span></td>
                  <td><span className={"badge " + (o.payment === "Paid" ? "green" : o.payment === "Refunded" ? "violet" : "")}>{o.payment}</span></td>
                  <td className="num muted">{o.items}</td>
                  <td className="num" style={{ fontWeight: 500 }}>{fmtGBP(o.total)}</td>
                  <td onClick={e => e.stopPropagation()}><button className="icon-btn row-action"><I.More size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row between" style={{ padding: "10px 14px", borderTop: "1px solid var(--border)", fontSize: 12, color: "var(--text-muted)" }}>
          <span>Showing 1–{Math.min(30, filtered.length)} of {filtered.length}</span>
          <div className="row" style={{ gap: 4 }}>
            <button className="btn sm" disabled>Previous</button>
            <button className="btn sm">Next</button>
          </div>
        </div>
      </div>

      <OrderDrawer order={drawer} onClose={() => setDrawer(null)} />
    </div>
  );
};

window.Orders = Orders;
