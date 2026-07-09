import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Sun, Moon } from "lucide-react";

// 8-point star (R=14, r=5.8) in an 80×80 tile — precomputed
const S_CTR = "40,26 42.22,34.64 49.90,30.10 45.36,37.78 54,40 45.36,42.22 49.90,49.90 42.22,45.36 40,54 37.78,45.36 30.10,49.90 34.64,42.22 26,40 34.64,37.78 30.10,30.10 37.78,34.64";
const S_TL  = "0,-14 2.22,-5.36 9.90,-9.90 5.36,-2.22 14,0 5.36,2.22 9.90,9.90 2.22,5.36 0,14 -2.22,5.36 -9.90,9.90 -5.36,2.22 -14,0 -5.36,-2.22 -9.90,-9.90 -2.22,-5.36";
const S_TR  = "80,-14 82.22,-5.36 89.90,-9.90 85.36,-2.22 94,0 85.36,2.22 89.90,9.90 82.22,5.36 80,14 77.78,5.36 70.10,9.90 74.64,2.22 66,0 74.64,-2.22 70.10,-9.90 77.78,-5.36";
const S_BL  = "0,66 2.22,74.64 9.90,70.10 5.36,77.78 14,80 5.36,82.22 9.90,89.90 2.22,85.36 0,94 -2.22,85.36 -9.90,89.90 -5.36,82.22 -14,80 -5.36,77.78 -9.90,70.10 -2.22,74.64";
const S_BR  = "80,66 82.22,74.64 89.90,70.10 85.36,77.78 94,80 85.36,82.22 89.90,89.90 82.22,85.36 80,94 77.78,85.36 70.10,89.90 74.64,82.22 66,80 74.64,77.78 70.10,70.10 77.78,74.64";

