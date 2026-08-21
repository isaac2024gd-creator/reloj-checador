import React, { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";
import {
  Camera,
  Check,
  X,
  Plus,
  Trash2,
  LogIn,
  LogOut,
  Clock,
  UserRound,
  RotateCcw,
  Users,
  Loader2,
  RefreshCw,
  ScrollText,
  Lock,
  LockOpen,
  CalendarClock,
  FileSignature,
  UploadCloud,
  Wallet,
  Coins,
  ChevronLeft,
  ChevronRight,
  Settings2,
  AlertTriangle,
  MapPin,
  Building2,
  Fingerprint,
  Pencil,
} from "lucide-react";

/* ============================================================
   CONFIGURACIÓN DE SUPABASE — proyecto compartido con PAR
   ============================================================ */
const SUPABASE_URL = "https://ciwfhbpcpygubsvtmwze.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_AF_54iVTwT25rhMrhWbFXQ_oW2z_NeF";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* Reemplazan a window.storage: usan la tabla kv_store_reloj_checador de Supabase
   (proyecto compartido con PAR, pero con tabla propia para no mezclar datos). */
async function kvGet(key) {
  const { data, error } = await supabase.from("kv_store_reloj_checador").select("value").eq("key", key).maybeSingle();
  if (error) throw error;
  return data ? data.value : null;
}

async function kvSet(key, value) {
  const { error } = await supabase
    .from("kv_store_reloj_checador")
    .upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw error;
  return true;
}


// ---------- helpers ----------

function pad(n) {
  return String(n).padStart(2, "0");
}

function localDateKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
}

function formatDateLabel(key, todayKey) {
  if (key === todayKey) return "Hoy";
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (key === localDateKey(yesterday)) return "Ayer";
  const label = date.toLocaleDateString("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function monthKeyOf(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

function monthLabel(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  const label = new Date(y, m - 1, 1).toLocaleDateString("es-MX", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function shiftMonthKey(monthKey, delta) {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return monthKeyOf(d);
}

function compressImage(file, maxWidth = 480, quality = 0.6) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => reject(new Error("No se pudo leer la imagen"));
      img.src = ev.target.result;
    };
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.readAsDataURL(file);
  });
}

function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ---------- horario semanal + tolerancia de puntualidad ----------

const DAY_NAMES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const DAY_SHORT = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

const DEFAULT_AREAS = ["Cocina Caliente", "Cocina Fría", "Servicio", "Barra", "Almacén"];


function defaultSchedule() {
  const sched = {};
  for (let i = 0; i < 7; i++) sched[i] = { enabled: false, start: "09:00", end: "17:00" };
  return sched;
}

// Devuelve el horario que estaba VIGENTE en una fecha dada, no el actual —
// así los resúmenes de meses pasados no se recalculan con cambios recientes.
// emp.scheduleHistory: [{ effectiveFrom: "YYYY-MM-DD", schedule }, ...] ordenado ascendente.
function getScheduleForDate(emp, dateKey) {
  const history = emp.scheduleHistory;
  if (!history || history.length === 0) return emp.schedule || null; // compatibilidad con datos antiguos
  let applicable = history[0].schedule;
  for (const version of history) {
    if (version.effectiveFrom <= dateKey) applicable = version.schedule;
    else break;
  }
  return applicable;
}

// minutos de diferencia entre la hora checada y la hora programada (positivo = tarde)
function minutesLate(scheduledStart, punchIso) {
  const punch = new Date(punchIso);
  const [h, m] = scheduledStart.split(":").map(Number);
  const scheduled = new Date(punch);
  scheduled.setHours(h, m, 0, 0);
  return Math.floor((punch - scheduled) / 60000);
}

// Si no hay salida registrada y ya pasaron 1.5 horas del fin de turno programado,
// se asume que la persona salió puntual (a la hora programada). Devuelve el ISO de esa
// salida "asumida", o null si todavía estamos dentro de la ventana de tolerancia (no se asume nada aún).
const TOLERANCIA_SALIDA_MIN = 90; // 1.5 horas

function salidaAsumidaIso(dateKey, scheduledEnd) {
  if (!scheduledEnd) return null;
  const [y, mo, d] = dateKey.split("-").map(Number);
  const [h, m] = scheduledEnd.split(":").map(Number);
  const programada = new Date(y, mo - 1, d, h, m, 0, 0);
  const limite = new Date(programada.getTime() + TOLERANCIA_SALIDA_MIN * 60000);
  if (new Date() >= limite) return programada.toISOString();
  return null;
}

