import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

// 8-point star (R=14, r=5.8) in an 80×80 tile — precomputed for zero runtime cost
const S_CTR = "40,26 42.22,34.64 49.90,30.10 45.36,37.78 54,40 45.36,42.22 49.90,49.90 42.22,45.36 40,54 37.78,45.36 30.10,49.90 34.64,42.22 26,40 34.64,37.78 30.10,30.10 37.78,34.64";
const S_TL  = "0,-14 2.22,-5.36 9.90,-9.90 5.36,-2.22 14,0 5.36,2.22 9.90,9.90 2.22,5.36 0,14 -2.22,5.36 -9.90,9.90 -5.36,2.22 -14,0 -5.36,-2.22 -9.90,-9.90 -2.22,-5.36";
const S_TR  = "80,-14 82.22,-5.36 89.90,-9.90 85.36,-2.22 94,0 85.36,2.22 89.90,9.90 82.22,5.36 80,14 77.78,5.36 70.10,9.90 74.64,2.22 66,0 74.64,-2.22 70.10,-9.90 77.78,-5.36";
const S_BL  = "0,66 2.22,74.64 9.90,70.10 5.36,77.78 14,80 5.36,82.22 9.90,89.90 2.22,85.36 0,94 -2.22,85.36 -9.90,89.90 -5.36,82.22 -14,80 -5.36,77.78 -9.90,70.10 -2.22,74.64";
const S_BR  = "80,66 82.22,74.64 89.90,70.10 85.36,77.78 94,80 85.36,82.22 89.90,89.90 82.22,85.36 80,94 77.78,85.36 70.10,89.90 74.64,82.22 66,80 74.64,77.78 70.10,70.10 77.78,74.64";