// Oversized at 160% with -30% offset so corners stay covered during rotation
function IslamicPattern({ id, color, fillOpacity, strokeOpacity, animate = false }: {
  id: string; color: string; fillOpacity: number; strokeOpacity: number; animate?: boolean;
}) {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      style={{
        position: "absolute",
        width: animate ? "160%" : "100%",
        height: animate ? "160%" : "100%",
        top: animate ? "-30%" : 0,
        left: animate ? "-30%" : 0,
        pointerEvents: "none",
        transformOrigin: "50% 50%",
        animation: animate ? "islamic-rotate 120s linear infinite" : undefined,
      }}
    >
      <defs>
        <pattern id={id} x="0" y="0" width="80" height="80" patternUnits="userSpaceOnUse">
          {[S_CTR, S_TL, S_TR, S_BL, S_BR].map((pts, i) => (
            <polygon key={i} points={pts} fill={color} fillOpacity={fillOpacity} />
          ))}
          {[S_CTR, S_TL, S_TR, S_BL, S_BR].map((pts, i) => (
            <polygon key={`o${i}`} points={pts} fill="none" stroke={color} strokeWidth="0.7" strokeOpacity={strokeOpacity} />
          ))}
          <line x1="30.10" y1="30.10" x2="9.90"  y2="9.90"  stroke={color} strokeWidth="0.5" strokeOpacity={strokeOpacity * 0.75} />
          <line x1="49.90" y1="30.10" x2="70.10" y2="9.90"  stroke={color} strokeWidth="0.5" strokeOpacity={strokeOpacity * 0.75} />
          <line x1="49.90" y1="49.90" x2="70.10" y2="70.10" stroke={color} strokeWidth="0.5" strokeOpacity={strokeOpacity * 0.75} />
          <line x1="30.10" y1="49.90" x2="9.90"  y2="70.10" stroke={color} strokeWidth="0.5" strokeOpacity={strokeOpacity * 0.75} />
          <line x1="40" y1="26" x2="40" y2="0"   stroke={color} strokeWidth="0.5" strokeOpacity={strokeOpacity * 0.75} />
          <line x1="54" y1="40" x2="80" y2="40"  stroke={color} strokeWidth="0.5" strokeOpacity={strokeOpacity * 0.75} />
          <line x1="40" y1="54" x2="40" y2="80"  stroke={color} strokeWidth="0.5" strokeOpacity={strokeOpacity * 0.75} />
          <line x1="26" y1="40" x2="0"  y2="40"  stroke={color} strokeWidth="0.5" strokeOpacity={strokeOpacity * 0.75} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

// Mosque silhouette watermark — viewBox 1000×240, scaled to bottom of panel
function MosqueSilhouette({ color, opacity }: { color: string; opacity: number }) {
  // Main body + 3 arch cutouts combined with evenodd for transparent windows
  const bodyPath = [
    "M 80,165 L 80,240 L 920,240 L 920,165 Z",
    "M 478,240 L 478,196 C 478,179 487,168 500,168 C 513,168 522,179 522,196 L 522,240 Z",
    "M 295,240 L 295,198 C 295,183 302,175 312,175 C 322,175 329,183 329,198 L 329,240 Z",
    "M 671,240 L 671,198 C 671,183 678,175 688,175 C 698,175 705,183 705,198 L 705,240 Z",
  ].join(" ");

  return (
    <svg
      viewBox="0 0 1000 240"
      preserveAspectRatio="xMidYMax meet"
      aria-hidden="true"
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        width: "100%",
        height: "32%",
        pointerEvents: "none",
        zIndex: 2,
      }}
    >
      <g fill={color} fillOpacity={opacity}>
        {/* Left main minaret + balcony */}
        <path d="M99,240 L99,75 C99,58 104,42 110,38 C116,42 121,58 121,75 L121,240 Z" />
        <rect x="95" y="100" width="30" height="5" rx="1" />

        {/* Right main minaret + balcony */}
        <path d="M879,240 L879,75 C879,58 884,42 890,38 C896,42 901,58 901,75 L901,240 Z" />
        <rect x="875" y="100" width="30" height="5" rx="1" />

        {/* Left secondary minaret + balcony */}
        <path d="M222,240 L222,115 C222,102 226,90 230,85 C234,90 238,102 238,115 L238,240 Z" />
        <rect x="219" y="133" width="22" height="4" rx="1" />

        {/* Right secondary minaret + balcony */}
        <path d="M762,240 L762,115 C762,102 766,90 770,85 C774,90 778,102 778,115 L778,240 Z" />
        <rect x="759" y="133" width="22" height="4" rx="1" />

        {/* Left flanking dome */}
        <path d="M200,165 C188,145 193,120 220,118 C247,120 255,145 242,165 Z" />

        {/* Right flanking dome */}
        <path d="M758,165 C745,145 753,120 780,118 C807,120 812,145 800,165 Z" />

        {/* Main dome drum */}
        <rect x="460" y="130" width="80" height="35" />

        {/* Main dome — tall onion silhouette */}
        <path d="M398,130 C372,112 380,62 500,38 C620,62 628,112 602,130 Z" />

        {/* Finial rod */}
        <rect x="499" y="24" width="2" height="14" />

        {/* Finial 5-point star (precomputed: center 500,16 R=9 r=3.7) */}
        <polygon points="500,7 502.18,13.01 508.56,13.22 503.52,17.14 505.29,23.28 500,19.7 494.71,23.28 496.48,17.14 491.44,13.22 497.82,13.01" />

        {/* Main body wall with arch-door + side windows punched out via evenodd */}
        <path fillRule="evenodd" d={bodyPath} />

        {/* Ground base */}
        <rect x="0" y="236" width="1000" height="4" />
      </g>
    </svg>
  );
}

function StarIcon({ size = 10, color = "#c9a84c", opacity = 1 }: { size?: number; color?: string; opacity?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" style={{ opacity }}>
      <polygon points="8,0.5 9.6,5.8 15.5,5.8 10.9,9.2 12.7,15 8,11.5 3.3,15 5.1,9.2 0.5,5.8 6.4,5.8" fill={color} />
    </svg>
  );
}