// clasifica la puntualidad según la tolerancia: 10 min para bono, 15 min para propinas
function punctualityTier(mins, toleranciaBono = 10, toleranciaPropina = 15) {
  if (mins === null || mins === undefined) return null;
  if (mins <= toleranciaBono) return "bono";
  if (mins <= toleranciaPropina) return "propina";
  return "ninguno";
}

function punctualityMeta(tier, paprika, brass, sage) {
  switch (tier) {
    case "bono":
      return { color: sage, label: "A tiempo — aplica bono y propina" };
    case "propina":
      return { color: brass, label: "Dentro de tolerancia — aplica solo propina" };
    case "ninguno":
      return { color: paprika, label: "Fuera de tolerancia — sin bono ni propina" };
    default:
      return { color: null, label: "" };
  }
}

function scheduleSummary(schedule) {
  if (!schedule) return "Sin horario configurado";
  const enabledDays = Object.keys(schedule)
    .map(Number)
    .filter((d) => schedule[d]?.enabled)
    .sort((a, b) => a - b);
  if (enabledDays.length === 0) return "Sin horario configurado";
  const dayLabels = enabledDays.map((d) => DAY_SHORT[d]).join(" ");
  const times = enabledDays.map((d) => `${schedule[d].start}–${schedule[d].end}`);
  const uniform = times.every((t) => t === times[0]);
  return uniform ? `${dayLabels} · ${times[0]}` : `${dayLabels} · horarios variados`;
}

// número de semana dentro del mes (1-based, semanas de domingo a sábado)
function weekOfMonth(dateObj) {
  const firstDay = new Date(dateObj.getFullYear(), dateObj.getMonth(), 1);
  return Math.ceil((dateObj.getDate() + firstDay.getDay()) / 7);
}

function hoursBetween(entradaIso, salidaIso) {
  const diffMs = new Date(salidaIso) - new Date(entradaIso);
  return Math.round((diffMs / 3600000) * 10) / 10;
}

function isWebAuthnSupported() {
  return typeof window !== "undefined" && !!window.PublicKeyCredential;
}

// Color palette
const paper = "#fafaf8";
const ink = "#1a1a18";
const brass = "#B8860B";
const sage = "#4a7c59";
const paprika = "#d97706";
const steel = "#999";

