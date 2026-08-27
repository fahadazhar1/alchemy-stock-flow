/* global React, I, Charts */
const { fmtGBP, fmtNum, fmtPct, salesTrend, channels, topProducts, collectionSales, customerSplit, totalRevenueToday, totalRevenueWTD, totalRevenueMTD, totalRevenueMonthPrev, totalOrdersMTD, inventoryByCategory, losers, expiringSoon, replenishmentQueue, agingBuckets } = window.MOCK;

// ----- KPI tile -----
const KPI = ({ label, value, unit, delta, deltaLabel, deltaUp, icon, iconColor, iconBg, sparkData, sparkColor, footer, progress, progressColor, onClick }) => (
  <div className="kpi" onClick={onClick} style={onClick ? { cursor: "pointer" } : {}}>
    <div className="label">
      {icon && (
        <span className="icon-pill" style={{ background: iconBg, color: iconColor }}>
          {React.createElement(I[icon], { size: 11, stroke: 2 })}
        </span>
      )}
      {label}
    </div>
    <div className="value">
      {value}{unit && <span className="unit">{unit}</span>}
    </div>
    <div className="meta">
      {delta != null && (
        <span className={"delta " + (deltaUp ? "up" : "down")}>
          {deltaUp ? <I.ArrowUp size={11} stroke={2.5} /> : <I.ArrowDown size={11} stroke={2.5} />}
          {Math.abs(delta)}%
        </span>
      )}
      {deltaLabel && <span>{deltaLabel}</span>}
      {footer && <span>{footer}</span>}
    </div>
    {progress != null && (
      <div className="progress-track"><div className="progress-fill" style={{ width: progress + "%", background: progressColor }}></div></div>
    )}
    {sparkData && (
      <div className="spark">
        <Charts.Sparkline data={sparkData} color={sparkColor || "var(--primary)"} w={70} h={26} />
      </div>
    )}
  </div>
);

// ----- Status banner with summary alerts -----
const AlertStrip = () => (
  <div className="banner" style={{ borderColor: "var(--amber)", background: "linear-gradient(90deg, var(--amber-soft), var(--bg-elev))" }}>
    <div className="pill" style={{ background: "var(--amber-soft)", color: "var(--amber-text)" }}>
      <I.Alert size={12} stroke={2.4} />
      <span style={{ fontWeight: 600 }}>Operations summary</span>
    </div>
    <div className="row" style={{ gap: 16, fontSize: 12.5 }}>
      <span><span style={{ color: "var(--red-text)", fontWeight: 600 }}>496</span> <span className="muted">SKUs out of stock</span></span>
      <span className="banner-divider"></span>
      <span><span style={{ color: "var(--green-text)", fontWeight: 600 }}>461</span> <span className="muted">low-stock winners</span></span>
      <span className="banner-divider"></span>
      <span><span style={{ color: "var(--amber-text)", fontWeight: 600 }}>52</span> <span className="muted">orders pending fulfillment</span></span>
      <span className="banner-divider"></span>
      <span><span style={{ color: "var(--violet-text)", fontWeight: 600 }}>6</span> <span className="muted">approvals awaiting your review</span></span>
    </div>
    <div className="spacer" style={{ flex: 1 }}></div>
    <button className="btn sm">Take action</button>
    <button className="banner-dismiss icon-btn"><I.X size={14} /></button>
  </div>
);

