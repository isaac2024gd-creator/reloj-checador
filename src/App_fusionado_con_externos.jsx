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
   CONFIGURACIÓN DE SUPABASE
   ============================================================ */
const SUPABASE_URL = "https://ciwfhbpcpygubsvtmwze.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_AF_54iVTwT25rhMrhWbFXQ_oW2z_NeF";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Storage helpers con Supabase
async function storageGet(key) {
  try {
    const { data, error } = await supabase
      .from("kv_store_reloj_checador")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    if (error) throw error;
    return data ? { value: data.value } : null;
  } catch {
    return null;
  }
}

async function storageSet(key, value) {
  try {
    await supabase
      .from("kv_store_reloj_checador")
      .upsert({ key, value, updated_at: new Date().toISOString() });
  } catch (e) {
    console.error("Storage error:", e);
  }
}

function scheduleSync(key, value) {
  storageSet(key, value);
}

// ---------- helpers ----------

function pad(n) {
  return String(n).padStart(2, "0");
}

function localDateKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatTime(iso) {
  if (!iso) return "—";
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

const DAY_NAMES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const DAY_SHORT = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const DEFAULT_AREAS = ["Cocina Caliente", "Cocina Fría", "Servicio", "Barra", "Almacén"];

function defaultSchedule() {
  const sched = {};
  for (let i = 0; i < 7; i++) sched[i] = { enabled: false, start: "09:00", end: "17:00" };
  return sched;
}

function getScheduleForDate(emp, dateKey) {
  const history = emp.scheduleHistory;
  if (!history || history.length === 0) return emp.schedule || null;
  let applicable = history[0].schedule;
  for (const version of history) {
    if (version.effectiveFrom <= dateKey) applicable = version.schedule;
    else break;
  }
  return applicable;
}

function minutesLate(scheduledStart, punchIso) {
  const punch = new Date(punchIso);
  const [h, m] = scheduledStart.split(":").map(Number);
  const scheduled = new Date(punch);
  scheduled.setHours(h, m, 0, 0);
  return Math.floor((punch - scheduled) / 60000);
}

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

function computeWorkedInRange(employeeId, startKey, endKey, recordsByDate) {
  let totalDias = 0;
  let diasPropina = 0;
  for (const dateKey of Object.keys(recordsByDate).sort()) {
    if (dateKey < startKey || dateKey > endKey) continue;
    const records = recordsByDate[dateKey] || [];
    const entrada = records.find((r) => r.employeeId === employeeId && r.type === "entrada");
    if (entrada) {
      totalDias++;
      if (entrada.punctuality === "bono" || entrada.punctuality === "propina") {
        diasPropina++;
      }
    }
  }
  return { totalDias, diasPropina };
}

// Color palette
const paper = "#fafaf8";
const ink = "#1a1a18";
const brass = "#B8860B";
const sage = "#4a7c59";
const paprika = "#d97706";
const steel = "#999";

// ====== FUNCIÓN CÁLCULO DE REPARTO (incluyendo externos) ======
function calcularRepartoPropinas(startKey, endKey, monto, employees, recordsByDate, externosPorDia) {
  // Candidatos empleados
  const candidatos = employees
    .map((emp) => {
      const w = computeWorkedInRange(emp.id, startKey, endKey, recordsByDate);
      return {
        employeeId: emp.id,
        employeeName: emp.name,
        diasTrabajados: w.totalDias,
        diasPropina: w.diasPropina,
        califica: w.diasPropina > 0,
        tipo: "empleado",
      };
    })
    .filter((c) => c.diasTrabajados > 0);

  // Candidatos externos (cuentan como 1 día cada uno)
  const externosEnRango = (externosPorDia || []).filter(
    (e) => e.fecha >= startKey && e.fecha <= endKey
  );
  const externoCandidatos = [];
  const externoPorId = {};
  for (const ext of externosEnRango) {
    if (!externoPorId[ext.externoId]) {
      externoPorId[ext.externoId] = {
        externoId: ext.externoId,
        nombre: ext.nombre,
        diasTrabajados: 0,
        diasPropina: 0,
      };
    }
    externoPorId[ext.externoId].diasTrabajados++;
    externoPorId[ext.externoId].diasPropina++;
  }
  for (const ext of Object.values(externoPorId)) {
    externoCandidatos.push({
      employeeId: ext.externoId,
      employeeName: ext.nombre,
      diasTrabajados: ext.diasTrabajados,
      diasPropina: ext.diasPropina,
      califica: ext.diasPropina > 0,
      tipo: "externo",
    });
  }

  // Combina empleados y externos
  const todosCandidatos = [...candidatos, ...externoCandidatos];
  const totalDiasPropina = todosCandidatos.reduce((s, c) => s + c.diasPropina, 0);
  const montoCentavos = Math.round((Number(monto) || 0) * 100);

  const lista = todosCandidatos
    .map((c) => {
      const centavos = totalDiasPropina > 0 ? Math.floor((montoCentavos * c.diasPropina) / totalDiasPropina) : 0;
      return { ...c, monto: centavos / 100 };
    })
    .sort((a, b) => (b.califica === a.califica ? a.employeeName.localeCompare(b.employeeName) : b.califica ? 1 : -1));

  const repartidoCentavos = lista.reduce((s, l) => s + Math.round(l.monto * 100), 0);
  const sobrante = (montoCentavos - repartidoCentavos) / 100;

  return { lista, sobrante };
}

export default function App() {
  // ====== Estado Global ======
  const [employees, setEmployees] = useState([]);
  const [tab, setTab] = useState("checador");
  const [adminPIN, setAdminPIN] = useState("");
  const [unlockedSession, setUnlockedSession] = useState(false);
  const [adminPINInput, setAdminPINInput] = useState("");
  const [recordsByDate, setRecordsByDate] = useState({});
  const [toast, setToast] = useState(null);

  // Propinas
  const [propinasPeriodoInicio, setPropinasPeriodoInicio] = useState(localDateKey());
  const [propinasPeriodoFin, setPropinasPeriodoFin] = useState(localDateKey());
  const [propinasMonto, setPropinasMonto] = useState("");
  const [propinasConfig, setPropinasConfig] = useState({ toleranciaMin: 15, frecuencia: "diaria", modoEntrega: "diaria" });
  const [propinasConfigDraft, setPropinasConfigDraft] = useState({ toleranciaMin: "15", frecuencia: "diaria", modoEntrega: "diaria" });
  const [showPropinasConfigEdit, setShowPropinasConfigEdit] = useState(false);

  // Externos (personal temporal)
  const [externosCatalogo, setExternosCatalogo] = useState([]);
  const [externosPorDia, setExternosPorDia] = useState([]);
  const [propinasFecha, setPropinasFecha] = useState(localDateKey());
  const [nuevoExternoNombre, setNuevoExternoNombre] = useState("");

  // Correcciones manuales
  const [showAjusteManual, setShowAjusteManual] = useState(false);
  const [ajusteEmpleadoId, setAjusteEmpleadoId] = useState("");
  const [ajusteFecha, setAjusteFecha] = useState(localDateKey());
  const [ajusteBono, setAjusteBono] = useState(false);
  const [ajustePropina, setAjustePropina] = useState(false);
  const [ajusteMotivo, setAjusteMotivo] = useState("");

  // ====== Load Data ======
  useEffect(() => {
    (async () => {
      try {
        const pin = await storageGet("admin_pin");
        if (pin) setAdminPIN(pin.value);

        const emps = await storageGet("employees");
        if (emps) setEmployees(JSON.parse(emps.value));

        const recs = await storageGet("records");
        if (recs) setRecordsByDate(JSON.parse(recs.value));

        const cfg = await storageGet("propinas_config");
        if (cfg) {
          const parsed = JSON.parse(cfg.value);
          setPropinasConfig(parsed);
          setPropinasConfigDraft({ ...parsed, toleranciaMin: String(parsed.toleranciaMin) });
        }

        const cat = await storageGet("personal_externo");
        if (cat) setExternosCatalogo(JSON.parse(cat.value));

        const dia = await storageGet("externos_por_dia");
        if (dia) setExternosPorDia(JSON.parse(dia.value));
      } catch (e) {
        console.error("Load error:", e);
      }
    })();
  }, []);

  // Recalcular rango de propinas si cambia frecuencia
  useEffect(() => {
    const hoy = new Date();
    if (propinasConfig.frecuencia === "semanal") {
      const inicio = new Date(hoy);
      inicio.setDate(hoy.getDate() - hoy.getDay());
      const fin = new Date(inicio);
      fin.setDate(inicio.getDate() + 6);
      setPropinasPeriodoInicio(localDateKey(inicio));
      setPropinasPeriodoFin(localDateKey(fin));
    } else if (propinasConfig.frecuencia === "mensual") {
      const inicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
      const fin = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);
      setPropinasPeriodoInicio(localDateKey(inicio));
      setPropinasPeriodoFin(localDateKey(fin));
    } else {
      setPropinasPeriodoInicio(localDateKey(hoy));
      setPropinasPeriodoFin(localDateKey(hoy));
    }
  }, [propinasConfig.frecuencia]);

  // ====== Funciones ======
  const showToast = (text, color = sage) => {
    setToast({ text, color });
    setTimeout(() => setToast(null), 3000);
  };

  function savePropinasConfig() {
    const cfg = {
      toleranciaMin: Number(propinasConfigDraft.toleranciaMin) || 0,
      frecuencia: propinasConfigDraft.frecuencia,
      modoEntrega: propinasConfigDraft.modoEntrega,
    };
    setPropinasConfig(cfg);
    scheduleSync("propinas_config", JSON.stringify(cfg));
    setShowPropinasConfigEdit(false);
    showToast("Configuración de propinas actualizada.", sage);
  }

  function agregarExternoAlDia(externo) {
    const yaEsta = externosPorDia.some((e) => e.fecha === propinasFecha && e.externoId === externo.id);
    if (yaEsta) return;
    const nuevo = { id: uid("extdia"), fecha: propinasFecha, nombre: externo.nombre, externoId: externo.id };
    const actualizado = [...externosPorDia, nuevo];
    setExternosPorDia(actualizado);
    scheduleSync("externos_por_dia", JSON.stringify(actualizado));
  }

  function crearYAgregarExterno() {
    const nombre = nuevoExternoNombre.trim();
    if (!nombre) return;
    const existente = externosCatalogo.find((e) => e.nombre.toLowerCase() === nombre.toLowerCase());
    const externo = existente || { id: uid("ext"), nombre };
    if (!existente) {
      const catalogoActualizado = [...externosCatalogo, externo];
      setExternosCatalogo(catalogoActualizado);
      scheduleSync("personal_externo", JSON.stringify(catalogoActualizado));
    }
    agregarExternoAlDia(externo);
    setNuevoExternoNombre("");
  }

  function quitarExternoDelDia(idAsignacion) {
    const actualizado = externosPorDia.filter((e) => e.id !== idAsignacion);
    setExternosPorDia(actualizado);
    scheduleSync("externos_por_dia", JSON.stringify(actualizado));
  }

  function aplicarCorreccionManual() {
    if (!ajusteEmpleadoId || !ajusteFecha || !ajusteMotivo.trim()) return;
    if (!ajusteBono && !ajustePropina) return;

    const dayRecords = recordsByDate[ajusteFecha] || [];
    const idx = dayRecords.findIndex((r) => r.employeeId === ajusteEmpleadoId && r.type === "entrada");
    if (idx === -1) {
      showToast("Esa persona no tiene una entrada registrada ese día.", paprika);
      return;
    }

    const nuevoTier = ajusteBono ? "bono" : "propina";
    const updatedDay = [...dayRecords];
    updatedDay[idx] = {
      ...updatedDay[idx],
      punctuality: nuevoTier,
      correccionManual: { motivo: ajusteMotivo.trim(), aplicadoEn: new Date().toISOString() },
    };
    const updatedAll = { ...recordsByDate, [ajusteFecha]: updatedDay };
    setRecordsByDate(updatedAll);
    scheduleSync("records", JSON.stringify(updatedAll));

    setAjusteEmpleadoId("");
    setAjusteMotivo("");
    setAjusteBono(false);
    setAjustePropina(false);
    showToast("Corrección aplicada.", sage);
    setShowAjusteManual(false);
  }

  // ====== Render ======
  return (
    <div className="min-h-screen flex flex-col" style={{ background: paper }}>
      {/* Header */}
      <div className="sticky top-0 z-40 border-b px-5 py-4" style={{ borderColor: ink + "11" }}>
        <h1 className="text-lg font-black" style={{ color: ink }}>
          Reloj Checador
        </h1>
        <p className="text-xs" style={{ color: ink + "77" }}>
          Restaurante Bondiola
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b px-5 flex gap-4" style={{ borderColor: ink + "11" }}>
        {[
          { id: "checador", label: "Checador", icon: Clock },
          { id: "nomina", label: "Nómina", icon: FileSignature },
          { id: "propinas", label: "Propinas", icon: Coins },
          { id: "admin", label: "Admin", icon: Lock },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="py-3 px-2 border-b-2 font-bold text-xs uppercase transition"
            style={{
              borderColor: tab === t.id ? brass : "transparent",
              color: tab === t.id ? brass : ink + "77",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 px-5 py-6 overflow-y-auto">
        {tab === "propinas" && (
          <div className="space-y-4 max-w-2xl">
            {/* Config */}
            <div className="rounded-sm p-4" style={{ background: paper, border: `1px solid ${ink}11` }}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-bold uppercase" style={{ color: ink }}>
                  Configuración
                </h3>
                <button
                  onClick={() => setShowPropinasConfigEdit(!showPropinasConfigEdit)}
                  className="text-xs font-bold px-2 py-1 rounded-sm"
                  style={{ border: `1px solid ${ink}33`, color: ink }}
                >
                  {showPropinasConfigEdit ? "Cancelar" : "Editar"}
                </button>
              </div>

              {!showPropinasConfigEdit ? (
                <div className="space-y-1 text-xs" style={{ color: ink }}>
                  <div>Tolerancia: <strong style={{ color: sage }}>{propinasConfig.toleranciaMin} min</strong></div>
                  <div>Frecuencia: <strong>{propinasConfig.frecuencia}</strong></div>
                  <div>Entrega: <strong>{propinasConfig.modoEntrega}</strong></div>
                </div>
              ) : (
                <div className="space-y-2">
                  <input
                    value={propinasConfigDraft.toleranciaMin}
                    onChange={(e) => setPropinasConfigDraft((d) => ({ ...d, toleranciaMin: e.target.value }))}
                    inputMode="numeric"
                    placeholder="Minutos"
                    className="w-full px-2 py-1.5 rounded-sm text-xs outline-none"
                    style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                  />
                  <select
                    value={propinasConfigDraft.frecuencia}
                    onChange={(e) => setPropinasConfigDraft((d) => ({ ...d, frecuencia: e.target.value }))}
                    className="w-full px-2 py-1.5 rounded-sm text-xs outline-none"
                    style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                  >
                    <option value="diaria">Diaria</option>
                    <option value="semanal">Semanal</option>
                    <option value="mensual">Mensual</option>
                  </select>
                  <button
                    onClick={savePropinasConfig}
                    className="w-full py-2 rounded-sm font-bold text-xs uppercase"
                    style={{ background: sage, color: paper }}
                  >
                    Guardar
                  </button>
                </div>
              )}
            </div>

            {/* Reparto */}
            <div className="rounded-sm p-4" style={{ background: paper, border: `1px solid ${ink}11` }}>
              <h3 className="text-xs font-bold uppercase mb-3" style={{ color: ink }}>
                Reparto de propinas
              </h3>

              <div className="flex gap-2 mb-3">
                <input
                  type="date"
                  value={propinasPeriodoInicio}
                  onChange={(e) => setPropinasPeriodoInicio(e.target.value)}
                  className="flex-1 px-2 py-1.5 rounded-sm text-xs outline-none"
                  style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                />
                {propinasConfig.frecuencia !== "diaria" && (
                  <input
                    type="date"
                    value={propinasPeriodoFin}
                    onChange={(e) => setPropinasPeriodoFin(e.target.value)}
                    className="flex-1 px-2 py-1.5 rounded-sm text-xs outline-none"
                    style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                  />
                )}
                <input
                  value={propinasMonto}
                  onChange={(e) => setPropinasMonto(e.target.value.replace(/[^0-9.]/g, ""))}
                  placeholder="Monto"
                  inputMode="decimal"
                  className="flex-1 px-2 py-1.5 rounded-sm text-xs outline-none"
                  style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                />
              </div>

              {(() => {
                const fin = propinasConfig.frecuencia === "diaria" ? propinasPeriodoInicio : propinasPeriodoFin;
                const { lista, sobrante } = calcularRepartoPropinas(propinasPeriodoInicio, fin, propinasMonto, employees, recordsByDate, externosPorDia);
                return (
                  <>
                    {lista.length === 0 ? (
                      <p className="text-xs text-center py-3" style={{ color: ink + "77" }}>
                        Sin registros en ese periodo
                      </p>
                    ) : (
                      <div className="space-y-1">
                        {lista.map((p) => (
                          <div key={p.employeeId} className="flex justify-between px-2 py-1.5 rounded-sm text-xs" style={{ background: ink + "06" }}>
                            <span style={{ color: ink }}>
                              {p.employeeName} <span style={{ color: ink + "77", fontSize: "0.8em" }}>({p.diasPropina}d)</span>
                            </span>
                            <strong style={{ color: sage }}>$ {p.monto.toFixed(2)}</strong>
                          </div>
                        ))}
                        {sobrante > 0 && (
                          <div className="flex justify-between px-2 py-1.5 rounded-sm text-xs" style={{ background: paprika + "18" }}>
                            <span style={{ color: paprika }}>Sobrante</span>
                            <strong style={{ color: paprika }}>$ {sobrante.toFixed(2)}</strong>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            {/* Personal Externo */}
            <div className="rounded-sm p-4" style={{ background: paper, border: `1px solid ${ink}11` }}>
              <h3 className="text-xs font-bold uppercase mb-3" style={{ color: ink }}>
                Personal Externo ({propinasFecha})
              </h3>

              <div className="flex gap-2 mb-3">
                <input
                  type="date"
                  value={propinasFecha}
                  onChange={(e) => setPropinasFecha(e.target.value)}
                  className="flex-1 px-2 py-1.5 rounded-sm text-xs outline-none"
                  style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                />
              </div>

              {/* Externos ya agregados hoy */}
              {externosPorDia.filter((e) => e.fecha === propinasFecha).length > 0 && (
                <div className="mb-3 space-y-1">
                  {externosPorDia.filter((e) => e.fecha === propinasFecha).map((e) => (
                    <div key={e.id} className="flex items-center justify-between px-2 py-1.5 rounded-sm text-xs" style={{ background: sage + "18" }}>
                      <span style={{ color: ink }}>{e.nombre}</span>
                      <button onClick={() => quitarExternoDelDia(e.id)}>
                        <X size={14} color={paprika} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Recurrentes */}
              {externosCatalogo.filter((ext) => !externosPorDia.some((e) => e.fecha === propinasFecha && e.externoId === ext.id)).length > 0 && (
                <div className="mb-3">
                  <p className="text-[10px] mb-2" style={{ color: ink + "88" }}>Recurrentes:</p>
                  <div className="flex flex-wrap gap-2">
                    {externosCatalogo
                      .filter((ext) => !externosPorDia.some((e) => e.fecha === propinasFecha && e.externoId === ext.id))
                      .map((ext) => (
                        <button
                          key={ext.id}
                          onClick={() => agregarExternoAlDia(ext)}
                          className="px-2 py-1 rounded-sm text-xs font-bold"
                          style={{ border: `1px solid ${ink}33`, color: ink }}
                        >
                          + {ext.nombre}
                        </button>
                      ))}
                  </div>
                </div>
              )}

              {/* Agregar nuevo */}
              <div className="flex gap-2">
                <input
                  value={nuevoExternoNombre}
                  onChange={(e) => setNuevoExternoNombre(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && crearYAgregarExterno()}
                  placeholder="Nombre externo"
                  className="flex-1 px-2 py-1.5 rounded-sm text-xs outline-none"
                  style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                />
                <button
                  onClick={crearYAgregarExterno}
                  disabled={!nuevoExternoNombre.trim()}
                  className="px-3 py-1.5 rounded-sm font-bold text-xs disabled:opacity-40"
                  style={{ background: brass, color: ink }}
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>

            {/* Ajustes Manuales */}
            <div className="rounded-sm p-4" style={{ background: paper, border: `1px solid ${ink}11` }}>
              <h3 className="text-xs font-bold uppercase mb-3" style={{ color: ink }}>
                Ajustes Manuales
              </h3>
              <button
                onClick={() => setShowAjusteManual(!showAjusteManual)}
                className="w-full py-2 rounded-sm font-bold text-xs uppercase"
                style={{ background: brass + "18", color: brass, border: `1px solid ${brass}33` }}
              >
                {showAjusteManual ? "Cancelar" : "+ Agregar ajuste"}
              </button>

              {showAjusteManual && (
                <div className="mt-3 space-y-2">
                  <select
                    value={ajusteEmpleadoId}
                    onChange={(e) => setAjusteEmpleadoId(e.target.value)}
                    className="w-full px-2 py-1.5 rounded-sm text-xs outline-none"
                    style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                  >
                    <option value="">Selecciona empleado</option>
                    {employees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>

                  <input
                    type="date"
                    value={ajusteFecha}
                    onChange={(e) => setAjusteFecha(e.target.value)}
                    className="w-full px-2 py-1.5 rounded-sm text-xs outline-none"
                    style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                  />

                  <textarea
                    value={ajusteMotivo}
                    onChange={(e) => setAjusteMotivo(e.target.value)}
                    placeholder="Motivo de la corrección"
                    className="w-full px-2 py-1.5 rounded-sm text-xs outline-none"
                    style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink, minHeight: "60px" }}
                  />

                  <div className="flex gap-2">
                    <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: ink }}>
                      <input
                        type="checkbox"
                        checked={ajusteBono}
                        onChange={(e) => setAjusteBono(e.target.checked)}
                      />
                      Bono
                    </label>
                    <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: ink }}>
                      <input
                        type="checkbox"
                        checked={ajustePropina}
                        onChange={(e) => setAjustePropina(e.target.checked)}
                      />
                      Propina
                    </label>
                  </div>

                  <button
                    onClick={aplicarCorreccionManual}
                    className="w-full py-2 rounded-sm font-bold text-xs uppercase"
                    style={{ background: sage, color: paper }}
                  >
                    Aplicar corrección
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "checador" && (
          <div className="text-center py-12" style={{ color: ink + "77" }}>
            <Clock size={48} style={{ margin: "0 auto", marginBottom: "16px", color: brass }} />
            <p className="text-sm">Modulo Checador en construcción</p>
          </div>
        )}

        {tab === "nomina" && (
          <div className="text-center py-12" style={{ color: ink + "77" }}>
            <FileSignature size={48} style={{ margin: "0 auto", marginBottom: "16px", color: brass }} />
            <p className="text-sm">Modulo Nómina en construcción</p>
          </div>
        )}

        {tab === "admin" && (
          <div style={{ color: ink + "77" }}>
            <button
              onClick={() => {
                const pin = prompt("Ingresa PIN de admin:");
                if (pin === adminPIN) {
                  setUnlockedSession(true);
                  showToast("✓ Acceso otorgado", sage);
                } else {
                  showToast("PIN incorrecto", paprika);
                }
              }}
              className="w-full py-3 rounded-sm font-bold text-sm uppercase"
              style={{ background: sage, color: paper }}
            >
              <Lock size={16} style={{ display: "inline-block", marginRight: "8px" }} />
              Desbloquear Admin
            </button>

            {unlockedSession && (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-bold" style={{ color: sage }}>✓ Sesión desbloqueada</p>
                <button
                  onClick={() => {
                    const newPin = prompt("Nuevo PIN (4 dígitos):");
                    if (newPin && newPin.length === 4) {
                      setAdminPIN(newPin);
                      scheduleSync("admin_pin", newPin);
                      showToast("PIN actualizado", sage);
                    }
                  }}
                  className="w-full py-2 rounded-sm text-xs font-bold uppercase"
                  style={{ border: `1px solid ${ink}33`, color: ink }}
                >
                  Cambiar PIN
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-5 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-sm text-sm font-bold z-50 text-center"
          style={{ background: toast.color, color: paper, maxWidth: "90%" }}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