export default function App() {
  // ====== Estado global ======
  const [mode, setMode] = useState("select"); // "select" | "checador" | "admin"
  const [currentEmployee, setCurrentEmployee] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [adminPIN, setAdminPIN] = useState("");
  const [adminPINInput, setAdminPINInput] = useState("");
  const [showPINModal, setShowPINModal] = useState(false);
  const [pinError, setPinError] = useState("");
  const [toast, setToast] = useState(null);

  // Tab state
  const [checadorTab, setChecadorTab] = useState("checador"); // "checador" | "nomina" | "propinas"

  // Checador state
  const [areaList, setAreaList] = useState(DEFAULT_AREAS);
  const [methodModal, setMethodModal] = useState(null);
  const [scheduleModal, setScheduleModal] = useState(null);
  const [areasModal, setAreasModal] = useState(null);
  const [metodoModal, setMetodoModal] = useState(null);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);

  // ====== Load employees & admin PIN ======
  useEffect(() => {
    (async () => {
      try {
        const emps = await kvGet("employees");
        if (emps) setEmployees(emps);

        const pin = await kvGet("admin_pin");
        if (pin) setAdminPIN(pin);
      } catch (e) {
        console.error("Error loading data:", e);
      }
    })();
  }, []);

  // ====== Helpers ======
  const showToast = (text, color = sage) => {
    setToast({ text, color });
    setTimeout(() => setToast(null), 3000);
  };

  const validatePIN = () => {
    if (adminPINInput === adminPIN) {
      setPinError("");
      setShowPINModal(false);
      setAdminPINInput("");
      setMode("admin");
    } else {
      setPinError("PIN incorrecto");
    }
  };

  // ====== Checador functions ======
  const getCurrentChecked = () => {
    if (!currentEmployee) return null;
    const today = localDateKey();
    return currentEmployee.checked?.[today];
  };

  const getCurrentPunch = () => {
    const checked = getCurrentChecked();
    return checked?.entrada ? new Date(checked.entrada) : null;
  };

  const isTimeForExit = () => {
    if (!currentEmployee) return false;
    const checked = getCurrentChecked();
    if (!checked?.entrada) return false; // sin entrada, no exit
    if (checked?.salida) return false; // ya salió
    
    const now = new Date();
    const entrada = new Date(checked.entrada);
    const diffHours = (now - entrada) / (1000 * 60 * 60);
    return diffHours >= 0.5; // al menos 30 min
  };

  const handleChecador = async () => {
    if (!currentEmployee) return;

    const today = localDateKey();
    const checked = getCurrentChecked() || {};

    if (!checked.entrada) {
      // ENTRADA
      setMethodModal({ step: "area" });
    } else if (!checked.salida) {
      // SALIDA
      const salida = new Date().toISOString();
      const updated = { ...checked, salida };
      const newEmps = employees.map((e) =>
        e.id === currentEmployee.id
          ? {
              ...e,
              checked: { ...(e.checked || {}), [today]: updated },
            }
          : e
      );
      setEmployees(newEmps);
      await kvSet("employees", newEmps);
      setCurrentEmployee(newEmps.find((e) => e.id === currentEmployee.id));
      showToast("✓ Salida registrada", sage);
    }
  };

  // ====== Render ======
  if (mode === "select") {
    return (
      <SelectMode
        employees={employees}
        setCurrentEmployee={setCurrentEmployee}
        setMode={setMode}
        setShowPINModal={setShowPINModal}
        paper={paper}
        ink={ink}
        brass={brass}
        sage={sage}
      />
    );
  }

  if (mode === "checador") {
    return (
      <CheckadorMode
        currentEmployee={currentEmployee}
        employees={employees}
        setEmployees={setEmployees}
        setCurrentEmployee={setCurrentEmployee}
        setMode={setMode}
        checadorTab={checadorTab}
        setChecadorTab={setChecadorTab}
        toast={toast}
        showToast={showToast}
        methodModal={methodModal}
        setMethodModal={setMethodModal}
        scheduleModal={scheduleModal}
        setScheduleModal={setScheduleModal}
        areasModal={areasModal}
        setAreasModal={setAreasModal}
        metodoModal={metodoModal}
        setMetodoModal={setMetodoModal}
        handleChecador={handleChecador}
        isTimeForExit={isTimeForExit}
        videoRef={videoRef}
        canvasRef={canvasRef}
        fileInputRef={fileInputRef}
        paper={paper}
        ink={ink}
        brass={brass}
        sage={sage}
        paprika={paprika}
        steel={steel}
        areaList={areaList}
        setAreaList={setAreaList}
      />
    );
  }

  if (mode === "admin") {
    return (
      <AdminMode
        employees={employees}
        setEmployees={setEmployees}
        setMode={setMode}
        toast={toast}
        showToast={showToast}
        paper={paper}
        ink={ink}
        brass={brass}
        sage={sage}
        paprika={paprika}
        steel={steel}
      />
    );
  }

  if (showPINModal) {
    return (
      <div
        className="fixed inset-0 flex items-center justify-center z-50 p-4"
        style={{ background: "#00000099" }}
      >
        <div className="w-full max-w-sm rounded-sm p-5" style={{ background: paper }}>
          <div className="text-sm font-bold uppercase mb-4" style={{ color: ink, letterSpacing: "0.06em" }}>
            Ingresa PIN de administrador
          </div>
          <input
            autoFocus
            type="password"
            inputMode="numeric"
            value={adminPINInput}
            onChange={(e) => {
              setAdminPINInput(e.target.value);
              setPinError("");
            }}
            onKeyDown={(e) => e.key === "Enter" && validatePIN()}
            placeholder="####"
            className="w-full px-3 py-3 rounded-sm text-2xl tracking-[0.5em] text-center outline-none mb-3"
            style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
          />
          {pinError && <p className="text-xs mb-3" style={{ color: paprika }}>{pinError}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => {
                setShowPINModal(false);
                setAdminPINInput("");
                setPinError("");
              }}
              className="flex-1 py-2.5 rounded-sm font-bold text-xs uppercase"
              style={{ border: `1px solid ${ink}33`, color: ink }}
            >
              Cancelar
            </button>
            <button
              onClick={validatePIN}
              className="flex-1 py-2.5 rounded-sm font-bold text-xs uppercase"
              style={{ background: brass, color: ink }}
            >
              Ingresar
            </button>
          </div>
        </div>
      </div>
    );
  }
}

