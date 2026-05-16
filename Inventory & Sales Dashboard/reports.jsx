/* global React, I, Charts */
const { fmtGBP, fmtNum, reportTemplates, savedReports, salesTrend, channels, collectionSales } = window.MOCK;

const ReportTemplateCard = ({ tpl, onUse }) => (
  <div className="card" style={{ cursor: "pointer", transition: "border-color 0.15s, transform 0.15s" }}
       onMouseEnter={e => e.currentTarget.style.borderColor = "var(--border-strong)"}
       onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border)"}
       onClick={onUse}>
    <div className="card-body">
      <div className="row between" style={{ alignItems: "flex-start" }}>
        <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: tpl.color + "1A", color: tpl.color, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {React.createElement(I[tpl.icon] || I.Reports, { size: 17, stroke: 1.8 })}
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13.5 }}>{tpl.name}</div>
            <div className="muted" style={{ fontSize: 11.5, marginTop: 1 }}>{tpl.category}</div>
          </div>
        </div>
        <button className="icon-btn"><I.More size={14} /></button>
      </div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 12, lineHeight: 1.5 }}>{tpl.desc}</div>
      <div className="row between" style={{ marginTop: 14, fontSize: 11.5 }}>
        <span className="muted"><I.Clock size={11} style={{ verticalAlign: "-1px" }} /> Last run {tpl.lastRun}</span>
        <span style={{ color: tpl.color, fontWeight: 500 }}>Run report <I.ChevronRight size={11} stroke={2.5} style={{ verticalAlign: "-1px" }} /></span>
      </div>
    </div>
  </div>
);

// ----- Custom builder -----
const FieldChip = ({ name, type, onAdd, dragging }) => {
  const colors = { Metric: "var(--green-text)", Dimension: "var(--violet-text)", Filter: "var(--cyan-text)" };
  const bgs = { Metric: "var(--green-soft)", Dimension: "var(--violet-soft)", Filter: "var(--cyan-soft)" };
  return (
    <div
      onClick={onAdd}
      style={{
        display: "flex", alignItems: "center", gap: 7,
        padding: "6px 9px",
        background: "var(--bg-elev)",
        border: "1px solid var(--border)",
        borderRadius: 7,
        cursor: "grab",
        fontSize: 12,
        transition: "background 0.12s, border-color 0.12s",
      }}
    >
      <I.Drag size={12} style={{ color: "var(--text-faint)" }} />
      <span style={{ flex: 1 }}>{name}</span>
      <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: bgs[type], color: colors[type], fontWeight: 600 }}>{type}</span>
    </div>
  );
};

const Slot = ({ label, items, accent, placeholder, onRemove }) => (
  <div>
    <div className="caption" style={{ marginBottom: 6 }}>{label}</div>
    <div style={{
      minHeight: 64,
      border: "1.5px dashed " + (items.length ? "transparent" : "var(--border-strong)"),
      borderRadius: 8,
      padding: 8,
      background: items.length ? "var(--bg-subtle)" : "transparent",
      display: "flex", flexWrap: "wrap", gap: 6,
      alignItems: items.length ? "flex-start" : "center",
      justifyContent: items.length ? "flex-start" : "center",
    }}>
      {items.length === 0 && (
        <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{placeholder}</div>
      )}
      {items.map((it, i) => (
        <div key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 6px 4px 9px", background: accent, color: "#fff", borderRadius: 6, fontSize: 11.5, fontWeight: 500 }}>
          <span>{it}</span>
          <button className="icon-btn" style={{ width: 16, height: 16, color: "rgba(255,255,255,0.85)" }} onClick={() => onRemove(i)}>
            <I.X size={11} stroke={2.5} />
          </button>
        </div>
      ))}
    </div>
  </div>
);