// ----- SALES section -----
const SalesSection = ({ range, setRange }) => {
  const sparkRev = salesTrend.slice(-14).map(d => d.revenue);
  const sparkOrders = salesTrend.slice(-14).map(d => d.orders);
  const aov = totalRevenueMTD / totalOrdersMTD;
  const refundRate = 2.4;
  const conversionRate = 3.1;

  return (
    <div>
      <div className="section-h">
        <div className="left">
          <span className="tag">Sales</span>
          <h2>Sales overview</h2>
          <span className="desc">May 1 – May 8 vs Apr 1 – Apr 30</span>
        </div>
        <div className="right">
          <div className="chips">
            {["Today", "WTD", "MTD", "QTD", "YTD"].map(r => (
              <button key={r} className={"chip" + (range === r ? " active" : "")} onClick={() => setRange(r)}>{r}</button>
            ))}
          </div>
          <button className="btn"><I.Download size={13} /> Export</button>
        </div>
      </div>

      {/* Sales KPI tiles */}
      <div className="grid cols-5" style={{ marginBottom: 14 }}>
        <KPI
          icon="Pound" iconColor="var(--primary-text)" iconBg="var(--primary-soft)"
          label="Revenue (MTD)" value={fmtGBP(totalRevenueMTD)}
          delta={12.4} deltaUp={true} deltaLabel="vs last month"
          sparkData={sparkRev} sparkColor="var(--primary)"
        />
        <KPI
          icon="Cart" iconColor="var(--violet-text)" iconBg="var(--violet-soft)"
          label="Orders" value={fmtNum(totalOrdersMTD)}
          delta={8.1} deltaUp={true} deltaLabel="vs last month"
          sparkData={sparkOrders} sparkColor="var(--violet)"
        />
        <KPI
          icon="CreditCard" iconColor="var(--cyan-text)" iconBg="var(--cyan-soft)"
          label="Avg. Order Value" value={fmtGBP(aov)}
          delta={3.7} deltaUp={true} deltaLabel="vs last month"
          footer=""
        />
        <KPI
          icon="TrendUp" iconColor="var(--green-text)" iconBg="var(--green-soft)"
          label="Sell-Through %" value="0.2" unit="%"
          delta={0.3} deltaUp={false} deltaLabel="below target 1.5%"
          progress={13} progressColor="var(--amber)"
        />
        <KPI
          icon="Activity" iconColor="var(--pink-text)" iconBg="var(--pink-soft)"
          label="Conv. / Refund" value={`${conversionRate}%`}
          footer={`Refund ${refundRate}%`}
        />
      </div>

      {/* Trend + Channels */}
      <div className="grid split-2-1" style={{ marginBottom: 14 }}>
        <div className="card">
          <div className="card-header">
            <h3>Revenue trend <span className="sub">last 30 days</span></h3>
            <div className="row" style={{ gap: 12, fontSize: 11.5, color: "var(--text-muted)" }}>
              <span className="row" style={{ gap: 5 }}><span style={{ width: 10, height: 2, background: "var(--primary)", display: "inline-block" }}></span>Revenue</span>
              <span className="row" style={{ gap: 5 }}><span style={{ width: 10, height: 2, background: "var(--violet)", display: "inline-block", borderTop: "1px dashed" }}></span>Orders</span>
              <button className="icon-btn"><I.More size={14} /></button>
            </div>
          </div>
          <div className="card-body">
            <Charts.TrendChart data={salesTrend} height={230} showSecondary={true} formatY={(v) => fmtGBP(v)} />
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3>Sales by channel</h3><span className="sub">{fmtGBP(channels.reduce((s, c) => s + c.revenue, 0))}</span></div>
          <div className="card-body">
            <Charts.Donut
              data={channels.map(c => ({ name: c.name, value: c.revenue, color: c.color, formatted: fmtGBP(c.revenue) }))}
              centerLabel="Total" centerValue={fmtGBP(channels.reduce((s, c) => s + c.revenue, 0))}
              size={140} strokeWidth={20}
            />
          </div>
        </div>
      </div>

      {/* Top products + Collections + Customers */}
      <div className="grid split-3-2" style={{ marginBottom: 14 }}>
        <div className="card">
          <div className="card-header">
            <h3>Top selling products <span className="sub">by revenue · MTD</span></h3>
            <button className="btn ghost sm">View all <I.ChevronRight size={11} /></button>
          </div>
          <div className="list">
            {topProducts.slice(0, 6).map((p, i) => (
              <div className="list-row" key={p.sku}>
                <div className="thumb" style={{ fontSize: 18 }}>{p.img}</div>
                <div className="meta">
                  <div className="title">{p.name}</div>
                  <div className="sub">{p.vendor} · <span className="mono">{p.sku}</span></div>
                </div>
                <div style={{ textAlign: "right", minWidth: 90 }}>
                  <div className="num" style={{ fontWeight: 600 }}>{fmtGBP(p.revenue)}</div>
                  <div className="sub muted">{p.units} units</div>
                </div>
                <div style={{ width: 80 }}>
                  <Charts.Sparkline
                    data={Array.from({ length: 12 }, (_, k) => 50 + Math.sin(i + k * 0.7) * 25 + (p.trend > 0 ? k : -k) * 2)}
                    color={p.trend > 0 ? "var(--green)" : "var(--red)"} w={70} h={22}
                  />
                </div>
                <span className={"badge " + (p.trend > 0 ? "green" : "red")}>
                  {p.trend > 0 ? <I.ArrowUp size={9} stroke={2.5} /> : <I.ArrowDown size={9} stroke={2.5} />}
                  {Math.abs(p.trend)}%
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="col" style={{ gap: 14 }}>
          <div className="card">
            <div className="card-header"><h3>Sales by collection</h3></div>
            <div className="card-body">
              <Charts.BarList
                items={collectionSales.map(c => ({ label: c.name, value: c.revenue, color: c.color }))}
                formatValue={fmtGBP}
              />
            </div>
          </div>
          <div className="card">
            <div className="card-header"><h3>New vs returning</h3><span className="sub">customers · MTD</span></div>
            <div className="card-body">
              <div className="row" style={{ gap: 16, alignItems: "stretch" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>New</div>
                  <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }} className="tabular">{customerSplit.new}%</div>
                  <div className="sub muted" style={{ fontSize: 11 }}>{fmtGBP(customerSplit.newRevenue)}</div>
                </div>
                <div style={{ width: 1, background: "var(--border)" }}></div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>Returning</div>
                  <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--primary-text)" }} className="tabular">{customerSplit.returning}%</div>
                  <div className="sub muted" style={{ fontSize: 11 }}>{fmtGBP(customerSplit.returningRevenue)}</div>
                </div>
              </div>
              <div style={{ marginTop: 12 }}>
                <Charts.StackedBar
                  segments={[
                    { label: "New", value: customerSplit.new, color: "var(--cyan)" },
                    { label: "Returning", value: customerSplit.returning, color: "var(--primary)" },
                  ]}
                  height={8}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Channel detail */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-header">
          <h3>Channel performance</h3>
          <button className="btn ghost sm">Manage channels</button>
        </div>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Channel</th>
                <th className="num">Revenue</th>
                <th className="num">Orders</th>
                <th className="num">AOV</th>
                <th className="num">Share</th>
                <th>Trend (14d)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {channels.map(c => (
                <tr key={c.key}>
                  <td>
                    <div className="row" style={{ gap: 9 }}>
                      <span style={{ width: 22, height: 22, borderRadius: 6, background: c.color + "22", color: c.color, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                        {React.createElement(I[c.icon], { size: 12, stroke: 2 })}
                      </span>
                      <span style={{ fontWeight: 500 }}>{c.name}</span>
                    </div>
                  </td>
                  <td className="num" style={{ fontWeight: 500 }}>{fmtGBP(c.revenue)}</td>
                  <td className="num muted">{fmtNum(c.orders)}</td>
                  <td className="num muted">{fmtGBP(c.revenue / c.orders)}</td>
                  <td className="num">
                    <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
                      <div style={{ width: 60, height: 4, background: "var(--bg-subtle)", borderRadius: 2, overflow: "hidden" }}>
                        <div style={{ width: c.share + "%", height: "100%", background: c.color }}></div>
                      </div>
                      <span className="tabular" style={{ minWidth: 36, textAlign: "right" }}>{c.share}%</span>
                    </div>
                  </td>
                  <td>
                    <Charts.Sparkline
                      data={Array.from({ length: 14 }, (_, k) => c.revenue / 14 * (0.7 + 0.6 * Math.abs(Math.sin(k + c.key.length))))}
                      color={c.color} w={120} h={26}
                    />
                  </td>
                  <td><button className="icon-btn"><I.More size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ----- INVENTORY section -----
const InventorySection = () => {
  const stockValue = 1648200;
  const onHand = 20342;
  const oos = 496;
  const lowStock = 187;
  const winners = 1013;
  const losersCount = 250;
  const sparkInv = Array.from({ length: 14 }, (_, i) => onHand - i * 80 + Math.sin(i) * 200);

  return (
    <div>
      <div className="section-h">
        <div className="left">
          <span className="tag">Inventory</span>
          <h2>Inventory health</h2>
          <span className="desc">Across all stores · live</span>
        </div>
        <div className="right">
          <button className="btn"><I.Refresh size={13} /> Sync now</button>
          <button className="btn"><I.Filter size={13} /> Filter</button>
        </div>
      </div>

      <div className="grid cols-5" style={{ marginBottom: 14 }}>
        <KPI
          icon="Boxes" iconColor="var(--primary-text)" iconBg="var(--primary-soft)"
          label="On-hand units" value={fmtNum(onHand)}
          delta={2.1} deltaUp={true} deltaLabel="vs last month"
          sparkData={sparkInv} sparkColor="var(--primary)"
        />
        <KPI
          icon="Pound" iconColor="var(--green-text)" iconBg="var(--green-soft)"
          label="Stock value" value={fmtGBP(stockValue)}
          delta={4.2} deltaUp={true} deltaLabel="at current prices"
        />
        <KPI
          icon="XCircle" iconColor="var(--red-text)" iconBg="var(--red-soft)"
          label="Out of stock" value={fmtNum(oos)}
          delta={12} deltaUp={false} deltaLabel="needs replenishment"
        />
        <KPI
          icon="Award" iconColor="var(--green-text)" iconBg="var(--green-soft)"
          label="Winners" value={fmtNum(winners)}
          footer={`${Math.round(winners / (winners + losersCount) * 100)}% of active SKUs`}
        />
        <KPI
          icon="TrendDown" iconColor="var(--red-text)" iconBg="var(--red-soft)"
          label="Losers" value={fmtNum(losersCount)}
          footer=">20 days, >10 stock"
        />
      </div>

      {/* Aging + Category breakdown + Central WMS */}
      <div className="grid split-2-1" style={{ marginBottom: 14 }}>
        <div className="card">
          <div className="card-header">
            <h3>Stock aging <span className="sub">days on shelf · all SKUs</span></h3>
            <button className="btn ghost sm">View report</button>
          </div>
          <div className="card-body">
            <Charts.ColumnChart
              data={agingBuckets.map(b => ({ label: b.label, value: b.units, color: b.color }))}
              formatY={(v) => v >= 1000 ? (v / 1000).toFixed(0) + "k" : v}
              height={170}
            />
            <div className="row" style={{ gap: 10, marginTop: 12, fontSize: 11.5, flexWrap: "wrap" }}>
              {agingBuckets.map((b, i) => (
                <div className="row" key={i} style={{ gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: b.color }}></span>
                  <span className="muted">{b.label}</span>
                  <span className="tabular" style={{ fontWeight: 500 }}>{fmtNum(b.units)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3>By category</h3></div>
          <div className="card-body">
            <Charts.Donut
              data={inventoryByCategory.map(c => ({ name: c.name, value: c.units, color: c.color, formatted: fmtNum(c.units) }))}
              centerLabel="Units" centerValue={fmtNum(inventoryByCategory.reduce((s, c) => s + c.units, 0))}
              size={130} strokeWidth={20}
            />
          </div>
        </div>
      </div>

      {/* WMS pool */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-header">
          <h3><I.Warehouse size={14} /> Central WMS pool</h3>
          <span className="sub">Master pool feeding all 3 stores</span>
        </div>
        <div className="card-body" style={{ paddingTop: 12 }}>
          <div className="grid cols-6">
            <KPI label="Central SKUs" value={fmtNum(1284)} icon="Layers" iconColor="var(--primary-text)" iconBg="var(--primary-soft)" footer="Master variants" />
            <KPI label="Total available" value={fmtNum(18420)} icon="Cart" iconColor="var(--green-text)" iconBg="var(--green-soft)" footer="Sellable" />
            <KPI label="Reserved" value={fmtNum(2840)} icon="Clock" iconColor="var(--amber-text)" iconBg="var(--amber-soft)" />
            <KPI label="Net available" value={fmtNum(15580)} icon="TrendUp" iconColor="var(--violet-text)" iconBg="var(--violet-soft)" />
            <KPI label="In transit" value={fmtNum(1840)} icon="Truck" iconColor="var(--cyan-text)" iconBg="var(--cyan-soft)" />
            <KPI label="Central value" value={fmtGBP(1142800)} icon="Pound" iconColor="var(--green-text)" iconBg="var(--green-soft)" footer="At base prices" />
          </div>
        </div>
      </div>

      {/* Losers + Replenishment + Expiry */}
      <div className="grid split-2-1" style={{ marginBottom: 14 }}>
        <div className="card">
          <div className="card-header">
            <h3><I.TrendDown size={14} /> Shelf life of losers <span className="sub">{losers.length} products</span></h3>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn sm">Mark for promo</button>
              <button className="btn sm"><I.Eye size={13} /> Review &amp; export</button>
            </div>
          </div>
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Vendor</th>
                  <th>Collection</th>
                  <th className="num">Stock</th>
                  <th className="num">Days old</th>
                  <th className="num">Price</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {losers.slice(0, 6).map(l => (
                  <tr key={l.id}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{l.name}</div>
                      <div className="mono muted" style={{ fontSize: 11 }}>{l.sku}</div>
                    </td>
                    <td className="muted">{l.vendor}</td>
                    <td><span className="badge">{l.collection}</span></td>
                    <td className="num">{l.stock}</td>
                    <td className="num">
                      <span className={"badge " + (l.days > 60 ? "red" : "amber")}>{l.days}d</span>
                    </td>
                    <td className="num">£{l.price} <span className="muted" style={{ textDecoration: "line-through", marginLeft: 3 }}>£{l.compare}</span></td>
                    <td><button className="icon-btn"><I.More size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="col" style={{ gap: 14 }}>
          <div className="card">
            <div className="card-header"><h3><I.Truck size={14} /> Replenishment queue</h3><span className="sub">{replenishmentQueue.length}</span></div>
            <div className="list">
              {replenishmentQueue.slice(0, 4).map(r => (
                <div className="list-row" key={r.sku}>
                  <div className="thumb"><I.Package size={14} /></div>
                  <div className="meta">
                    <div className="title">{r.name}</div>
                    <div className="sub">{r.vendor}</div>
                  </div>
                  <span className={"badge " + (r.urgency === "High" ? "red" : r.urgency === "Medium" ? "amber" : "")}>{r.urgency}</span>
                  <span className="num" style={{ fontWeight: 500, minWidth: 50, textAlign: "right" }}>{r.suggested}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h3><I.Clock size={14} /> Expiring within 30 days</h3></div>
            <div className="list">
              {expiringSoon.map(e => (
                <div className="list-row" key={e.sku}>
                  <div className="thumb" style={{ background: "var(--amber-soft)", color: "var(--amber-text)", borderColor: "transparent" }}><I.Alert size={14} stroke={2} /></div>
                  <div className="meta">
                    <div className="title">{e.name}</div>
                    <div className="sub mono">{e.sku}</div>
                  </div>
                  <span className="num" style={{ fontWeight: 500 }}>{e.units} u.</span>
                  <span className="badge amber">{e.days}d</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ----- Combined Dashboard page -----
const Dashboard = () => {
  const [range, setRange] = React.useState("MTD");
  return (
    <div className="content">
      <AlertStrip />
      <div style={{ height: 18 }}></div>
      <SalesSection range={range} setRange={setRange} />
      <div style={{ height: 8, marginTop: 28, marginBottom: 12, borderTop: "1px dashed var(--border)" }}></div>
      <InventorySection />
    </div>
  );
};

window.Dashboard = Dashboard;
