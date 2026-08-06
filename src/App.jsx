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
} from "lucide-react";

/* ============================================================
   CONFIGURACIÓN DE SUPABASE — PEGA AQUÍ TUS DATOS
   Los obtienes en tu proyecto de Supabase: Settings → API
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
  return Math.round((punch - scheduled) / 60000);
}

// clasifica la puntualidad según la tolerancia: 10 min para bono, 15 min para propinas
function punctualityTier(mins) {
  if (mins === null || mins === undefined) return null;
  if (mins <= 10) return "bono";
  if (mins <= 15) return "propina";
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
  if (diffMs <= 0) return null;
  return Math.round((diffMs / 3600000) * 10) / 10; // 1 decimal
}

// cruza el horario VIGENTE en cada fecha (no siempre el actual) contra los registros reales del mes
function buildEmployeeMonthReport(emp, monthKeyStr, recordsByDate) {
  const [year, month] = monthKeyStr.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const rows = [];

  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(year, month - 1, d);
    const dateKey = `${year}-${pad(month)}-${pad(d)}`;
    const weekday = dateObj.getDay();
    const daySchedule = getScheduleForDate(emp, dateKey)?.[weekday];
    const scheduled = !!daySchedule?.enabled;
    const dayRecords = (recordsByDate[dateKey] || []).filter((r) => r.employeeId === emp.id);
    const entrada = dayRecords.find((r) => r.type === "entrada");
    const salida = [...dayRecords].reverse().find((r) => r.type === "salida");

    if (!scheduled && !entrada && !salida) continue; // día sin relevancia para este empleado

    const hoursWorked = entrada && salida ? hoursBetween(entrada.time, salida.time) : null;

    rows.push({
      dateKey,
      dayNum: d,
      dayLabel: DAY_SHORT[weekday],
      weekNum: weekOfMonth(dateObj),
      scheduled,
      scheduledStart: daySchedule?.start || null,
      scheduledEnd: daySchedule?.end || null,
      entradaTime: entrada ? formatTime(entrada.time) : null,
      salidaTime: salida ? formatTime(salida.time) : null,
      punctuality: entrada?.punctuality || null,
      minutesLate: entrada?.minutesLate ?? null,
      falta: scheduled && !entrada,
      retardo: !!entrada && (entrada.minutesLate ?? 0) > 0,
      hoursWorked,
    });
  }

  const weekNums = [...new Set(rows.map((r) => r.weekNum))].sort((a, b) => a - b);
  const weeks = weekNums.map((wn) => {
    const weekRows = rows.filter((r) => r.weekNum === wn);
    const firstDay = weekRows[0]?.dayNum;
    const lastDay = weekRows[weekRows.length - 1]?.dayNum;
    return {
      weekNum: wn,
      label: firstDay === lastDay ? `Semana ${wn} (día ${firstDay})` : `Semana ${wn} (días ${firstDay}–${lastDay})`,
      diasTrabajados: weekRows.filter((r) => r.entradaTime).length,
      horas: Math.round(weekRows.reduce((s, r) => s + (r.hoursWorked || 0), 0) * 10) / 10,
      retardos: weekRows.filter((r) => r.retardo).length,
      faltas: weekRows.filter((r) => r.falta).length,
    };
  });

  return {
    rows,
    weeks,
    diasProgramados: rows.filter((r) => r.scheduled).length,
    diasTrabajados: rows.filter((r) => r.entradaTime).length,
    diasBono: rows.filter((r) => r.punctuality === "bono").length,
    diasPropina: rows.filter((r) => r.punctuality === "bono" || r.punctuality === "propina").length,
    diasSinTolerancia: rows.filter((r) => r.punctuality === "ninguno").length,
    diasFalta: rows.filter((r) => r.falta).length,
    diasRetardo: rows.filter((r) => r.retardo).length,
    horasTotalMes: Math.round(rows.reduce((s, r) => s + (r.hoursWorked || 0), 0) * 10) / 10,
  };
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// arma un documento HTML autocontenido (sin dependencias externas) con el resumen del mes,
// listo para descargar, abrir en cualquier navegador e imprimir/guardar como PDF
function buildMonthSummaryHtml(monthKeyStr, employees, recordsByDate) {
  const reportsToShow = employees
    .map((emp) => ({ emp, report: buildEmployeeMonthReport(emp, monthKeyStr, recordsByDate) }))
    .filter(({ report }) => report.rows.length > 0);

  const resultLabel = (r) =>
    r.punctuality === "bono"
      ? "Bono + propina"
      : r.punctuality === "propina"
      ? "Solo propina"
      : r.punctuality === "ninguno"
      ? "Sin bono/propina"
      : r.falta
      ? "Falta"
      : "—";

  const pagesHtml = reportsToShow
    .map(
      ({ emp, report }) => `
    <section class="report-page">
      <h1>Resumen mensual de asistencia</h1>
      <p class="subtitle">Restaurante Bondiola · ${escapeHtml(monthLabel(monthKeyStr))}</p>
      <div class="meta">
        <div><strong>Empleado:</strong> ${escapeHtml(emp.name)}</div>
        <div><strong>Puesto:</strong> ${escapeHtml(emp.puesto)}</div>
        <div><strong>Horario asignado:</strong> ${escapeHtml(scheduleSummary(getScheduleForDate(emp, `${monthKeyStr}-01`)))}</div>
      </div>
      <table>
        <thead><tr><th>Fecha</th><th>Programado</th><th>Entrada</th><th>Salida</th><th>Horas</th><th>Min. tarde</th><th>Resultado</th></tr></thead>
        <tbody>
          ${report.rows
            .map(
              (r) => `<tr>
            <td>${escapeHtml(r.dayLabel)} ${r.dayNum}</td>
            <td>${r.scheduled ? `${r.scheduledStart}–${r.scheduledEnd}` : "—"}</td>
            <td>${r.entradaTime || (r.falta ? "FALTA" : "—")}</td>
            <td>${r.salidaTime || "—"}</td>
            <td>${r.hoursWorked !== null ? r.hoursWorked : "—"}</td>
            <td>${r.minutesLate !== null ? r.minutesLate : "—"}</td>
            <td>${resultLabel(r)}</td>
          </tr>`
            )
            .join("")}
        </tbody>
      </table>
      <h2>Desglose semanal</h2>
      <table>
        <thead><tr><th>Semana</th><th>Días trabajados</th><th>Horas</th><th>Retardos</th><th>Faltas</th></tr></thead>
        <tbody>
          ${report.weeks
            .map(
              (w) =>
                `<tr><td>${escapeHtml(w.label)}</td><td>${w.diasTrabajados}</td><td>${w.horas}</td><td>${w.retardos}</td><td>${w.faltas}</td></tr>`
            )
            .join("")}
        </tbody>
      </table>
      <div class="totals">
        <span>Días programados: <strong>${report.diasProgramados}</strong></span>
        <span>Días trabajados: <strong>${report.diasTrabajados}</strong></span>
        <span>Horas trabajadas: <strong>${report.horasTotalMes}</strong></span>
        <span>Retardos: <strong>${report.diasRetardo}</strong></span>
        <span>Faltas: <strong>${report.diasFalta}</strong></span>
        <span>Con bono: <strong>${report.diasBono}</strong></span>
        <span>Con propina: <strong>${report.diasPropina}</strong></span>
      </div>
      <p class="agreement">Al firmar este documento, el empleado y el encargado en turno confirman estar de
      acuerdo con el horario asignado y los días efectivamente cumplidos durante el mes indicado.</p>
      <div class="signatures">
        <div><div class="line">Firma del Encargado en turno</div><div class="sublabel">Nombre y fecha</div></div>
        <div><div class="line">Firma del Empleado</div><div class="sublabel">Nombre y fecha</div></div>
      </div>
    </section>`
    )
    .join("");

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Resumen mensual — ${escapeHtml(monthLabel(monthKeyStr))}</title>
<style>
  body { font-family: Helvetica, Arial, sans-serif; color: #211F1B; margin: 0; }
  .report-page { max-width: 720px; margin: 0 auto; padding: 2rem; page-break-after: always; }
  h1 { font-size: 1.15rem; font-weight: 900; text-transform: uppercase; margin: 0; }
  .subtitle { font-size: 0.82rem; color: #21201b99; margin: 2px 0 0; }
  .meta { margin-top: 1rem; font-size: 0.85rem; line-height: 1.6; }
  table { width: 100%; margin-top: 1rem; font-size: 0.72rem; border-collapse: collapse; }
  th, td { text-align: left; padding: 4px 6px; }
  thead tr { border-bottom: 1px solid #21201b55; }
  tbody tr { border-bottom: 1px solid #21201b15; }
  h2 { font-size: 0.78rem; text-transform: uppercase; margin-top: 1.2rem; }
  .totals { margin-top: 1rem; font-size: 0.8rem; display: flex; gap: 1.25rem; flex-wrap: wrap; }
  .agreement { margin-top: 2rem; font-size: 0.78rem; line-height: 1.5; color: #211f1bcc; }
  .signatures { margin-top: 3rem; display: flex; justify-content: space-between; gap: 2rem; }
  .signatures > div { flex: 1; text-align: center; }
  .line { border-top: 1px solid #211F1B; padding-top: 4px; font-size: 0.78rem; }
  .sublabel { font-size: 0.65rem; color: #21201b77; margin-top: 2px; }
  @media print { .report-page { page-break-after: always; } }
</style>
</head>
<body>
${pagesHtml || `<p style="padding:2rem;">No hay días programados ni registros para ${escapeHtml(monthLabel(monthKeyStr))}.</p>`}
</body>
</html>`;
}

const POLL_MS = 45000;

// ---------- storage helpers backed by Supabase (kv_store table) ----------
// Ya no existe distinción "compartido/local": Supabase es la única fuente de
// verdad para todos los dispositivos, siempre.

async function storageGet(key) {
  try {
    const v = await kvGet(key);
    return v === null || v === undefined ? null : { value: v };
  } catch (err) {
    console.error(`Error leyendo "${key}" de Supabase:`, err);
    return null;
  }
}

async function storageSet(key, value) {
  // deja que el error se propague: la cola de sincronización (scheduleSync)
  // lo reintenta sola en segundo plano si falla.
  return kvSet(key, value);
}

// ---------- fotos guardadas localmente en este dispositivo (IndexedDB) ----------
// Este equipo es fijo, así que las fotos NO se suben a Supabase — se quedan aquí,
// solo se sincroniza el dato liviano (nombre, hora, tipo) en la nube.

const PHOTO_DB_NAME = "reloj_checador_fotos";
const PHOTO_STORE_NAME = "photos";

function openPhotoDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(PHOTO_DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(PHOTO_STORE_NAME)) {
        req.result.createObjectStore(PHOTO_STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function savePhotoLocal(id, dataUrl) {
  const db = await openPhotoDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE_NAME, "readwrite");
    tx.objectStore(PHOTO_STORE_NAME).put(dataUrl, id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function getPhotoLocal(id) {
  const db = await openPhotoDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE_NAME, "readonly");
    const req = tx.objectStore(PHOTO_STORE_NAME).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function deletePhotoLocal(id) {
  try {
    const db = await openPhotoDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(PHOTO_STORE_NAME, "readwrite");
      tx.objectStore(PHOTO_STORE_NAME).delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // limpieza de mejor esfuerzo; si falla no es grave
  }
}

// ---------- main component ----------

export default function RelojChecador() {
  const [tab, setTab] = useState("checador");

  const [employees, setEmployees] = useState([]);
  const [loadingEmployees, setLoadingEmployees] = useState(true);
  const [newName, setNewName] = useState("");
  const [newPuesto, setNewPuesto] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const [selectedEmployeeId, setSelectedEmployeeId] = useState(null);

  // week log: { [dateKey]: record[] }
  const [recordsByDate, setRecordsByDate] = useState({});
  const [loadingWeek, setLoadingWeek] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

  // ---------- caché en memoria de fotos leídas desde IndexedDB ----------
  const [photoCache, setPhotoCache] = useState({}); // recordId -> dataUrl | null
  const loadingPhotoIdsRef = useRef(new Set());

  useEffect(() => {
    const idsNeeded = Object.values(recordsByDate)
      .flat()
      .filter((r) => r.hasPhoto)
      .map((r) => r.id);

    idsNeeded.forEach((id) => {
      if (loadingPhotoIdsRef.current.has(id)) return;
      loadingPhotoIdsRef.current.add(id);
      getPhotoLocal(id)
        .then((dataUrl) => {
          setPhotoCache((prev) => (id in prev ? prev : { ...prev, [id]: dataUrl || null }));
        })
        .catch(() => {
          setPhotoCache((prev) => (id in prev ? prev : { ...prev, [id]: null }));
        });
    });
  }, [recordsByDate]);

  const [punchModal, setPunchModal] = useState(null); // {type, photo}
  const [toast, setToast] = useState(null);
  const fileInputRef = useRef(null);

  // ---------- background sync queue (optimistic UI, never blocks, never reverts) ----------
  const pendingValuesRef = useRef({}); // key -> latest JSON string awaiting sync
  const syncingRef = useRef({}); // key -> in-flight flag
  const [pendingKeys, setPendingKeys] = useState({}); // key -> true, drives the small status dot

  const attemptSync = useCallback(
    async (key) => {
      if (syncingRef.current[key]) return;
      const valueAtStart = pendingValuesRef.current[key];
      if (valueAtStart === undefined) return;
      syncingRef.current[key] = true;
      try {
        await storageSet(key, valueAtStart);
        if (pendingValuesRef.current[key] === valueAtStart) {
          delete pendingValuesRef.current[key];
          setPendingKeys((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
        }
      } catch (err) {
        console.error(`Sincronización pendiente de "${key}":`, err);
        // se queda en la cola; el intervalo de abajo lo reintenta solo
      } finally {
        syncingRef.current[key] = false;
      }
    },
    [storageSet]
  );

  const scheduleSync = useCallback(
    (key, value) => {
      pendingValuesRef.current[key] = value;
      setPendingKeys((prev) => ({ ...prev, [key]: true }));
      attemptSync(key);
    },
    [attemptSync]
  );

  useEffect(() => {
    const id = setInterval(() => {
      Object.keys(pendingValuesRef.current).forEach((key) => attemptSync(key));
    }, 6000);
    return () => clearInterval(id);
  }, [attemptSync]);

  const today = localDateKey();

  // ---------- mes seleccionado en la Bitácora ----------
  const [selectedMonth, setSelectedMonth] = useState(monthKeyOf());
  const monthDateKeys = Object.keys(recordsByDate)
    .filter((d) => d.startsWith(selectedMonth))
    .sort()
    .reverse();

  // ---------- resumen mensual imprimible ----------
  const [printView, setPrintView] = useState(null); // { month: "YYYY-MM" } | null
  const [confirmPurgeMonth, setConfirmPurgeMonth] = useState(false);
  const [showDriveHelp, setShowDriveHelp] = useState(false);

  useEffect(() => {
    setConfirmPurgeMonth(false);
    setShowDriveHelp(false);
  }, [printView]);

  // Descarga el resumen ya formateado (documento HTML con tablas y líneas de firma),
  // listo para abrir en cualquier navegador e imprimir o guardar como PDF.
  function downloadMonthSummary(monthKeyStr) {
    const html = buildMonthSummaryHtml(monthKeyStr, employees, recordsByDate);
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `resumen-${monthKeyStr}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setToast({ color: sage, text: "Resumen descargado — ábrelo en tu navegador para verlo o imprimirlo." });
  }

  // Descarga un respaldo JSON del mes (registros + personal) para subirlo a Drive a mano.
  // Nota: la subida automática a Drive requiere configurar credenciales de la API de Google
  // (pendiente); mientras tanto este botón genera el archivo para subirlo manualmente.
  function downloadMonthBackup(monthKeyStr) {
    const monthRecords = {};
    Object.keys(recordsByDate)
      .filter((d) => d.startsWith(monthKeyStr))
      .forEach((d) => {
        monthRecords[d] = recordsByDate[d];
      });
    const payload = {
      month: monthKeyStr,
      generatedAt: new Date().toISOString(),
      employees: employees.map((e) => ({ id: e.id, name: e.name, puesto: e.puesto, schedule: getScheduleForDate(e, `${monthKeyStr}-01`) })),
      records: monthRecords,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reloj-checador-${monthKeyStr}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setToast({ color: sage, text: "Respaldo descargado — súbelo a Drive y luego puedes borrar el mes." });
  }

  function purgeMonth(monthKeyStr) {
    const kept = {};
    Object.keys(recordsByDate).forEach((d) => {
      if (!d.startsWith(monthKeyStr)) kept[d] = recordsByDate[d];
    });
    cleanupOrphanedPhotos(recordsByDate, kept);
    setRecordsByDate(kept);
    scheduleSync("records", JSON.stringify(kept));
    setConfirmPurgeMonth(false);
    setToast({ color: sage, text: `Datos de ${monthLabel(monthKeyStr)} borrados de este dispositivo.` });
  }

  // ---------- access pin (protects Bitácora and adding personal) ----------
  const [pin, setPin] = useState(undefined); // undefined = cargando, null = sin configurar, string = clave
  const [unlockedSession, setUnlockedSession] = useState(false);
  const [pinModal, setPinModal] = useState(null); // {mode:'setup'|'unlock'|'change', target, value, confirmValue, error}

  useEffect(() => {
    (async () => {
      try {
        const r = await storageGet("access_pin");
        setPin(r ? r.value : null);
      } catch {
        setPin(null);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function requestUnlock(target) {
    if (unlockedSession) {
      if (target === "bitacora") setTab("bitacora");
      return;
    }
    if (!pin) {
      setPinModal({ mode: "setup", target, value: "", confirmValue: "", error: "" });
    } else {
      setPinModal({ mode: "unlock", target, value: "", error: "" });
    }
  }

  function openChangePin() {
    setPinModal({ mode: "change", target: null, value: "", confirmValue: "", error: "" });
  }

  function lockNow() {
    setUnlockedSession(false);
    if (tab === "bitacora") setTab("checador");
  }

  function submitPin() {
    if (!pinModal) return;
    const digits = pinModal.value.trim();

    if (pinModal.mode === "unlock") {
      if (digits !== pin) {
        setPinModal((m) => ({ ...m, value: "", error: "Clave incorrecta." }));
        return;
      }
      setUnlockedSession(true);
      const target = pinModal.target;
      setPinModal(null);
      if (target === "bitacora") setTab("bitacora");
      return;
    }

    // setup / change
    if (digits.length < 4) {
      setPinModal((m) => ({ ...m, error: "Usa al menos 4 dígitos." }));
      return;
    }
    if (digits !== pinModal.confirmValue.trim()) {
      setPinModal((m) => ({ ...m, error: "Las claves no coinciden." }));
      return;
    }
    setPin(digits);
    scheduleSync("access_pin", digits);
    setUnlockedSession(true);
    const target = pinModal.target;
    setPinModal(null);
    if (target === "bitacora") setTab("bitacora");
  }

  // ---------- load employees ----------

  const loadEmployees = useCallback(async () => {
    setLoadingEmployees(true);
    try {
      const r = await storageGet("employees");
      setEmployees(r ? JSON.parse(r.value) : []);
    } catch {
      setEmployees([]);
    }
    setLoadingEmployees(false);
  }, []);

  // ---------- load week (single 'records' key holding { date: record[] }) ----------

  function pruneOldDates(allRecords, keepMonths = 4) {
    // conserva los últimos `keepMonths` meses completos, para que siempre haya
    // datos disponibles al generar el resumen del mes recién cerrado.
    const dates = Object.keys(allRecords).sort().reverse(); // más reciente primero
    const monthsSeen = new Set();
    const kept = {};
    for (const d of dates) {
      monthsSeen.add(d.slice(0, 7));
      if (monthsSeen.size > keepMonths) break;
      kept[d] = allRecords[d];
    }
    return kept;
  }

  // borra en segundo plano las fotos locales de registros que ya se podaron
  function cleanupOrphanedPhotos(prevRecordsByDate, nextRecordsByDate) {
    const nextIds = new Set(
      Object.values(nextRecordsByDate)
        .flat()
        .map((r) => r.id)
    );
    Object.values(prevRecordsByDate)
      .flat()
      .forEach((r) => {
        if (r.hasPhoto && !nextIds.has(r.id)) {
          deletePhotoLocal(r.id);
          setPhotoCache((prev) => {
            if (!(r.id in prev)) return prev;
            const next = { ...prev };
            delete next[r.id];
            return next;
          });
        }
      });
  }

  const loadRecords = useCallback(async (showSpinner) => {
    if (showSpinner) setLoadingWeek(true);
    try {
      const r = await storageGet("records");
      const all = r ? JSON.parse(r.value) : {};
      setRecordsByDate(all);
    } catch {
      // keep whatever we already have rather than wiping it on a transient failure
    }
    setLastUpdated(new Date());
    if (showSpinner) setLoadingWeek(false);
  }, []);

  useEffect(() => {
    loadEmployees();
    loadRecords(true);
  }, [loadEmployees, loadRecords]);

  // poll for near real-time updates (status chips on Checador depend on this too)
  useEffect(() => {
    const id = setInterval(() => loadRecords(false), POLL_MS);
    return () => clearInterval(id);
  }, [loadRecords]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  // ---------- employee crud ----------

  function saveEmployeesList(list) {
    setEmployees(list);
    scheduleSync("employees", JSON.stringify(list));
  }

  function addEmployee() {
    const name = newName.trim();
    if (!name) return;
    const initialSchedule = defaultSchedule();
    const emp = {
      id: uid("emp"),
      name,
      puesto: newPuesto.trim() || "Sin puesto",
      active: true,
      schedule: initialSchedule, // espejo del horario vigente, por conveniencia
      scheduleHistory: [{ effectiveFrom: localDateKey(), schedule: initialSchedule }],
    };
    saveEmployeesList([...employees, emp]);
    setNewName("");
    setNewPuesto("");
  }

  function toggleActive(id) {
    saveEmployeesList(employees.map((e) => (e.id === id ? { ...e, active: !e.active } : e)));
  }

  function deleteEmployee(id) {
    saveEmployeesList(employees.filter((e) => e.id !== id));
    if (selectedEmployeeId === id) setSelectedEmployeeId(null);
    setConfirmDeleteId(null);
  }

  // ---------- editor de horario semanal ----------
  const [scheduleModal, setScheduleModal] = useState(null); // { employeeId, draft }

  function openScheduleModal(employeeId) {
    const emp = employees.find((e) => e.id === employeeId);
    if (!emp) return;
    setScheduleModal({ employeeId, draft: getScheduleForDate(emp, localDateKey()) || defaultSchedule() });
  }

  function updateScheduleDay(dayIdx, patch) {
    setScheduleModal((m) => ({
      ...m,
      draft: { ...m.draft, [dayIdx]: { ...m.draft[dayIdx], ...patch } },
    }));
  }

  function saveSchedule() {
    if (!scheduleModal) return;
    const todayKey = localDateKey();
    saveEmployeesList(
      employees.map((e) => {
        if (e.id !== scheduleModal.employeeId) return e;
        const history = e.scheduleHistory ? [...e.scheduleHistory] : [];
        const idx = history.findIndex((v) => v.effectiveFrom === todayKey);
        if (idx >= 0) history[idx] = { effectiveFrom: todayKey, schedule: scheduleModal.draft };
        else history.push({ effectiveFrom: todayKey, schedule: scheduleModal.draft });
        history.sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFrom ? 1 : 0));
        // "schedule" queda como espejo del horario vigente para accesos rápidos/compatibilidad
        return { ...e, scheduleHistory: history, schedule: scheduleModal.draft };
      })
    );
    setScheduleModal(null);
  }

  // ---------- status (based on today only) ----------

  function statusFor(employeeId) {
    const own = (recordsByDate[today] || []).filter((r) => r.employeeId === employeeId);
    if (own.length === 0) return "fuera";
    return own[own.length - 1].type === "entrada" ? "dentro" : "fuera";
  }

  // ---------- punching ----------

  function openPunch(type) {
    setPunchModal({ type, photo: null });
  }

  function triggerCamera() {
    // ya no se usa para abrir el selector (ver <label htmlFor="reloj-photo-input">),
    // se deja solo por si se necesita disparar el input de forma programática en el futuro
    fileInputRef.current?.click();
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const dataUrl = await compressImage(file);
      setPunchModal((prev) => (prev ? { ...prev, photo: dataUrl } : prev));
    } catch {
      setToast({ color: paprika, text: "No se pudo procesar la foto." });
    }
  }

  function confirmPunch() {
    if (!punchModal || !selectedEmployeeId) return;
    if (punchModal.type === "entrada" && !punchModal.photo) return;

    const emp = employees.find((e) => e.id === selectedEmployeeId);
    if (!emp) return;

    const now = new Date();
    const nowIso = now.toISOString();

    let punctuality = null;
    let minsLate = null;
    if (punchModal.type === "entrada") {
      const daySchedule = getScheduleForDate(emp, today)?.[now.getDay()];
      if (daySchedule?.enabled && daySchedule.start) {
        minsLate = minutesLate(daySchedule.start, nowIso);
        punctuality = punctualityTier(minsLate);
      }
    }

    const record = {
      id: uid("rec"),
      employeeId: emp.id,
      employeeName: emp.name,
      type: punchModal.type,
      time: nowIso,
      hasPhoto: !!punchModal.photo,
      punctuality, // 'bono' | 'propina' | 'ninguno' | null (sin horario configurado ese día)
      minutesLate: minsLate,
    };

    // la foto se queda en este dispositivo (IndexedDB); a Supabase solo va el dato liviano
    if (punchModal.photo) {
      savePhotoLocal(record.id, punchModal.photo)
        .then(() => setPhotoCache((prev) => ({ ...prev, [record.id]: punchModal.photo })))
        .catch((err) => {
          console.error("No se pudo guardar la foto localmente:", err);
          setToast({ color: paprika, text: "El registro se guardó, pero la foto no se pudo guardar en este dispositivo." });
        });
    }

    const updatedAll = pruneOldDates({
      ...recordsByDate,
      [today]: [...(recordsByDate[today] || []), record],
    });

    cleanupOrphanedPhotos(recordsByDate, updatedAll);

    setRecordsByDate(updatedAll);
    setLastUpdated(new Date());
    scheduleSync("records", JSON.stringify(updatedAll));

    const meta = punctualityMeta(punctuality, paprika, brass, sage);
    let toastText = `${punchModal.type === "entrada" ? "Entrada" : "Salida"} registrada — ${emp.name}`;
    if (punchModal.type === "entrada" && punctuality) {
      const minsLabel =
        minsLate <= 0 ? "a tiempo" : `${minsLate} min tarde`;
      toastText += ` (${minsLabel} · ${meta.label.split("—")[1]?.trim() || meta.label})`;
    }
    setToast({ color: punctuality ? meta.color : sage, text: toastText });
    setPunchModal(null);
    setSelectedEmployeeId(null); // listo para el siguiente empleado
  }

  const activeEmployees = employees.filter((e) => e.active);
  const selectedEmployee = employees.find((e) => e.id === selectedEmployeeId) || null;
  const selectedStatus = selectedEmployee ? statusFor(selectedEmployee.id) : null;

  const monthTotal = monthDateKeys.reduce((sum, d) => sum + (recordsByDate[d]?.length || 0), 0);
  const secsAgo = lastUpdated ? Math.max(0, Math.round((Date.now() - lastUpdated.getTime()) / 1000)) : null;

  // ---------- style tokens ----------
  const paprika = "#C1442D";
  const sage = "#5C7A5E";
  const ink = "#211F1B";
  const paper = "#F7F3EA";
  const charcoal = "#201E1B";
  const brass = "#D6A24C";
  const steel = "#8A8F86";

  // ---------- vista imprimible del resumen mensual (reemplaza toda la UI mientras esté activa) ----------
  if (printView) {
    const reportsToShow = employees
      .map((emp) => ({ emp, report: buildEmployeeMonthReport(emp, printView.month, recordsByDate) }))
      .filter(({ report }) => report.rows.length > 0);

    return (
      <div style={{ background: "#fff", minHeight: "100vh", color: ink, fontFamily: "'Helvetica Neue', Arial, sans-serif" }}>
        <style>{`
          @media print {
            .no-print { display: none !important; }
            .report-page { page-break-after: always; }
          }
        `}</style>

        <div
          className="no-print flex items-center justify-between px-4 py-3"
          style={{ borderBottom: `1px solid ${ink}22`, position: "sticky", top: 0, background: "#fff" }}
        >
          <button
            onClick={() => setPrintView(null)}
            className="text-sm font-bold flex items-center gap-1"
            style={{ color: ink }}
          >
            ← Volver
          </button>
          <div className="text-xs font-bold uppercase" style={{ color: ink + "88" }}>
            {monthLabel(printView.month)}
          </div>
          <button
            onClick={() => window.print()}
            className="px-3 py-1.5 rounded-sm font-bold text-xs uppercase"
            style={{ background: brass, color: ink }}
          >
            Imprimir / Guardar PDF
          </button>
        </div>

        <div
          className="no-print flex flex-col gap-2 px-4 py-3"
          style={{ borderBottom: `1px solid ${ink}11`, background: ink + "06" }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => downloadMonthSummary(printView.month)}
              className="text-[11px] font-bold uppercase px-3 py-1.5 rounded-sm"
              style={{ background: brass, color: ink }}
            >
              Descargar resumen
            </button>
            <button
              onClick={() => downloadMonthBackup(printView.month)}
              className="text-[11px] font-bold uppercase px-3 py-1.5 rounded-sm"
              style={{ border: `1px solid ${ink}33`, color: ink }}
            >
              Descargar respaldo (JSON)
            </button>
            <button
              onClick={() => setShowDriveHelp((v) => !v)}
              className="flex items-center gap-1.5 text-[11px] font-bold uppercase px-3 py-1.5 rounded-sm"
              style={{ border: `1px solid ${ink}33`, color: ink }}
            >
              <UploadCloud size={13} /> Subir a Drive
            </button>
          </div>

          {showDriveHelp && (
            <div className="text-[10px] rounded-sm px-3 py-2" style={{ background: brass + "22", color: ink }}>
              Esta app ya tiene acceso a internet, pero la subida automática a Drive todavía no está
              conectada — requiere configurar credenciales de la API de Google (un paso aparte, con su
              propia cuenta de Google Cloud). Mientras tanto: descarga el resumen arriba y arrástralo tú
              mismo a Drive, o súbelo aquí en el chat con Claude y pídeme que te lo suba. Si quieres, en
              otra sesión podemos configurar la conexión directa a Drive.
            </div>
          )}

          <div>
            {printView.month >= monthKeyOf() ? (
              <span className="text-[10px]" style={{ color: ink + "66" }}>
                El mes en curso no se puede borrar todavía.
              </span>
            ) : confirmPurgeMonth ? (
              <div className="flex items-center gap-2">
                <span className="text-[10px]" style={{ color: paprika }}>
                  ¿Ya subiste el respaldo a Drive? Esto borra {monthLabel(printView.month)} de este dispositivo.
                </span>
                <button
                  onClick={() => purgeMonth(printView.month)}
                  className="text-[10px] font-bold uppercase px-2 py-1 rounded-sm"
                  style={{ background: paprika, color: "#fff" }}
                >
                  Sí, borrar
                </button>
                <button
                  onClick={() => setConfirmPurgeMonth(false)}
                  className="text-[10px] font-bold uppercase px-2 py-1 rounded-sm"
                  style={{ border: `1px solid ${ink}33`, color: ink }}
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmPurgeMonth(true)}
                className="text-[11px] font-bold uppercase px-3 py-1.5 rounded-sm"
                style={{ border: `1px solid ${paprika}55`, color: paprika }}
              >
                Borrar datos de este mes
              </button>
            )}
          </div>
        </div>

        {reportsToShow.length === 0 ? (
          <p className="p-6 text-sm">No hay días programados ni registros para {monthLabel(printView.month)}.</p>
        ) : (
          reportsToShow.map(({ emp, report }) => (
            <div key={emp.id} className="report-page" style={{ padding: "2rem", maxWidth: "720px", margin: "0 auto" }}>
              <h1 style={{ fontSize: "1.15rem", fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em" }}>
                Resumen mensual de asistencia
              </h1>
              <p style={{ fontSize: "0.82rem", color: ink + "99", marginTop: "2px" }}>
                Restaurante Bondiola · {monthLabel(printView.month)}
              </p>

              <div style={{ marginTop: "1rem", fontSize: "0.85rem", lineHeight: 1.6 }}>
                <div>
                  <strong>Empleado:</strong> {emp.name}
                </div>
                <div>
                  <strong>Puesto:</strong> {emp.puesto}
                </div>
                <div>
                  <strong>Horario asignado:</strong> {scheduleSummary(getScheduleForDate(emp, today))}
                </div>
              </div>

              <table style={{ width: "100%", marginTop: "1rem", fontSize: "0.7rem", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${ink}55`, textAlign: "left" }}>
                    <th style={{ padding: "4px 6px 4px 0" }}>Fecha</th>
                    <th style={{ padding: "4px 6px" }}>Programado</th>
                    <th style={{ padding: "4px 6px" }}>Entrada</th>
                    <th style={{ padding: "4px 6px" }}>Salida</th>
                    <th style={{ padding: "4px 6px" }}>Horas</th>
                    <th style={{ padding: "4px 6px" }}>Min. tarde</th>
                    <th style={{ padding: "4px 0" }}>Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((r) => (
                    <tr key={r.dateKey} style={{ borderBottom: `1px solid ${ink}15` }}>
                      <td style={{ padding: "3px 6px 3px 0" }}>
                        {r.dayLabel} {r.dayNum}
                      </td>
                      <td style={{ padding: "3px 6px" }}>
                        {r.scheduled ? `${r.scheduledStart}–${r.scheduledEnd}` : "—"}
                      </td>
                      <td style={{ padding: "3px 6px" }}>{r.entradaTime || (r.falta ? "FALTA" : "—")}</td>
                      <td style={{ padding: "3px 6px" }}>{r.salidaTime || "—"}</td>
                      <td style={{ padding: "3px 6px" }}>{r.hoursWorked !== null ? r.hoursWorked : "—"}</td>
                      <td style={{ padding: "3px 6px" }}>{r.minutesLate !== null ? r.minutesLate : "—"}</td>
                      <td style={{ padding: "3px 0" }}>
                        {r.punctuality === "bono" && "Bono + propina"}
                        {r.punctuality === "propina" && "Solo propina"}
                        {r.punctuality === "ninguno" && "Sin bono/propina"}
                        {r.falta && "Falta"}
                        {!r.punctuality && !r.falta && "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <p style={{ marginTop: "1.2rem", fontSize: "0.78rem", fontWeight: 700, textTransform: "uppercase" }}>
                Desglose semanal
              </p>
              <table style={{ width: "100%", marginTop: "0.4rem", fontSize: "0.72rem", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${ink}55`, textAlign: "left" }}>
                    <th style={{ padding: "4px 6px 4px 0" }}>Semana</th>
                    <th style={{ padding: "4px 6px" }}>Días trabajados</th>
                    <th style={{ padding: "4px 6px" }}>Horas</th>
                    <th style={{ padding: "4px 6px" }}>Retardos</th>
                    <th style={{ padding: "4px 0" }}>Faltas</th>
                  </tr>
                </thead>
                <tbody>
                  {report.weeks.map((w) => (
                    <tr key={w.weekNum} style={{ borderBottom: `1px solid ${ink}15` }}>
                      <td style={{ padding: "3px 6px 3px 0" }}>{w.label}</td>
                      <td style={{ padding: "3px 6px" }}>{w.diasTrabajados}</td>
                      <td style={{ padding: "3px 6px" }}>{w.horas}</td>
                      <td style={{ padding: "3px 6px" }}>{w.retardos}</td>
                      <td style={{ padding: "3px 0" }}>{w.faltas}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ marginTop: "1rem", fontSize: "0.8rem", display: "flex", gap: "1.25rem", flexWrap: "wrap" }}>
                <span>
                  Días programados: <strong>{report.diasProgramados}</strong>
                </span>
                <span>
                  Días trabajados (mes): <strong>{report.diasTrabajados}</strong>
                </span>
                <span>
                  Horas trabajadas (mes): <strong>{report.horasTotalMes}</strong>
                </span>
                <span>
                  Retardos: <strong>{report.diasRetardo}</strong>
                </span>
                <span>
                  Faltas: <strong>{report.diasFalta}</strong>
                </span>
                <span>
                  Con bono: <strong>{report.diasBono}</strong>
                </span>
                <span>
                  Con propina: <strong>{report.diasPropina}</strong>
                </span>
              </div>

              <p style={{ marginTop: "2rem", fontSize: "0.78rem", lineHeight: 1.5, color: ink + "cc" }}>
                Al firmar este documento, el empleado y el encargado en turno confirman estar de acuerdo con
                el horario asignado y los días efectivamente cumplidos durante el mes indicado.
              </p>

              <div style={{ marginTop: "3rem", display: "flex", justifyContent: "space-between", gap: "2rem" }}>
                <div style={{ flex: 1, textAlign: "center" }}>
                  <div style={{ borderTop: `1px solid ${ink}`, paddingTop: "4px", fontSize: "0.78rem" }}>
                    Firma del Encargado en turno
                  </div>
                  <div style={{ fontSize: "0.65rem", color: ink + "77", marginTop: "2px" }}>Nombre y fecha</div>
                </div>
                <div style={{ flex: 1, textAlign: "center" }}>
                  <div style={{ borderTop: `1px solid ${ink}`, paddingTop: "4px", fontSize: "0.78rem" }}>
                    Firma del Empleado
                  </div>
                  <div style={{ fontSize: "0.65rem", color: ink + "77", marginTop: "2px" }}>Nombre y fecha</div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    );
  }

  return (
    <div
      className="min-h-screen w-full flex flex-col"
      style={{ background: charcoal, fontFamily: "'Helvetica Neue', Arial, sans-serif" }}
    >
      <input
        id="reloj-photo-input"
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFile}
        style={{ display: "none" }}
      />

      {/* header */}
      <div className="px-5 pt-6 pb-4" style={{ borderBottom: `2px dashed ${steel}55` }}>
        <div className="flex items-center gap-2">
          <Clock size={22} color={brass} strokeWidth={2.4} />
          <h1
            className="uppercase font-black tracking-tight"
            style={{ color: paper, fontSize: "1.5rem", letterSpacing: "-0.01em" }}
          >
            Reloj Checador
          </h1>
        </div>
        <p className="text-xs mt-1" style={{ color: steel, letterSpacing: "0.04em" }}>
          Control de entradas y salidas del personal
        </p>
        <div className="flex items-center gap-1.5 mt-2">
          <span
            className="inline-block rounded-full flex-shrink-0"
            style={{
              width: 6,
              height: 6,
              background: Object.keys(pendingKeys).length > 0 ? brass : sage,
              animation: Object.keys(pendingKeys).length > 0 ? "pulse 1.4s infinite" : "none",
            }}
          />
          <span className="text-[10px]" style={{ color: steel }}>
            {Object.keys(pendingKeys).length > 0 ? "Sincronizando cambios…" : "Todo sincronizado"}
          </span>
        </div>

        <div className="flex gap-2 mt-4">
          {[
            { id: "checador", label: "Checador", icon: Clock },
            { id: "bitacora", label: "Bitácora", icon: unlockedSession ? ScrollText : Lock },
            { id: "personal", label: "Personal", icon: Users },
          ].map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => (t.id === "bitacora" ? requestUnlock("bitacora") : setTab(t.id))}
                className="flex items-center gap-1.5 px-4 py-2 rounded-sm text-xs font-bold uppercase transition-colors"
                style={{
                  background: active ? brass : "transparent",
                  color: active ? ink : steel,
                  border: `1px solid ${active ? brass : steel + "55"}`,
                  letterSpacing: "0.05em",
                }}
              >
                <Icon size={14} strokeWidth={2.5} />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ---------------- CHECADOR TAB ---------------- */}
      {tab === "checador" && (
        <div className="flex-1 px-5 py-5 flex flex-col gap-5">
          {loadingEmployees ? (
            <div className="flex items-center gap-2 text-sm" style={{ color: steel }}>
              <Loader2 size={16} className="animate-spin" /> Cargando personal…
            </div>
          ) : activeEmployees.length === 0 ? (
            <div className="rounded-sm p-4 text-sm" style={{ background: paper, color: ink }}>
              Aún no hay personal activo. Ve a la pestaña <span className="font-bold">Personal</span> para
              agregar empleados.
            </div>
          ) : (
            <>
              <div>
                <div
                  className="text-[10px] font-bold uppercase mb-2"
                  style={{ color: steel, letterSpacing: "0.1em" }}
                >
                  Selecciona tu nombre
                </div>
                <div
                  className="grid gap-2"
                  style={{ gridTemplateColumns: "repeat(auto-fill, minmax(9rem, 1fr))" }}
                >
                  {activeEmployees.map((emp) => {
                    const st = statusFor(emp.id);
                    const sel = emp.id === selectedEmployeeId;
                    return (
                      <button
                        key={emp.id}
                        onClick={() => setSelectedEmployeeId(emp.id)}
                        className="w-full flex flex-col items-start gap-1 px-3 py-2 rounded-sm"
                        style={{
                          background: sel ? paper : "transparent",
                          border: `1px solid ${sel ? paper : steel + "55"}`,
                        }}
                      >
                        <div className="flex items-center gap-1.5">
                          <span
                            className="inline-block rounded-full"
                            style={{ width: 7, height: 7, background: st === "dentro" ? sage : steel }}
                          />
                          <span className="text-xs font-bold" style={{ color: sel ? ink : paper }}>
                            {emp.name}
                          </span>
                        </div>
                        <span className="text-[10px]" style={{ color: sel ? ink + "99" : steel }}>
                          {emp.puesto} · {st === "dentro" ? "Dentro" : "Fuera"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {selectedEmployee && (
                <div className="rounded-sm p-4" style={{ background: paper, border: `1px solid ${ink}22` }}>
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <div className="font-black text-lg" style={{ color: ink }}>
                        {selectedEmployee.name}
                      </div>
                      <div className="text-xs" style={{ color: ink + "88" }}>
                        {selectedEmployee.puesto}
                      </div>
                    </div>
                    <div
                      className="text-[10px] font-bold uppercase px-2 py-1 rounded-sm"
                      style={{
                        background: selectedStatus === "dentro" ? sage + "22" : steel + "22",
                        color: selectedStatus === "dentro" ? sage : steel,
                      }}
                    >
                      {selectedStatus === "dentro" ? "Dentro" : "Fuera"}
                    </div>
                  </div>

                  <button
                    onClick={() => openPunch(selectedStatus === "dentro" ? "salida" : "entrada")}
                    className="w-full flex items-center justify-center gap-2 py-4 rounded-sm font-black text-base uppercase"
                    style={{
                      background: selectedStatus === "dentro" ? sage : paprika,
                      color: paper,
                    }}
                  >
                    {selectedStatus === "dentro" ? <LogOut size={19} /> : <LogIn size={19} />}
                    {selectedStatus === "dentro" ? "Registrar Salida" : "Registrar Entrada"}
                  </button>
                  <p className="text-[10px] mt-2 text-center" style={{ color: ink + "77" }}>
                    {selectedStatus === "dentro"
                      ? "La foto es opcional para la salida."
                      : "La entrada requiere una foto con el uniforme puesto."}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ---------------- BITACORA TAB ---------------- */}
      {tab === "bitacora" && (
        <div className="flex-1 px-5 py-5 flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-1">
            <button
              onClick={() => setSelectedMonth((m) => shiftMonthKey(m, -1))}
              className="p-1 text-lg leading-none"
              style={{ color: steel }}
            >
              ‹
            </button>
            <div className="text-sm font-black uppercase text-center" style={{ color: paper }}>
              {monthLabel(selectedMonth)}
            </div>
            <button
              onClick={() => setSelectedMonth((m) => shiftMonthKey(m, 1))}
              disabled={selectedMonth >= monthKeyOf()}
              className="p-1 text-lg leading-none disabled:opacity-20"
              style={{ color: steel }}
            >
              ›
            </button>
          </div>

          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5">
              <span
                className="inline-block rounded-full"
                style={{ width: 6, height: 6, background: sage, animation: "pulse 2s infinite" }}
              />
              <div className="text-[10px] font-bold uppercase" style={{ color: steel, letterSpacing: "0.1em" }}>
                {monthTotal} registros
              </div>
            </div>
            <button
              onClick={() => loadRecords(false)}
              className="flex items-center gap-1 text-[10px]"
              style={{ color: steel }}
            >
              <RefreshCw size={11} />
              {secsAgo !== null ? `hace ${secsAgo}s` : ""}
            </button>
          </div>

          <div className="flex items-center justify-between gap-2 mb-3">
            <button
              onClick={lockNow}
              className="flex items-center gap-1 text-[10px] font-bold uppercase"
              style={{ color: steel }}
            >
              <Lock size={11} /> Bloquear
            </button>
            <button
              onClick={() => setPrintView({ month: selectedMonth })}
              className="flex items-center gap-1.5 text-[10px] font-bold uppercase px-2.5 py-1.5 rounded-sm"
              style={{ background: brass, color: ink }}
            >
              <FileSignature size={12} /> Generar resumen del mes
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-3 text-[9px]" style={{ color: steel }}>
            <span className="flex items-center gap-1">
              <span className="inline-block rounded-full" style={{ width: 6, height: 6, background: sage }} />
              ≤10 min: bono + propina
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block rounded-full" style={{ width: 6, height: 6, background: brass }} />
              11–15 min: solo propina
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block rounded-full" style={{ width: 6, height: 6, background: paprika }} />
              +15 min: sin bono ni propina
            </span>
          </div>

          {loadingWeek ? (
            <div className="flex items-center gap-2 text-sm" style={{ color: steel }}>
              <Loader2 size={16} className="animate-spin" /> Cargando bitácora…
            </div>
          ) : monthTotal === 0 ? (
            <div className="text-sm py-6 text-center" style={{ color: steel }}>
              Sin registros en {monthLabel(selectedMonth)}.
            </div>
          ) : (
            <div className="flex-1 flex flex-col gap-4 overflow-y-auto pr-1">
              {monthDateKeys.map((date) => {
                const dayRecords = [...(recordsByDate[date] || [])].reverse();
                if (dayRecords.length === 0) return null;
                return (
                  <div key={date}>
                    <div className="flex items-center gap-2 mb-1.5 sticky top-0" style={{ background: charcoal }}>
                      <div
                        className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-sm"
                        style={{
                          background: date === today ? brass : steel + "33",
                          color: date === today ? ink : paper,
                        }}
                      >
                        {formatDateLabel(date, today)}
                      </div>
                      <div className="text-[10px]" style={{ color: steel }}>
                        {dayRecords.length} {dayRecords.length === 1 ? "registro" : "registros"}
                      </div>
                    </div>
                    <div className="flex flex-col gap-2">
                      {dayRecords.map((r) => {
                        const photoUrl = r.hasPhoto ? photoCache[r.id] : null;
                        const meta =
                          r.type === "entrada" ? punctualityMeta(r.punctuality, paprika, brass, sage) : null;
                        return (
                          <div
                            key={r.id}
                            className="flex items-center gap-3 px-3 py-2 rounded-sm"
                            style={{
                              background: paper,
                              borderTop: `2px dashed ${ink}22`,
                              borderLeft: meta?.color ? `4px solid ${meta.color}` : "4px solid transparent",
                            }}
                          >
                            {photoUrl ? (
                              <img
                                src={photoUrl}
                                alt={r.employeeName}
                                className="rounded-full object-cover flex-shrink-0"
                                style={{
                                  width: 34,
                                  height: 34,
                                  border: `2px solid ${r.type === "entrada" ? paprika : sage}`,
                                }}
                              />
                            ) : (
                              <div
                                className="rounded-full flex items-center justify-center flex-shrink-0"
                                style={{ width: 34, height: 34, background: ink + "11" }}
                              >
                                <UserRound size={16} color={ink} />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-bold truncate" style={{ color: ink }}>
                                {r.employeeName}
                              </div>
                              <div
                                className="text-[10px] font-mono uppercase"
                                style={{ color: r.type === "entrada" ? paprika : sage }}
                              >
                                {r.type} · {formatTime(r.time)}
                              </div>
                            </div>
                            {meta?.color && (
                              <span
                                className="flex-shrink-0 text-[9px] font-bold uppercase px-1.5 py-1 rounded-sm text-right"
                                style={{ background: meta.color + "22", color: meta.color }}
                                title={meta.label}
                              >
                                {r.minutesLate <= 0 ? "A tiempo" : `+${r.minutesLate} min`}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ---------------- PERSONAL TAB ---------------- */}
      {tab === "personal" && (
        <div className="flex-1 px-5 py-5 flex flex-col gap-5">
          {unlockedSession ? (
            <div className="rounded-sm p-4" style={{ background: paper }}>
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs font-bold uppercase" style={{ color: ink, letterSpacing: "0.06em" }}>
                  Agregar empleado
                </div>
                <button
                  onClick={lockNow}
                  className="flex items-center gap-1 text-[10px] font-bold uppercase"
                  style={{ color: ink + "77" }}
                >
                  <Lock size={11} /> Bloquear
                </button>
              </div>
              <div className="flex flex-col gap-2">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Nombre completo"
                  className="px-3 py-2 rounded-sm text-sm outline-none"
                  style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                />
                <input
                  value={newPuesto}
                  onChange={(e) => setNewPuesto(e.target.value)}
                  placeholder="Puesto (ej. Cocina, Barra, Servicio)"
                  className="px-3 py-2 rounded-sm text-sm outline-none"
                  style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                />
                <button
                  onClick={addEmployee}
                  disabled={!newName.trim()}
                  className="flex items-center justify-center gap-2 py-2.5 rounded-sm font-bold text-sm uppercase disabled:opacity-40"
                  style={{ background: brass, color: ink }}
                >
                  <Plus size={16} /> Agregar
                </button>
                <button
                  onClick={openChangePin}
                  className="text-[10px] font-bold uppercase text-center mt-1"
                  style={{ color: ink + "66" }}
                >
                  Cambiar clave de acceso
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => requestUnlock("agregar")}
              className="rounded-sm p-4 flex items-center gap-3 text-left w-full"
              style={{ background: paper }}
            >
              <div
                className="rounded-full flex items-center justify-center flex-shrink-0"
                style={{ width: 34, height: 34, background: brass + "33" }}
              >
                <Lock size={16} color={ink} />
              </div>
              <div>
                <div className="text-sm font-bold" style={{ color: ink }}>
                  Agregar personal está protegido
                </div>
                <div className="text-[11px]" style={{ color: ink + "88" }}>
                  Toca para ingresar la clave de acceso
                </div>
              </div>
            </button>
          )}

          <div className="flex-1 flex flex-col gap-2 overflow-y-auto">
            {loadingEmployees ? (
              <div className="flex items-center gap-2 text-sm" style={{ color: steel }}>
                <Loader2 size={16} className="animate-spin" /> Cargando…
              </div>
            ) : employees.length === 0 ? (
              <div className="text-sm py-6 text-center" style={{ color: steel }}>
                No hay empleados registrados todavía.
              </div>
            ) : (
              employees.map((emp) => (
                <div
                  key={emp.id}
                  className="flex items-center justify-between px-3 py-2.5 rounded-sm"
                  style={{ background: paper }}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-bold truncate" style={{ color: ink }}>
                      {emp.name}
                    </div>
                    <div className="text-[11px]" style={{ color: ink + "88" }}>
                      {emp.puesto}
                    </div>
                    <div className="text-[10px] mt-0.5" style={{ color: ink + "66" }}>
                      {scheduleSummary(getScheduleForDate(emp, today))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {unlockedSession && (
                      <button
                        onClick={() => openScheduleModal(emp.id)}
                        className="p-1.5 rounded-sm"
                        style={{ color: ink + "77", border: `1px solid ${ink}22` }}
                        title="Editar horario"
                      >
                        <CalendarClock size={14} />
                      </button>
                    )}
                    <button
                      onClick={() => toggleActive(emp.id)}
                      className="text-[10px] font-bold uppercase px-2 py-1 rounded-sm"
                      style={{
                        background: emp.active ? sage + "22" : steel + "22",
                        color: emp.active ? sage : steel,
                      }}
                    >
                      {emp.active ? "Activo" : "Inactivo"}
                    </button>
                    {confirmDeleteId === emp.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => deleteEmployee(emp.id)}
                          className="p-1.5 rounded-sm"
                          style={{ background: paprika, color: paper }}
                        >
                          <Check size={13} />
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="p-1.5 rounded-sm"
                          style={{ background: steel + "33", color: ink }}
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteId(emp.id)}
                        className="p-1.5 rounded-sm"
                        style={{ color: ink + "55" }}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ---------------- PUNCH MODAL ---------------- */}
      {punchModal && selectedEmployee && (
        <div
          className="fixed inset-0 flex items-end sm:items-center justify-center z-50 p-4"
          style={{ background: "#00000099" }}
        >
          <div className="w-full max-w-sm rounded-sm p-5" style={{ background: paper }}>
            <div className="flex items-center justify-between mb-4">
              <div
                className="text-xs font-bold uppercase"
                style={{ color: punchModal.type === "entrada" ? paprika : sage, letterSpacing: "0.06em" }}
              >
                Registrar {punchModal.type}
              </div>
              <button onClick={() => setPunchModal(null)}>
                <X size={18} color={ink} />
              </button>
            </div>

            <div className="text-sm font-bold mb-1" style={{ color: ink }}>
              {selectedEmployee.name}
            </div>
            <div className="text-xs mb-4" style={{ color: ink + "88" }}>
              {formatTime(new Date().toISOString())} · Hoy
            </div>

            {punchModal.type === "entrada" && !punchModal.photo && (
              <div className="mb-4">
                <p className="text-xs mb-3" style={{ color: ink + "aa" }}>
                  Toma una foto con tu uniforme puesto para registrar la entrada.
                </p>
                <label
                  htmlFor="reloj-photo-input"
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-sm font-bold text-sm uppercase cursor-pointer"
                  style={{ background: paprika, color: paper }}
                >
                  <Camera size={16} /> Tomar / subir foto
                </label>
              </div>
            )}

            {punchModal.photo && (
              <div className="mb-4">
                <img
                  src={punchModal.photo}
                  alt="Foto de uniforme"
                  className="w-full rounded-sm object-cover mb-2"
                  style={{ maxHeight: 220 }}
                />
                <label
                  htmlFor="reloj-photo-input"
                  className="inline-flex items-center gap-1.5 text-xs font-bold cursor-pointer"
                  style={{ color: ink + "88" }}
                >
                  <RotateCcw size={13} /> Repetir foto
                </label>
              </div>
            )}

            {punchModal.type === "salida" && !punchModal.photo && (
              <label
                htmlFor="reloj-photo-input"
                className="w-full flex items-center justify-center gap-2 py-2.5 mb-3 rounded-sm font-bold text-xs uppercase cursor-pointer"
                style={{ border: `1px solid ${ink}33`, color: ink }}
              >
                <Camera size={14} /> Agregar foto (opcional)
              </label>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setPunchModal(null)}
                className="py-2.5 rounded-sm font-bold text-sm uppercase"
                style={{ border: `1px solid ${ink}33`, color: ink }}
              >
                Cancelar
              </button>
              <button
                onClick={confirmPunch}
                disabled={punchModal.type === "entrada" && !punchModal.photo}
                className="flex items-center justify-center gap-2 py-2.5 rounded-sm font-bold text-sm uppercase disabled:opacity-40"
                style={{ background: punchModal.type === "entrada" ? paprika : sage, color: paper }}
              >
                <Check size={15} />
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- PIN MODAL ---------------- */}
      {pinModal && (
        <div
          className="fixed inset-0 flex items-end sm:items-center justify-center z-50 p-4"
          style={{ background: "#00000099" }}
        >
          <div className="w-full max-w-sm rounded-sm p-5" style={{ background: paper }}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Lock size={16} color={brass} />
                <div className="text-xs font-bold uppercase" style={{ color: ink, letterSpacing: "0.06em" }}>
                  {pinModal.mode === "unlock" && "Ingresa la clave"}
                  {pinModal.mode === "setup" && "Configura una clave"}
                  {pinModal.mode === "change" && "Nueva clave de acceso"}
                </div>
              </div>
              <button onClick={() => setPinModal(null)}>
                <X size={18} color={ink} />
              </button>
            </div>

            {pinModal.mode === "setup" && (
              <p className="text-xs mb-3" style={{ color: ink + "aa" }}>
                Esta clave se pedirá para ver la bitácora y para agregar personal nuevo.
              </p>
            )}

            {pinModal.mode === "unlock" ? (
              <input
                autoFocus
                type="password"
                inputMode="numeric"
                maxLength={8}
                value={pinModal.value}
                onChange={(e) =>
                  setPinModal((m) => ({ ...m, value: e.target.value.replace(/\D/g, ""), error: "" }))
                }
                onKeyDown={(e) => e.key === "Enter" && submitPin()}
                placeholder="Clave"
                className="w-full px-3 py-3 rounded-sm text-lg tracking-[0.3em] text-center outline-none mb-2"
                style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
              />
            ) : (
              <div className="flex flex-col gap-2 mb-2">
                <input
                  autoFocus
                  type="password"
                  inputMode="numeric"
                  maxLength={8}
                  value={pinModal.value}
                  onChange={(e) =>
                    setPinModal((m) => ({ ...m, value: e.target.value.replace(/\D/g, ""), error: "" }))
                  }
                  placeholder="Nueva clave (mín. 4 dígitos)"
                  className="w-full px-3 py-3 rounded-sm text-lg tracking-[0.3em] text-center outline-none"
                  style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                />
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={8}
                  value={pinModal.confirmValue}
                  onChange={(e) =>
                    setPinModal((m) => ({ ...m, confirmValue: e.target.value.replace(/\D/g, ""), error: "" }))
                  }
                  onKeyDown={(e) => e.key === "Enter" && submitPin()}
                  placeholder="Confirmar clave"
                  className="w-full px-3 py-3 rounded-sm text-lg tracking-[0.3em] text-center outline-none"
                  style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                />
              </div>
            )}

            {pinModal.error && (
              <p className="text-xs mb-2" style={{ color: paprika }}>
                {pinModal.error}
              </p>
            )}

            <button
              onClick={submitPin}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-sm font-bold text-sm uppercase mt-2"
              style={{ background: brass, color: ink }}
            >
              <LockOpen size={15} />
              {pinModal.mode === "unlock" ? "Desbloquear" : "Guardar clave"}
            </button>
          </div>
        </div>
      )}

      {/* ---------------- SCHEDULE MODAL ---------------- */}
      {scheduleModal && (
        <div
          className="fixed inset-0 flex items-end sm:items-center justify-center z-50 p-4"
          style={{ background: "#00000099" }}
        >
          <div className="w-full max-w-sm rounded-sm p-5" style={{ background: paper, maxHeight: "85vh", overflowY: "auto" }}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <CalendarClock size={16} color={brass} />
                <div className="text-xs font-bold uppercase" style={{ color: ink, letterSpacing: "0.06em" }}>
                  Horario semanal
                </div>
              </div>
              <button onClick={() => setScheduleModal(null)}>
                <X size={18} color={ink} />
              </button>
            </div>
            <p className="text-xs mb-4" style={{ color: ink + "88" }}>
              {employees.find((e) => e.id === scheduleModal.employeeId)?.name}
            </p>

            <div className="flex flex-col gap-2 mb-4">
              {DAY_NAMES.map((name, idx) => {
                const day = scheduleModal.draft[idx] || { enabled: false, start: "09:00", end: "17:00" };
                return (
                  <div key={idx} className="flex items-center gap-2">
                    <button
                      onClick={() => updateScheduleDay(idx, { enabled: !day.enabled })}
                      className="flex items-center gap-2 flex-shrink-0"
                      style={{ width: "5.5rem" }}
                    >
                      <span
                        className="inline-block rounded-full flex-shrink-0"
                        style={{
                          width: 14,
                          height: 14,
                          border: `2px solid ${day.enabled ? sage : steel}`,
                          background: day.enabled ? sage : "transparent",
                        }}
                      />
                      <span
                        className="text-xs font-bold"
                        style={{ color: day.enabled ? ink : ink + "66" }}
                      >
                        {name.slice(0, 3)}
                      </span>
                    </button>
                    {day.enabled ? (
                      <div className="flex items-center gap-1 flex-1">
                        <input
                          type="time"
                          value={day.start}
                          onChange={(e) => updateScheduleDay(idx, { start: e.target.value })}
                          className="flex-1 px-2 py-1.5 rounded-sm text-xs outline-none"
                          style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                        />
                        <span className="text-[10px]" style={{ color: ink + "66" }}>
                          a
                        </span>
                        <input
                          type="time"
                          value={day.end}
                          onChange={(e) => updateScheduleDay(idx, { end: e.target.value })}
                          className="flex-1 px-2 py-1.5 rounded-sm text-xs outline-none"
                          style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                        />
                      </div>
                    ) : (
                      <span className="text-[11px] flex-1" style={{ color: ink + "55" }}>
                        Descanso
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            <p className="text-[10px] mb-1.5" style={{ color: ink + "77" }}>
              La hora de "entrada" de cada día es la referencia para la tolerancia de bono (10 min) y
              propina (15 min).
            </p>
            <p className="text-[10px] mb-3" style={{ color: brass }}>
              Este cambio aplica a partir de hoy — los resúmenes de meses ya pasados conservan el
              horario que estaba vigente en su momento.
            </p>

            <button
              onClick={saveSchedule}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-sm font-bold text-sm uppercase"
              style={{ background: brass, color: ink }}
            >
              <Check size={15} /> Guardar horario
            </button>
          </div>
        </div>
      )}

      {/* ---------------- TOAST ---------------- */}
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
