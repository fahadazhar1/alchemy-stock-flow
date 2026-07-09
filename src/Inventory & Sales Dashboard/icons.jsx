/* global React */
// Lucide-style icons. Stroke 1.75 for crisp command-center feel.
const Icon = ({ d, size = 16, stroke = 1.75, fill = "none", children, ...props }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={fill}
    stroke="currentColor"
    strokeWidth={stroke}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    {d ? <path d={d} /> : children}
  </svg>
);

const I = {
  Dashboard: (p) => <Icon {...p}><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></Icon>,
  Package: (p) => <Icon {...p}><path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3.27 8.5 12 13l8.73-4.5"/><path d="M12 22V13"/></Icon>,
  Cart: (p) => <Icon {...p}><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h2.5l3 13.5h12L22 7H6"/></Icon>,
  Tag: (p) => <Icon {...p}><path d="M12.6 2.7 21 11.1c.5.5.5 1.3 0 1.8l-7.5 7.5c-.5.5-1.3.5-1.8 0L3.3 12c-.2-.2-.3-.4-.3-.7V4c0-.6.4-1 1-1h7.6c.3 0 .5.1.7.3z"/><circle cx="8" cy="8" r="1.2"/></Icon>,
  Megaphone: (p) => <Icon {...p}><path d="M3 11v2a1 1 0 0 0 1 1h1l3 6h2l-2-6h2l8 4V5L9 9H4a1 1 0 0 0-1 1z"/></Icon>,
  Reports: (p) => <Icon {...p}><path d="M3 3v18h18"/><path d="M7 14l4-4 3 3 6-7"/></Icon>,
  Warehouse: (p) => <Icon {...p}><path d="M3 9 12 4l9 5v11H3z"/><path d="M7 13h10v7H7z"/><path d="M7 17h10"/></Icon>,
  Truck: (p) => <Icon {...p}><path d="M3 7h11v10H3z"/><path d="M14 10h4l3 3v4h-7"/><circle cx="7" cy="18" r="1.5"/><circle cx="17" cy="18" r="1.5"/></Icon>,
  Settings: (p) => <Icon {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></Icon>,
  Help: (p) => <Icon {...p}><circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></Icon>,
  Search: (p) => <Icon {...p}><circle cx="11" cy="11" r="7"/><path d="m20 20-4.3-4.3"/></Icon>,
  Calendar: (p) => <Icon {...p}><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></Icon>,
  Download: (p) => <Icon {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></Icon>,
  Upload: (p) => <Icon {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/></Icon>,
  Plus: (p) => <Icon {...p}><path d="M5 12h14M12 5v14"/></Icon>,
  Filter: (p) => <Icon {...p}><path d="M3 6h18M6 12h12M10 18h4"/></Icon>,
  Refresh: (p) => <Icon {...p}><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></Icon>,
  More: (p) => <Icon {...p}><circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/></Icon>,
  X: (p) => <Icon {...p}><path d="M18 6 6 18M6 6l12 12"/></Icon>,
  Check: (p) => <Icon {...p}><path d="m20 6-11 11-5-5"/></Icon>,
  Chevron: (p) => <Icon {...p}><path d="m9 18 6-6-6-6"/></Icon>,
  ChevronDown: (p) => <Icon {...p}><path d="m6 9 6 6 6-6"/></Icon>,
  ChevronRight: (p) => <Icon {...p}><path d="m9 18 6-6-6-6"/></Icon>,
  ArrowUp: (p) => <Icon {...p}><path d="M12 19V5M5 12l7-7 7 7"/></Icon>,
  ArrowDown: (p) => <Icon {...p}><path d="M12 5v14M19 12l-7 7-7-7"/></Icon>,
  TrendUp: (p) => <Icon {...p}><path d="M22 7 13.5 15.5 8.5 10.5 2 17"/><path d="M16 7h6v6"/></Icon>,
  TrendDown: (p) => <Icon {...p}><path d="M22 17 13.5 8.5 8.5 13.5 2 7"/><path d="M16 17h6v-6"/></Icon>,
  Alert: (p) => <Icon {...p}><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></Icon>,
  Clock: (p) => <Icon {...p}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></Icon>,
  Dollar: (p) => <Icon {...p}><path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></Icon>,
  Pound: (p) => <Icon {...p}><path d="M18 7c0-2.5-2-4-4.5-4S9 4.5 9 7v3H6v3h3v3a3 3 0 0 1-3 3h12"/><path d="M9 13h6"/></Icon>,
  Boxes: (p) => <Icon {...p}><path d="M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 1.03 1.71l3 1.71a2 2 0 0 0 1.94 0L11 19.5"/><path d="M2.32 13.07a2 2 0 0 0 .65 2.71L7 17.5l4-2.27"/><path d="M21.03 12.92A2 2 0 0 1 22 14.63v3.24a2 2 0 0 1-1.03 1.71l-3 1.71a2 2 0 0 1-1.94 0L13 19.5"/><path d="M21.68 13.07a2 2 0 0 1-.65 2.71L17 17.5l-4-2.27"/><path d="M11 4.32 8.97 5.46a2 2 0 0 0-1 1.71v3.24a2 2 0 0 0 1.03 1.71l3 1.71a2 2 0 0 0 1.94 0l3-1.71a2 2 0 0 0 1.03-1.71V7.17a2 2 0 0 0-1-1.71L13 4.32a2 2 0 0 0-2 0z"/></Icon>,
  Award: (p) => <Icon {...p}><circle cx="12" cy="9" r="6"/><path d="m9 14-1.7 7L12 18l4.7 3L15 14"/></Icon>,
  Bot: (p) => <Icon {...p}><rect x="3" y="8" width="18" height="12" rx="2"/><path d="M12 4v4M9 12h.01M15 12h.01M9 16h6"/></Icon>,
  Sparkles: (p) => <Icon {...p}><path d="M9.94 14.34 12 22l2.06-7.66L22 12l-7.94-2.34L12 2l-2.06 7.66L2 12z"/></Icon>,
  Layout: (p) => <Icon {...p}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></Icon>,
  Pin: (p) => <Icon {...p}><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></Icon>,
  Bell: (p) => <Icon {...p}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></Icon>,
  Sun: (p) => <Icon {...p}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></Icon>,
  Moon: (p) => <Icon {...p}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></Icon>,
  Eye: (p) => <Icon {...p}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></Icon>,
  Edit: (p) => <Icon {...p}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="m18.5 2.5 3 3L12 15l-4 1 1-4 9.5-9.5z"/></Icon>,
  Copy: (p) => <Icon {...p}><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></Icon>,
  Trash: (p) => <Icon {...p}><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></Icon>,
  Sliders: (p) => <Icon {...p}><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M2 14h4M10 8h4M18 16h4"/></Icon>,
  Globe: (p) => <Icon {...p}><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></Icon>,
  Smartphone: (p) => <Icon {...p}><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/></Icon>,
  Store: (p) => <Icon {...p}><path d="M3 9h18l-2-5H5z"/><path d="M5 9v11h14V9"/><path d="M9 20v-6h6v6"/></Icon>,
  Users: (p) => <Icon {...p}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></Icon>,
  User: (p) => <Icon {...p}><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></Icon>,
  Mail: (p) => <Icon {...p}><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 6 10 7 10-7"/></Icon>,
  MapPin: (p) => <Icon {...p}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></Icon>,
  Layers: (p) => <Icon {...p}><path d="m12 2 9 5-9 5-9-5 9-5z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/></Icon>,
  PieChart: (p) => <Icon {...p}><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></Icon>,
  BarChart: (p) => <Icon {...p}><path d="M3 3v18h18"/><rect x="7" y="11" width="3" height="7"/><rect x="12" y="7" width="3" height="11"/><rect x="17" y="13" width="3" height="5"/></Icon>,
  Table: (p) => <Icon {...p}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></Icon>,
  Activity: (p) => <Icon {...p}><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></Icon>,
  Zap: (p) => <Icon {...p}><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></Icon>,
  Send: (p) => <Icon {...p}><path d="M22 2 11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></Icon>,
  CheckCircle: (p) => <Icon {...p}><circle cx="12" cy="12" r="9"/><path d="m9 12 2 2 4-4"/></Icon>,
  XCircle: (p) => <Icon {...p}><circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/></Icon>,
  Pause: (p) => <Icon {...p}><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></Icon>,
  Play: (p) => <Icon {...p}><polygon points="6 3 20 12 6 21 6 3"/></Icon>,
  CreditCard: (p) => <Icon {...p}><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></Icon>,
  Building: (p) => <Icon {...p}><rect x="4" y="2" width="16" height="20" rx="1"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M8 10h.01M16 10h.01M12 10h.01M8 14h.01M16 14h.01M12 14h.01"/></Icon>,
  Star: (p) => <Icon {...p}><polygon points="12 2 15 9 22 9.3 17 14.1 18.5 21 12 17.3 5.5 21 7 14.1 2 9.3 9 9"/></Icon>,
  Save: (p) => <Icon {...p}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/></Icon>,
  Share: (p) => <Icon {...p}><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="m16 6-4-4-4 4M12 2v13"/></Icon>,
  Link: (p) => <Icon {...p}><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></Icon>,
  Drag: (p) => <Icon {...p}><circle cx="9" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="18" r="1"/></Icon>,
  ColumnChart: (p) => <Icon {...p}><rect x="4" y="14" width="3" height="6"/><rect x="10.5" y="9" width="3" height="11"/><rect x="17" y="4" width="3" height="16"/></Icon>,
  LineChart: (p) => <Icon {...p}><path d="M3 3v18h18"/><path d="m7 16 4-4 3 3 6-7"/></Icon>,
  Hash: (p) => <Icon {...p}><path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/></Icon>,
  Beaker: (p) => <Icon {...p}><path d="M5 3v4l-3 7a4 4 0 0 0 0 4 4 4 0 0 0 0 4h20"/><path d="M19 3v4l3 7"/><path d="M9 3h6"/></Icon>,
  PanelLeft: (p) => <Icon {...p}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/></Icon>,
};

window.I = I;
