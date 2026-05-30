"use client";

import { useState, useEffect } from "react";
import { Phone, Copy, CheckCircle2, ChevronDown, ChevronUp, AlertTriangle, ExternalLink, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { toast } from "sonner";

interface Carrier {
  name: string;
  icon: string;
  forwardCode: (did: string) => string;
  cancelCode: string;
  testCode: string;
  notes: string;
  docsUrl?: string;
}

const CARRIERS: Carrier[] = [
  {
    name: "AT&T",
    icon: "🔵",
    forwardCode: (did) => `**21*${did}#`,
    cancelCode: "##21#",
    testCode: "Let it ring — call your main number from another phone",
    notes: "Works on AT&T landlines, VoIP, and some AT&T mobility lines. If you have a PBX (RingCentral, 8x8, etc.) hosted on AT&T, use the PBX instructions below instead.",
    docsUrl: "https://www.att.com/features/call-forwarding/",
  },
  {
    name: "Verizon",
    icon: "🔴",
    forwardCode: (did) => `*72${did}`,
    cancelCode: "*73",
    testCode: "Call your number and confirm AI picks up",
    notes: "Dial the forward code and wait for two beeps before hanging up. Does not work on Fios Digital Voice if you use the web portal — use the My Verizon app instead.",
    docsUrl: "https://www.verizon.com/support/residential/phone/call-forwarding",
  },
  {
    name: "T-Mobile",
    icon: "🩷",
    forwardCode: (did) => `**21*${did}#`,
    cancelCode: "##21#",
    testCode: "Call from a different line to verify forwarding",
    notes: "T-Mobile business lines may require enabling Call Forwarding in MyT-Mobile Business first. Consumer lines work immediately with the code.",
  },
  {
    name: "Spectrum (Charter)",
    icon: "⚫",
    forwardCode: (did) => `*72${did}`,
    cancelCode: "*73",
    testCode: "Call from your cell to your office number",
    notes: "Spectrum Voice requires a touchtone signal after dialling. Dial, wait for second dial tone, then dial your DID.",
  },
  {
    name: "RingCentral",
    icon: "🟠",
    forwardCode: (did) => `See admin portal`,
    cancelCode: "See admin portal",
    testCode: "Use the RingCentral app or test from your cell",
    notes: "Log into admin.ringcentral.com → Phone System → Groups → Auto-Receptionist → Rules → Add rule → Forward to External Number. Paste your DID. Set priority to apply after X rings or always.",
    docsUrl: "https://support.ringcentral.com/",
  },
  {
    name: "8x8 / Vonage Business",
    icon: "🟣",
    forwardCode: (did) => `See admin portal`,
    cancelCode: "See admin portal",
    testCode: "Use the 8x8 Work app to confirm",
    notes: "In 8x8 Admin Console: Users → select user → Call Forwarding → Forward Always to External Number. Paste your DID and save.",
  },
  {
    name: "Other / Unknown",
    icon: "❓",
    forwardCode: (did) => `*72${did} or **21*${did}# or *21*${did}#`,
    cancelCode: "*73 or ##21# or #21#",
    testCode: "Try *72 first, then **21* if that fails",
    notes: "Try *72 (most common) first. If you hear an error tone, try **21*[number]# instead. If neither works, check with your phone provider or log into your PBX admin panel.",
  },
];

export default function PhoneSetupPage() {
  const [did, setDid] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [openCarrier, setOpenCarrier] = useState<string | null>("AT&T");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.setup.status()
      .then((s) => setDid(s.phone_number))
      .catch(() => {/* handled by loading state */})
      .finally(() => setLoading(false));
  }, []);

  function copyDid() {
    if (!did) return;
    navigator.clipboard.writeText(did);
    setCopied(true);
    toast.success("Phone number copied");
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Phone Forwarding Setup</h1>
        <p className="mt-1 text-slate-500">
          Your clinic keeps its existing published number. Follow these steps to forward inbound calls
          to your AI receptionist.
        </p>
      </div>

      {/* Step 1 — Your DID */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-6">
        <div className="bg-teal-600 px-6 py-4">
          <div className="flex items-center gap-2 text-white">
            <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold">1</div>
            <span className="font-semibold">Your AI Receptionist Number</span>
          </div>
        </div>
        <div className="px-6 py-5">
          <p className="text-sm text-slate-500 mb-3">
            This is the number you will forward your clinic's existing line to. Keep this private — do not
            share it with patients.
          </p>
          {loading ? (
            <div className="flex items-center gap-2 text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Loading your number…</span>
            </div>
          ) : did ? (
            <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
              <Phone className="w-5 h-5 text-teal-600 flex-shrink-0" />
              <span className="text-xl font-bold text-slate-900 tracking-widest tabular-nums">{did}</span>
              <button
                onClick={copyDid}
                className="ml-auto flex items-center gap-1.5 text-sm text-teal-600 hover:text-teal-700 font-medium"
              >
                {copied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
              <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />
              <p className="text-sm text-amber-800">
                No number assigned yet. Complete the{" "}
                <a href="/dashboard" className="underline font-medium">onboarding steps</a>{" "}
                first (connect Google Calendar → activate).
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Step 2 — Carrier Instructions */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-6">
        <div className="bg-teal-600 px-6 py-4">
          <div className="flex items-center gap-2 text-white">
            <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold">2</div>
            <span className="font-semibold">Forward Your Existing Number</span>
          </div>
        </div>
        <div className="px-6 py-4">
          <p className="text-sm text-slate-500 mb-4">
            Select your phone carrier below and follow the instructions. This takes under 2 minutes.
            Your clinic's published number does <strong>not</strong> change.
          </p>
          <div className="space-y-2">
            {CARRIERS.map((carrier) => {
              const isOpen = openCarrier === carrier.name;
              const forwardCode = did ? carrier.forwardCode(did) : carrier.forwardCode("+1XXXXXXXXXX");
              return (
                <div key={carrier.name} className="border border-slate-200 rounded-lg overflow-hidden">
                  <button
                    onClick={() => setOpenCarrier(isOpen ? null : carrier.name)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors text-left"
                  >
                    <span className="flex items-center gap-2 text-sm font-medium text-slate-900">
                      <span>{carrier.icon}</span>
                      {carrier.name}
                    </span>
                    {isOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                  </button>

                  {isOpen && (
                    <div className="px-4 pb-4 pt-1 border-t border-slate-100 text-sm space-y-4">
                      <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                          To Enable Forwarding
                        </p>
                        {forwardCode.startsWith("See") ? (
                          <p className="text-slate-700 italic">{forwardCode}</p>
                        ) : (
                          <div className="flex items-center gap-2">
                            <code className="bg-slate-900 text-green-400 text-base font-mono px-3 py-1.5 rounded-lg">
                              {forwardCode}
                            </code>
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(forwardCode);
                                toast.success("Code copied");
                              }}
                              className="text-xs text-teal-600 hover:text-teal-700 font-medium"
                            >
                              Copy
                            </button>
                          </div>
                        )}
                        <p className="text-slate-500 mt-1">
                          Dial this code from your clinic's main phone (not a cell). You'll hear confirmation tones.
                        </p>
                      </div>

                      <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                          To Cancel Forwarding Later
                        </p>
                        {carrier.cancelCode.startsWith("See") ? (
                          <p className="text-slate-700 italic">{carrier.cancelCode}</p>
                        ) : (
                          <code className="bg-slate-100 text-slate-800 text-base font-mono px-3 py-1.5 rounded-lg">
                            {carrier.cancelCode}
                          </code>
                        )}
                      </div>

                      <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2.5">
                        <p className="text-xs font-semibold text-blue-700 mb-0.5">Note</p>
                        <p className="text-blue-800 text-xs">{carrier.notes}</p>
                      </div>

                      {carrier.docsUrl && (
                        <a
                          href={carrier.docsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-teal-600 hover:text-teal-700"
                        >
                          {carrier.name} official docs
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Step 3 — Test */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-6">
        <div className="bg-teal-600 px-6 py-4">
          <div className="flex items-center gap-2 text-white">
            <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold">3</div>
            <span className="font-semibold">Test Your Setup</span>
          </div>
        </div>
        <div className="px-6 py-5 space-y-3 text-sm text-slate-600">
          <p>After enabling forwarding, do a quick test:</p>
          <ol className="list-decimal pl-5 space-y-2">
            <li>Call your clinic's <strong>existing published number</strong> from your personal cell phone.</li>
            <li>The AI receptionist should answer within 2 rings.</li>
            <li>Say: <em>"Hi, I'd like to book a cleaning with Dr. [name] on Friday afternoon."</em></li>
            <li>The AI should offer available times and confirm a booking in your Google Calendar.</li>
            <li>Check your <a href="/dashboard" className="text-teal-600 hover:text-teal-700 underline">dashboard</a> — the call and booking should appear within seconds.</li>
          </ol>
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 mt-2">
            <p className="text-amber-800">
              <strong>If the AI doesn't answer:</strong> verify that forwarding was enabled on the correct line,
              confirm your DID above matches what's in your admin settings, and email{" "}
              <a href="mailto:[YOUR_SUPPORT_EMAIL]" className="underline text-amber-900">[YOUR_SUPPORT_EMAIL]</a> if the issue persists.
            </p>
          </div>
        </div>
      </div>

      {/* Help */}
      <p className="text-center text-sm text-slate-400">
        Need help? Email{" "}
        <a href="mailto:[YOUR_SUPPORT_EMAIL]" className="text-teal-600 hover:text-teal-700">
          [YOUR_SUPPORT_EMAIL]
        </a>{" "}
        and we'll walk you through setup in under 15 minutes.
      </p>
    </div>
  );
}
