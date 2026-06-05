import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

export default function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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

      {/* ── Left panel — branding ─────────────────────────────────────────── */}
      <div className="hidden lg:flex lg:w-1/2 bg-[#1a1f3c] flex-col items-center justify-center p-16 relative overflow-hidden">
        {/* subtle geometric background */}
        <div className="absolute inset-0 opacity-5">
          <div className="absolute top-20 left-20 w-64 h-64 rounded-full border-2 border-white" />
          <div className="absolute bottom-20 right-20 w-48 h-48 rounded-full border-2 border-white" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full border border-white" />
        </div>

        <div className="relative z-10 flex flex-col items-center text-center space-y-8">
          <img
            src="/darussalam-logo.png"
            alt="Darussalam"
            className="w-48 h-auto drop-shadow-2xl"
          />
          <div className="space-y-3">
            <h1 className="text-4xl font-bold text-white tracking-wide">Darussalam</h1>
            <p className="text-blue-200 text-lg font-light">Inventory Management System</p>
          </div>
          <div className="w-16 h-0.5 bg-blue-400 rounded-full" />
          <p className="text-blue-300 text-sm max-w-xs leading-relaxed">
            Real-time inventory intelligence for smarter stock decisions.
          </p>
        </div>
      </div>

      {/* ── Right panel — login form ──────────────────────────────────────── */}
      <div className="w-full lg:w-1/2 flex items-center justify-center bg-gray-50 p-8">
        <div className="w-full max-w-md space-y-8">

          {/* Mobile logo (shown only on small screens) */}
          <div className="flex lg:hidden flex-col items-center gap-3 mb-4">
            <img src="/darussalam-logo.png" alt="Darussalam" className="w-20 h-auto" />
            <h1 className="text-2xl font-bold text-gray-900">Darussalam</h1>
          </div>

          {/* Heading */}
          <div>
            <h2 className="text-3xl font-bold text-gray-900">Welcome back</h2>
            <p className="mt-2 text-sm text-gray-500">Sign in to access your dashboard</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-sm font-medium text-gray-700">
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
                className="h-11 bg-white border-gray-300 focus:border-blue-500 focus:ring-blue-500"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-sm font-medium text-gray-700">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="h-11 bg-white border-gray-300 focus:border-blue-500 focus:ring-blue-500"
              />
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            <Button
              type="submit"
              className="w-full h-11 bg-[#1a1f3c] hover:bg-[#252b52] text-white font-medium text-sm rounded-lg transition-colors"
              disabled={loading}
            >
              {loading
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Signing in…</>
                : "Sign in"
              }
            </Button>
          </form>

          <p className="text-center text-xs text-gray-400">
            Access is restricted to authorised personnel only.
          </p>
        </div>
      </div>

    </div>
  );
}
