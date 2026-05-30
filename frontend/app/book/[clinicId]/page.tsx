"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { Calendar, Clock, User, Phone, Mail, Shield, ChevronLeft, ChevronRight, Check } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

interface ClinicInfo {
  id: string;
  name: string;
  phone: string;
  address: string;
  hours: Record<string, { open: string; close: string } | null>;
  color: string;
}

interface Service {
  id: string;
  name: string;
  slug: string;
  duration_minutes: number;
}

interface Provider {
  id: string;
  name: string;
  specialty: string;
  working_days: number[];
}

interface Slot {
  time: string;
  provider_id: string;
  provider_name: string;
}

type Step = "service" | "date" | "time" | "info" | "confirm";

const STEPS: Step[] = ["service", "date", "time", "info", "confirm"];

export default function BookingWidget() {
  const params = useParams();
  const clinicId = params.clinicId as string;

  const [clinic, setClinic] = useState<ClinicInfo | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [step, setStep] = useState<Step>("service");
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [insurance, setInsurance] = useState("");
  const [isNewPatient, setIsNewPatient] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [bookingResult, setBookingResult] = useState<any>(null);

  const accentColor = clinic?.color || "#2563EB";

  // Load clinic data
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${API_BASE}/api/public/clinic/${clinicId}`);
        if (!res.ok) throw new Error("This clinic is not available for online booking.");
        const data = await res.json();
        setClinic(data.clinic);
        setServices(data.services);
        setProviders(data.providers);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [clinicId]);

  // Load available slots when date changes
  useEffect(() => {
    if (!selectedDate || !selectedService) return;
    async function loadSlots() {
      setSlotsLoading(true);
      try {
        const params = new URLSearchParams({
          clinicId, date: selectedDate, serviceId: selectedService!.id,
        });
        const res = await fetch(`${API_BASE}/api/public/available-slots?${params}`);
        const data = await res.json();
        setSlots(data.slots || []);
      } catch {
        setSlots([]);
      } finally {
        setSlotsLoading(false);
      }
    }
    loadSlots();
  }, [selectedDate, selectedService, clinicId]);

  const currentStepIndex = STEPS.indexOf(step);

  // Date picker helpers
  const today = new Date();
  const [calendarMonth, setCalendarMonth] = useState(today.getMonth());
  const [calendarYear, setCalendarYear] = useState(today.getFullYear());

  const getDaysInMonth = (month: number, year: number) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (month: number, year: number) => new Date(year, month, 1).getDay();

  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const isDateDisabled = (day: number) => {
    const d = new Date(calendarYear, calendarMonth, day);
    if (d < new Date(today.getFullYear(), today.getMonth(), today.getDate())) return true;
    if (d > new Date(today.getFullYear(), today.getMonth(), today.getDate() + 90)) return true;
    // Check if any provider works on this day
    const dayOfWeek = d.getDay();
    const hasProvider = providers.some((p) => p.working_days.includes(dayOfWeek));
    return !hasProvider;
  };

  const formatDateStr = (day: number) => {
    const m = String(calendarMonth + 1).padStart(2, "0");
    const d = String(day).padStart(2, "0");
    return `${calendarYear}-${m}-${d}`;
  };

  const submit = async () => {
    if (!name || !phone || !selectedDate || !selectedSlot) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/public/book`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clinicId,
          providerId: selectedSlot.provider_id,
          serviceId: selectedService?.id,
          patientName: name,
          patientPhone: phone,
          patientEmail: email || undefined,
          patientInsurance: insurance || undefined,
          date: selectedDate,
          time: selectedSlot.time,
          isNewPatient,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Booking failed");
      setBookingResult(data);
      setSuccess(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-pulse text-gray-500">Loading booking...</div>
      </div>
    );
  }

  if (error && !clinic) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">Booking Unavailable</h1>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-blue-50 to-white p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: `${accentColor}20` }}>
            <Check className="w-8 h-8" style={{ color: accentColor }} />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Appointment Confirmed!</h1>
          <div className="bg-gray-50 rounded-xl p-4 mb-4 text-left space-y-1">
            <p className="text-sm"><strong>Date:</strong> {new Date(selectedDate).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</p>
            <p className="text-sm"><strong>Time:</strong> {selectedSlot?.time}</p>
            <p className="text-sm"><strong>Service:</strong> {selectedService?.name}</p>
            <p className="text-sm"><strong>With:</strong> {selectedSlot?.provider_name}</p>
          </div>
          <p className="text-sm text-gray-600 mb-4">
            A confirmation has been sent to your phone. {isNewPatient && "Since you're a new patient, you'll receive an intake form to complete before your visit."}
          </p>
          <p className="text-xs text-gray-400">{clinic?.name} | {clinic?.phone}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      {/* Header */}
      <div className="bg-white border-b">
        <div className="max-w-lg mx-auto px-4 py-4">
          <h1 className="text-xl font-bold" style={{ color: accentColor }}>{clinic?.name}</h1>
          <p className="text-sm text-gray-500">Book an Appointment Online</p>
        </div>
      </div>

      {/* Progress */}
      <div className="max-w-lg mx-auto px-4 pt-6">
        <div className="flex items-center gap-1 mb-6">
          {STEPS.map((s, i) => (
            <div key={s} className="flex-1 h-1.5 rounded-full transition-all" style={{ backgroundColor: i <= currentStepIndex ? accentColor : "#e5e7eb" }} />
          ))}
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 pb-24">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm mb-4">{error}</div>
        )}

        {/* Step: Select Service */}
        {step === "service" && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">What do you need?</h2>
            <div className="grid gap-3">
              {services.map((svc) => (
                <button key={svc.id} onClick={() => { setSelectedService(svc); setStep("date"); }}
                  className={`w-full text-left p-4 rounded-xl border-2 transition-all hover:shadow-md ${selectedService?.id === svc.id ? "shadow-md" : "bg-white"}`}
                  style={{ borderColor: selectedService?.id === svc.id ? accentColor : "#e5e7eb" }}
                >
                  <div className="font-medium text-gray-900">{svc.name}</div>
                  <div className="text-sm text-gray-500">{svc.duration_minutes} minutes</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step: Select Date */}
        {step === "date" && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">Pick a date</h2>
            <div className="bg-white rounded-xl border p-4">
              <div className="flex items-center justify-between mb-4">
                <button onClick={() => { if (calendarMonth === 0) { setCalendarMonth(11); setCalendarYear(calendarYear - 1); } else setCalendarMonth(calendarMonth - 1); }} className="p-1 hover:bg-gray-100 rounded">
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <span className="font-semibold">{monthNames[calendarMonth]} {calendarYear}</span>
                <button onClick={() => { if (calendarMonth === 11) { setCalendarMonth(0); setCalendarYear(calendarYear + 1); } else setCalendarMonth(calendarMonth + 1); }} className="p-1 hover:bg-gray-100 rounded">
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
              <div className="grid grid-cols-7 gap-1 text-center">
                {dayNames.map((d) => <div key={d} className="text-xs font-medium text-gray-400 py-1">{d}</div>)}
                {Array.from({ length: getFirstDayOfMonth(calendarMonth, calendarYear) }).map((_, i) => <div key={`e-${i}`} />)}
                {Array.from({ length: getDaysInMonth(calendarMonth, calendarYear) }).map((_, i) => {
                  const day = i + 1;
                  const dateStr = formatDateStr(day);
                  const disabled = isDateDisabled(day);
                  const selected = selectedDate === dateStr;
                  return (
                    <button key={day} disabled={disabled}
                      onClick={() => { setSelectedDate(dateStr); setSelectedSlot(null); setStep("time"); }}
                      className={`w-10 h-10 rounded-full text-sm font-medium mx-auto transition-all
                        ${disabled ? "text-gray-300 cursor-not-allowed" : "hover:bg-gray-100 cursor-pointer"}
                        ${selected ? "text-white" : "text-gray-700"}
                      `}
                      style={selected ? { backgroundColor: accentColor, color: "white" } : {}}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
            </div>
            <button onClick={() => setStep("service")} className="text-sm text-gray-500 hover:text-gray-700">
              <ChevronLeft className="w-4 h-4 inline" /> Back to services
            </button>
          </div>
        )}

        {/* Step: Select Time */}
        {step === "time" && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">
              Available times for {new Date(selectedDate).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
            </h2>
            {slotsLoading ? (
              <div className="text-center py-8 text-gray-400 animate-pulse">Checking availability...</div>
            ) : slots.length === 0 ? (
              <div className="text-center py-8">
                <Clock className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                <p className="text-gray-500">No available times for this date.</p>
                <button onClick={() => setStep("date")} className="mt-2 text-sm hover:underline" style={{ color: accentColor }}>
                  Choose a different date
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {slots.map((slot, i) => (
                  <button key={i} onClick={() => { setSelectedSlot(slot); setStep("info"); }}
                    className={`p-3 rounded-xl border-2 text-center transition-all hover:shadow-md ${selectedSlot?.time === slot.time && selectedSlot?.provider_id === slot.provider_id ? "shadow-md" : "bg-white"}`}
                    style={{ borderColor: selectedSlot?.time === slot.time && selectedSlot?.provider_id === slot.provider_id ? accentColor : "#e5e7eb" }}
                  >
                    <div className="font-medium text-gray-900">{slot.time}</div>
                    <div className="text-xs text-gray-500">{slot.provider_name}</div>
                  </button>
                ))}
              </div>
            )}
            <button onClick={() => setStep("date")} className="text-sm text-gray-500 hover:text-gray-700">
              <ChevronLeft className="w-4 h-4 inline" /> Back to calendar
            </button>
          </div>
        )}

        {/* Step: Patient Info */}
        {step === "info" && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">Your Information</h2>
            <div className="bg-white rounded-xl border p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1"><User className="w-4 h-4 inline mr-1" />Full Name *</label>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full border rounded-lg px-3 py-2.5 focus:ring-2 focus:border-blue-500" style={{ "--tw-ring-color": accentColor } as any} placeholder="Jane Doe" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1"><Phone className="w-4 h-4 inline mr-1" />Phone Number *</label>
                <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full border rounded-lg px-3 py-2.5 focus:ring-2 focus:border-blue-500" placeholder="(555) 123-4567" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1"><Mail className="w-4 h-4 inline mr-1" />Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full border rounded-lg px-3 py-2.5 focus:ring-2 focus:border-blue-500" placeholder="jane@email.com" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1"><Shield className="w-4 h-4 inline mr-1" />Insurance Provider</label>
                <input type="text" value={insurance} onChange={(e) => setInsurance(e.target.value)} className="w-full border rounded-lg px-3 py-2.5 focus:ring-2 focus:border-blue-500" placeholder="Delta Dental, MetLife, etc." />
              </div>
              <div className="flex gap-3">
                <button onClick={() => setIsNewPatient(true)} className={`flex-1 py-2.5 rounded-lg text-sm font-medium border-2 transition-all ${isNewPatient ? "text-white" : "bg-white text-gray-700"}`} style={isNewPatient ? { backgroundColor: accentColor, borderColor: accentColor } : { borderColor: "#e5e7eb" }}>
                  New Patient
                </button>
                <button onClick={() => setIsNewPatient(false)} className={`flex-1 py-2.5 rounded-lg text-sm font-medium border-2 transition-all ${!isNewPatient ? "text-white" : "bg-white text-gray-700"}`} style={!isNewPatient ? { backgroundColor: accentColor, borderColor: accentColor } : { borderColor: "#e5e7eb" }}>
                  Returning Patient
                </button>
              </div>
            </div>
            <button onClick={() => setStep("time")} className="text-sm text-gray-500 hover:text-gray-700">
              <ChevronLeft className="w-4 h-4 inline" /> Back to times
            </button>
          </div>
        )}

        {/* Step: Confirm */}
        {step === "confirm" && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">Confirm Your Appointment</h2>
            <div className="bg-white rounded-xl border p-5 space-y-3">
              <div className="flex justify-between py-2 border-b">
                <span className="text-gray-500">Service</span>
                <span className="font-medium">{selectedService?.name}</span>
              </div>
              <div className="flex justify-between py-2 border-b">
                <span className="text-gray-500">Date</span>
                <span className="font-medium">{new Date(selectedDate).toLocaleDateString("en-US", { weekday: "short", month: "long", day: "numeric" })}</span>
              </div>
              <div className="flex justify-between py-2 border-b">
                <span className="text-gray-500">Time</span>
                <span className="font-medium">{selectedSlot?.time}</span>
              </div>
              <div className="flex justify-between py-2 border-b">
                <span className="text-gray-500">Provider</span>
                <span className="font-medium">{selectedSlot?.provider_name}</span>
              </div>
              <div className="flex justify-between py-2 border-b">
                <span className="text-gray-500">Duration</span>
                <span className="font-medium">{selectedService?.duration_minutes} min</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-gray-500">Patient</span>
                <span className="font-medium">{name}</span>
              </div>
            </div>
            {isNewPatient && (
              <p className="text-sm text-gray-500 bg-blue-50 rounded-lg p-3">
                As a new patient, please arrive 15 minutes early. You'll receive an intake form to complete before your visit.
              </p>
            )}
            <button onClick={() => setStep("info")} className="text-sm text-gray-500 hover:text-gray-700">
              <ChevronLeft className="w-4 h-4 inline" /> Back to info
            </button>
          </div>
        )}
      </div>

      {/* Bottom Action */}
      {step === "info" && name && phone && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-4">
          <div className="max-w-lg mx-auto">
            <button onClick={() => setStep("confirm")} className="w-full py-3 rounded-xl text-white font-medium text-lg transition-all hover:opacity-90" style={{ backgroundColor: accentColor }}>
              Review Appointment
            </button>
          </div>
        </div>
      )}
      {step === "confirm" && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-4">
          <div className="max-w-lg mx-auto">
            <button onClick={submit} disabled={submitting} className="w-full py-3 rounded-xl text-white font-medium text-lg transition-all hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: accentColor }}>
              {submitting ? "Booking..." : "Confirm Appointment"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