// ============================================================
// SELECT MODE
// ============================================================
function SelectMode({ employees, setCurrentEmployee, setMode, setShowPINModal, paper, ink, brass, sage }) {
  return (
    <div className="min-h-screen p-4" style={{ background: paper }}>
      <div className="max-w-sm mx-auto py-12">
        <div className="mb-8">
          <Clock size={48} color={brass} style={{ margin: "0 auto" }} />
        </div>
        <h1 className="text-2xl font-black text-center mb-1" style={{ color: ink }}>
          Reloj Checador
        </h1>
        <p className="text-xs text-center mb-8" style={{ color: ink + "77" }}>
          Restaurante Bondiola
        </p>

        <div className="flex flex-col gap-2 mb-6">
          {employees.map((emp) => (
            <button
              key={emp.id}
              onClick={() => {
                setCurrentEmployee(emp);
                setMode("checador");
              }}
              className="w-full px-4 py-3.5 rounded-sm font-bold text-left text-sm"
              style={{ background: brass + "18", border: `1px solid ${brass}44`, color: ink }}
            >
              <UserRound size={16} style={{ display: "inline-block", marginRight: "8px" }} />
              {emp.name}
            </button>
          ))}
        </div>

        <button
          onClick={() => setShowPINModal(true)}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-sm font-bold text-sm uppercase"
          style={{ background: sage, color: "#fff" }}
        >
          <Lock size={16} />
          Administrador
        </button>
      </div>
    </div>
  );
}