export default function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Amiri&display=swap";
    document.head.appendChild(link);
    return () => document.head.removeChild(link);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await signIn(email, password);
    setLoading(false);
    if (error) { setError(error); return; }
    navigate("/dashboard", { replace: true });
  }

  const dark = {
    panel:  "linear-gradient(160deg, #0e1228 0%, #1a1f3c 55%, #0a0e20 100%)",
    card:   "rgba(14, 18, 46, 0.80)",
    border: "rgba(201, 168, 76, 0.22)",
    shadow: "0 2px 0 rgba(255,255,255,0.04) inset, 0 12px 48px rgba(0,0,0,0.5)",
    title:  "#ffffff",
    sub:    "#8ea8d0",
    label:  "#c8c0b0",
    foot:   "#6a7090",
    input:  { background: "rgba(255,255,255,0.07)", border: "1px solid rgba(201,168,76,0.22)", color: "white" },
    btnShadow: "0 4px 18px rgba(0,0,0,0.5), 0 0 0 1px rgba(201,168,76,0.2)",
    divider:   "rgba(201,168,76,0.18)",
  } as const;

  const light = {
    panel:  "radial-gradient(ellipse at 55% 45%, #fdf9f4 0%, #f2ead8 100%)",
    card:   "rgba(255, 253, 248, 0.80)",
    border: "rgba(190, 155, 80, 0.28)",
    shadow: "0 2px 0 rgba(255,255,255,0.95) inset, 0 12px 48px rgba(160,120,48,0.14)",
    title:  "#1a1f3c",
    sub:    "#7a6e5e",
    label:  "#3d3426",
    foot:   "#9a8878",
    input:  { background: "rgba(255,255,255,0.75)", border: "1px solid rgba(180,145,80,0.35)", color: "#1a1f3c" },
    btnShadow: "0 4px 18px rgba(26,31,60,0.35)",
    divider:   "rgba(180,145,80,0.25)",
  } as const;

  const theme = isDark ? dark : light;

  return (
    <>
      <style>{`@keyframes islamic-rotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      <div className="min-h-screen flex w-full">

        {/* ── Left panel — always dark ──────────────────────────────────── */}
        <div
          className="hidden lg:flex lg:w-1/2 flex-col items-center justify-center p-16 relative overflow-hidden"
          style={{ background: "linear-gradient(160deg, #141830 0%, #1a1f3c 55%, #101428 100%)" }}
        >
          <IslamicPattern id="ip-left" color="#c9a84c" fillOpacity={0.06} strokeOpacity={0.22} animate />

          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: "radial-gradient(ellipse at 50% 50%, transparent 40%, rgba(10,12,30,0.55) 100%)" }}
          />

          {/* Mosque silhouette — renders below z-10 content */}
          <MosqueSilhouette color="white" opacity={0.10} />

          <div className="relative z-10 flex flex-col items-center text-center gap-5">
            <p
              style={{
                fontFamily: "'Amiri', 'Traditional Arabic', 'Arabic Typesetting', serif",
                direction: "rtl",
                fontSize: "1.65rem",
                lineHeight: "2.2rem",
                letterSpacing: "0.04em",
                color: "#d4b87a",
                textShadow: "0 1px 12px rgba(201,168,76,0.35)",
              }}
            >
              بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ
            </p>

            <div className="flex items-center gap-2.5">
              <div className="h-px w-10 bg-gradient-to-r from-transparent to-[#c9a84c] opacity-60" />
              <StarIcon size={9} color="#c9a84c" opacity={0.9} />
              <div className="h-px w-16 bg-[#c9a84c] opacity-50" />
              <StarIcon size={6} color="#c9a84c" opacity={0.6} />
              <div className="h-px w-16 bg-[#c9a84c] opacity-50" />
              <StarIcon size={9} color="#c9a84c" opacity={0.9} />
              <div className="h-px w-10 bg-gradient-to-l from-transparent to-[#c9a84c] opacity-60" />
            </div>

            <img
              src="/darussalam-logo.png"
              alt="Darussalam"
              className="w-44 h-auto mt-1"
              style={{ filter: "drop-shadow(0 4px 24px rgba(201,168,76,0.25))" }}
            />

            <div className="space-y-1.5 mt-1">
              <h1 className="text-[2.4rem] font-bold text-white" style={{ letterSpacing: "0.12em" }}>
                DARUSSALAM
              </h1>
              <p className="text-[#8ea8d0] font-light tracking-widest uppercase text-xs">
                Inventory Management System
              </p>
            </div>

            <div className="flex items-center gap-2 mt-1">
              <div className="h-px w-6 bg-[#c9a84c] opacity-40" />
              <div className="w-1 h-1 rotate-45 bg-[#c9a84c] opacity-70" />
              <div className="h-px w-24 bg-[#c9a84c] opacity-60" />
              <div className="w-1.5 h-1.5 rotate-45 bg-[#c9a84c]" />
              <div className="h-px w-24 bg-[#c9a84c] opacity-60" />
              <div className="w-1 h-1 rotate-45 bg-[#c9a84c] opacity-70" />
              <div className="h-px w-6 bg-[#c9a84c] opacity-40" />
            </div>

            <p className="text-[#6a85b0] text-sm max-w-[260px] leading-relaxed mt-1">
              Real-time inventory intelligence for smarter stock decisions.
            </p>
          </div>
        </div>

        {/* ── Right panel — light / dark ─────────────────────────────────── */}
        <div
          className="w-full lg:w-1/2 flex items-center justify-center relative overflow-hidden p-8"
          style={{ background: theme.panel, transition: "background 0.6s ease" }}
        >
          <IslamicPattern
            id="ip-right"
            color={isDark ? "#c9a84c" : "#a07830"}
            fillOpacity={isDark ? 0.08 : 0.05}
            strokeOpacity={isDark ? 0.24 : 0.14}
            animate
          />

          {isDark && (
            <div
              className="absolute inset-0 pointer-events-none"
              style={{ background: "radial-gradient(ellipse at 50% 50%, transparent 40%, rgba(10,12,30,0.5) 100%)" }}
            />
          )}

          {/* Light / Dark toggle */}
          <button
            onClick={() => setIsDark(d => !d)}
            className="absolute top-5 right-5 z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium"
            style={{
              background: isDark ? "rgba(201,168,76,0.12)" : "rgba(26,31,60,0.07)",
              border: `1px solid ${isDark ? "rgba(201,168,76,0.4)" : "rgba(26,31,60,0.18)"}`,
              color: isDark ? "#d4b87a" : "#4a4030",
              backdropFilter: "blur(10px)",
              transition: "all 0.3s ease",
            }}
          >
            {isDark ? <><Sun className="h-3.5 w-3.5" /> Light</> : <><Moon className="h-3.5 w-3.5" /> Dark</>}
          </button>

          {/* Frosted glass card */}
          <div
            className="relative z-10 w-full max-w-md"
            style={{
              background: theme.card,
              backdropFilter: "blur(22px) saturate(160%)",
              WebkitBackdropFilter: "blur(22px) saturate(160%)",
              border: `1px solid ${theme.border}`,
              borderRadius: "22px",
              padding: "48px 44px 44px",
              boxShadow: theme.shadow,
              transition: "background 0.5s ease, border-color 0.5s ease, box-shadow 0.5s ease",
            }}
          >
            {/* Gold accent bar */}
            <div
              className="absolute top-0 left-8 right-8 h-px"
              style={{ background: "linear-gradient(90deg, transparent, rgba(201,168,76,0.6) 30%, rgba(201,168,76,0.6) 70%, transparent)" }}
            />

            {/* Mobile logo */}
            <div className="flex lg:hidden flex-col items-center gap-3 mb-7">
              <img src="/darussalam-logo.png" alt="Darussalam" className="w-16 h-auto" />
              <p style={{ fontFamily: "'Amiri', 'Traditional Arabic', serif", direction: "rtl", color: "#c9a84c", fontSize: "1.1rem" }}>
                بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ
              </p>
            </div>

            {/* Heading */}
            <div className="mb-8">
              <h2 className="text-[1.75rem] font-bold tracking-tight" style={{ color: theme.title, transition: "color 0.4s" }}>
                Welcome back
              </h2>
              <p className="mt-1.5 text-sm" style={{ color: theme.sub, transition: "color 0.4s" }}>
                Sign in to access your dashboard
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-sm font-medium" style={{ color: theme.label, transition: "color 0.4s" }}>
                  Email address
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoFocus
                  className="h-11 rounded-xl"
                  style={{ ...theme.input, transition: "background 0.4s, border-color 0.4s, color 0.4s" }}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-sm font-medium" style={{ color: theme.label, transition: "color 0.4s" }}>
                  Password
                </Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  className="h-11 rounded-xl"
                  style={{ ...theme.input, transition: "background 0.4s, border-color 0.4s, color 0.4s" }}
                />
              </div>

              {error && (
                <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3">
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              <Button
                type="submit"
                className="w-full h-11 text-white font-semibold text-sm rounded-xl transition-all mt-1"
                style={{
                  background: "linear-gradient(135deg, #1a1f3c 0%, #252d58 100%)",
                  boxShadow: theme.btnShadow,
                  border: "1px solid rgba(201,168,76,0.25)",
                }}
                disabled={loading}
              >
                {loading
                  ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Signing in…</>
                  : "Sign in"
                }
              </Button>
            </form>

            {/* Footer ornament */}
            <div className="mt-8 flex items-center gap-2">
              <div className="h-px flex-1" style={{ background: theme.divider, transition: "background 0.4s" }} />
              <StarIcon size={8} color="#c9a84c" opacity={isDark ? 0.6 : 0.45} />
              <div className="h-px flex-1" style={{ background: theme.divider, transition: "background 0.4s" }} />
            </div>
            <p className="mt-3 text-center text-xs" style={{ color: theme.foot, transition: "color 0.4s" }}>
              Access is restricted to authorised personnel only.
            </p>
          </div>
        </div>

      </div>
    </>
  );
}
