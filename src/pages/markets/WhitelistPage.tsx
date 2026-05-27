import { useState } from "react";
import { ArrowRight, Loader2, KeyRound } from "lucide-react";
import { redeemWhitelistCode, requestWhitelistAccess } from "../../lib/markets/api";

type Props = {
  account: string;
  onRedeemed: () => void;
};

export default function WhitelistPage({ account, onRedeemed }: Props) {
  const [mode, setMode] = useState<"code" | "request" | "success">("code");
  
  // Code state
  const [code, setCode] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [codeError, setCodeError] = useState("");

  // Request state
  const [form, setForm] = useState({ name: "", email: "", twitter: "" });
  const [isRequesting, setIsRequesting] = useState(false);
  const [requestError, setRequestError] = useState("");

  async function handleCodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    
    setIsVerifying(true);
    setCodeError("");
    try {
      const res = await redeemWhitelistCode(code, account);
      if (res.success) {
        onRedeemed();
      } else {
        setCodeError(res.error || "Invalid or already used code.");
      }
    } catch (err) {
      setCodeError("Failed to verify code. Try again later.");
    } finally {
      setIsVerifying(false);
    }
  }

  async function handleRequestSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) return;
    
    setIsRequesting(true);
    setRequestError("");
    try {
      const res = await requestWhitelistAccess(form);
      if (res.success) {
        setMode("success");
      } else {
        setRequestError(res.message || "Failed to send request.");
      }
    } catch (err) {
      setRequestError("Failed to send request. Try again later.");
    } finally {
      setIsRequesting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--canvas)] p-6">
      <div className="w-full max-w-[440px] rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-8 shadow-xl">
        
        <div className="mb-10 flex flex-col items-center text-center">
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--ink)] text-[color:var(--canvas)]">
            <KeyRound className="h-8 w-8" />
          </div>
          <h1 className="mb-3 font-mono text-[16px] font-semibold tracking-tight text-[var(--ink)]">
            Disburse Markets Beta
          </h1>
          <p className="text-[14px] leading-relaxed text-[var(--muted)]">
            Your wallet (<span className="font-mono">{account.slice(0,6)}…{account.slice(-4)}</span>) is not whitelisted yet. Enter your single-use code to bind it to your wallet.
          </p>
        </div>

        {mode === "code" && (
          <form onSubmit={handleCodeSubmit} className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <label htmlFor="code" className="text-[12px] font-medium text-[var(--muted)]">
                Access Code
              </label>
              <input
                id="code"
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Enter your code"
                className="rounded-md border border-[var(--line)] bg-[var(--input-bg)] px-4 py-3 text-[14px] text-[var(--ink)] placeholder:text-[var(--muted-soft)] focus:border-[var(--ink)] focus:outline-none focus:ring-1 focus:ring-[var(--ink)]"
                autoComplete="off"
                spellCheck="false"
              />
              {codeError && (
                <p className="text-[12px] text-[var(--red-text)]">{codeError}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={!code.trim() || isVerifying}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-[var(--primary-bg)] px-4 py-3 text-[13px] font-medium text-[color:var(--primary-text)] shadow-sm transition-colors hover:bg-[var(--primary-bg-hover)] disabled:opacity-50"
            >
              {isVerifying && <Loader2 className="h-4 w-4 animate-spin" />}
              Enter Market
            </button>

            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => setMode("request")}
                className="text-[13px] text-[var(--muted)] underline-offset-4 hover:text-[var(--ink)] hover:underline"
              >
                Don't have a code? Request access
              </button>
            </div>
          </form>
        )}

        {mode === "request" && (
          <form onSubmit={handleRequestSubmit} className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <label htmlFor="name" className="text-[12px] font-medium text-[var(--muted)]">
                Name
              </label>
              <input
                id="name"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Jane Doe"
                className="rounded-md border border-[var(--line)] bg-[var(--input-bg)] px-4 py-3 text-[14px] text-[var(--ink)] placeholder:text-[var(--muted-soft)] focus:border-[var(--ink)] focus:outline-none focus:ring-1 focus:ring-[var(--ink)]"
              />
            </div>
            
            <div className="flex flex-col gap-2">
              <label htmlFor="email" className="text-[12px] font-medium text-[var(--muted)]">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="jane@example.com"
                className="rounded-md border border-[var(--line)] bg-[var(--input-bg)] px-4 py-3 text-[14px] text-[var(--ink)] placeholder:text-[var(--muted-soft)] focus:border-[var(--ink)] focus:outline-none focus:ring-1 focus:ring-[var(--ink)]"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="twitter" className="text-[12px] font-medium text-[var(--muted)]">
                Twitter / X (Optional)
              </label>
              <input
                id="twitter"
                value={form.twitter}
                onChange={(e) => setForm({ ...form, twitter: e.target.value })}
                placeholder="@username"
                className="rounded-md border border-[var(--line)] bg-[var(--input-bg)] px-4 py-3 text-[14px] text-[var(--ink)] placeholder:text-[var(--muted-soft)] focus:border-[var(--ink)] focus:outline-none focus:ring-1 focus:ring-[var(--ink)]"
              />
            </div>

            {requestError && (
              <p className="text-[12px] text-[var(--red-text)]">{requestError}</p>
            )}

            <button
              type="submit"
              disabled={!form.name.trim() || !form.email.trim() || isRequesting}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-[var(--primary-bg)] px-4 py-3 text-[13px] font-medium text-[color:var(--primary-text)] shadow-sm transition-colors hover:bg-[var(--primary-bg-hover)] disabled:opacity-50"
            >
              {isRequesting && <Loader2 className="h-4 w-4 animate-spin" />}
              Submit Request
            </button>

            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => setMode("code")}
                className="text-[13px] text-[var(--muted)] underline-offset-4 hover:text-[var(--ink)] hover:underline"
              >
                Back to enter code
              </button>
            </div>
          </form>
        )}

        {mode === "success" && (
          <div className="flex flex-col items-center text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--green-text)]/10 text-[var(--green-text)]">
              <ArrowRight className="h-6 w-6" />
            </div>
            <h3 className="mb-2 text-[16px] font-medium text-[var(--ink)]">Request Received</h3>
            <p className="text-[14px] leading-relaxed text-[var(--muted)]">
              Thanks for your interest! We've received your request and will be in touch if a spot opens up.
            </p>
            <button
              type="button"
              onClick={() => setMode("code")}
              className="mt-8 text-[13px] text-[var(--ink)] underline-offset-4 hover:underline"
            >
              Back to login
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