// ============================================================
// CHECADOR MODE
// ============================================================
function CheckadorMode({
  currentEmployee,
  employees,
  setEmployees,
  setCurrentEmployee,
  setMode,
  checadorTab,
  setChecadorTab,
  toast,
  showToast,
  methodModal,
  setMethodModal,
  scheduleModal,
  setScheduleModal,
  areasModal,
  setAreasModal,
  metodoModal,
  setMetodoModal,
  handleChecador,
  isTimeForExit,
  videoRef,
  canvasRef,
  fileInputRef,
  paper,
  ink,
  brass,
  sage,
  paprika,
  steel,
  areaList,
  setAreaList,
}) {
  const today = localDateKey();
  const checked = currentEmployee?.checked?.[today];
  const currentPunch = checked?.entrada ? new Date(checked.entrada) : null;

  const handleCheckador = async () => {
    if (!methodModal || methodModal.step !== "capturando") return;

    if (methodModal.tipo === "foto") {
      if (!methodModal.foto) return;
      const ahora = new Date().toISOString();
      const schedule = getScheduleForDate(currentEmployee, today);
      const entrada_retraso = schedule ? minutesLate(schedule[new Date(ahora).getDay()].start, ahora) : null;

      const newEmps = employees.map((e) =>
        e.id === currentEmployee.id
          ? {
              ...e,
              checked: {
                ...(e.checked || {}),
                [today]: {
                  entrada: ahora,
                  entrada_foto: methodModal.foto,
                  entrada_retraso,
                  area: methodModal.selectedArea || null,
                },
              },
            }
          : e
      );
      setEmployees(newEmps);
      await kvSet("employees", newEmps);
      setCurrentEmployee(newEmps.find((e) => e.id === currentEmployee.id));
      setMethodModal(null);
      showToast("✓ Entrada registrada", sage);
    }
  };

  return (
    <div className="min-h-screen" style={{ background: paper }}>
      {/* HEADER */}
      <div className="sticky top-0 z-40 border-b" style={{ background: paper, borderColor: ink + "11" }}>
        <div className="max-w-sm mx-auto px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => {
              setMode("select");
              setCurrentEmployee(null);
            }}
            className="p-2 rounded-sm"
            style={{ color: ink + "77" }}
          >
            <LogOut size={18} />
          </button>
          <div className="text-center">
            <h2 className="text-sm font-bold" style={{ color: ink }}>
              {currentEmployee?.name}
            </h2>
            <p className="text-[10px]" style={{ color: ink + "77" }}>
              {formatDateLabel(today, today)}
            </p>
          </div>
          <div style={{ width: 40 }} />
        </div>
      </div>

      {/* TABS */}
      <div className="max-w-sm mx-auto px-4 pt-4 flex gap-2 border-b" style={{ borderColor: ink + "11" }}>
        {[
          { id: "checador", label: "Checador", icon: Clock },
          { id: "nomina", label: "Nómina", icon: FileSignature },
          { id: "propinas", label: "Propinas", icon: Coins },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setChecadorTab(tab.id)}
              className="flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-bold uppercase border-b-2 transition"
              style={{
                color: checadorTab === tab.id ? brass : ink + "77",
                borderColor: checadorTab === tab.id ? brass : "transparent",
              }}
            >
              <Icon size={14} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* CONTENT */}
      <div className="max-w-sm mx-auto px-4 py-6 pb-20">
        {checadorTab === "checador" && (
          <CheckadorTab
            currentEmployee={currentEmployee}
            checked={checked}
            today={today}
            isTimeForExit={isTimeForExit}
            handleCheckador={handleCheckador}
            setMethodModal={setMethodModal}
            setScheduleModal={setScheduleModal}
            setAreasModal={setAreasModal}
            setMetodoModal={setMetodoModal}
            paper={paper}
            ink={ink}
            brass={brass}
            sage={sage}
            paprika={paprika}
          />
        )}

        {checadorTab === "nomina" && (
          <NominaTab
            currentEmployee={currentEmployee}
            today={today}
            paper={paper}
            ink={ink}
            brass={brass}
            sage={sage}
          />
        )}

        {checadorTab === "propinas" && (
          <PropinasTab
            currentEmployee={currentEmployee}
            employees={employees}
            today={today}
            paper={paper}
            ink={ink}
            brass={brass}
            sage={sage}
            paprika={paprika}
          />
        )}
      </div>

      {/* MODALS */}
      {methodModal && (
        <MethodModal
          modal={methodModal}
          setModal={setMethodModal}
          handleCheckador={handleCheckador}
          videoRef={videoRef}
          canvasRef={canvasRef}
          fileInputRef={fileInputRef}
          currentEmployee={currentEmployee}
          areaList={areaList}
          paper={paper}
          ink={ink}
          brass={brass}
          sage={sage}
          paprika={paprika}
        />
      )}

      {/* TOAST */}
      {toast && (
        <div
          className="fixed bottom-5 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-sm text-sm font-bold z-50 shadow-lg text-center"
          style={{ background: toast.color || sage, color: paper, maxWidth: "90%" }}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}

// ============================================================
// CHECADOR TAB
// ============================================================
function CheckadorTab({
  currentEmployee,
  checked,
  today,
  isTimeForExit,
  handleCheckador,
  setMethodModal,
  setScheduleModal,
  setAreasModal,
  setMetodoModal,
  paper,
  ink,
  brass,
  sage,
  paprika,
}) {
  const schedule = getScheduleForDate(currentEmployee, today);
  const todayDayOfWeek = new Date().getDay();
  const scheduleToday = schedule ? schedule[todayDayOfWeek] : null;

  return (
    <div>
      {/* Card de estado */}
      <div className="rounded-sm p-4 mb-6" style={{ background: sage + "14", border: `1px solid ${sage}44` }}>
        <div className="text-xs font-bold uppercase mb-1" style={{ color: sage, letterSpacing: "0.06em" }}>
          Estado de hoy
        </div>
        {!checked?.entrada ? (
          <div>
            <p className="text-sm font-black mb-3" style={{ color: ink }}>
              Sin entrada registrada
            </p>
            {scheduleToday?.enabled ? (
              <p className="text-xs mb-3" style={{ color: ink + "77" }}>
                Horario: {scheduleToday.start} – {scheduleToday.end}
              </p>
            ) : (
              <p className="text-xs mb-3" style={{ color: paprika }}>
                Sin horario configurado
              </p>
            )}
            <button
              onClick={() => setMethodModal({ step: "area", tipo: "foto", selectedArea: null, foto: null })}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-sm font-bold text-sm uppercase"
              style={{ background: brass, color: ink }}
            >
              <Clock size={16} />
              Registrar entrada
            </button>
          </div>
        ) : (
          <div>
            <p className="text-sm font-black mb-2" style={{ color: ink }}>
              ✓ {formatTime(checked.entrada)}
            </p>
            {checked.salida ? (
              <p className="text-xs" style={{ color: sage }}>
                Salida: {formatTime(checked.salida)}
              </p>
            ) : (
              <button
                onClick={() => {
                  const salida = new Date().toISOString();
                  const newEmps = employees.map((e) =>
                    e.id === currentEmployee.id
                      ? {
                          ...e,
                          checked: {
                            ...(e.checked || {}),
                            [today]: {
                              ...checked,
                              salida,
                            },
                          },
                        }
                      : e
                  );
                  // Simulación: necesitarías pasar employees y setEmployees
                }}
                disabled={!isTimeForExit()}
                className="w-full py-2.5 rounded-sm font-bold text-xs uppercase disabled:opacity-50"
                style={{ background: brass, color: ink }}
              >
                Registrar salida
              </button>
            )}
          </div>
        )}
      </div>

      {/* Settings */}
      <div className="space-y-2">
        <button
          onClick={() => setScheduleModal({ employeeId: currentEmployee.id, draft: structuredClone(getScheduleForDate(currentEmployee, today) || defaultSchedule()) })}
          className="w-full flex items-center justify-between px-4 py-3 rounded-sm"
          style={{ background: ink + "06", border: `1px solid ${ink}11`, color: ink }}
        >
          <span className="text-sm font-bold flex items-center gap-2">
            <CalendarClock size={16} /> Horario
          </span>
          <ChevronRight size={16} />
        </button>
        <button
          onClick={() => setAreasModal({ employeeId: currentEmployee.id, draft: currentEmployee.areas || [] })}
          className="w-full flex items-center justify-between px-4 py-3 rounded-sm"
          style={{ background: ink + "06", border: `1px solid ${ink}11`, color: ink }}
        >
          <span className="text-sm font-bold flex items-center gap-2">
            <MapPin size={16} /> Áreas
          </span>
          <ChevronRight size={16} />
        </button>
        <button
          onClick={() => setMetodoModal({ employeeId: currentEmployee.id, draft: { tipo: currentEmployee.metodo?.tipo || "foto" } })}
          className="w-full flex items-center justify-between px-4 py-3 rounded-sm"
          style={{ background: ink + "06", border: `1px solid ${ink}11`, color: ink }}
        >
          <span className="text-sm font-bold flex items-center gap-2">
            <Fingerprint size={16} /> Método de checado
          </span>
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

// ============================================================
// NOMINA TAB
// ============================================================
function NominaTab({ currentEmployee, today, paper, ink, brass, sage }) {
  const currentMonth = monthKeyOf();
  const [monthKey, setMonthKey] = useState(currentMonth);

  const days = Object.entries(currentEmployee?.checked || {})
    .filter(([key]) => key.startsWith(monthKey))
    .sort(([a], [b]) => a.localeCompare(b));

  const totals = days.reduce(
    (acc, [, dayData]) => {
      const entrada = dayData.entrada ? new Date(dayData.entrada) : null;
      const salida = dayData.salida ? new Date(dayData.salida) : null;
      if (entrada && salida) {
        acc.horas += (salida - entrada) / (1000 * 60 * 60);
      }
      if (dayData.entrada_retraso !== null && dayData.entrada_retraso !== undefined) {
        acc.dias_registrados++;
      }
      return acc;
    },
    { horas: 0, dias_registrados: 0 }
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => setMonthKey(shiftMonthKey(monthKey, -1))}>
          <ChevronLeft size={18} color={brass} />
        </button>
        <span className="text-sm font-bold" style={{ color: ink }}>
          {monthLabel(monthKey)}
        </span>
        <button onClick={() => setMonthKey(shiftMonthKey(monthKey, 1))}>
          <ChevronRight size={18} color={brass} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="rounded-sm p-4" style={{ background: brass + "18" }}>
          <p className="text-[10px] font-bold uppercase mb-1" style={{ color: brass }}>
            Horas
          </p>
          <p className="text-2xl font-black" style={{ color: ink }}>
            {totals.horas.toFixed(1)}
          </p>
        </div>
        <div className="rounded-sm p-4" style={{ background: sage + "18" }}>
          <p className="text-[10px] font-bold uppercase mb-1" style={{ color: sage }}>
            Días registrados
          </p>
          <p className="text-2xl font-black" style={{ color: ink }}>
            {totals.dias_registrados}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {days.map(([dateKey, dayData]) => (
          <div
            key={dateKey}
            className="flex items-center justify-between px-4 py-3 rounded-sm"
            style={{ background: ink + "06", border: `1px solid ${ink}11` }}
          >
            <span className="text-sm font-bold" style={{ color: ink }}>
              {formatDateLabel(dateKey, today)}
            </span>
            <span className="text-xs" style={{ color: ink + "77" }}>
              {dayData.entrada && dayData.salida ? `${hoursBetween(dayData.entrada, dayData.salida)}h` : "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// PROPINAS TAB
// ============================================================
function PropinasTab({ currentEmployee, employees, today, paper, ink, brass, sage, paprika }) {
  const [currentMonth, setCurrentMonth] = useState(monthKeyOf());

  const allDays = Object.entries(currentEmployee?.checked || {})
    .filter(([key]) => key.startsWith(currentMonth))
    .sort(([a], [b]) => a.localeCompare(b));

  const propinasData = allDays.map(([dateKey, dayData]) => {
    const schedule = getScheduleForDate(currentEmployee, dateKey);
    const dayOfWeek = new Date(dateKey + "T00:00:00").getDay();
    const scheduleDay = schedule?.[dayOfWeek];

    if (!scheduleDay?.enabled || !dayData.entrada) {
      return { dateKey, status: "sin_horario", entrada_retraso: null };
    }

    const entrada_retraso = dayData.entrada_retraso ?? (scheduleDay ? minutesLate(scheduleDay.start, dayData.entrada) : null);
    const tier = punctualityTier(entrada_retraso);

    return {
      dateKey,
      status: tier,
      entrada_retraso,
    };
  });

  const stats = propinasData.reduce(
    (acc, d) => {
      if (d.status === "bono") acc.bono++;
      else if (d.status === "propina") acc.propina++;
      else if (d.status === "ninguno") acc.ninguno++;
      return acc;
    },
    { bono: 0, propina: 0, ninguno: 0 }
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => setCurrentMonth(shiftMonthKey(currentMonth, -1))}>
          <ChevronLeft size={18} color={brass} />
        </button>
        <span className="text-sm font-bold" style={{ color: ink }}>
          {monthLabel(currentMonth)}
        </span>
        <button onClick={() => setCurrentMonth(shiftMonthKey(currentMonth, 1))}>
          <ChevronRight size={18} color={brass} />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-6">
        <div className="rounded-sm p-3 text-center" style={{ background: sage + "18" }}>
          <p className="text-[9px] font-bold uppercase mb-1" style={{ color: sage }}>
            Bono + Propina
          </p>
          <p className="text-xl font-black" style={{ color: ink }}>
            {stats.bono}
          </p>
        </div>
        <div className="rounded-sm p-3 text-center" style={{ background: brass + "18" }}>
          <p className="text-[9px] font-bold uppercase mb-1" style={{ color: brass }}>
            Solo Propina
          </p>
          <p className="text-xl font-black" style={{ color: ink }}>
            {stats.propina}
          </p>
        </div>
        <div className="rounded-sm p-3 text-center" style={{ background: paprika + "18" }}>
          <p className="text-[9px] font-bold uppercase mb-1" style={{ color: paprika }}>
            Sin Propina
          </p>
          <p className="text-xl font-black" style={{ color: ink }}>
            {stats.ninguno}
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        {propinasData.map(({ dateKey, status, entrada_retraso }) => {
          const meta = punctualityMeta(status, paprika, brass, sage);
          return (
            <div
              key={dateKey}
              className="flex items-center justify-between px-4 py-3 rounded-sm"
              style={{ background: (meta.color || ink) + "11", border: `1px solid ${(meta.color || ink)}22` }}
            >
              <div>
                <p className="text-sm font-bold" style={{ color: ink }}>
                  {formatDateLabel(dateKey, today)}
                </p>
                <p className="text-xs" style={{ color: meta.color }}>
                  {meta.label}
                </p>
              </div>
              <p className="text-xs font-bold" style={{ color: meta.color }}>
                {entrada_retraso !== null ? `${entrada_retraso}m` : "—"}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// METHOD MODAL
// ============================================================
function MethodModal({
  modal,
  setModal,
  handleCheckador,
  videoRef,
  canvasRef,
  fileInputRef,
  currentEmployee,
  areaList,
  paper,
  ink,
  brass,
  sage,
  paprika,
}) {
  const [fotoCapturada, setFotoCapturada] = useState(null);
  const [capturando, setCapturando] = useState(false);

  const capturePhoto = async () => {
    setCapturando(true);
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
    setFotoCapturada(dataUrl);
    setCapturando(false);
  };

  return (
    <div
      className="fixed inset-0 flex items-end sm:items-center justify-center z-50 p-4"
      style={{ background: "#00000099" }}
    >
      <div className="w-full max-w-sm rounded-sm p-5" style={{ background: paper, maxHeight: "88vh", overflowY: "auto" }}>
        {modal.step === "area" && (
          <>
            <p className="text-xs font-bold uppercase mb-4" style={{ color: ink, letterSpacing: "0.06em" }}>
              ¿En qué área trabajas hoy?
            </p>
            <div className="flex flex-col gap-2 mb-4">
              {areaList.map((area) => (
                <button
                  key={area}
                  onClick={() => setModal({ ...modal, step: "capturando", selectedArea: area })}
                  className="px-4 py-3 rounded-sm text-left font-bold text-sm"
                  style={{ background: brass + "18", border: `1px solid ${brass}44`, color: ink }}
                >
                  {area}
                </button>
              ))}
            </div>
            <button
              onClick={() => setModal(null)}
              className="w-full py-2.5 rounded-sm font-bold text-xs uppercase"
              style={{ border: `1px solid ${ink}33`, color: ink }}
            >
              Cancelar
            </button>
          </>
        )}

        {modal.step === "capturando" && (
          <>
            <p className="text-xs font-bold uppercase mb-3" style={{ color: brass, letterSpacing: "0.06em" }}>
              Foto con uniforme
            </p>
            {!fotoCapturada ? (
              <>
                <div
                  className="mb-4 rounded-sm overflow-hidden"
                  style={{
                    background: ink,
                    aspectRatio: "1",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    style={{ width: "100%", height: "100%" }}
                  />
                </div>
                <button
                  onClick={capturePhoto}
                  disabled={capturando}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-sm font-bold text-sm uppercase disabled:opacity-40"
                  style={{ background: sage, color: "#fff" }}
                >
                  <Camera size={16} />
                  {capturando ? "Capturando..." : "Tomar foto"}
                </button>
              </>
            ) : (
              <>
                <img src={fotoCapturada} alt="Capturada" className="w-full mb-4 rounded-sm" />
                <div className="flex gap-2">
                  <button
                    onClick={() => setFotoCapturada(null)}
                    className="flex-1 py-2.5 rounded-sm font-bold text-xs uppercase"
                    style={{ border: `1px solid ${ink}33`, color: ink }}
                  >
                    Retomar
                  </button>
                  <button
                    onClick={() => {
                      setModal({ ...modal, foto: fotoCapturada });
                      handleCheckador();
                    }}
                    className="flex-1 py-2.5 rounded-sm font-bold text-xs uppercase"
                    style={{ background: sage, color: "#fff" }}
                  >
                    Confirmar
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================
// ADMIN MODE
// ============================================================
function AdminMode({ employees, setEmployees, setMode, toast, showToast, paper, ink, brass, sage, paprika, steel }) {
  return (
    <div className="min-h-screen" style={{ background: paper }}>
      <div className="max-w-2xl mx-auto px-4 py-6">
        <button
          onClick={() => setMode("select")}
          className="mb-6 flex items-center gap-2 text-sm font-bold"
          style={{ color: brass }}
        >
          <ChevronLeft size={16} />
          Volver
        </button>

        <h1 className="text-2xl font-black mb-6" style={{ color: ink }}>
          Administrador
        </h1>

        <div className="space-y-4">
          {employees.map((emp) => (
            <div
              key={emp.id}
              className="p-4 rounded-sm border"
              style={{ background: ink + "02", borderColor: ink + "11" }}
            >
              <h3 className="font-bold mb-2" style={{ color: ink }}>
                {emp.name}
              </h3>
              <p className="text-xs" style={{ color: ink + "77" }}>
                {emp.email}
              </p>
            </div>
          ))}
        </div>
      </div>

      {toast && (
        <div
          className="fixed bottom-5 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-sm text-sm font-bold z-50 shadow-lg text-center"
          style={{ background: toast.color || sage, color: paper }}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