const CustomBuilder = () => {
  const [metrics, setMetrics] = React.useState(["Revenue", "Orders"]);
  const [dimensions, setDimensions] = React.useState(["Channel"]);
  const [filters, setFilters] = React.useState(["Date: Last 30 days"]);
  const [chartType, setChartType] = React.useState("bar");

  const fields = {
    Metric: ["Revenue", "Orders", "AOV", "Units sold", "Refunds", "Margin", "Sell-through %", "Inventory units", "Stock value", "Days on shelf", "Conversion %"],
    Dimension: ["Channel", "Collection", "Vendor", "Store", "Customer cohort", "Day", "Week", "Month", "Country", "SKU"],
    Filter: ["Date range", "Status", "Channel", "Store", "Tag", "Vendor"],
  };

  const remove = (kind) => (i) => {
    if (kind === "metrics") setMetrics(s => s.filter((_, k) => k !== i));
    if (kind === "dimensions") setDimensions(s => s.filter((_, k) => k !== i));
    if (kind === "filters") setFilters(s => s.filter((_, k) => k !== i));
  };
  const add = (type, name) => {
    if (type === "Metric" && !metrics.includes(name)) setMetrics([...metrics, name]);
    if (type === "Dimension" && !dimensions.includes(name)) setDimensions([...dimensions, name]);
    if (type === "Filter" && !filters.includes(name)) setFilters([...filters, name]);
  };

  return (
    <div className="grid" style={{ gridTemplateColumns: "260px 1fr", gap: 14 }}>
      {/* Field library */}
      <div className="card">
        <div className="card-header"><h3>Fields</h3></div>
        <div className="card-body" style={{ padding: 12 }}>
          {Object.entries(fields).map(([type, list]) => (
            <div key={type} style={{ marginBottom: 14 }}>
              <div className="caption" style={{ marginBottom: 6 }}>{type}s</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {list.map(f => <FieldChip key={f} name={f} type={type} onAdd={() => add(type, f)} />)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Builder canvas */}
      <div className="col" style={{ gap: 14 }}>
        <div className="card">
          <div className="card-body">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <Slot label="Metrics" items={metrics} accent="var(--green)" placeholder="Drag metrics here" onRemove={remove("metrics")} />
              <Slot label="Dimensions" items={dimensions} accent="var(--violet)" placeholder="Drag dimensions here" onRemove={remove("dimensions")} />
              <Slot label="Filters" items={filters} accent="var(--cyan)" placeholder="Drag filters here" onRemove={remove("filters")} />
            </div>
            <div className="row" style={{ marginTop: 14, gap: 8 }}>
              <span className="caption" style={{ marginRight: 4 }}>Chart</span>
              {[
                { id: "bar", icon: "BarChart", label: "Bar" },
                { id: "line", icon: "LineChart", label: "Line" },
                { id: "pie", icon: "PieChart", label: "Donut" },
                { id: "table", icon: "Table", label: "Pivot" },
                { id: "kpi", icon: "Hash", label: "KPI" },
              ].map(c => (
                <button key={c.id} className={"btn sm" + (chartType === c.id ? " primary" : "")} onClick={() => setChartType(c.id)}>
                  {React.createElement(I[c.icon], { size: 12 })} {c.label}
                </button>
              ))}
              <div style={{ flex: 1 }}></div>
              <button className="btn sm"><I.Save size={12} /> Save</button>
              <button className="btn sm"><I.Calendar size={12} /> Schedule</button>
              <button className="btn sm primary"><I.Play size={12} /> Run</button>
            </div>
          </div>
        </div>

        {/* Preview */}
        <div className="card">
          <div className="card-header">
            <h3>Preview <span className="sub">{metrics.join(", ") || "no metrics"} by {dimensions.join(", ") || "—"}</span></h3>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn ghost sm"><I.Download size={12} /> CSV</button>
              <button className="btn ghost sm"><I.Download size={12} /> PDF</button>
              <button className="btn ghost sm"><I.Share size={12} /> Share</button>
            </div>
          </div>
          <div className="card-body">
            {chartType === "bar" && (
              <Charts.ColumnChart
                data={channels.map(c => ({ label: c.name.split(" ")[0], value: c.revenue, color: c.color }))}
                height={260}
                formatY={(v) => v >= 1000 ? "£" + (v / 1000).toFixed(0) + "k" : "£" + v}
              />
            )}
            {chartType === "line" && (
              <Charts.TrendChart data={salesTrend} height={260} formatY={(v) => fmtGBP(v)} />
            )}
            {chartType === "pie" && (
              <Charts.Donut
                data={channels.map(c => ({ name: c.name, value: c.revenue, color: c.color, formatted: fmtGBP(c.revenue) }))}
                centerLabel="Revenue" centerValue={fmtGBP(channels.reduce((s, c) => s + c.revenue, 0))}
                size={180} strokeWidth={26}
              />
            )}
            {chartType === "table" && (
              <div className="table-wrap" style={{ marginTop: -16, marginLeft: -16, marginRight: -16, marginBottom: -16 }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>{dimensions[0] || "Dimension"}</th>
                      {metrics.map(m => <th key={m} className="num">{m}</th>)}
                      <th>Trend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {channels.map(c => (
                      <tr key={c.key}>
                        <td>
                          <span className="row" style={{ gap: 8 }}>
                            <span style={{ width: 8, height: 8, borderRadius: 2, background: c.color }}></span>
                            {c.name}
                          </span>
                        </td>
                        {metrics.map(m => (
                          <td className="num" key={m}>
                            {m === "Revenue" ? fmtGBP(c.revenue) :
                             m === "Orders" ? fmtNum(c.orders) :
                             m === "AOV" ? fmtGBP(c.revenue / c.orders) :
                             m === "Units sold" ? fmtNum(Math.round(c.orders * 1.6)) :
                             m === "Sell-through %" ? (c.share / 4).toFixed(1) + "%" :
                             "—"}
                          </td>
                        ))}
                        <td>
                          <Charts.Sparkline data={Array.from({ length: 12 }, (_, k) => 50 + Math.sin(k + c.key.length) * 20 + k * 2)} color={c.color} w={80} h={20} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {chartType === "kpi" && (
              <div className="grid cols-3" style={{ gap: 12 }}>
                {metrics.map((m, i) => (
                  <div key={m} className="kpi" style={{ border: "1px dashed var(--border-strong)" }}>
                    <div className="label">{m}</div>
                    <div className="value">{i === 0 ? fmtGBP(403000) : i === 1 ? fmtNum(3829) : fmtGBP(105)}</div>
                    <div className="meta"><span className="delta up"><I.ArrowUp size={11} stroke={2.5} />{(8 + i * 3).toFixed(1)}%</span><span>vs prev</span></div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const SavedReportsTab = () => (
  <div className="card">
    <div className="card-header">
      <h3>Saved reports <span className="sub">{savedReports.length}</span></h3>
      <div className="row" style={{ gap: 8 }}>
        <div className="search" style={{ width: 200 }}>
          <I.Search size={13} />
          <input placeholder="Search saved reports..." />
        </div>
        <button className="btn sm primary"><I.Plus size={12} /> New report</button>
      </div>
    </div>
    <div className="table-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th>Name</th>
            <th>Template</th>
            <th>Owner</th>
            <th>Last updated</th>
            <th>Schedule</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {savedReports.map((r, i) => (
            <tr key={i}>
              <td>
                <div className="row" style={{ gap: 8 }}>
                  <I.Reports size={14} style={{ color: "var(--primary)" }} />
                  <span style={{ fontWeight: 500 }}>{r.name}</span>
                </div>
              </td>
              <td className="muted">{r.template}</td>
              <td>
                <span className="row" style={{ gap: 6 }}>
                  <span style={{ width: 18, height: 18, borderRadius: 50, background: "linear-gradient(135deg, var(--violet), var(--pink))", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 600 }}>{r.owner.split(" ").map(s => s[0]).join("").slice(0, 2)}</span>
                  {r.owner}
                </span>
              </td>
              <td className="muted">{r.updated}</td>
              <td>
                {r.schedule ? <span className="badge primary"><I.Calendar size={10} /> {r.schedule}</span> : <span className="muted">—</span>}
              </td>
              <td>
                <div className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
                  <button className="icon-btn"><I.Play size={13} /></button>
                  <button className="icon-btn"><I.Share size={13} /></button>
                  <button className="icon-btn"><I.More size={13} /></button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

const ScheduledTab = () => (
  <div className="card">
    <div className="card-header"><h3>Scheduled deliveries</h3><button className="btn sm primary"><I.Plus size={12} /> New schedule</button></div>
    <div className="list">
      {[
        { name: "Weekly Sales Digest", to: "leadership@inv.com, +3", freq: "Mondays at 9:00 BST", next: "May 11, 2026", fmt: ["PDF", "CSV"] },
        { name: "Monthly Inventory Aging", to: "warehouse@inv.com", freq: "1st of month at 8:00 BST", next: "Jun 1, 2026", fmt: ["PDF"] },
        { name: "Quarterly Vendor Review", to: "buying@inv.com, +2", freq: "1st Mon of quarter", next: "Jul 6, 2026", fmt: ["PDF", "Excel"] },
      ].map((s, i) => (
        <div className="list-row" key={i}>
          <div className="thumb" style={{ background: "var(--primary-soft)", color: "var(--primary-text)", borderColor: "transparent" }}><I.Calendar size={14} /></div>
          <div className="meta">
            <div className="title">{s.name}</div>
            <div className="sub">{s.freq} · to {s.to}</div>
          </div>
          <div className="row" style={{ gap: 6 }}>
            {s.fmt.map(f => <span key={f} className="badge">{f}</span>)}
          </div>
          <div style={{ minWidth: 120, textAlign: "right" }}>
            <div className="sub muted">Next run</div>
            <div style={{ fontSize: 12.5, fontWeight: 500 }}>{s.next}</div>
          </div>
          <div className="row" style={{ gap: 4 }}>
            <button className="icon-btn"><I.Pause size={13} /></button>
            <button className="icon-btn"><I.More size={13} /></button>
          </div>
        </div>
      ))}
    </div>
  </div>
);

const Reports = () => {
  const [tab, setTab] = React.useState("templates");

  return (
    <div className="content">
      <div className="section-h" style={{ marginTop: 0 }}>
        <div className="left" style={{ flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
          <h2 style={{ fontSize: 22, letterSpacing: "-0.02em" }}>Reports</h2>
          <span className="desc">Pre-built reports, custom builder, and scheduled deliveries</span>
        </div>
        <div className="right">
          <button className="btn"><I.Share size={13} /> Share library</button>
          <button className="btn primary"><I.Plus size={13} /> New report</button>
        </div>
      </div>

      <div className="tabs">
        <button className={"tab" + (tab === "templates" ? " active" : "")} onClick={() => setTab("templates")}>
          <I.Layout size={13} /> Templates <span className="count">{reportTemplates.length}</span>
        </button>
        <button className={"tab" + (tab === "builder" ? " active" : "")} onClick={() => setTab("builder")}>
          <I.Sliders size={13} /> Custom builder
        </button>
        <button className={"tab" + (tab === "saved" ? " active" : "")} onClick={() => setTab("saved")}>
          <I.Save size={13} /> Saved <span className="count">{savedReports.length}</span>
        </button>
        <button className={"tab" + (tab === "scheduled" ? " active" : "")} onClick={() => setTab("scheduled")}>
          <I.Calendar size={13} /> Scheduled <span className="count">3</span>
        </button>
      </div>

      {tab === "templates" && (
        <React.Fragment>
          <div className="row" style={{ marginBottom: 14, gap: 10, flexWrap: "wrap" }}>
            <div className="chips">
              {["All", "Sales", "Inventory", "Vendors", "Customers", "Marketing"].map((c, i) => (
                <button key={c} className={"chip" + (i === 0 ? " active" : "")}>{c}</button>
              ))}
            </div>
            <div style={{ flex: 1 }}></div>
            <div className="search" style={{ width: 240 }}>
              <I.Search size={13} />
              <input placeholder="Search templates..." />
            </div>
          </div>
          <div className="grid cols-3">
            {reportTemplates.map(t => <ReportTemplateCard key={t.id} tpl={t} onUse={() => {}} />)}
          </div>
        </React.Fragment>
      )}

      {tab === "builder" && <CustomBuilder />}
      {tab === "saved" && <SavedReportsTab />}
      {tab === "scheduled" && <ScheduledTab />}
    </div>
  );
};

window.Reports = Reports;