function IslamicPattern({ id, color, fillOpacity, strokeOpacity }: {
  id: string; color: string; fillOpacity: number; strokeOpacity: number;
}) {
  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id={id} x="0" y="0" width="80" height="80" patternUnits="userSpaceOnUse">
          {/* Filled stars */}
          {[S_CTR, S_TL, S_TR, S_BL, S_BR].map((pts, i) => (
            <polygon key={i} points={pts} fill={color} fillOpacity={fillOpacity} />
          ))}
          {/* Star outlines */}
          {[S_CTR, S_TL, S_TR, S_BL, S_BR].map((pts, i) => (
            <polygon key={`s${i}`} points={pts} fill="none" stroke={color} strokeWidth="0.7" strokeOpacity={strokeOpacity} />
          ))}
          {/* Diagonal connectors: center star ↔ each corner star */}
          <line x1="30.10" y1="30.10" x2="9.90"  y2="9.90"  stroke={color} strokeWidth="0.5" strokeOpacity={strokeOpacity * 0.75} />
          <line x1="49.90" y1="30.10" x2="70.10" y2="9.90"  stroke={color} strokeWidth="0.5" strokeOpacity={strokeOpacity * 0.75} />
          <line x1="49.90" y1="49.90" x2="70.10" y2="70.10" stroke={color} strokeWidth="0.5" strokeOpacity={strokeOpacity * 0.75} />
          <line x1="30.10" y1="49.90" x2="9.90"  y2="70.10" stroke={color} strokeWidth="0.5" strokeOpacity={strokeOpacity * 0.75} />
          {/* Cardinal connectors: center star tips → tile edges (join with adjacent tiles) */}
          <line x1="40" y1="26" x2="40" y2="0"  stroke={color} strokeWidth="0.5" strokeOpacity={strokeOpacity * 0.75} />
          <line x1="54" y1="40" x2="80" y2="40" stroke={color} strokeWidth="0.5" strokeOpacity={strokeOpacity * 0.75} />
          <line x1="40" y1="54" x2="40" y2="80" stroke={color} strokeWidth="0.5" strokeOpacity={strokeOpacity * 0.75} />
          <line x1="26" y1="40" x2="0"  y2="40" stroke={color} strokeWidth="0.5" strokeOpacity={strokeOpacity * 0.75} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

// Small 8-point star used as inline ornament
function StarIcon({ size = 10, color = "#c9a84c", opacity = 1 }: { size?: number; color?: string; opacity?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" style={{ opacity }}>
      <polygon
        points="8,0.5 9.6,5.8 15.5,5.8 10.9,9.2 12.7,15 8,11.5 3.3,15 5.1,9.2 0.5,5.8 6.4,5.8"
        fill={color}
      />
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

  return (
    <div className="min-h-screen flex w-full">

      {/* ── Left panel ────────────────────────────────────────────────────── */}
      <div
        className="hidden lg:flex lg:w-1/2 flex-col items-center justify-center p-16 relative overflow-hidden"
        style={{ background: "linear-gradient(160deg, #141830 0%, #1a1f3c 55%, #101428 100%)" }}
      >
        <IslamicPattern id="ip-left" color="#c9a84c" fillOpacity={0.06} strokeOpacity={0.22} />

        {/* Vignette depth overlay */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse at 50% 50%, transparent 40%, rgba(10,12,30,0.55) 100%)" }}
        />

        <div className="relative z-10 flex flex-col items-center text-center gap-5">

          {/* Bismillah */}
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

          {/* Ornamental rule */}
          <div className="flex items-center gap-2.5">
            <div className="h-px w-10 bg-gradient-to-r from-transparent to-[#c9a84c] opacity-60" />
            <StarIcon size={9} color="#c9a84c" opacity={0.9} />
            <div className="h-px w-16 bg-[#c9a84c] opacity-50" />
            <StarIcon size={6} color="#c9a84c" opacity={0.6} />
            <div className="h-px w-16 bg-[#c9a84c] opacity-50" />
            <StarIcon size={9} color="#c9a84c" opacity={0.9} />
            <div className="h-px w-10 bg-gradient-to-l from-transparent to-[#c9a84c] opacity-60" />
          </div>

          {/* Logo */}
          <img
            src="/darussalam-logo.png"
            alt="Darussalam"
            className="w-44 h-auto mt-1"
            style={{ filter: "drop-shadow(0 4px 24px rgba(201,168,76,0.25))" }}
          />

          {/* Brand */}
          <div className="space-y-1.5 mt-1">
            <h1 className="text-[2.4rem] font-bold text-white tracking-wider" style={{ letterSpacing: "0.12em" }}>
              DARUSSALAM
            </h1>
            <p className="text-[#8ea8d0] text-base font-light tracking-widest uppercase text-xs">
              Inventory Management System
            </p>
          </div>

          {/* Gold divider with diamonds */}
          <div className="flex items-center gap-2 mt-1">
            <div className="h-px w-6 bg-[#c9a84c] opacity-40" />
            <div className="w-1 h-1 rotate-45 bg-[#c9a84c] opacity-70" />
            <div className="h-px w-24 bg-gradient-to-r from-[#c9a84c]/60 to-[#c9a84c]/60 opacity-60" />
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

      {/* ── Right panel ───────────────────────────────────────────────────── */}
      <div
        className="w-full lg:w-1/2 flex items-center justify-center relative overflow-hidden p-8"
        style={{ background: "radial-gradient(ellipse at 55% 45%, #fdf9f4 0%, #f2ead8 100%)" }}
      >
        <IslamicPattern id="ip-right" color="#a07830" fillOpacity={0.05} strokeOpacity={0.14} />

        {/* Frosted glass card */}
        <div
          className="relative z-10 w-full max-w-md"
          style={{
            background: "rgba(255, 253, 248, 0.80)",
            backdropFilter: "blur(22px) saturate(160%)",
            WebkitBackdropFilter: "blur(22px) saturate(160%)",
            border: "1px solid rgba(190, 155, 80, 0.28)",
            borderRadius: "22px",
            padding: "48px 44px 44px",
            boxShadow:
              "0 2px 0 rgba(255,255,255,0.95) inset, " +
              "0 12px 48px rgba(160, 120, 48, 0.14), " +
              "0 1px 3px rgba(160, 120, 48, 0.08)",
          }}
        >
          {/* Gold top accent bar */}
          <div
            className="absolute top-0 left-8 right-8 h-px"
            style={{ background: "linear-gradient(90deg, transparent, rgba(201,168,76,0.6) 30%, rgba(201,168,76,0.6) 70%, transparent)" }}
          />

          {/* Mobile logo */}
          <div className="flex lg:hidden flex-col items-center gap-3 mb-7">
            <img src="/darussalam-logo.png" alt="Darussalam" className="w-16 h-auto" />
            <p
              style={{ fontFamily: "'Amiri', 'Traditional Arabic', serif", direction: "rtl", color: "#a07830", fontSize: "1.1rem" }}
            >
              بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ
            </p>
          </div>

          {/* Heading */}
          <div className="mb-8">
            <h2 className="text-[1.75rem] font-bold tracking-tight" style={{ color: "#1a1f3c" }}>
              Welcome back
            </h2>
            <p className="mt-1.5 text-sm" style={{ color: "#7a6e5e" }}>
              Sign in to access your dashboard
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-sm font-medium" style={{ color: "#3d3426" }}>
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
                style={{
                  background: "rgba(255,255,255,0.75)",
                  border: "1px solid rgba(180,145,80,0.35)",
                  color: "#1a1f3c",
                }}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-sm font-medium" style={{ color: "#3d3426" }}>
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
                style={{
                  background: "rgba(255,255,255,0.75)",
                  border: "1px solid rgba(180,145,80,0.35)",
                  color: "#1a1f3c",
                }}
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
                boxShadow: "0 4px 18px rgba(26,31,60,0.35)",
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
            <div className="h-px flex-1" style={{ background: "rgba(180,145,80,0.25)" }} />
            <StarIcon size={8} color="#c9a84c" opacity={0.45} />
            <div className="h-px flex-1" style={{ background: "rgba(180,145,80,0.25)" }} />
          </div>
          <p className="mt-3 text-center text-xs" style={{ color: "#9a8878" }}>
            Access is restricted to authorised personnel only.
          </p>
        </div>
      </div>

    </div>
  );
}
