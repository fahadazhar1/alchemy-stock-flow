/* global React */
// SVG chart primitives — hand-drawn, lightweight, theme-aware via currentColor

function useElementWidth(ref, fallback = 600) {
  const [w, setW] = React.useState(fallback);
  React.useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

// ----- Sparkline -----
function Sparkline({ data, w = 80, h = 28, color = "var(--primary)", fill = true }) {
  if (!data || data.length === 0) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * h * 0.8 - h * 0.1;
    return [x, y];
  });
  const path = "M " + points.map(p => p.join(",")).join(" L ");
  const area = path + ` L ${w},${h} L 0,${h} Z`;
  const id = "sg" + Math.random().toString(36).slice(2, 7);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#${id})`} />}
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ----- Area+Line trend chart -----
function TrendChart({ data, height = 220, color = "var(--primary)", color2 = "var(--violet)", showSecondary = false, secondaryKey = "orders", primaryKey = "revenue", labelKey = "label", formatY = (v) => v }) {
  const ref = React.useRef(null);
  const W = useElementWidth(ref, 700);
  const H = height;
  const padL = 44, padR = 12, padT = 16, padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const ys = data.map(d => d[primaryKey]);
  const yMax = Math.max(...ys) * 1.1;
  const yMin = 0;
  const xStep = innerW / (data.length - 1);

  const ys2 = data.map(d => d[secondaryKey] || 0);
  const yMax2 = Math.max(...ys2) * 1.2 || 1;

  const toX = (i) => padL + i * xStep;
  const toY = (v) => padT + innerH - ((v - yMin) / (yMax - yMin || 1)) * innerH;
  const toY2 = (v) => padT + innerH - (v / yMax2) * innerH;

  const linePath = data.map((d, i) => `${i ? "L" : "M"} ${toX(i)} ${toY(d[primaryKey])}`).join(" ");
  const areaPath = linePath + ` L ${toX(data.length - 1)} ${padT + innerH} L ${padL} ${padT + innerH} Z`;
  const linePath2 = data.map((d, i) => `${i ? "L" : "M"} ${toX(i)} ${toY2(d[secondaryKey])}`).join(" ");

  // Y ticks
  const ticks = 4;
  const tickValues = Array.from({ length: ticks + 1 }, (_, i) => yMin + ((yMax - yMin) * i) / ticks);

  const [hover, setHover] = React.useState(null);
  const handleMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - padL;
    const i = Math.round(x / xStep);
    if (i >= 0 && i < data.length) setHover(i);
  };

  return (
    <div ref={ref} style={{ width: "100%", position: "relative" }}>
      <svg width={W} height={H} style={{ display: "block" }} onMouseMove={handleMove} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.18" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {tickValues.map((v, i) => (
          <g key={i}>
            <line x1={padL} y1={toY(v)} x2={W - padR} y2={toY(v)} stroke="var(--border)" strokeWidth="1" strokeDasharray={i === 0 ? "0" : "3,3"} />
            <text x={padL - 8} y={toY(v) + 3} textAnchor="end" fontSize="10" fill="var(--text-faint)">{formatY(Math.round(v))}</text>
          </g>
        ))}
        {data.map((d, i) => {
          if (i % Math.ceil(data.length / 8) !== 0 && i !== data.length - 1) return null;
          return <text key={i} x={toX(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--text-faint)">{d[labelKey]}</text>;
        })}
        <path d={areaPath} fill="url(#trendGrad)" />
        <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {showSecondary && (
          <path d={linePath2} fill="none" stroke={color2} strokeWidth="1.5" strokeDasharray="4,3" />
        )}
        {hover != null && (
          <g>
            <line x1={toX(hover)} y1={padT} x2={toX(hover)} y2={padT + innerH} stroke="var(--text-faint)" strokeWidth="1" strokeDasharray="3,3" />
            <circle cx={toX(hover)} cy={toY(data[hover][primaryKey])} r="4" fill={color} stroke="var(--bg-elev)" strokeWidth="2" />
            {showSecondary && <circle cx={toX(hover)} cy={toY2(data[hover][secondaryKey])} r="3" fill={color2} stroke="var(--bg-elev)" strokeWidth="2" />}
          </g>
        )}
      </svg>
      {hover != null && (
        <div style={{
          position: "absolute",
          left: Math.min(W - 180, Math.max(0, toX(hover) - 80)),
          top: 4,
          background: "var(--bg-elev)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: "6px 10px",
          fontSize: 11.5,
          boxShadow: "var(--shadow-lg)",
          pointerEvents: "none",
          minWidth: 140,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>{data[hover][labelKey]}</div>
          <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-muted)" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: color }}></span>Revenue
            </span>
            <span className="tabular" style={{ color: "var(--text)", fontWeight: 500 }}>{formatY(data[hover][primaryKey])}</span>
          </div>
          {showSecondary && (
            <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-muted)" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: color2 }}></span>Orders
              </span>
              <span className="tabular" style={{ color: "var(--text)", fontWeight: 500 }}>{data[hover][secondaryKey]}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ----- Donut chart -----
function Donut({ data, size = 160, strokeWidth = 22, centerLabel, centerValue, showLegend = true }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const radius = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
      <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
          <circle cx={cx} cy={cy} r={radius} fill="none" stroke="var(--bg-subtle)" strokeWidth={strokeWidth} />
          {data.map((d, i) => {
            const len = (d.value / total) * circumference;
            const seg = (
              <circle
                key={i}
                cx={cx}
                cy={cy}
                r={radius}
                fill="none"
                stroke={d.color}
                strokeWidth={strokeWidth}
                strokeDasharray={`${len} ${circumference - len}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
              />
            );
            offset += len;
            return seg;
          })}
        </svg>
        <div style={{
          position: "absolute", inset: 0, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", textAlign: "center",
        }}>
          <div style={{ fontSize: 10, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>{centerLabel}</div>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em", marginTop: 2 }} className="tabular">{centerValue}</div>
        </div>
      </div>
      {showLegend && (
        <div className="legend" style={{ flex: 1, minWidth: 0 }}>
          {data.map((d, i) => (
            <div className="legend-row" key={i}>
              <span className="legend-dot" style={{ background: d.color }}></span>
              <span className="lbl truncate">{d.label || d.name}</span>
              <span className="val">{d.formatted || d.value.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ----- Bar list (horizontal bars) -----
function BarList({ items, valueLabel = "value", color = "var(--primary)", formatValue = (v) => v.toLocaleString() }) {
  const max = Math.max(...items.map(x => x.value));
  return (
    <div>
      {items.map((it, i) => {
        const pct = (it.value / max) * 100;
        return (
          <div className="bar-row" key={i}>
            <div className="lbl truncate">{it.label}</div>
            <div className="bar-track"><div className="bar-fill" style={{ width: pct + "%", background: it.color || color }}></div></div>
            <div className="val">{formatValue(it.value)}</div>
          </div>
        );
      })}
    </div>
  );
}

// ----- Stacked horizontal bar (for new vs returning, etc.) -----
function StackedBar({ segments, height = 10, showLabels = false }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  return (
    <div>
      <div style={{ display: "flex", height, borderRadius: 999, overflow: "hidden", background: "var(--bg-subtle)" }}>
        {segments.map((s, i) => (
          <div key={i} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} title={`${s.label}: ${s.value}`}></div>
        ))}
      </div>
      {showLabels && (
        <div style={{ display: "flex", gap: 14, marginTop: 8, fontSize: 11.5 }}>
          {segments.map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color }}></span>
              <span style={{ color: "var(--text)" }}>{s.label}</span>
              <span style={{ color: "var(--text-muted)" }} className="tabular">{((s.value / total) * 100).toFixed(0)}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ----- Vertical bar chart -----
function ColumnChart({ data, height = 180, color = "var(--primary)", formatY = (v) => v }) {
  const ref = React.useRef(null);
  const W = useElementWidth(ref, 600);
  const H = height;
  const padL = 36, padR = 8, padT = 12, padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const max = Math.max(...data.map(d => d.value)) * 1.15 || 1;
  const barW = (innerW / data.length) * 0.62;
  const gap = (innerW / data.length) - barW;

  const ticks = 3;
  const tickValues = Array.from({ length: ticks + 1 }, (_, i) => (max * i) / ticks);

  return (
    <div ref={ref} style={{ width: "100%" }}>
      <svg width={W} height={H} style={{ display: "block" }}>
        {tickValues.map((v, i) => {
          const y = padT + innerH - (v / max) * innerH;
          return (
            <g key={i}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="var(--border)" strokeDasharray={i === 0 ? "0" : "3,3"} />
              <text x={padL - 6} y={y + 3} textAnchor="end" fontSize="10" fill="var(--text-faint)">{formatY(Math.round(v))}</text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const h = (d.value / max) * innerH;
          const x = padL + i * (innerW / data.length) + gap / 2;
          const y = padT + innerH - h;
          return (
            <g key={i}>
              <rect x={x} y={y} width={barW} height={h} rx="3" fill={d.color || color} opacity="0.92" />
              <text x={x + barW / 2} y={H - 10} textAnchor="middle" fontSize="10" fill="var(--text-faint)">{d.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ----- Gauge for sell-through -----
function Gauge({ value, max = 100, label, size = 140, color = "var(--primary)", subtext }) {
  const pct = Math.min(1, value / max);
  const r = size / 2 - 14;
  const cx = size / 2;
  const cy = size / 2 + 8;
  const circ = Math.PI * r; // semicircle
  const dash = pct * circ;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <svg width={size} height={size * 0.65}>
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke="var(--bg-subtle)" strokeWidth="14" strokeLinecap="round" />
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke={color} strokeWidth="14" strokeLinecap="round" strokeDasharray={`${dash} ${circ}`} />
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize="22" fontWeight="600" fill="var(--text)" style={{ letterSpacing: "-0.02em" }}>{value.toFixed(1)}%</text>
        <text x={cx} y={cy + 10} textAnchor="middle" fontSize="10" fill="var(--text-muted)">{subtext || ""}</text>
      </svg>
      {label && <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{label}</div>}
    </div>
  );
}

window.Charts = { Sparkline, TrendChart, Donut, BarList, StackedBar, ColumnChart, Gauge };
