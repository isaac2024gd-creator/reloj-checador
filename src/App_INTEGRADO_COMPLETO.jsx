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
  return Math.round((punch - scheduled) / 60000);
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
  if (diffMs <= 0) return null;
  return Math.round((diffMs / 3600000) * 10) / 10; // 1 decimal
}

// ---------- nómina ----------

function defaultPayroll() {
  return {
    rateType: "dia", // "dia" | "hora"
    rateAmount: 0,
    payPeriod: "semanal", // "semanal" | "quincenal" | "mensual"
    bonoPorJornada: 0,
    bonoFrecuencia: "dia", // "dia" | "semana" | "mes"
    toleranciaBonoMin: 10,
  };
}

function formatMoney(n) {
  return (Number(n) || 0).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}

function defaultPeriodDates(payPeriod) {
  const end = new Date();
  const start = new Date();
  if (payPeriod === "semanal") start.setDate(end.getDate() - 6);
  else if (payPeriod === "quincenal") start.setDate(end.getDate() - 14);
  else start.setDate(end.getDate() - 29);
  return { start: localDateKey(start), end: localDateKey(end) };
}

// cuánto trabajó un empleado en un rango de fechas [startKey, endKey], usando sus
// registros reales de entrada/salida — incluye días/horas y elegibilidad de bono/propina
function computeWorkedInRange(employeeId, startKey, endKey, recordsByDate) {
  const dates = Object.keys(recordsByDate)
    .filter((d) => d >= startKey && d <= endKey)
    .sort();
  let totalHoras = 0;
  let totalDias = 0;
  let diasBono = 0;
  let diasPropina = 0; // cuenta días en tier 'bono' o 'propina' (ambos dan derecho a propina)

  dates.forEach((dateKey) => {
    const dayRecords = (recordsByDate[dateKey] || []).filter((r) => r.employeeId === employeeId);
    const entrada = dayRecords.find((r) => r.type === "entrada");
    const salida = [...dayRecords].reverse().find((r) => r.type === "salida");
    if (!entrada) return;
    totalDias += 1;
    if (entrada.punctuality === "bono") {
      diasBono += 1;
      diasPropina += 1;
    } else if (entrada.punctuality === "propina") {
      diasPropina += 1;
    }
    if (salida) {
      const h = hoursBetween(entrada.time, salida.time);
      if (h) totalHoras += h;
    }
  });

  return { totalHoras: Math.round(totalHoras * 10) / 10, totalDias, diasBono, diasPropina };
}

// días dentro del rango en los que el empleado NO checó entrada — candidatos a marcar
// como vacaciones tomadas (o simplemente días libres, sin registro alguno)
function getNonWorkedDaysInRange(employeeId, startKey, endKey, recordsByDate) {
  const dias = [];
  const start = new Date(startKey + "T00:00:00");
  const end = new Date(endKey + "T00:00:00");
  if (isNaN(start) || isNaN(end) || start > end) return dias;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = localDateKey(d);
    const trabajado = (recordsByDate[key] || []).some((r) => r.employeeId === employeeId && r.type === "entrada");
    if (!trabajado) dias.push({ key, weekday: DAY_SHORT[d.getDay()] });
  }
  return dias;
}

// total de días elegibles para propina de TODO el personal activo en el mismo rango,
// para poder prorratear la bolsa de propinas del periodo
function computeTotalEligibleDiasPropina(startKey, endKey, employees, recordsByDate) {
  return employees.reduce((sum, emp) => {
    const w = computeWorkedInRange(emp.id, startKey, endKey, recordsByDate);
    return sum + w.diasPropina;
  }, 0);
}

// clave del "bucket" (día/semana/mes) al que pertenece una fecha, según la frecuencia del bono
function bonoBucketKey(dateKey, frecuencia) {
  if (frecuencia === "dia") return dateKey;
  const d = new Date(dateKey + "T00:00:00");
  if (frecuencia === "semana") {
    const dom = new Date(d);
    dom.setDate(dom.getDate() - dom.getDay()); // domingo de esa semana
    return localDateKey(dom);
  }
  return dateKey.slice(0, 7); // "mes": YYYY-MM
}

// cuántas "unidades" de bono ganó el empleado en el rango, según la frecuencia:
// por día = cada día puntual cuenta; por semana/mes = solo cuenta si TODOS los días
// trabajados de ese bucket calificaron para bono (ni uno fuera de tolerancia)
function computeBonoUnits(employeeId, startKey, endKey, recordsByDate, frecuencia) {
  if (frecuencia === "dia") {
    return computeWorkedInRange(employeeId, startKey, endKey, recordsByDate).diasBono;
  }
  const dates = Object.keys(recordsByDate)
    .filter((d) => d >= startKey && d <= endKey)
    .sort();
  const buckets = {};
  dates.forEach((dateKey) => {
    const entrada = (recordsByDate[dateKey] || []).find((r) => r.employeeId === employeeId && r.type === "entrada");
    if (!entrada) return;
    const key = bonoBucketKey(dateKey, frecuencia);
    if (!buckets[key]) buckets[key] = { totalDias: 0, diasBono: 0 };
    buckets[key].totalDias += 1;
    if (entrada.punctuality === "bono") buckets[key].diasBono += 1;
  });
  return Object.values(buckets).filter((b) => b.totalDias > 0 && b.diasBono === b.totalDias).length;
}

function computePayrollTotals(draft, worked, bonoUnits, propinaMonto) {
  const base = draft.rateType === "hora" ? worked.totalHoras * draft.rateAmount : worked.totalDias * draft.rateAmount;
  const bono = draft.enableBono ? (bonoUnits || 0) * draft.bonoPorJornada : 0;
  const propina = draft.enablePropina ? propinaMonto || 0 : 0;
  const vacaciones = draft.enableVacaciones ? (draft.vacacionesFechas || []).length * draft.rateAmount : 0;
  const descuentos = draft.enableDescuentos
    ? (draft.descuentos || []).reduce((s, d) => s + (Number(d.amount) || 0), 0)
    : 0;
  const consumo = draft.enableConsumo
    ? (draft.consumo || []).reduce((s, d) => s + (Number(d.amount) || 0), 0)
    : 0;
  const bruto = base + bono + propina + vacaciones;
  const leyDeduccion = draft.enableLey ? bruto * ((Number(draft.leyPercent) || 0) / 100) : 0;
  const neto = bruto - leyDeduccion - descuentos - consumo;
  return { base, bono, propina, vacaciones, descuentos, consumo, bruto, leyDeduccion, neto };
}

// ---------- propinas del periodo (día, semana o mes) ----------
// reparte un monto entre quienes trabajaron en el rango, proporcional a sus días elegibles
// (bono o propina) dentro de ese rango — para un solo día, esto equivale al reparto 50/50
// de antes; para semana/mes, cada quien recibe según cuántos días le tocó calificar.
// Usa matemática de centavos enteros para que el redondeo sea siempre exacto y hacia abajo.
// Nota: las correcciones manuales de puntualidad se aplican directo al registro de la
// entrada (ver aplicarCorreccionManual), así que este cálculo ya las ve automáticamente
// sin necesitar un overlay aparte.
function calcularRepartoPropinas(startKey, endKey, monto, employees, recordsByDate, externosPorDia) {
  const candidatos = employees
    .map((emp) => {
      const w = computeWorkedInRange(emp.id, startKey, endKey, recordsByDate);
      const tieneCorreccion = Object.keys(recordsByDate)
        .filter((d) => d >= startKey && d <= endKey)
        .some((d) => (recordsByDate[d] || []).some((r) => r.employeeId === emp.id && r.type === "entrada" && r.correccionManual));
      return {
        employeeId: emp.id,
        employeeName: emp.name,
        diasTrabajados: w.totalDias,
        diasPropina: w.diasPropina,
        califica: w.diasPropina > 0,
        tieneCorreccion,
        tipo: "empleado",
      };
    })
    .filter((c) => c.diasTrabajados > 0);

  // Agregar externos al cálculo
  const externosEnRango = (externosPorDia || []).filter((e) => e.fecha >= startKey && e.fecha <= endKey);
  const externoPorId = {};
  for (const ext of externosEnRango) {
    if (!externoPorId[ext.externoId]) {
      externoPorId[ext.externoId] = { externoId: ext.externoId, nombre: ext.nombre, diasTrabajados: 0, diasPropina: 0 };
    }
    externoPorId[ext.externoId].diasTrabajados++;
    externoPorId[ext.externoId].diasPropina++;
  }
  const externoCandidatos = Object.values(externoPorId).map((ext) => ({
    employeeId: ext.externoId,
    employeeName: ext.nombre,
    diasTrabajados: ext.diasTrabajados,
    diasPropina: ext.diasPropina,
    califica: ext.diasPropina > 0,
    tieneCorreccion: false,
    tipo: "externo",
  }));

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

// suma lo que a un empleado le tocó en los repartos de Propinas ya guardados,
// cuyo rango cae dentro del periodo de nómina — así la nómina no duplica el cálculo,
// solo recoge lo que ya se repartió.
function sumPropinaFromHistorial(employeeId, periodStart, periodEnd, propinasHistorial) {
  return propinasHistorial
    .filter((p) => {
      const inicio = p.fechaInicio || p.fecha;
      const fin = p.fechaFin || p.fecha;
      return inicio >= periodStart && fin <= periodEnd;
    })
    .reduce((sum, p) => {
      const linea = (p.reparto || []).find((r) => r.employeeId === employeeId);
      return sum + (linea ? Number(linea.monto) || 0 : 0);
    }, 0);
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
function buildMonthSummaryHtml(monthKeyStr, employees, recordsByDate, businessConfig) {
  const bizName = escapeHtml(businessConfig?.nombre || "Restaurante");
  const bizLine = [businessConfig?.direccion, businessConfig?.encabezado].filter(Boolean).map(escapeHtml).join(" · ");

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
      <p class="subtitle">${bizName}${bizLine ? " · " + bizLine : ""} · ${escapeHtml(monthLabel(monthKeyStr))}</p>
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

// ---------- reconocimiento biométrico (huella / rostro) vía WebAuthn ----------
// No hay servidor propio que verifique firmas criptográficas — esto usa el lector
// biométrico del sistema operativo del dispositivo (Face ID, Touch ID, huella en Android/
// Windows) en modo "confianza local": si el sistema operativo confirma la huella/rostro
// correcto para la credencial guardada de esa persona EN ESTE DISPOSITIVO, se acepta.
// Por diseño está atado al dispositivo donde se registró — perfecto para un equipo fijo,
// pero cada persona debe registrarse de nuevo si algún día se usa en otro dispositivo.

function isWebAuthnSupported() {
  return typeof window !== "undefined" && !!window.PublicKeyCredential;
}

function bufToBase64url(buf) {
  const bytes = new Uint8Array(buf);
  let str = "";
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlToBuf(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/").padEnd(str.length + ((4 - (str.length % 4)) % 4), "=");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function randomChallenge() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return arr;
}

async function enrollBiometric(employeeId, employeeName, businessName) {
  const idBytes = new TextEncoder().encode(employeeId).slice(0, 64);
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: randomChallenge(),
      rp: { name: businessName || "Reloj Checador" },
      user: { id: idBytes, name: employeeName, displayName: employeeName },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 }, // ES256
        { type: "public-key", alg: -257 }, // RS256
      ],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
      timeout: 60000,
    },
  });
  if (!credential) throw new Error("No se pudo registrar");
  return bufToBase64url(credential.rawId);
}

async function verifyBiometric(credentialIdBase64url) {
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: randomChallenge(),
      allowCredentials: [{ id: base64urlToBuf(credentialIdBase64url), type: "public-key" }],
      userVerification: "required",
      timeout: 60000,
    },
  });
  return !!assertion;
}

// ---------- main component ----------

// ---------- panel de nómina por empleado ----------

function ToggleRow({ label, checked, onChange, colors }) {
  const { ink, sage, steel } = colors;
  return (
    <button
      onClick={() => onChange(!checked)}
      className="w-full flex items-center justify-between px-3 py-2 rounded-sm"
      style={{ background: checked ? sage + "14" : ink + "06", border: `1px solid ${checked ? sage + "55" : ink + "11"}` }}
    >
      <span className="text-xs font-bold" style={{ color: ink }}>
        {label}
      </span>
      <span
        className="rounded-full flex-shrink-0"
        style={{
          width: 30,
          height: 17,
          background: checked ? sage : steel + "55",
          position: "relative",
          transition: "background 0.15s",
        }}
      >
        <span
          className="rounded-full absolute"
          style={{
            width: 13,
            height: 13,
            top: 2,
            left: checked ? 15 : 2,
            background: "#fff",
            transition: "left 0.15s",
          }}
        />
      </span>
    </button>
  );
}

function LineItemsEditor({ items, onAdd, onUpdate, onRemove, colors, placeholder }) {
  const { ink } = colors;
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {(items || []).map((item, idx) => (
        <div key={idx} className="flex items-center gap-1.5">
          <input
            value={item.label}
            onChange={(e) => onUpdate(idx, { label: e.target.value })}
            placeholder={placeholder}
            className="flex-1 px-2 py-1.5 rounded-sm text-xs outline-none"
            style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
          />
          <input
            value={item.amount}
            onChange={(e) => onUpdate(idx, { amount: e.target.value.replace(/[^0-9.]/g, "") })}
            placeholder="$"
            inputMode="decimal"
            className="w-20 px-2 py-1.5 rounded-sm text-xs outline-none"
            style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
          />
          <button onClick={() => onRemove(idx)} className="p-1.5 flex-shrink-0" style={{ color: ink + "55" }}>
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <button onClick={onAdd} className="flex items-center gap-1 text-[11px] font-bold self-start" style={{ color: ink + "88" }}>
        <Plus size={12} /> Agregar línea
      </button>
    </div>
  );
}

function PayrollPanel({
  employee,
  draft,
  employees,
  recordsByDate,
  propinasHistorial,
  propinasConfig,
  onBack,
  onChange,
  onAddLine,
  onUpdateLine,
  onRemoveLine,
  onSaveConfig,
  onGenerate,
  colors,
}) {
  const { paprika, sage, ink, paper, brass, steel } = colors;
  if (!employee || !draft) return null;

  const worked = computeWorkedInRange(employee.id, draft.periodStart, draft.periodEnd, recordsByDate);
  const bonoUnits = draft.enableBono
    ? computeBonoUnits(employee.id, draft.periodStart, draft.periodEnd, recordsByDate, draft.bonoFrecuencia || "dia")
    : 0;
  // la propina ya NO se captura a mano: se suma sola de lo que Propinas ya repartió y
  // guardó para este empleado dentro del periodo de nómina
  const propinaAuto = draft.enablePropina
    ? sumPropinaFromHistorial(employee.id, draft.periodStart, draft.periodEnd, propinasHistorial)
    : 0;
  const propinaSeSuma = draft.enablePropina && propinasConfig.modoEntrega === "nomina";
  const totals = computePayrollTotals(draft, worked, bonoUnits, propinaSeSuma ? propinaAuto : 0);
  const bonoLabel =
    draft.bonoFrecuencia === "semana" ? "semana perfecta" : draft.bonoFrecuencia === "mes" ? "mes perfecto" : "jornada";
  const mostrarLineaBono = draft.enableBono && (draft.rateType !== "dia" || totals.bono > 0);
  const diasNoTrabajados = draft.enableVacaciones
    ? getNonWorkedDaysInRange(employee.id, draft.periodStart, draft.periodEnd, recordsByDate)
    : [];

  return (
    <div className="flex-1 overflow-y-auto flex flex-col gap-4 pb-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-1 text-xs font-bold" style={{ color: paper }}>
          <ChevronLeft size={15} /> Personal
        </button>
        <div className="text-sm font-black" style={{ color: paper }}>
          {employee.name}
        </div>
      </div>

      {/* configuración de pago */}
      <div className="rounded-sm p-4" style={{ background: paper }}>
        <div className="flex items-center gap-1.5 mb-3">
          <Settings2 size={13} color={ink} />
          <div className="text-[11px] font-bold uppercase" style={{ color: ink, letterSpacing: "0.05em" }}>
            Configuración de pago
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <button
            onClick={() => onChange({ rateType: "dia" })}
            className="py-2 rounded-sm text-xs font-bold uppercase"
            style={{
              background: draft.rateType === "dia" ? brass : "transparent",
              border: `1px solid ${draft.rateType === "dia" ? brass : ink + "33"}`,
              color: ink,
            }}
          >
            Por jornada/día
          </button>
          <button
            onClick={() => onChange({ rateType: "hora" })}
            className="py-2 rounded-sm text-xs font-bold uppercase"
            style={{
              background: draft.rateType === "hora" ? brass : "transparent",
              border: `1px solid ${draft.rateType === "hora" ? brass : ink + "33"}`,
              color: ink,
            }}
          >
            Por hora
          </button>
        </div>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs" style={{ color: ink + "88" }}>
            Monto por {draft.rateType === "hora" ? "hora" : "jornada"}:
          </span>
          <input
            value={draft.rateAmount}
            onChange={(e) => onChange({ rateAmount: e.target.value.replace(/[^0-9.]/g, "") })}
            placeholder="0.00"
            inputMode="decimal"
            className="flex-1 px-2 py-1.5 rounded-sm text-xs outline-none"
            style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
          />
        </div>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs" style={{ color: ink + "88" }}>
            Periodo de pago:
          </span>
          <select
            value={draft.payPeriod}
            onChange={(e) => onChange({ payPeriod: e.target.value })}
            className="flex-1 px-2 py-1.5 rounded-sm text-xs outline-none"
            style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
          >
            <option value="semanal">Semanal</option>
            <option value="quincenal">Quincenal</option>
            <option value="mensual">Mensual</option>
          </select>
        </div>
        <button
          onClick={onSaveConfig}
          className="w-full py-2 rounded-sm font-bold text-xs uppercase"
          style={{ border: `1px solid ${ink}33`, color: ink }}
        >
          Guardar como configuración de {employee.name.split(" ")[0]}
        </button>
      </div>

      {/* periodo a calcular */}
      <div className="rounded-sm p-4" style={{ background: paper }}>
        <div className="text-[11px] font-bold uppercase mb-3" style={{ color: ink, letterSpacing: "0.05em" }}>
          Periodo a calcular
        </div>
        <div className="flex items-center gap-2 mb-3">
          <input
            type="date"
            value={draft.periodStart}
            onChange={(e) => onChange({ periodStart: e.target.value })}
            className="flex-1 px-2 py-1.5 rounded-sm text-xs outline-none"
            style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
          />
          <span className="text-[10px]" style={{ color: ink + "66" }}>
            a
          </span>
          <input
            type="date"
            value={draft.periodEnd}
            onChange={(e) => onChange({ periodEnd: e.target.value })}
            className="flex-1 px-2 py-1.5 rounded-sm text-xs outline-none"
            style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
          />
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs" style={{ color: ink }}>
          <div>
            Días trabajados: <strong>{worked.totalDias}</strong>
          </div>
          <div>
            Horas trabajadas: <strong>{worked.totalHoras}</strong>
          </div>
          <div>
            Días con bono: <strong>{worked.diasBono}</strong>
          </div>
          <div>
            Días con propina: <strong>{worked.diasPropina}</strong>
          </div>
        </div>
      </div>

      {/* opciones */}
      <div className="rounded-sm p-4 flex flex-col gap-2" style={{ background: paper }}>
        <div className="text-[11px] font-bold uppercase mb-1" style={{ color: ink, letterSpacing: "0.05em" }}>
          Opciones
        </div>

        <ToggleRow label="Bono por puntualidad" checked={draft.enableBono} onChange={(v) => onChange({ enableBono: v })} colors={colors} />
        {draft.enableBono && (
          <div className="pl-1 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[11px]" style={{ color: ink + "88" }}>
                Frecuencia:
              </span>
              <select
                value={draft.bonoFrecuencia || "dia"}
                onChange={(e) => onChange({ bonoFrecuencia: e.target.value })}
                className="flex-1 px-2 py-1.5 rounded-sm text-xs outline-none"
                style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
              >
                <option value="dia">Por día</option>
                <option value="semana">Por semana</option>
                <option value="mes">Por mes</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px]" style={{ color: ink + "88" }}>
                Monto por {bonoLabel}:
              </span>
              <input
                value={draft.bonoPorJornada}
                onChange={(e) => onChange({ bonoPorJornada: e.target.value.replace(/[^0-9.]/g, "") })}
                inputMode="decimal"
                className="flex-1 px-2 py-1.5 rounded-sm text-xs outline-none"
                style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
              />
            </div>
            {draft.bonoFrecuencia && draft.bonoFrecuencia !== "dia" && (
              <p className="text-[10px]" style={{ color: ink + "66" }}>
                Solo cuenta como {draft.bonoFrecuencia === "semana" ? "semana" : "mes"} perfecta si ningún
                día trabajado quedó fuera de la tolerancia de bono.
              </p>
            )}

            <div className="mt-1 pt-2" style={{ borderTop: `1px dashed ${ink}22` }}>
              <p className="text-[10px] font-bold uppercase mb-1.5" style={{ color: ink + "88" }}>
                Tolerancia de bono (afecta al Checador en vivo)
              </p>
              <div className="flex items-center gap-2">
                <span className="text-[11px] flex-1" style={{ color: ink + "88" }}>
                  Minutos para bono:
                </span>
                <input
                  value={draft.toleranciaBonoMin}
                  onChange={(e) => onChange({ toleranciaBonoMin: e.target.value.replace(/[^0-9]/g, "") })}
                  inputMode="numeric"
                  className="w-16 px-2 py-1.5 rounded-sm text-xs outline-none"
                  style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                />
              </div>
              <p className="text-[10px] mt-1.5" style={{ color: brass }}>
                Al guardar, esta tolerancia queda vigente para las próximas entradas de {employee.name} en
                el Checador.
              </p>
              <p className="text-[10px] mt-1" style={{ color: ink + "66" }}>
                La tolerancia de propina ahora se configura desde la pestaña Propinas.
              </p>
            </div>
          </div>
        )}

        <ToggleRow label="Reparto de propina" checked={draft.enablePropina} onChange={(v) => onChange({ enablePropina: v })} colors={colors} />
        {draft.enablePropina && (
          <div className="pl-1">
            <div className="flex items-center justify-between px-3 py-2 rounded-sm" style={{ background: sage + "14" }}>
              <span className="text-[11px]" style={{ color: ink + "88" }}>
                Propina de {employee.name} este periodo (automático):
              </span>
              <span className="text-sm font-bold" style={{ color: sage }}>
                {formatMoney(propinaAuto)}
              </span>
            </div>
            <p className="text-[10px] mt-1.5" style={{ color: ink + "66" }}>
              Se toma de lo ya guardado en Propinas para las fechas de este periodo — no se captura a
              mano aquí.
            </p>
            {propinasConfig.modoEntrega === "nomina" ? (
              <p className="text-[10px] mt-1" style={{ color: sage }}>
                Entrega configurada como "junto con la nómina": este monto se suma al neto de abajo.
              </p>
            ) : (
              <p className="text-[10px] mt-1" style={{ color: brass }}>
                Entrega configurada como "diaria e independiente" en Propinas: este monto es solo
                informativo, ya se le pagó aparte y NO se suma al neto. Cámbialo en la pestaña Propinas
                si quieres que sí se sume.
              </p>
            )}
          </div>
        )}

        <ToggleRow label="Vacaciones" checked={draft.enableVacaciones} onChange={(v) => onChange({ enableVacaciones: v })} colors={colors} />
        {draft.enableVacaciones && (
          <div className="pl-1">
            {diasNoTrabajados.length === 0 ? (
              <p className="text-[11px]" style={{ color: ink + "66" }}>
                No hay días sin checar dentro de este periodo — no hay nada que marcar como
                vacaciones.
              </p>
            ) : (
              <>
                <p className="text-[11px] mb-1.5" style={{ color: ink + "88" }}>
                  ¿Cuál de estos días sin checar fue tomado como vacaciones?
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {diasNoTrabajados.map((d) => {
                    const marcado = (draft.vacacionesFechas || []).includes(d.key);
                    return (
                      <button
                        key={d.key}
                        onClick={() => {
                          const actuales = draft.vacacionesFechas || [];
                          onChange({
                            vacacionesFechas: marcado ? actuales.filter((f) => f !== d.key) : [...actuales, d.key],
                          });
                        }}
                        className="px-2.5 py-1.5 rounded-sm text-[11px] font-bold"
                        style={{
                          background: marcado ? sage : "transparent",
                          color: marcado ? paper : ink,
                          border: `1px solid ${marcado ? sage : ink + "33"}`,
                        }}
                      >
                        {d.weekday} {d.key.slice(8, 10)}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            {(draft.vacacionesFechas || []).length > 0 && (
              <p className="text-[10px] mt-1.5" style={{ color: sage }}>
                {draft.vacacionesFechas.length} día(s) marcado(s) como vacaciones ={" "}
                {formatMoney(draft.vacacionesFechas.length * (Number(draft.rateAmount) || 0))}.
              </p>
            )}
          </div>
        )}

        <ToggleRow
          label="Descuentos y penalizaciones"
          checked={draft.enableDescuentos}
          onChange={(v) => onChange({ enableDescuentos: v })}
          colors={colors}
        />
        {draft.enableDescuentos && (
          <LineItemsEditor
            items={draft.descuentos}
            onAdd={() => onAddLine("descuentos")}
            onUpdate={(idx, patch) => onUpdateLine("descuentos", idx, patch)}
            onRemove={(idx) => onRemoveLine("descuentos", idx)}
            colors={colors}
            placeholder="Motivo (ej. retardo, material dañado)"
          />
        )}

        <ToggleRow
          label="Consumo en el local"
          checked={draft.enableConsumo}
          onChange={(v) => onChange({ enableConsumo: v })}
          colors={colors}
        />
        {draft.enableConsumo && (
          <LineItemsEditor
            items={draft.consumo}
            onAdd={() => onAddLine("consumo")}
            onUpdate={(idx, patch) => onUpdateLine("consumo", idx, patch)}
            onRemove={(idx) => onRemoveLine("consumo", idx)}
            colors={colors}
            placeholder="Qué consumió"
          />
        )}

        <ToggleRow
          label="Descuentos de ley (simplificado)"
          checked={draft.enableLey}
          onChange={(v) => onChange({ enableLey: v })}
          colors={colors}
        />
        {draft.enableLey && (
          <div className="pl-1">
            <div className="flex items-center gap-2">
              <span className="text-[11px]" style={{ color: ink + "88" }}>
                % a descontar del bruto:
              </span>
              <input
                value={draft.leyPercent}
                onChange={(e) => onChange({ leyPercent: e.target.value.replace(/[^0-9.]/g, "") })}
                inputMode="decimal"
                className="flex-1 px-2 py-1.5 rounded-sm text-xs outline-none"
                style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
              />
            </div>
            <p className="text-[10px] mt-1 flex items-start gap-1" style={{ color: paprika }}>
              <AlertTriangle size={11} className="flex-shrink-0 mt-0.5" />
              Esto es un porcentaje simple, no un cálculo real de ISR/IMSS. Antes de usarlo con nómina de
              verdad, valídalo con tu contador.
            </p>
          </div>
        )}
      </div>

      {/* resumen */}
      <div className="rounded-sm p-4" style={{ background: paper }}>
        <div className="text-[11px] font-bold uppercase mb-3" style={{ color: ink, letterSpacing: "0.05em" }}>
          Resumen
        </div>
        <div className="flex flex-col gap-1 text-xs" style={{ color: ink }}>
          <div className="flex justify-between">
            <span>Pago base</span>
            <span>{formatMoney(totals.base)}</span>
          </div>
          {mostrarLineaBono && (
            <div className="flex justify-between">
              <span>Bono</span>
              <span>+{formatMoney(totals.bono)}</span>
            </div>
          )}
          {draft.enablePropina && (
            <div className="flex justify-between">
              <span>Propina</span>
              <span>+{formatMoney(totals.propina)}</span>
            </div>
          )}
          {draft.enableVacaciones && (
            <div className="flex justify-between">
              <span>Vacaciones</span>
              <span>+{formatMoney(totals.vacaciones)}</span>
            </div>
          )}
          <div className="flex justify-between font-bold pt-1" style={{ borderTop: `1px solid ${ink}22` }}>
            <span>Bruto</span>
            <span>{formatMoney(totals.bruto)}</span>
          </div>
          {draft.enableLey && (
            <div className="flex justify-between" style={{ color: paprika }}>
              <span>Descuento de ley</span>
              <span>-{formatMoney(totals.leyDeduccion)}</span>
            </div>
          )}
          {draft.enableDescuentos && (
            <div className="flex justify-between" style={{ color: paprika }}>
              <span>Descuentos/penalizaciones</span>
              <span>-{formatMoney(totals.descuentos)}</span>
            </div>
          )}
          {draft.enableConsumo && (
            <div className="flex justify-between" style={{ color: paprika }}>
              <span>Consumo en el local</span>
              <span>-{formatMoney(totals.consumo)}</span>
            </div>
          )}
          <div className="flex justify-between font-black text-base pt-2 mt-1" style={{ borderTop: `2px solid ${ink}33`, color: sage }}>
            <span>Neto a pagar</span>
            <span>{formatMoney(totals.neto)}</span>
          </div>
        </div>

        <button
          onClick={() => onGenerate(worked, totals)}
          className="w-full flex items-center justify-center gap-2 py-3 mt-4 rounded-sm font-bold text-sm uppercase"
          style={{ background: brass, color: ink }}
        >
          <FileSignature size={15} /> Generar recibo imprimible
        </button>
      </div>
    </div>
  );
}

export default function RelojChecador() {
  const [tab, setTab] = useState("checador");

  const [employees, setEmployees] = useState([]);
  const [loadingEmployees, setLoadingEmployees] = useState(true);
  const [newName, setNewName] = useState("");
  const [newPuesto, setNewPuesto] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  // ---------- lista de áreas del local (configurable, ya no fija) ----------
  const [areasList, setAreasList] = useState(DEFAULT_AREAS);
  const [loadingAreas, setLoadingAreas] = useState(true);
  const [newAreaName, setNewAreaName] = useState("");
  const [editingAreaIdx, setEditingAreaIdx] = useState(null);
  const [editingAreaValue, setEditingAreaValue] = useState("");
  const [confirmDeleteAreaIdx, setConfirmDeleteAreaIdx] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await storageGet("areas_config");
        setAreasList(r ? JSON.parse(r.value) : DEFAULT_AREAS);
      } catch {
        setAreasList(DEFAULT_AREAS);
      }
      setLoadingAreas(false);
    })();
  }, []);

  function saveAreasList(list) {
    setAreasList(list);
    scheduleSync("areas_config", JSON.stringify(list));
  }

  function addAreaToList() {
    const name = newAreaName.trim();
    if (!name || areasList.includes(name)) return;
    saveAreasList([...areasList, name]);
    setNewAreaName("");
  }

  function startEditArea(idx) {
    setEditingAreaIdx(idx);
    setEditingAreaValue(areasList[idx]);
  }

  function saveEditArea() {
    const nuevoNombre = editingAreaValue.trim();
    if (!nuevoNombre) return;
    const nombreAnterior = areasList[editingAreaIdx];
    const nuevaLista = areasList.map((a, i) => (i === editingAreaIdx ? nuevoNombre : a));
    saveAreasList(nuevaLista);
    // renombrar también en los empleados que ya tenían asignada esa área
    if (nombreAnterior !== nuevoNombre) {
      saveEmployeesList(
        employees.map((e) =>
          (e.areas || []).includes(nombreAnterior)
            ? { ...e, areas: e.areas.map((a) => (a === nombreAnterior ? nuevoNombre : a)) }
            : e
        )
      );
    }
    setEditingAreaIdx(null);
    setEditingAreaValue("");
  }

  function deleteArea(idx) {
    const nombre = areasList[idx];
    saveAreasList(areasList.filter((_, i) => i !== idx));
    // quitarla también de cualquier empleado que la tuviera asignada
    saveEmployeesList(employees.map((e) => (e.areas || []).includes(nombre) ? { ...e, areas: e.areas.filter((a) => a !== nombre) } : e));
    setConfirmDeleteAreaIdx(null);
  }

  const [horarioDiaSeleccionado, setHorarioDiaSeleccionado] = useState(new Date().getDay());

  // ---------- mínimo de personal por área ----------
  const [areaMinimos, setAreaMinimos] = useState({}); // { [nombreArea]: number }
  const [loadingAreaMinimos, setLoadingAreaMinimos] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await storageGet("area_minimos");
        setAreaMinimos(r ? JSON.parse(r.value) : {});
      } catch {
        setAreaMinimos({});
      }
      setLoadingAreaMinimos(false);
    })();
  }, []);

  function setAreaMinimo(areaName, value) {
    const next = { ...areaMinimos, [areaName]: Math.max(0, Number(value) || 0) };
    setAreaMinimos(next);
    scheduleSync("area_minimos", JSON.stringify(next));
  }

  // ---------- turnos (matutino / medio / nocturno) ----------
  const DEFAULT_TURNOS = [
    { id: "matutino", nombre: "Matutino", start: "07:00", end: "15:00" },
    { id: "medio", nombre: "Medio", start: "13:00", end: "19:00" },
    { id: "nocturno", nombre: "Nocturno", start: "19:00", end: "01:00" },
  ];
  const [turnosConfig, setTurnosConfig] = useState({ habilitado: false, turnos: DEFAULT_TURNOS });
  const [loadingTurnos, setLoadingTurnos] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await storageGet("turnos_config");
        setTurnosConfig(r ? JSON.parse(r.value) : { habilitado: false, turnos: DEFAULT_TURNOS });
      } catch {
        setTurnosConfig({ habilitado: false, turnos: DEFAULT_TURNOS });
      }
      setLoadingTurnos(false);
    })();
  }, []);

  function saveTurnosConfig(next) {
    setTurnosConfig(next);
    scheduleSync("turnos_config", JSON.stringify(next));
  }

  function toggleTurnosHabilitado() {
    saveTurnosConfig({ ...turnosConfig, habilitado: !turnosConfig.habilitado });
  }

  function updateTurnoDefinicion(turnoId, patch) {
    saveTurnosConfig({
      ...turnosConfig,
      turnos: turnosConfig.turnos.map((t) => (t.id === turnoId ? { ...t, ...patch } : t)),
    });
  }

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

  // ---------- datos del negocio (para encabezados de recibos) ----------
  const [businessConfig, setBusinessConfig] = useState({ nombre: "Restaurante Bondiola", direccion: "", encabezado: "" });
  const [businessConfigDraft, setBusinessConfigDraft] = useState({ nombre: "", direccion: "", encabezado: "" });
  const [businessLogo, setBusinessLogo] = useState(null); // data URL, se queda local en este dispositivo
  const [showBusinessConfigEdit, setShowBusinessConfigEdit] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await storageGet("business_config");
        const cfg = r ? JSON.parse(r.value) : { nombre: "Restaurante Bondiola", direccion: "", encabezado: "" };
        setBusinessConfig(cfg);
        setBusinessConfigDraft(cfg);
      } catch {
        // se queda con el valor por defecto
      }
      try {
        const logo = await getPhotoLocal("business_logo");
        if (logo) setBusinessLogo(logo);
      } catch {
        // sin logo guardado todavía
      }
    })();
  }, []);

  function saveBusinessConfig() {
    setBusinessConfig(businessConfigDraft);
    scheduleSync("business_config", JSON.stringify(businessConfigDraft));
    setShowBusinessConfigEdit(false);
    setToast({ color: sage, text: "Datos del negocio actualizados." });
  }

  async function handleLogoUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const dataUrl = await compressImage(file, 320, 0.85);
      await savePhotoLocal("business_logo", dataUrl);
      setBusinessLogo(dataUrl);
      setToast({ color: sage, text: "Logo actualizado en este dispositivo." });
    } catch {
      setToast({ color: paprika, text: "No se pudo guardar el logo." });
    }
  }

  async function removeLogo() {
    try {
      await deletePhotoLocal("business_logo");
    } catch {
      // no pasa nada si no existía
    }
    setBusinessLogo(null);
  }

  // ---------- nómina ----------
  const [payrollSelectedEmployeeId, setPayrollSelectedEmployeeId] = useState(null);
  const [payrollDraft, setPayrollDraft] = useState(null);
  const [payrollPrintView, setPayrollPrintView] = useState(null); // { employee, worked, totals, draft } | null
  const [payrollRuns, setPayrollRuns] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const r = await storageGet("payroll_runs");
        setPayrollRuns(r ? JSON.parse(r.value) : []);
      } catch {
        setPayrollRuns([]);
      }
    })();
  }, []);

  // guarda el recibo generado en el histórico y deja el formulario listo para la siguiente jornada
  function handleGeneratePayroll(worked, totals) {
    const emp = employees.find((e) => e.id === payrollSelectedEmployeeId);
    if (!emp || !payrollDraft) return;
    const run = {
      id: uid("nomina"),
      employeeId: emp.id,
      employeeName: emp.name,
      periodStart: payrollDraft.periodStart,
      periodEnd: payrollDraft.periodEnd,
      draft: payrollDraft,
      worked,
      totals,
      creadoEn: new Date().toISOString(),
    };
    const actualizado = [run, ...payrollRuns].slice(0, 200);
    setPayrollRuns(actualizado);
    scheduleSync("payroll_runs", JSON.stringify(actualizado));

    setPayrollPrintView({ employee: emp, draft: payrollDraft, worked, totals });
    openPayroll(emp.id); // reinicia el formulario a un borrador limpio para la siguiente jornada
  }

  // ---------- propinas ----------
  const [propinasPeriodoInicio, setPropinasPeriodoInicio] = useState(localDateKey());
  const [propinasPeriodoFin, setPropinasPeriodoFin] = useState(localDateKey());
  const [propinasMonto, setPropinasMonto] = useState("");
  const [propinasQuien, setPropinasQuien] = useState("");
  const [propinasHistorial, setPropinasHistorial] = useState([]);
  const [loadingPropinasHistorial, setLoadingPropinasHistorial] = useState(true);
  const [showPropinasHistorial, setShowPropinasHistorial] = useState(false);

  // configuración global de propinas: visible para cualquiera, pero solo se edita con PIN.
  // toleranciaMin: minutos para calificar a propina · frecuencia: cada cuánto se cierra el
  // reparto (diaria/semanal/mensual) · modoEntrega: si se paga aparte cada vez, o se junta
  // y se entrega hasta la nómina del periodo.
  const [propinasConfig, setPropinasConfig] = useState({ toleranciaMin: 15, frecuencia: "diaria", modoEntrega: "diaria" });
  const [propinasConfigDraft, setPropinasConfigDraft] = useState({ toleranciaMin: "15", frecuencia: "diaria", modoEntrega: "diaria" });
  const [showPropinasConfigEdit, setShowPropinasConfigEdit] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await storageGet("propinas_config");
        const cfg = r ? JSON.parse(r.value) : { toleranciaMin: 15, frecuencia: "diaria", modoEntrega: "diaria" };
        setPropinasConfig(cfg);
        setPropinasConfigDraft({ ...cfg, toleranciaMin: String(cfg.toleranciaMin) });
      } catch {
        // se queda con los valores por defecto
      }
    })();
  }, []);

  // al cambiar la frecuencia (incluida la que ya está guardada al cargar), recalcula el
  // rango de fechas por defecto para el reparto
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

  function savePropinasConfig() {
    const cfg = {
      toleranciaMin: Number(propinasConfigDraft.toleranciaMin) || 0,
      frecuencia: propinasConfigDraft.frecuencia,
      modoEntrega: propinasConfigDraft.modoEntrega,
    };
    setPropinasConfig(cfg);
    scheduleSync("propinas_config", JSON.stringify(cfg));
    setShowPropinasConfigEdit(false);
    setToast({ color: sage, text: "Configuración de propinas actualizada." });
  }

  // ---------- personal externo (temporal) ----------
  const [externosCatalogo, setExternosCatalogo] = useState([]);
  const [externosPorDia, setExternosPorDia] = useState([]);
  const [propinasFecha, setPropinasFecha] = useState(localDateKey());
  const [nuevoExternoNombre, setNuevoExternoNombre] = useState("");

  const loadExternos = useCallback(async () => {
    try {
      const cat = await storageGet("personal_externo");
      setExternosCatalogo(cat ? JSON.parse(cat.value) : []);
    } catch {
      setExternosCatalogo([]);
    }
    try {
      const dia = await storageGet("externos_por_dia");
      setExternosPorDia(dia ? JSON.parse(dia.value) : []);
    } catch {
      setExternosPorDia([]);
    }
  }, []);

  useEffect(() => {
    loadExternos();
  }, [loadExternos]);

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

  // ---------- corrección manual de puntualidad (superusuario) ----------
  // Corrige directo el registro de la entrada de un día específico, cuando un error ajeno
  // a la persona (falla al checar, etc.) le impidió calificar. Al corregir la fuente, el
  // cambio se ve automáticamente en Bitácora, Nómina y Propinas — no es un cálculo aparte.
  const [showAjusteManual, setShowAjusteManual] = useState(false);
  const [ajusteEmpleadoId, setAjusteEmpleadoId] = useState("");
  const [ajusteFecha, setAjusteFecha] = useState(localDateKey());
  const [ajusteBono, setAjusteBono] = useState(false);
  const [ajustePropina, setAjustePropina] = useState(false);
  const [ajusteMotivo, setAjusteMotivo] = useState("");
  const [ajustesLog, setAjustesLog] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const r = await storageGet("ajustes_manuales_log");
        setAjustesLog(r ? JSON.parse(r.value) : []);
      } catch {
        setAjustesLog([]);
      }
    })();
  }, []);

  function aplicarCorreccionManual() {
    if (!ajusteEmpleadoId || !ajusteFecha || !ajusteMotivo.trim()) return;
    if (!ajusteBono && !ajustePropina) return;

    const dayRecords = recordsByDate[ajusteFecha] || [];
    const idx = dayRecords.findIndex((r) => r.employeeId === ajusteEmpleadoId && r.type === "entrada");
    if (idx === -1) {
      setToast({ color: paprika, text: "Esa persona no tiene una entrada registrada ese día." });
      return;
    }

    // "bono" ya incluye derecho a propina (mismo criterio que el resto de la app); si solo
    // se marca propina, el nivel queda en "propina" nada más.
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

    const emp = employees.find((e) => e.id === ajusteEmpleadoId);
    const logEntry = {
      id: uid("ajuste"),
      employeeId: ajusteEmpleadoId,
      employeeName: emp?.name || ajusteEmpleadoId,
      fecha: ajusteFecha,
      bono: ajusteBono,
      propina: ajustePropina || ajusteBono,
      motivo: ajusteMotivo.trim(),
      creadoEn: new Date().toISOString(),
    };
    const actualizado = [logEntry, ...ajustesLog].slice(0, 100);
    setAjustesLog(actualizado);
    scheduleSync("ajustes_manuales_log", JSON.stringify(actualizado));

    setAjusteEmpleadoId("");
    setAjusteMotivo("");
    setAjusteBono(false);
    setAjustePropina(false);
    setToast({ color: sage, text: `Corrección aplicada a ${emp?.name || "empleado"} — ya se refleja en todos lados.` });
  }

  useEffect(() => {
    (async () => {
      try {
        const r = await storageGet("propinas_historial");
        setPropinasHistorial(r ? JSON.parse(r.value) : []);
      } catch {
        setPropinasHistorial([]);
      }
      setLoadingPropinasHistorial(false);
    })();
  }, []);

  async function guardarReparto(fechaInicio, fechaFin, monto, reparto, quien) {
    const nuevo = {
      id: uid("propina"),
      fechaInicio,
      fechaFin,
      monto: Number(monto) || 0,
      reparto,
      quien: quien || "",
      creadoEn: new Date().toISOString(),
    };
    const sinEseRango = propinasHistorial.filter(
      (p) => !((p.fechaInicio || p.fecha) === fechaInicio && (p.fechaFin || p.fecha) === fechaFin)
    );
    const actualizado = [nuevo, ...sinEseRango].slice(0, 60); // conserva los últimos 60 repartos
    setPropinasHistorial(actualizado);
    scheduleSync("propinas_historial", JSON.stringify(actualizado));
    setPropinasMonto("");
    setPropinasQuien("");
    const rangoLabel =
      fechaInicio === fechaFin
        ? formatDateLabel(fechaInicio, today)
        : `${formatDateLabel(fechaInicio, today)} – ${formatDateLabel(fechaFin, today)}`;
    setToast({ color: sage, text: `Propinas de ${rangoLabel} guardadas.` });
  }

  function openPayroll(employeeId) {
    const emp = employees.find((e) => e.id === employeeId);
    if (!emp) return;
    const payroll = emp.payroll || defaultPayroll();
    const period = defaultPeriodDates(payroll.payPeriod);
    setPayrollSelectedEmployeeId(employeeId);
    setPayrollDraft({
      ...payroll,
      periodStart: period.start,
      periodEnd: period.end,
      vacacionesFechas: [],
      leyPercent: payroll.leyPercent || 0,
      enableBono: false,
      enablePropina: false,
      enableVacaciones: false,
      enableDescuentos: false,
      enableConsumo: false,
      enableLey: false,
      descuentos: [],
      consumo: [],
    });
  }

  function closePayroll() {
    setPayrollSelectedEmployeeId(null);
    setPayrollDraft(null);
  }

  function updatePayrollDraft(patch) {
    setPayrollDraft((d) => ({ ...d, ...patch }));
  }

  function addLineItem(field) {
    setPayrollDraft((d) => ({ ...d, [field]: [...(d[field] || []), { label: "", amount: "" }] }));
  }
  function updateLineItem(field, idx, patch) {
    setPayrollDraft((d) => {
      const list = [...(d[field] || [])];
      list[idx] = { ...list[idx], ...patch };
      return { ...d, [field]: list };
    });
  }
  function removeLineItem(field, idx) {
    setPayrollDraft((d) => {
      const list = [...(d[field] || [])];
      list.splice(idx, 1);
      return { ...d, [field]: list };
    });
  }

  function savePayrollConfig() {
    if (!payrollSelectedEmployeeId || !payrollDraft) return;
    const configToSave = {
      rateType: payrollDraft.rateType,
      rateAmount: Number(payrollDraft.rateAmount) || 0,
      payPeriod: payrollDraft.payPeriod,
      bonoPorJornada: Number(payrollDraft.bonoPorJornada) || 0,
      bonoFrecuencia: payrollDraft.bonoFrecuencia || "dia",
      toleranciaBonoMin: Number(payrollDraft.toleranciaBonoMin) || 10,
      leyPercent: Number(payrollDraft.leyPercent) || 0,
    };
    saveEmployeesList(
      employees.map((e) => (e.id === payrollSelectedEmployeeId ? { ...e, payroll: configToSave } : e))
    );
    setToast({ color: sage, text: "Configuración de pago guardada — la tolerancia ya aplica en el Checador." });
  }

  // Descarga el resumen ya formateado (documento HTML con tablas y líneas de firma),
  // listo para abrir en cualquier navegador e imprimir o guardar como PDF.
  function downloadMonthSummary(monthKeyStr) {
    const html = buildMonthSummaryHtml(monthKeyStr, employees, recordsByDate, businessConfig);
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
      if (target === "bitacora" || target === "nomina") setTab(target);
      if (target === "propinas_historial") setShowPropinasHistorial(true);
      if (target === "propinas_config_editar") setShowPropinasConfigEdit(true);
      if (target === "propinas_ajuste_manual") setShowAjusteManual(true);
      if (target === "business_config_editar") setShowBusinessConfigEdit(true);
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
    setShowPropinasHistorial(false);
    setShowPropinasConfigEdit(false);
    setShowAjusteManual(false);
    setShowBusinessConfigEdit(false);
    if (tab === "bitacora" || tab === "nomina") setTab("checador");
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
      if (target === "bitacora" || target === "nomina") setTab(target);
      if (target === "propinas_historial") setShowPropinasHistorial(true);
      if (target === "propinas_config_editar") setShowPropinasConfigEdit(true);
      if (target === "propinas_ajuste_manual") setShowAjusteManual(true);
      if (target === "business_config_editar") setShowBusinessConfigEdit(true);
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
    if (target === "bitacora" || target === "nomina") setTab(target);
    if (target === "propinas_historial") setShowPropinasHistorial(true);
    if (target === "propinas_config_editar") setShowPropinasConfigEdit(true);
    if (target === "propinas_ajuste_manual") setShowAjusteManual(true);
    if (target === "business_config_editar") setShowBusinessConfigEdit(true);
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
      areas: [],
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

  // edición rápida de un solo día desde la vista "Horario por día" — mismo versionado que
  // el editor por empleado (aplica desde hoy, conserva el histórico de meses pasados)
  function quickUpdateEmployeeDay(employeeId, dayIdx, patch) {
    const todayKey = localDateKey();
    saveEmployeesList(
      employees.map((e) => {
        if (e.id !== employeeId) return e;
        const current = getScheduleForDate(e, todayKey) || defaultSchedule();
        const updatedSchedule = { ...current, [dayIdx]: { ...current[dayIdx], ...patch } };
        const history = e.scheduleHistory ? [...e.scheduleHistory] : [];
        const idx = history.findIndex((v) => v.effectiveFrom === todayKey);
        if (idx >= 0) history[idx] = { effectiveFrom: todayKey, schedule: updatedSchedule };
        else history.push({ effectiveFrom: todayKey, schedule: updatedSchedule });
        history.sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFrom ? 1 : 0));
        return { ...e, scheduleHistory: history, schedule: updatedSchedule };
      })
    );
  }

  // ---------- editor de áreas por empleado ----------
  const [areasModal, setAreasModal] = useState(null); // { employeeId, draft: string[] }

  function openAreasModal(employeeId) {
    const emp = employees.find((e) => e.id === employeeId);
    if (!emp) return;
    setAreasModal({ employeeId, draft: emp.areas || [] });
  }

  function toggleAreaInModal(area) {
    setAreasModal((m) => ({
      ...m,
      draft: m.draft.includes(area) ? m.draft.filter((a) => a !== area) : [...m.draft, area],
    }));
  }

  function saveAreas() {
    if (!areasModal) return;
    saveEmployeesList(
      employees.map((e) => (e.id === areasModal.employeeId ? { ...e, areas: areasModal.draft } : e))
    );
    setAreasModal(null);
  }

  // ---------- método de checado por empleado (foto / clave / biométrico) ----------
  const [metodoModal, setMetodoModal] = useState(null); // { employeeId, draft: {tipo, clave, bioCredentialId}, error, enrolling }

  function openMetodoModal(employeeId) {
    const emp = employees.find((e) => e.id === employeeId);
    if (!emp) return;
    setMetodoModal({
      employeeId,
      draft: {
        tipo: emp.checadaMetodo || "foto",
        clave: emp.checadaClave || "",
        bioCredentialId: emp.biometricCredentialId || null,
      },
      error: "",
      enrolling: false,
    });
  }

  function saveMetodo() {
    if (!metodoModal) return;
    const { tipo, clave, bioCredentialId } = metodoModal.draft;
    if (tipo === "clave" && (!clave || clave.length !== 4)) {
      setMetodoModal((m) => ({ ...m, error: "La clave debe tener exactamente 4 dígitos." }));
      return;
    }
    if (tipo === "biometrico" && !bioCredentialId) {
      setMetodoModal((m) => ({ ...m, error: "Registra primero la huella/rostro en este dispositivo." }));
      return;
    }
    saveEmployeesList(
      employees.map((e) =>
        e.id === metodoModal.employeeId
          ? { ...e, checadaMetodo: tipo, checadaClave: tipo === "clave" ? clave : e.checadaClave, biometricCredentialId: bioCredentialId }
          : e
      )
    );
    setMetodoModal(null);
  }

  async function enrollBiometricForModal() {
    if (!metodoModal) return;
    const emp = employees.find((e) => e.id === metodoModal.employeeId);
    if (!emp) return;
    setMetodoModal((m) => ({ ...m, enrolling: true, error: "" }));
    try {
      const credentialId = await enrollBiometric(emp.id, emp.name, businessConfig.nombre);
      setMetodoModal((m) => ({ ...m, draft: { ...m.draft, bioCredentialId: credentialId }, enrolling: false }));
      setToast({ color: sage, text: `Huella/rostro registrado para ${emp.name} en este dispositivo.` });
    } catch (err) {
      console.error("Error registrando biometría:", err);
      setMetodoModal((m) => ({
        ...m,
        enrolling: false,
        error: "No se pudo registrar. Cancelado o no compatible con este dispositivo/navegador.",
      }));
    }
  }

  // ---------- status (based on today only) ----------

  function statusFor(employeeId) {
    const own = (recordsByDate[today] || []).filter((r) => r.employeeId === employeeId);
    if (own.length === 0) return "fuera";
    return own[own.length - 1].type === "entrada" ? "dentro" : "fuera";
  }

  // ---------- punching ----------

  function openPunch(type) {
    const emp = employees.find((e) => e.id === selectedEmployeeId);
    const areas = emp?.areas || [];
    const area = type === "entrada" && areas.length === 1 ? areas[0] : null;
    const metodo = emp?.checadaMetodo || "foto";
    setPunchModal({ type, photo: null, area, metodo, claveInput: "", claveError: "", bioStatus: "idle" });
  }

  async function runBiometricCheck() {
    const emp = employees.find((e) => e.id === selectedEmployeeId);
    if (!emp?.biometricCredentialId) return;
    setPunchModal((p) => (p ? { ...p, bioStatus: "checking" } : p));
    try {
      const ok = await verifyBiometric(emp.biometricCredentialId);
      setPunchModal((p) => (p ? { ...p, bioStatus: ok ? "success" : "error" } : p));
    } catch (err) {
      console.error("Error verificando biometría:", err);
      setPunchModal((p) => (p ? { ...p, bioStatus: "error" } : p));
    }
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

    const emp = employees.find((e) => e.id === selectedEmployeeId);
    if (!emp) return;

    const metodo = punchModal.metodo || "foto";
    if (punchModal.type === "entrada") {
      if (metodo === "foto" && !punchModal.photo) return;
      if (metodo === "clave" && punchModal.claveInput !== emp.checadaClave) return;
      if (metodo === "biometrico" && punchModal.bioStatus !== "success") return;
    }

    if (punchModal.type === "entrada" && (emp.areas || []).length > 1 && !punchModal.area) return;

    const now = new Date();
    const nowIso = now.toISOString();

    let punctuality = null;
    let minsLate = null;
    if (punchModal.type === "entrada") {
      const daySchedule = getScheduleForDate(emp, today)?.[now.getDay()];
      if (daySchedule?.enabled && daySchedule.start) {
        minsLate = minutesLate(daySchedule.start, nowIso);
        const tolBono = emp.payroll?.toleranciaBonoMin ?? 10;
        punctuality = punctualityTier(minsLate, tolBono, propinasConfig.toleranciaMin);
      }
    }

    const record = {
      id: uid("rec"),
      employeeId: emp.id,
      employeeName: emp.name,
      type: punchModal.type,
      time: nowIso,
      area: punchModal.type === "entrada" ? punchModal.area || null : null,
      hasPhoto: !!punchModal.photo,
      checadaMetodo: punchModal.type === "entrada" ? metodo : null,
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

  // ---------- recibo de nómina imprimible ----------
  if (payrollPrintView) {
    const { employee: pEmp, draft: pDraft, worked: pWorked, totals: pTotals } = payrollPrintView;
    const periodLabel = `${pDraft.periodStart} a ${pDraft.periodEnd}`;
    const bizNombre = businessConfig.nombre || "Restaurante";
    const bizInitials = bizNombre
      .split(" ")
      .filter(Boolean)
      .map((w) => w[0])
      .join("")
      .slice(0, 3)
      .toUpperCase();
    const refCode = `REF. ${bizInitials}-${pDraft.periodStart.replace(/-/g, "")}`;
    const mostrarBono = pDraft.enableBono && (pDraft.rateType !== "dia" || pTotals.bono > 0);
    const mostrarVacaciones = pDraft.enableVacaciones && (pDraft.vacacionesFechas || []).length > 0;
    const hasDeducciones =
      pDraft.enableLey ||
      (pDraft.enableDescuentos && (pDraft.descuentos || []).length > 0) ||
      (pDraft.enableConsumo && (pDraft.consumo || []).length > 0);

    return (
      <div style={{ background: "#2a2a2a", minHeight: "100vh", fontFamily: "'Helvetica Neue', Arial, sans-serif" }}>
        <style>{`
          @page { size: letter; margin: 0.4in; }
          @media print {
            .no-print { display: none !important; }
            .recibo-page { box-shadow: none !important; }
          }
          .recibo-page * { box-sizing: border-box; }
          .recibo-section-title {
            font-size: 0.64rem; font-weight: 900; text-transform: uppercase; letter-spacing: 0.06em;
            color: #111; margin-top: 0.8rem; padding-bottom: 0.15rem; border-bottom: 1.5px solid #111;
          }
          .recibo-table { width: 100%; margin-top: 0.3rem; font-size: 0.72rem; border-collapse: collapse; }
          .recibo-table th {
            text-align: left; font-size: 0.56rem; text-transform: uppercase; letter-spacing: 0.03em;
            color: #666; padding: 2px 6px; font-weight: 700; border-bottom: 1px solid #ccc;
          }
          .recibo-table td { padding: 3px 6px; border-bottom: 1px solid #eee; }
          .recibo-table tbody tr:nth-child(odd) td { background: #00000005; }
          .recibo-table .amt { text-align: right; font-family: 'Courier New', monospace; }
          .recibo-table .total-row td { border-top: 1.5px solid #111; border-bottom: none; font-weight: 800; padding-top: 5px; background: transparent !important; }
        `}</style>

        <div
          className="no-print flex items-center justify-between px-4 py-3"
          style={{ borderBottom: `1px solid ${ink}22`, position: "sticky", top: 0, background: paper, maxWidth: 680, margin: "0 auto" }}
        >
          <button onClick={() => setPayrollPrintView(null)} className="text-sm font-bold" style={{ color: ink }}>
            ← Volver
          </button>
          <div className="text-xs font-bold uppercase" style={{ color: ink + "88" }}>
            Recibo de nómina
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
          className="recibo-page"
          style={{
            maxWidth: 680,
            minHeight: "10in",
            margin: "0 auto",
            background: "#fff",
            color: "#111",
            position: "relative",
            padding: "1rem 1.4rem 1.2rem",
            boxShadow: "0 4px 24px #00000055",
          }}
        >
          <div style={{ height: 0, borderTop: "3px double #111" }} />
          <div
            style={{
              position: "absolute",
              top: "46%",
              left: "50%",
              transform: "translate(-50%,-50%) rotate(-22deg)",
              fontSize: "1.7rem",
              fontWeight: 900,
              color: "#00000010",
              whiteSpace: "nowrap",
              pointerEvents: "none",
            }}
          >
            RECIBO INTERNO — NO ES CFDI
          </div>

          <div style={{ border: "1px solid #111", borderRadius: 3, padding: "0.4rem 0.7rem", fontSize: "0.6rem", margin: "0.6rem 0 0.85rem", position: "relative" }}>
            Documento interno de control, no es un CFDI de nómina válido ante el SAT.
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", position: "relative" }}>
            {businessLogo ? (
              <img src={businessLogo} alt="Logo" style={{ width: 34, height: 34, objectFit: "contain", borderRadius: "50%" }} />
            ) : (
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: "50%",
                  background: "#111",
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 900,
                  fontSize: "0.72rem",
                  flexShrink: 0,
                }}
              >
                {bizInitials || "RB"}
              </div>
            )}
            <div>
              <div style={{ fontSize: "0.9rem", fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em" }}>
                {bizNombre}
              </div>
              {(businessConfig.direccion || businessConfig.encabezado) && (
                <div style={{ fontSize: "0.6rem", color: "#444", lineHeight: 1.3 }}>
                  {[businessConfig.direccion, businessConfig.encabezado].filter(Boolean).join(" · ")}
                </div>
              )}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-end",
              marginTop: "0.7rem",
              paddingBottom: "0.4rem",
              borderBottom: "2px dashed #999",
              position: "relative",
            }}
          >
            <h1 style={{ fontSize: "1.05rem", fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", margin: 0 }}>
              Recibo de nómina
            </h1>
            <div style={{ fontFamily: "'Courier New', monospace", fontSize: "0.6rem", color: "#555", textAlign: "right", lineHeight: 1.5 }}>
              <strong style={{ color: "#111", display: "block", fontSize: "0.64rem", letterSpacing: "0.02em" }}>{refCode}</strong>
              Periodo {periodLabel}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 1.25rem", marginTop: "0.6rem", fontSize: "0.72rem", lineHeight: 1.4 }}>
            <div>
              <span style={{ fontSize: "0.56rem", textTransform: "uppercase", letterSpacing: "0.04em", color: "#666", display: "block" }}>
                Empleado
              </span>
              <span style={{ fontWeight: 700 }}>{pEmp.name}</span>
            </div>
            <div>
              <span style={{ fontSize: "0.56rem", textTransform: "uppercase", letterSpacing: "0.04em", color: "#666", display: "block" }}>
                Puesto
              </span>
              <span style={{ fontWeight: 700 }}>{pEmp.puesto}</span>
            </div>
            <div style={{ marginTop: "0.3rem" }}>
              <span style={{ fontSize: "0.56rem", textTransform: "uppercase", letterSpacing: "0.04em", color: "#666", display: "block" }}>
                Tarifa
              </span>
              <span style={{ fontWeight: 700 }}>
                {formatMoney(pDraft.rateAmount)} por {pDraft.rateType === "hora" ? "hora" : "jornada"}
              </span>
            </div>
            <div style={{ marginTop: "0.3rem" }}>
              <span style={{ fontSize: "0.56rem", textTransform: "uppercase", letterSpacing: "0.04em", color: "#666", display: "block" }}>
                {pDraft.rateType === "hora" ? "Horas trabajadas" : "Días trabajados"}
              </span>
              <span style={{ fontWeight: 700 }}>{pDraft.rateType === "hora" ? pWorked.totalHoras : pWorked.totalDias}</span>
            </div>
          </div>

          <div className="recibo-section-title">Percepciones</div>
          <table className="recibo-table">
            <thead>
              <tr>
                <th>Concepto</th>
                <th className="amt">Monto</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Pago base</td>
                <td className="amt">{formatMoney(pTotals.base)}</td>
              </tr>
              {mostrarBono && (
                <tr>
                  <td>Bono por puntualidad</td>
                  <td className="amt">+{formatMoney(pTotals.bono)}</td>
                </tr>
              )}
              {pDraft.enablePropina && (
                <tr>
                  <td>Reparto de propina</td>
                  <td className="amt">+{formatMoney(pTotals.propina)}</td>
                </tr>
              )}
              {mostrarVacaciones && (
                <tr>
                  <td>Vacaciones ({pDraft.vacacionesFechas.length} días)</td>
                  <td className="amt">+{formatMoney(pTotals.vacaciones)}</td>
                </tr>
              )}
              <tr className="total-row">
                <td>Total percepciones</td>
                <td className="amt">{formatMoney(pTotals.bruto)}</td>
              </tr>
            </tbody>
          </table>

          {hasDeducciones && (
            <>
              <div className="recibo-section-title">Deducciones</div>
              <table className="recibo-table">
                <thead>
                  <tr>
                    <th>Concepto</th>
                    <th className="amt">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {pDraft.enableLey && (
                    <tr>
                      <td>Descuento de ley ({pDraft.leyPercent}%)</td>
                      <td className="amt">({formatMoney(pTotals.leyDeduccion)})</td>
                    </tr>
                  )}
                  {pDraft.enableDescuentos &&
                    (pDraft.descuentos || []).map((d, i) => (
                      <tr key={i}>
                        <td>{d.label || "Descuento/penalización"}</td>
                        <td className="amt">({formatMoney(d.amount)})</td>
                      </tr>
                    ))}
                  {pDraft.enableConsumo &&
                    (pDraft.consumo || []).map((c, i) => (
                      <tr key={i}>
                        <td>{c.label || "Consumo en el local"}</td>
                        <td className="amt">({formatMoney(c.amount)})</td>
                      </tr>
                    ))}
                  <tr className="total-row">
                    <td>Total deducciones</td>
                    <td className="amt">
                      ({formatMoney(pTotals.leyDeduccion + pTotals.descuentos + pTotals.consumo)})
                    </td>
                  </tr>
                </tbody>
              </table>
            </>
          )}

          <div
            style={{
              marginTop: "0.6rem",
              border: "3px double #111",
              borderRadius: 4,
              padding: "0.5rem 0.9rem",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: "0.68rem", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.03em" }}>
              Neto a pagar
            </span>
            <span style={{ fontSize: "1.15rem", fontWeight: 900, fontFamily: "'Courier New', monospace" }}>
              {formatMoney(pTotals.neto)}
            </span>
          </div>
          {pDraft.enableLey && (
            <p style={{ fontSize: "0.56rem", color: "#555", marginTop: "0.3rem", lineHeight: 1.4 }}>
              * El descuento de ley es un porcentaje simplificado, no un cálculo oficial de ISR/IMSS.
            </p>
          )}

          {mostrarVacaciones && (
            <div style={{ marginTop: "0.85rem", border: "1.5px dashed #111", borderRadius: 5, padding: "0.7rem 0.85rem", position: "relative" }}>
              <p style={{ fontSize: "0.68rem", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.02em", margin: 0 }}>
                Recibo individual de vacaciones
              </p>
              <p style={{ fontSize: "0.56rem", color: "#555", marginTop: "1px" }}>
                Comprobante independiente de los días tomados a cuenta de vacaciones en este periodo.
              </p>

              <div style={{ marginTop: "0.4rem", fontSize: "0.66rem", lineHeight: 1.4 }}>
                <strong>Trabajador:</strong> {pEmp.name} &nbsp;·&nbsp;
                <strong>Puesto:</strong> {pEmp.puesto} &nbsp;·&nbsp;
                <strong>Salario diario base:</strong> {formatMoney(pDraft.rateAmount)}
              </div>

              <table className="recibo-table">
                <thead>
                  <tr>
                    <th>Día</th>
                    <th>Fecha</th>
                    <th className="amt">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {pDraft.vacacionesFechas.map((fecha) => (
                    <tr key={fecha}>
                      <td>{formatDateLabel(fecha, today)}</td>
                      <td>{fecha}</td>
                      <td className="amt">{formatMoney(pDraft.rateAmount)}</td>
                    </tr>
                  ))}
                  <tr className="total-row">
                    <td colSpan={2}>Total días de vacaciones ({pDraft.vacacionesFechas.length})</td>
                    <td className="amt">{formatMoney(pTotals.vacaciones)}</td>
                  </tr>
                </tbody>
              </table>

              <p style={{ fontSize: "0.62rem", lineHeight: 1.45, color: "#111", marginTop: "0.5rem", borderLeft: "3px solid #111", paddingLeft: "0.55rem" }}>
                Quien suscribe, <strong>{pEmp.name}</strong>, declara que solicitó y disfrutó de manera
                <strong> voluntaria</strong> los días señalados arriba con cargo a su periodo vacacional, de
                conformidad con el artículo 76 de la Ley Federal del Trabajo, y recibe a su entera
                satisfacción el pago correspondiente a cada uno de esos días.
              </p>
              <p style={{ fontSize: "0.56rem", color: "#555", marginTop: "0.3rem" }}>
                El monto ya está incluido en el neto a pagar de arriba — este apartado es el comprobante
                individual.
              </p>

              <div style={{ marginTop: "0.75rem", display: "flex", justifyContent: "center" }}>
                <div style={{ width: "62%", textAlign: "center" }}>
                  <div style={{ borderTop: "1.5px solid #111", paddingTop: "4px", fontSize: "0.66rem", fontWeight: 600 }}>
                    Firma del trabajador — recibí y acepto los días señalados
                  </div>
                  <div style={{ fontSize: "0.56rem", color: "#666", marginTop: "2px", textTransform: "uppercase", letterSpacing: "0.02em" }}>
                    Nombre y fecha
                  </div>
                </div>
              </div>
            </div>
          )}

          <p style={{ marginTop: "0.8rem", fontSize: "0.66rem", lineHeight: 1.4, color: "#111", paddingTop: "0.45rem", borderTop: "2px dashed #999" }}>
            Recibí de conformidad el monto neto indicado arriba, correspondiente al periodo señalado.
          </p>

          <div style={{ marginTop: "1.1rem", display: "flex", justifyContent: "space-between", gap: "2rem" }}>
            <div style={{ flex: 1, textAlign: "center" }}>
              <div style={{ borderTop: "1.5px solid #111", paddingTop: "4px", fontSize: "0.66rem", fontWeight: 600 }}>
                Entregado por
              </div>
              <div style={{ fontSize: "0.56rem", color: "#666", marginTop: "2px", textTransform: "uppercase", letterSpacing: "0.02em" }}>
                Nombre y fecha
              </div>
            </div>
            <div style={{ flex: 1, textAlign: "center" }}>
              <div style={{ borderTop: "1.5px solid #111", paddingTop: "4px", fontSize: "0.66rem", fontWeight: 600 }}>
                Firma del empleado
              </div>
              <div style={{ fontSize: "0.56rem", color: "#666", marginTop: "2px", textTransform: "uppercase", letterSpacing: "0.02em" }}>
                Nombre y fecha
              </div>
            </div>
          </div>

          <div style={{ textAlign: "center", marginTop: "0.9rem", fontSize: "0.52rem", color: "#777", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Generado por Reloj Checador · {bizNombre}
          </div>
        </div>
      </div>
    );
  }

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
                {businessConfig.nombre || "Restaurante"} · {monthLabel(printView.month)}
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

        <div className="flex gap-2 mt-4 flex-wrap">
          {[
            { id: "checador", label: "Checador", icon: Clock },
            { id: "bitacora", label: "Bitácora", icon: unlockedSession ? ScrollText : Lock },
            { id: "propinas", label: "Propinas", icon: Coins },
            { id: "personal", label: "Personal", icon: Users },
            { id: "nomina", label: "Nómina", icon: unlockedSession ? Wallet : Lock },
          ].map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            const protectedTabs = ["bitacora", "nomina"];
            return (
              <button
                key={t.id}
                onClick={() => (protectedTabs.includes(t.id) ? requestUnlock(t.id) : setTab(t.id))}
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
                {(() => {
                  const grupos = areasList.map((area) => ({
                    area,
                    emps: activeEmployees.filter((e) => (e.areas || []).includes(area)),
                  })).filter((g) => g.emps.length > 0);
                  const sinArea = activeEmployees.filter((e) => !e.areas || e.areas.length === 0);
                  if (sinArea.length > 0) grupos.push({ area: "Sin área asignada", emps: sinArea });

                  return grupos.map(({ area, emps }) => (
                    <div key={area} className="mb-3 last:mb-0">
                      <div className="text-[10px] font-bold mb-1.5" style={{ color: brass }}>
                        {area}
                      </div>
                      <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(9rem, 1fr))" }}>
                        {emps.map((emp) => {
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
                  ));
                })()}
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

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-1 text-[9px]" style={{ color: steel }}>
            <span className="flex items-center gap-1">
              <span className="inline-block rounded-full" style={{ width: 6, height: 6, background: sage }} />
              Dentro de tolerancia de bono: bono + propina
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block rounded-full" style={{ width: 6, height: 6, background: brass }} />
              Dentro de tolerancia de propina: solo propina
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block rounded-full" style={{ width: 6, height: 6, background: paprika }} />
              Fuera de tolerancia: sin bono ni propina
            </span>
          </div>
          <p className="text-[9px] mb-3" style={{ color: steel + "aa" }}>
            La tolerancia de cada quien se ajusta por empleado en Nómina → Bono.
          </p>

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
                                {r.area ? ` · ${r.area}` : ""}
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
        <div className="flex-1 px-5 py-5 flex flex-col gap-6 overflow-y-auto min-h-0">
          <div>
            <div
              className="text-[10px] font-bold uppercase mb-3 flex items-center gap-1.5"
              style={{ color: brass, letterSpacing: "0.1em" }}
            >
              <Users size={12} /> Personal
            </div>
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
                    <div className="text-[10px] mt-0.5" style={{ color: ink + "66" }}>
                      {emp.areas && emp.areas.length > 0 ? emp.areas.join(" · ") : "Sin área asignada"}
                    </div>
                    <div className="text-[10px] mt-0.5" style={{ color: ink + "66" }}>
                      Checado:{" "}
                      {emp.checadaMetodo === "clave"
                        ? "Clave de 4 dígitos"
                        : emp.checadaMetodo === "biometrico"
                        ? "Biométrico (huella/rostro)"
                        : "Foto"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {unlockedSession && (
                      <button
                        onClick={() => openMetodoModal(emp.id)}
                        className="p-1.5 rounded-sm"
                        style={{ color: ink + "77", border: `1px solid ${ink}22` }}
                        title="Editar método de checado"
                      >
                        <Fingerprint size={14} />
                      </button>
                    )}
                    {unlockedSession && (
                      <button
                        onClick={() => openAreasModal(emp.id)}
                        className="p-1.5 rounded-sm"
                        style={{ color: ink + "77", border: `1px solid ${ink}22` }}
                        title="Editar áreas"
                      >
                        <MapPin size={14} />
                      </button>
                    )}
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

          <div>
            <div
              className="text-[10px] font-bold uppercase mb-3 flex items-center gap-1.5"
              style={{ color: brass, letterSpacing: "0.1em" }}
            >
              <MapPin size={12} /> Áreas
            </div>
              <div className="rounded-sm p-4" style={{ background: paper }}>
                <div className="text-xs font-bold uppercase mb-1" style={{ color: ink, letterSpacing: "0.06em" }}>
                  Áreas del local
                </div>
                <p className="text-[10px] mb-3" style={{ color: ink + "66" }}>
                  Las áreas que definas aquí son las que se pueden asignar a cada empleado, y con las
                  que se agrupa el selector del Checador.
                </p>

                {unlockedSession && (
                  <div className="flex items-center gap-2 mb-3">
                    <input
                      value={newAreaName}
                      onChange={(e) => setNewAreaName(e.target.value)}
                      placeholder="Nueva área (ej. Terraza, Caja)"
                      className="flex-1 px-3 py-2 rounded-sm text-sm outline-none"
                      style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                    />
                    <button
                      onClick={addAreaToList}
                      disabled={!newAreaName.trim() || areasList.includes(newAreaName.trim())}
                      className="p-2.5 rounded-sm disabled:opacity-40"
                      style={{ background: brass, color: ink }}
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                )}

                <div className="flex flex-col gap-2">
                  {loadingAreas ? (
                    <div className="flex items-center gap-2 text-sm" style={{ color: steel }}>
                      <Loader2 size={16} className="animate-spin" /> Cargando…
                    </div>
                  ) : areasList.length === 0 ? (
                    <div className="text-sm py-4 text-center" style={{ color: ink + "66" }}>
                      Todavía no hay áreas configuradas.
                    </div>
                  ) : (
                    areasList.map((area, idx) => {
                      const personasEnArea = employees.filter((e) => (e.areas || []).includes(area)).length;
                      return (
                        <div
                          key={area + idx}
                          className="flex items-center justify-between px-3 py-2 rounded-sm"
                          style={{ background: ink + "06" }}
                        >
                          {editingAreaIdx === idx ? (
                            <div className="flex items-center gap-2 flex-1">
                              <input
                                value={editingAreaValue}
                                onChange={(e) => setEditingAreaValue(e.target.value)}
                                autoFocus
                                className="flex-1 px-2 py-1.5 rounded-sm text-xs outline-none"
                                style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                              />
                              <button onClick={saveEditArea} className="p-1.5 rounded-sm" style={{ background: sage, color: paper }}>
                                <Check size={13} />
                              </button>
                              <button
                                onClick={() => setEditingAreaIdx(null)}
                                className="p-1.5 rounded-sm"
                                style={{ border: `1px solid ${ink}33`, color: ink }}
                              >
                                <X size={13} />
                              </button>
                            </div>
                          ) : (
                            <>
                              <div>
                                <div className="text-xs font-bold" style={{ color: ink }}>
                                  {area}
                                </div>
                                <div className="text-[10px]" style={{ color: ink + "66" }}>
                                  {personasEnArea} {personasEnArea === 1 ? "persona" : "personas"}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <div className="flex items-center gap-1">
                                  <span className="text-[9px] uppercase" style={{ color: ink + "66" }}>
                                    Mínimo
                                  </span>
                                  <input
                                    value={areaMinimos[area] ?? ""}
                                    onChange={(e) => setAreaMinimo(area, e.target.value.replace(/\D/g, ""))}
                                    disabled={!unlockedSession}
                                    inputMode="numeric"
                                    placeholder="0"
                                    className="w-10 px-1.5 py-1 rounded-sm text-[11px] text-center outline-none disabled:opacity-60"
                                    style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                                  />
                                </div>
                              {unlockedSession && (
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => startEditArea(idx)}
                                    className="p-1.5 rounded-sm"
                                    style={{ color: ink + "77" }}
                                  >
                                    <Pencil size={13} />
                                  </button>
                                  {confirmDeleteAreaIdx === idx ? (
                                    <>
                                      <button
                                        onClick={() => deleteArea(idx)}
                                        className="p-1.5 rounded-sm"
                                        style={{ background: paprika, color: paper }}
                                      >
                                        <Check size={13} />
                                      </button>
                                      <button
                                        onClick={() => setConfirmDeleteAreaIdx(null)}
                                        className="p-1.5 rounded-sm"
                                        style={{ background: steel + "33", color: ink }}
                                      >
                                        <X size={13} />
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      onClick={() => setConfirmDeleteAreaIdx(idx)}
                                      className="p-1.5 rounded-sm"
                                      style={{ color: ink + "55" }}
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                  )}
                                </div>
                              )}
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
          </div>

          <div>
            <div
              className="text-[10px] font-bold uppercase mb-3 flex items-center gap-1.5"
              style={{ color: brass, letterSpacing: "0.1em" }}
            >
              <CalendarClock size={12} /> Horario
            </div>
              <div className="rounded-sm p-4" style={{ background: paper }}>
                <div className="text-xs font-bold uppercase mb-1" style={{ color: ink, letterSpacing: "0.06em" }}>
                  Horario por día
                </div>
                <p className="text-[10px] mb-3" style={{ color: ink + "66" }}>
                  Revisa y ajusta quién trabaja cada día, según lo que necesite el local — sin entrar
                  empleado por empleado.
                </p>

                <button
                  onClick={toggleTurnosHabilitado}
                  disabled={!unlockedSession}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-sm mb-3 disabled:opacity-60"
                  style={{
                    background: turnosConfig.habilitado ? sage + "14" : ink + "06",
                    border: `1px solid ${turnosConfig.habilitado ? sage + "55" : ink + "11"}`,
                  }}
                >
                  <span className="text-xs font-bold" style={{ color: ink }}>
                    Multihorarios (turno matutino / medio / nocturno)
                  </span>
                  <span
                    className="rounded-full flex-shrink-0"
                    style={{
                      width: 30,
                      height: 17,
                      background: turnosConfig.habilitado ? sage : steel + "55",
                      position: "relative",
                    }}
                  >
                    <span
                      className="rounded-full absolute"
                      style={{
                        width: 13,
                        height: 13,
                        top: 2,
                        left: turnosConfig.habilitado ? 15 : 2,
                        background: "#fff",
                        transition: "left 0.15s",
                      }}
                    />
                  </span>
                </button>

                {turnosConfig.habilitado && (
                  <div className="mb-3 flex flex-col gap-1.5">
                    {turnosConfig.turnos.map((t) => (
                      <div key={t.id} className="flex items-center gap-1.5">
                        <span className="text-[11px] font-bold flex-1" style={{ color: ink }}>
                          {t.nombre}
                        </span>
                        <input
                          type="time"
                          value={t.start}
                          disabled={!unlockedSession}
                          onChange={(e) => updateTurnoDefinicion(t.id, { start: e.target.value })}
                          className="px-1.5 py-1 rounded-sm text-[11px] outline-none disabled:opacity-60"
                          style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink, width: "5.2rem" }}
                        />
                        <span className="text-[10px]" style={{ color: ink + "55" }}>
                          a
                        </span>
                        <input
                          type="time"
                          value={t.end}
                          disabled={!unlockedSession}
                          onChange={(e) => updateTurnoDefinicion(t.id, { end: e.target.value })}
                          className="px-1.5 py-1 rounded-sm text-[11px] outline-none disabled:opacity-60"
                          style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink, width: "5.2rem" }}
                        />
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1">
                  {DAY_NAMES.map((name, idx) => (
                    <button
                      key={idx}
                      onClick={() => setHorarioDiaSeleccionado(idx)}
                      className="px-3 py-1.5 rounded-sm text-xs font-bold flex-shrink-0"
                      style={{
                        background: horarioDiaSeleccionado === idx ? brass : "transparent",
                        border: `1px solid ${horarioDiaSeleccionado === idx ? brass : ink + "33"}`,
                        color: ink,
                      }}
                    >
                      {DAY_SHORT[idx]}
                    </button>
                  ))}
                </div>
                <div className="text-[11px] font-bold mb-2" style={{ color: ink + "88" }}>
                  {DAY_NAMES[horarioDiaSeleccionado]}
                </div>

                {areasList.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {areasList.map((area) => {
                      const minimo = areaMinimos[area] || 0;
                      const programados = employees.filter((e) => {
                        if (!e.active || !(e.areas || []).includes(area)) return false;
                        const d = getScheduleForDate(e, today)?.[horarioDiaSeleccionado];
                        return d?.enabled;
                      }).length;
                      const cumple = minimo === 0 || programados >= minimo;
                      return (
                        <div
                          key={area}
                          className="px-2 py-1 rounded-sm text-[10px] font-bold"
                          style={{
                            background: cumple ? sage + "14" : paprika + "14",
                            color: cumple ? sage : paprika,
                            border: `1px solid ${cumple ? sage + "55" : paprika + "55"}`,
                          }}
                        >
                          {area}: {programados}
                          {minimo > 0 ? `/${minimo}` : ""}
                          {!cumple && " ⚠"}
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="flex flex-col gap-2">
                  {employees.filter((e) => e.active).length === 0 ? (
                    <div className="text-sm py-4 text-center" style={{ color: ink + "66" }}>
                      No hay personal activo todavía.
                    </div>
                  ) : (
                    employees
                      .filter((e) => e.active)
                      .map((emp) => {
                        const daySchedule = getScheduleForDate(emp, today)?.[horarioDiaSeleccionado] || {
                          enabled: false,
                          start: "09:00",
                          end: "17:00",
                        };
                        return (
                          <div
                            key={emp.id}
                            className="flex flex-col gap-1.5 px-3 py-2 rounded-sm"
                            style={{ background: ink + "06" }}
                          >
                            <div className="flex items-center gap-2">
                              <button
                                disabled={!unlockedSession}
                                onClick={() => quickUpdateEmployeeDay(emp.id, horarioDiaSeleccionado, { enabled: !daySchedule.enabled })}
                                className="rounded-sm flex-shrink-0 disabled:opacity-50"
                                style={{
                                  width: 16,
                                  height: 16,
                                  border: `2px solid ${daySchedule.enabled ? sage : steel}`,
                                  background: daySchedule.enabled ? sage : "transparent",
                                }}
                              />
                              <span className="text-xs font-bold flex-1 truncate" style={{ color: ink }}>
                                {emp.name}
                              </span>
                              {daySchedule.enabled ? (
                                <div className="flex items-center gap-1">
                                  <input
                                    type="time"
                                    value={daySchedule.start}
                                    disabled={!unlockedSession}
                                    onChange={(e) => quickUpdateEmployeeDay(emp.id, horarioDiaSeleccionado, { start: e.target.value })}
                                    className="px-1.5 py-1 rounded-sm text-[11px] outline-none disabled:opacity-60"
                                    style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink, width: "5.2rem" }}
                                  />
                                  <span className="text-[10px]" style={{ color: ink + "55" }}>
                                    a
                                  </span>
                                  <input
                                    type="time"
                                    value={daySchedule.end}
                                    disabled={!unlockedSession}
                                    onChange={(e) => quickUpdateEmployeeDay(emp.id, horarioDiaSeleccionado, { end: e.target.value })}
                                    className="px-1.5 py-1 rounded-sm text-[11px] outline-none disabled:opacity-60"
                                    style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink, width: "5.2rem" }}
                                  />
                                </div>
                              ) : (
                                <span className="text-[10px]" style={{ color: ink + "55" }}>
                                  Descanso
                                </span>
                              )}
                            </div>
                            {turnosConfig.habilitado && daySchedule.enabled && (
                              <div className="flex items-center gap-1.5 pl-6">
                                {turnosConfig.turnos.map((t) => {
                                  const selected = daySchedule.turno === t.id;
                                  return (
                                    <button
                                      key={t.id}
                                      disabled={!unlockedSession}
                                      onClick={() =>
                                        quickUpdateEmployeeDay(emp.id, horarioDiaSeleccionado, {
                                          turno: t.id,
                                          start: t.start,
                                          end: t.end,
                                        })
                                      }
                                      className="px-2 py-1 rounded-sm text-[10px] font-bold disabled:opacity-60"
                                      style={{
                                        background: selected ? brass : "transparent",
                                        border: `1px solid ${selected ? brass : ink + "33"}`,
                                        color: ink,
                                      }}
                                    >
                                      {t.nombre}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })
                  )}
                </div>
                {!unlockedSession && (
                  <p className="text-[10px] mt-3" style={{ color: ink + "66" }}>
                    Desbloquea con tu clave arriba para poder editar horarios desde aquí.
                  </p>
                )}
              </div>
          </div>
        </div>
      )}

      {/* ---------------- NOMINA TAB ---------------- */}
      {tab === "nomina" && (
        <div className="flex-1 px-5 py-5 flex flex-col min-h-0 overflow-y-auto">
          {!payrollSelectedEmployeeId ? (
            <>
              <div className="rounded-sm p-4 mb-4" style={{ background: paper }}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <Building2 size={13} color={ink} />
                    <div className="text-[11px] font-bold uppercase" style={{ color: ink, letterSpacing: "0.05em" }}>
                      Datos del negocio (para recibos)
                    </div>
                  </div>
                  {!showBusinessConfigEdit && (
                    <button
                      onClick={() => requestUnlock("business_config_editar")}
                      className="flex items-center gap-1 text-[10px] font-bold uppercase px-2.5 py-1.5 rounded-sm flex-shrink-0"
                      style={{ border: `1px solid ${ink}33`, color: ink }}
                    >
                      <Lock size={11} /> Editar
                    </button>
                  )}
                </div>

                {!showBusinessConfigEdit ? (
                  <div className="flex items-center gap-3 mt-2">
                    {businessLogo ? (
                      <img src={businessLogo} alt="Logo" className="rounded-sm object-contain flex-shrink-0" style={{ width: 40, height: 40, background: "#fff" }} />
                    ) : (
                      <div className="rounded-sm flex items-center justify-center flex-shrink-0" style={{ width: 40, height: 40, background: ink + "0d" }}>
                        <Building2 size={16} color={ink + "55"} />
                      </div>
                    )}
                    <div className="text-xs" style={{ color: ink }}>
                      <div className="font-bold">{businessConfig.nombre || "Sin nombre configurado"}</div>
                      <div style={{ color: ink + "77" }}>{businessConfig.direccion || "Sin dirección"}</div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 flex flex-col gap-2">
                    <div className="flex items-center gap-3">
                      {businessLogo ? (
                        <img src={businessLogo} alt="Logo" className="rounded-sm object-contain flex-shrink-0" style={{ width: 44, height: 44, background: "#fff", border: `1px solid ${ink}22` }} />
                      ) : (
                        <div className="rounded-sm flex items-center justify-center flex-shrink-0" style={{ width: 44, height: 44, background: ink + "0d" }}>
                          <Building2 size={18} color={ink + "55"} />
                        </div>
                      )}
                      <div className="flex flex-col gap-1">
                        <label
                          htmlFor="business-logo-input"
                          className="text-[10px] font-bold uppercase px-2.5 py-1.5 rounded-sm cursor-pointer text-center"
                          style={{ border: `1px solid ${ink}33`, color: ink }}
                        >
                          {businessLogo ? "Cambiar logo" : "Subir logo"}
                        </label>
                        {businessLogo && (
                          <button onClick={removeLogo} className="text-[10px]" style={{ color: paprika }}>
                            Quitar logo
                          </button>
                        )}
                        <input id="business-logo-input" type="file" accept="image/*" onChange={handleLogoUpload} style={{ display: "none" }} />
                      </div>
                    </div>
                    <input
                      value={businessConfigDraft.nombre}
                      onChange={(e) => setBusinessConfigDraft((c) => ({ ...c, nombre: e.target.value }))}
                      placeholder="Nombre del negocio"
                      className="w-full px-2 py-1.5 rounded-sm text-xs outline-none"
                      style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                    />
                    <input
                      value={businessConfigDraft.direccion}
                      onChange={(e) => setBusinessConfigDraft((c) => ({ ...c, direccion: e.target.value }))}
                      placeholder="Dirección"
                      className="w-full px-2 py-1.5 rounded-sm text-xs outline-none"
                      style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                    />
                    <input
                      value={businessConfigDraft.encabezado}
                      onChange={(e) => setBusinessConfigDraft((c) => ({ ...c, encabezado: e.target.value }))}
                      placeholder="Texto extra de encabezado (opcional, ej. RFC, teléfono)"
                      className="w-full px-2 py-1.5 rounded-sm text-xs outline-none"
                      style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={saveBusinessConfig}
                        className="text-[10px] font-bold uppercase px-3 py-1.5 rounded-sm"
                        style={{ background: sage, color: paper }}
                      >
                        Guardar
                      </button>
                      <button
                        onClick={() => {
                          setShowBusinessConfigEdit(false);
                          setBusinessConfigDraft(businessConfig);
                        }}
                        className="text-[10px] font-bold uppercase px-3 py-1.5 rounded-sm"
                        style={{ border: `1px solid ${ink}33`, color: ink }}
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
                <p className="text-[10px] mt-2" style={{ color: ink + "66" }}>
                  Aparece en el encabezado de los recibos de nómina y resúmenes impresos. El logo se
                  guarda solo en este dispositivo.
                </p>
              </div>

              <div className="flex items-center justify-between mb-3">
                <div className="text-[10px] font-bold uppercase" style={{ color: steel, letterSpacing: "0.1em" }}>
                  Selecciona un empleado
                </div>
                <button
                  onClick={lockNow}
                  className="flex items-center gap-1 text-[10px] font-bold uppercase"
                  style={{ color: steel }}
                >
                  <Lock size={11} /> Bloquear
                </button>
              </div>
              <div className="flex flex-col gap-2 overflow-y-auto">
                {employees.length === 0 ? (
                  <div className="text-sm py-6 text-center" style={{ color: steel }}>
                    No hay empleados registrados todavía.
                  </div>
                ) : (
                  employees.map((emp) => (
                    <button
                      key={emp.id}
                      onClick={() => openPayroll(emp.id)}
                      className="flex items-center justify-between px-3 py-2.5 rounded-sm text-left"
                      style={{ background: paper }}
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-bold truncate" style={{ color: ink }}>
                          {emp.name}
                        </div>
                        <div className="text-[11px]" style={{ color: ink + "88" }}>
                          {emp.puesto}
                          {emp.payroll?.rateAmount ? (
                            <>
                              {" · "}
                              {formatMoney(emp.payroll.rateAmount)} por {emp.payroll.rateType === "hora" ? "hora" : "jornada"}
                            </>
                          ) : (
                            " · sin tarifa configurada"
                          )}
                        </div>
                      </div>
                      <ChevronRight size={16} color={ink + "55"} />
                    </button>
                  ))
                )}
              </div>
            </>
          ) : (
            <PayrollPanel
              employee={employees.find((e) => e.id === payrollSelectedEmployeeId)}
              draft={payrollDraft}
              employees={employees}
              recordsByDate={recordsByDate}
              propinasHistorial={propinasHistorial}
              propinasConfig={propinasConfig}
              onBack={closePayroll}
              onChange={updatePayrollDraft}
              onAddLine={addLineItem}
              onUpdateLine={updateLineItem}
              onRemoveLine={removeLineItem}
              onSaveConfig={savePayrollConfig}
              onGenerate={handleGeneratePayroll}
              colors={{ paprika, sage, ink, paper, brass, steel }}
            />
          )}
        </div>
      )}

      {/* ---------------- PROPINAS TAB ---------------- */}
      {tab === "propinas" && (
        <div className="flex-1 px-5 py-5 flex flex-col gap-4 overflow-y-auto">
          <div className="rounded-sm p-4" style={{ background: paper }}>
            <div className="flex items-center justify-between mb-1">
              <div className="text-[11px] font-bold uppercase" style={{ color: ink, letterSpacing: "0.05em" }}>
                Configuración de propinas
              </div>
              {!showPropinasConfigEdit && (
                <button
                  onClick={() => requestUnlock("propinas_config_editar")}
                  className="flex items-center gap-1 text-[10px] font-bold uppercase px-2.5 py-1.5 rounded-sm flex-shrink-0"
                  style={{ border: `1px solid ${ink}33`, color: ink }}
                >
                  <Lock size={11} /> Editar
                </button>
              )}
            </div>

            {!showPropinasConfigEdit ? (
              <div className="flex flex-col gap-1 mt-2 text-xs" style={{ color: ink }}>
                <div>
                  Tolerancia de puntualidad: <strong style={{ color: sage }}>{propinasConfig.toleranciaMin} min</strong>
                </div>
                <div>
                  Frecuencia de reparto:{" "}
                  <strong>
                    {propinasConfig.frecuencia === "semanal"
                      ? "Semanal"
                      : propinasConfig.frecuencia === "mensual"
                      ? "Mensual"
                      : "Diaria"}
                  </strong>
                </div>
                <div>
                  Entrega:{" "}
                  <strong>
                    {propinasConfig.modoEntrega === "nomina" ? "Junto con la nómina del periodo" : "Diaria e independiente"}
                  </strong>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2 mt-2">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] flex-1" style={{ color: ink + "88" }}>
                    Tolerancia (minutos):
                  </span>
                  <input
                    value={propinasConfigDraft.toleranciaMin}
                    onChange={(e) =>
                      setPropinasConfigDraft((d) => ({ ...d, toleranciaMin: e.target.value.replace(/[^0-9]/g, "") }))
                    }
                    inputMode="numeric"
                    className="w-20 px-2 py-1.5 rounded-sm text-xs outline-none"
                    style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] flex-1" style={{ color: ink + "88" }}>
                    Frecuencia de reparto:
                  </span>
                  <select
                    value={propinasConfigDraft.frecuencia}
                    onChange={(e) => setPropinasConfigDraft((d) => ({ ...d, frecuencia: e.target.value }))}
                    className="flex-1 px-2 py-1.5 rounded-sm text-xs outline-none"
                    style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                  >
                    <option value="diaria">Diaria</option>
                    <option value="semanal">Semanal</option>
                    <option value="mensual">Mensual</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] flex-1" style={{ color: ink + "88" }}>
                    Entrega:
                  </span>
                  <select
                    value={propinasConfigDraft.modoEntrega}
                    onChange={(e) => setPropinasConfigDraft((d) => ({ ...d, modoEntrega: e.target.value }))}
                    className="flex-1 px-2 py-1.5 rounded-sm text-xs outline-none"
                    style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                  >
                    <option value="diaria">Diaria e independiente</option>
                    <option value="nomina">Junto con la nómina</option>
                  </select>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <button
                    onClick={savePropinasConfig}
                    className="text-[10px] font-bold uppercase px-3 py-1.5 rounded-sm"
                    style={{ background: sage, color: paper }}
                  >
                    Guardar
                  </button>
                  <button
                    onClick={() => {
                      setShowPropinasConfigEdit(false);
                      setPropinasConfigDraft({ ...propinasConfig, toleranciaMin: String(propinasConfig.toleranciaMin) });
                    }}
                    className="text-[10px] font-bold uppercase px-3 py-1.5 rounded-sm"
                    style={{ border: `1px solid ${ink}33`, color: ink }}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
            <p className="text-[10px] mt-2" style={{ color: ink + "66" }}>
              Cualquiera puede ver esta configuración; solo con la clave se puede cambiar.
            </p>
          </div>

          <div className="rounded-sm p-4" style={{ background: paper }}>
            <div className="text-[11px] font-bold uppercase mb-3" style={{ color: ink, letterSpacing: "0.05em" }}>
              Reparto de propinas
              {propinasConfig.frecuencia !== "diaria" && ` (${propinasConfig.frecuencia})`}
            </div>
            <div className="flex items-center gap-2 mb-2">
              <input
                type="date"
                value={propinasPeriodoInicio}
                onChange={(e) => setPropinasPeriodoInicio(e.target.value)}
                className="flex-1 px-2 py-1.5 rounded-sm text-xs outline-none"
                style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
              />
              {propinasConfig.frecuencia !== "diaria" && (
                <>
                  <span className="text-[10px]" style={{ color: ink + "66" }}>
                    a
                  </span>
                  <input
                    type="date"
                    value={propinasPeriodoFin}
                    onChange={(e) => setPropinasPeriodoFin(e.target.value)}
                    className="flex-1 px-2 py-1.5 rounded-sm text-xs outline-none"
                    style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                  />
                </>
              )}
              <input
                value={propinasMonto}
                onChange={(e) => setPropinasMonto(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="Monto total"
                inputMode="decimal"
                className="flex-1 px-2 py-1.5 rounded-sm text-xs outline-none"
                style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
              />
            </div>

            {(() => {
              const monto = Number(propinasMonto) || 0;
              const fin = propinasConfig.frecuencia === "diaria" ? propinasPeriodoInicio : propinasPeriodoFin;
              const { lista, sobrante } = calcularRepartoPropinas(propinasPeriodoInicio, fin, monto, employees, recordsByDate, externosPorDia);
              return (
                <>
                  {lista.length === 0 ? (
                    <p className="text-xs py-3 text-center" style={{ color: ink + "77" }}>
                      Nadie ha checado entrada en ese periodo todavía.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-1.5 mt-2">
                      {lista.map((p) => (
                        <div
                          key={p.employeeId}
                          className="flex items-center justify-between px-3 py-2 rounded-sm"
                          style={{ background: p.tieneCorreccion ? brass + "1c" : p.califica ? sage + "14" : ink + "06" }}
                        >
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-bold" style={{ color: ink }}>
                                {p.employeeName}
                              </span>
                              {p.tieneCorreccion && (
                                <span
                                  className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-sm"
                                  style={{ background: brass, color: ink }}
                                  title="Incluye una corrección manual de puntualidad"
                                >
                                  Corregido
                                </span>
                              )}
                            </div>
                            <div className="text-[10px]" style={{ color: p.califica ? ink + "77" : paprika }}>
                              {p.diasPropina}/{p.diasTrabajados} días elegibles
                            </div>
                          </div>
                          <div className="text-sm font-bold" style={{ color: p.califica ? sage : ink + "44" }}>
                            {formatMoney(p.monto)}
                          </div>
                        </div>
                      ))}
                      {monto > 0 && sobrante > 0 && (
                        <p className="text-[10px] mt-1" style={{ color: ink + "66" }}>
                          Sobrante sin repartir (redondeo hacia abajo): {formatMoney(sobrante)}
                        </p>
                      )}
                    </div>
                  )}

                  <input
                    value={propinasQuien}
                    onChange={(e) => setPropinasQuien(e.target.value)}
                    placeholder="¿Quién realiza esta operación? (obligatorio)"
                    className="w-full mt-3 px-2 py-1.5 rounded-sm text-xs outline-none"
                    style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                  />
                  <button
                    onClick={() => guardarReparto(propinasPeriodoInicio, fin, monto, lista, propinasQuien)}
                    disabled={!propinasQuien.trim() || monto <= 0}
                    className="w-full flex items-center justify-center gap-2 py-2.5 mt-2 rounded-sm font-bold text-xs uppercase disabled:opacity-40"
                    style={{ background: brass, color: ink }}
                  >
                    <Coins size={14} /> Guardar reparto
                  </button>
                  {propinasConfig.modoEntrega === "nomina" && (
                    <p className="text-[10px] mt-2" style={{ color: brass }}>
                      Con la entrega en modo "junto con la nómina", este monto no se paga aparte — se
                      suma solo cuando generes el recibo de nómina de cada quien para este periodo.
                    </p>
                  )}
                </>
              );
            })()}
          </div>

          {/* personal externo (temporal) — requiere PIN */}
          <div className="rounded-sm p-4" style={{ background: paper }}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-[11px] font-bold uppercase" style={{ color: ink, letterSpacing: "0.05em" }}>
                Personal Externo ({propinasFecha})
              </div>
              {unlockedSession && (
                <button onClick={lockNow} className="flex items-center gap-1 text-[10px] font-bold uppercase" style={{ color: steel }}>
                  <Lock size={11} /> Bloquear
                </button>
              )}
            </div>

            {!unlockedSession ? (
              <button
                onClick={() => requestUnlock("propinas")}
                className="w-full rounded-sm p-4 flex items-center gap-3 text-left"
                style={{ background: paper }}
              >
                <div className="rounded-full flex items-center justify-center flex-shrink-0" style={{ width: 34, height: 34, background: brass + "33" }}>
                  <Lock size={16} color={ink} />
                </div>
                <div>
                  <div className="text-sm font-bold" style={{ color: ink }}>
                    Requiere clave de acceso
                  </div>
                  <div className="text-[11px]" style={{ color: ink + "88" }}>
                    Toca para desbloquear y agregar personal
                  </div>
                </div>
              </button>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-3">
                  <input
                    type="date"
                    value={propinasFecha}
                    onChange={(e) => setPropinasFecha(e.target.value)}
                    className="flex-1 px-2 py-1.5 rounded-sm text-xs outline-none"
                    style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                  />
                </div>

                {externosPorDia.filter((e) => e.fecha === propinasFecha).length > 0 && (
                  <div className="flex flex-col gap-1.5 mb-2">
                    {externosPorDia.filter((e) => e.fecha === propinasFecha).map((e) => (
                      <div key={e.id} className="flex items-center justify-between px-3 py-2 rounded-sm" style={{ background: sage + "18" }}>
                        <span className="text-xs font-bold" style={{ color: ink }}>{e.nombre}</span>
                        <button onClick={() => quitarExternoDelDia(e.id)}>
                          <X size={14} color={paprika} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {externosCatalogo.filter((ext) => !externosPorDia.some((e) => e.fecha === propinasFecha && e.externoId === ext.id)).length > 0 && (
                  <div className="mb-2">
                    <div className="text-[10px] mb-1" style={{ color: ink + "88" }}>Recurrentes — toca para agregar:</div>
                    <div className="flex flex-wrap gap-1.5">
                      {externosCatalogo
                        .filter((ext) => !externosPorDia.some((e) => e.fecha === propinasFecha && e.externoId === ext.id))
                        .map((ext) => (
                          <button
                            key={ext.id}
                            onClick={() => agregarExternoAlDia(ext)}
                            className="px-3 py-1.5 rounded-sm text-xs font-bold"
                            style={{ border: `1px solid ${ink}33`, color: ink }}
                          >
                            + {ext.nombre}
                          </button>
                        ))}
                    </div>
                  </div>
                )}

                <div className="flex gap-2">
                  <input
                    value={nuevoExternoNombre}
                    onChange={(e) => setNuevoExternoNombre(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && crearYAgregarExterno()}
                    placeholder="Nombre de la persona externa"
                    className="flex-1 px-3 py-2 rounded-sm text-sm outline-none"
                    style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                  />
                  <button
                    onClick={crearYAgregarExterno}
                    disabled={!nuevoExternoNombre.trim()}
                    className="px-3 rounded-sm font-bold text-sm disabled:opacity-40"
                    style={{ background: brass, color: ink }}
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </>
            )}
          </div>

          {/* corrección manual de puntualidad — solo superusuario (PIN) */}
          <div className="rounded-sm p-4" style={{ background: paper }}>
            <div className="flex items-center justify-between mb-1">
              <div className="text-[11px] font-bold uppercase" style={{ color: ink, letterSpacing: "0.05em" }}>
                Ajuste manual (superusuario)
              </div>
              {!showAjusteManual && (
                <button
                  onClick={() => requestUnlock("propinas_ajuste_manual")}
                  className="flex items-center gap-1 text-[10px] font-bold uppercase px-2.5 py-1.5 rounded-sm flex-shrink-0"
                  style={{ border: `1px solid ${ink}33`, color: ink }}
                >
                  <Lock size={11} /> Abrir
                </button>
              )}
            </div>

            {!showAjusteManual ? (
              <p className="text-[10px] mt-1" style={{ color: ink + "66" }}>
                Para corregir un día específico cuando un error ajeno a la persona (falla al checar,
                etc.) le impidió calificar para bono o propina. Requiere la clave.
              </p>
            ) : (
              <div className="mt-2 flex flex-col gap-2">
                <p className="text-[10px]" style={{ color: ink + "77" }}>
                  Corrige el registro de esa entrada — el cambio se refleja solo en Bitácora, Nómina y
                  Propinas, no es un cálculo aparte.
                </p>
                <div className="flex items-center gap-2">
                  <select
                    value={ajusteEmpleadoId}
                    onChange={(e) => setAjusteEmpleadoId(e.target.value)}
                    className="flex-1 px-2 py-1.5 rounded-sm text-xs outline-none"
                    style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                  >
                    <option value="">Selecciona empleado…</option>
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
                    className="px-2 py-1.5 rounded-sm text-xs outline-none"
                    style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="flex items-center gap-2 text-xs" style={{ color: ink }}>
                    <input
                      type="checkbox"
                      checked={ajusteBono}
                      onChange={(e) => {
                        setAjusteBono(e.target.checked);
                        if (e.target.checked) setAjustePropina(true); // el bono ya da derecho a propina
                      }}
                    />
                    Bono de puntualidad
                  </label>
                  <label className="flex items-center gap-2 text-xs" style={{ color: ink }}>
                    <input
                      type="checkbox"
                      checked={ajustePropina}
                      disabled={ajusteBono}
                      onChange={(e) => setAjustePropina(e.target.checked)}
                    />
                    Propina
                  </label>
                  {ajusteBono && (
                    <p className="text-[9px]" style={{ color: ink + "66" }}>
                      El bono ya incluye el derecho a propina, por eso quedó marcada también.
                    </p>
                  )}
                </div>

                <input
                  value={ajusteMotivo}
                  onChange={(e) => setAjusteMotivo(e.target.value)}
                  placeholder="Motivo del ajuste (obligatorio, ej. falla al checar)"
                  className="w-full px-2 py-1.5 rounded-sm text-xs outline-none"
                  style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                />
                <button
                  onClick={aplicarCorreccionManual}
                  disabled={!ajusteEmpleadoId || !ajusteFecha || !ajusteMotivo.trim() || (!ajusteBono && !ajustePropina)}
                  className="flex items-center justify-center gap-2 py-2 rounded-sm font-bold text-xs uppercase disabled:opacity-40"
                  style={{ background: brass, color: ink }}
                >
                  Aplicar corrección
                </button>

                {ajustesLog.length > 0 && (
                  <div className="flex flex-col gap-1.5 mt-1 max-h-40 overflow-y-auto">
                    {ajustesLog.slice(0, 10).map((a) => (
                      <div key={a.id} className="px-2 py-1.5 rounded-sm" style={{ background: brass + "1c" }}>
                        <div className="text-[10px]" style={{ color: ink }}>
                          <strong>{a.employeeName}</strong> · {formatDateLabel(a.fecha, today)} ·{" "}
                          {a.bono ? "Bono + propina" : "Propina"}
                        </div>
                        <div className="text-[9px]" style={{ color: ink + "77" }}>
                          {a.motivo}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <button
                  onClick={() => setShowAjusteManual(false)}
                  className="text-[10px] font-bold uppercase self-start"
                  style={{ color: ink + "77" }}
                >
                  Ocultar
                </button>
              </div>
            )}
          </div>

          {/* bitácora de propinas — protegida por PIN */}
          <div className="rounded-sm p-4" style={{ background: paper }}>
            <div className="flex items-center justify-between mb-1">
              <div className="text-[11px] font-bold uppercase" style={{ color: ink, letterSpacing: "0.05em" }}>
                Bitácora de propinas
              </div>
              {showPropinasHistorial && (
                <button
                  onClick={() => setShowPropinasHistorial(false)}
                  className="flex items-center gap-1 text-[10px] font-bold uppercase"
                  style={{ color: ink + "77" }}
                >
                  <Lock size={11} /> Ocultar
                </button>
              )}
            </div>

            {!showPropinasHistorial ? (
              <button
                onClick={() => requestUnlock("propinas_historial")}
                className="w-full flex items-center gap-3 py-2 text-left"
              >
                <div
                  className="rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ width: 30, height: 30, background: brass + "33" }}
                >
                  <Lock size={14} color={ink} />
                </div>
                <div className="text-[11px]" style={{ color: ink + "88" }}>
                  Protegido — toca para ingresar la clave y ver los repartos guardados.
                </div>
              </button>
            ) : loadingPropinasHistorial ? (
              <div className="flex items-center gap-2 text-sm py-2" style={{ color: steel }}>
                <Loader2 size={16} className="animate-spin" /> Cargando…
              </div>
            ) : propinasHistorial.length === 0 ? (
              <p className="text-xs py-2 text-center" style={{ color: ink + "66" }}>
                Todavía no se ha guardado ningún reparto.
              </p>
            ) : (
              <div className="flex flex-col gap-2 mt-2 max-h-64 overflow-y-auto">
                {propinasHistorial.map((p) => {
                  const inicio = p.fechaInicio || p.fecha;
                  const fin = p.fechaFin || p.fecha;
                  return (
                    <div key={p.id} className="px-3 py-2 rounded-sm" style={{ background: ink + "06" }}>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold" style={{ color: ink }}>
                          {inicio === fin
                            ? formatDateLabel(inicio, today)
                            : `${formatDateLabel(inicio, today)} – ${formatDateLabel(fin, today)}`}
                        </span>
                        <span className="text-xs font-bold" style={{ color: sage }}>
                          {formatMoney(p.monto)}
                        </span>
                      </div>
                      <div className="text-[10px]" style={{ color: ink + "77" }}>
                        Registró: {p.quien || "—"}
                      </div>
                    </div>
                  );
                })}
              </div>
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

            {punchModal.type === "entrada" && (selectedEmployee.areas || []).length > 1 && !punchModal.area ? (
              <div className="mb-4">
                <p className="text-xs mb-3" style={{ color: ink + "aa" }}>
                  ¿En qué área trabajas hoy?
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {(selectedEmployee.areas || []).map((area) => (
                    <button
                      key={area}
                      onClick={() => setPunchModal((p) => ({ ...p, area }))}
                      className="py-2.5 rounded-sm text-xs font-bold"
                      style={{ border: `1px solid ${ink}33`, color: ink }}
                    >
                      {area}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setPunchModal(null)}
                  className="w-full py-2.5 mt-3 rounded-sm font-bold text-sm uppercase"
                  style={{ border: `1px solid ${ink}33`, color: ink }}
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <>
                {punchModal.type === "entrada" && (selectedEmployee.areas || []).length > 1 && punchModal.area && (
                  <div
                    className="text-[10px] mb-3 px-2 py-1 rounded-sm inline-block"
                    style={{ background: brass + "22", color: ink }}
                  >
                    Área de hoy: <strong>{punchModal.area}</strong>
                  </div>
                )}

                {punchModal.type === "entrada" && punchModal.metodo === "foto" && !punchModal.photo && (
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

                {punchModal.type === "entrada" && punchModal.metodo === "clave" && (
                  <div className="mb-4">
                    <p className="text-xs mb-3" style={{ color: ink + "aa" }}>
                      Ingresa tu clave de 4 dígitos para registrar la entrada.
                    </p>
                    <input
                      value={punchModal.claveInput}
                      onChange={(e) =>
                        setPunchModal((p) => ({ ...p, claveInput: e.target.value.replace(/\D/g, "").slice(0, 4) }))
                      }
                      type="password"
                      inputMode="numeric"
                      maxLength={4}
                      placeholder="Clave"
                      className="w-full px-3 py-3 rounded-sm text-lg tracking-[0.3em] text-center outline-none"
                      style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                    />
                  </div>
                )}

                {punchModal.type === "entrada" && punchModal.metodo === "biometrico" && (
                  <div className="mb-4">
                    {punchModal.bioStatus === "success" ? (
                      <div
                        className="flex items-center justify-center gap-2 py-3 rounded-sm font-bold text-sm"
                        style={{ background: sage + "22", color: sage }}
                      >
                        <Check size={16} /> Verificado
                      </div>
                    ) : (
                      <button
                        onClick={runBiometricCheck}
                        disabled={punchModal.bioStatus === "checking"}
                        className="w-full flex items-center justify-center gap-2 py-3 rounded-sm font-bold text-sm uppercase disabled:opacity-60"
                        style={{ background: paprika, color: paper }}
                      >
                        <Fingerprint size={16} />
                        {punchModal.bioStatus === "checking" ? "Verificando…" : "Verificar huella/rostro"}
                      </button>
                    )}
                    {punchModal.bioStatus === "error" && (
                      <p className="text-xs mt-2" style={{ color: paprika }}>
                        No se pudo verificar. Intenta de nuevo.
                      </p>
                    )}
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
                    disabled={
                      punchModal.type === "entrada" &&
                      ((punchModal.metodo === "foto" && !punchModal.photo) ||
                        (punchModal.metodo === "clave" && punchModal.claveInput.length !== 4) ||
                        (punchModal.metodo === "biometrico" && punchModal.bioStatus !== "success"))
                    }
                    className="flex items-center justify-center gap-2 py-2.5 rounded-sm font-bold text-sm uppercase disabled:opacity-40"
                    style={{ background: punchModal.type === "entrada" ? paprika : sage, color: paper }}
                  >
                    <Check size={15} />
                    Confirmar
                  </button>
                </div>
              </>
            )}
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

      {/* ---------------- AREAS MODAL ---------------- */}
      {areasModal && (
        <div
          className="fixed inset-0 flex items-end sm:items-center justify-center z-50 p-4"
          style={{ background: "#00000099" }}
        >
          <div className="w-full max-w-sm rounded-sm p-5" style={{ background: paper }}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <MapPin size={16} color={brass} />
                <div className="text-xs font-bold uppercase" style={{ color: ink, letterSpacing: "0.06em" }}>
                  Áreas de trabajo
                </div>
              </div>
              <button onClick={() => setAreasModal(null)}>
                <X size={18} color={ink} />
              </button>
            </div>
            <p className="text-xs mb-4" style={{ color: ink + "88" }}>
              {employees.find((e) => e.id === areasModal.employeeId)?.name}
            </p>

            <div className="flex flex-col gap-2 mb-4">
              {areasList.map((area) => {
                const checked = areasModal.draft.includes(area);
                return (
                  <button
                    key={area}
                    onClick={() => toggleAreaInModal(area)}
                    className="flex items-center gap-2 px-3 py-2 rounded-sm text-left"
                    style={{
                      background: checked ? sage + "14" : ink + "06",
                      border: `1px solid ${checked ? sage + "55" : ink + "11"}`,
                    }}
                  >
                    <span
                      className="rounded-sm flex-shrink-0"
                      style={{
                        width: 16,
                        height: 16,
                        border: `2px solid ${checked ? sage : steel}`,
                        background: checked ? sage : "transparent",
                      }}
                    />
                    <span className="text-xs font-bold" style={{ color: ink }}>
                      {area}
                    </span>
                  </button>
                );
              })}
            </div>

            <p className="text-[10px] mb-3" style={{ color: ink + "77" }}>
              Si marcas más de un área, en el Checador se le preguntará en cuál trabaja al registrar su
              entrada de cada día.
            </p>

            <button
              onClick={saveAreas}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-sm font-bold text-sm uppercase"
              style={{ background: brass, color: ink }}
            >
              <Check size={15} /> Guardar áreas
            </button>
          </div>
        </div>
      )}

      {/* ---------------- METODO DE CHECADO MODAL ---------------- */}
      {metodoModal && (
        <div
          className="fixed inset-0 flex items-end sm:items-center justify-center z-50 p-4"
          style={{ background: "#00000099" }}
        >
          <div className="w-full max-w-sm rounded-sm p-5" style={{ background: paper }}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <Fingerprint size={16} color={brass} />
                <div className="text-xs font-bold uppercase" style={{ color: ink, letterSpacing: "0.06em" }}>
                  Método de checado
                </div>
              </div>
              <button onClick={() => setMetodoModal(null)}>
                <X size={18} color={ink} />
              </button>
            </div>
            <p className="text-xs mb-4" style={{ color: ink + "88" }}>
              {employees.find((e) => e.id === metodoModal.employeeId)?.name}
            </p>

            <div className="flex flex-col gap-2 mb-3">
              {[
                { id: "foto", label: "Foto con uniforme", desc: "El método actual — toma una foto al registrar entrada." },
                { id: "clave", label: "Clave de 4 dígitos", desc: "Ingresa su propia clave personal al checar (distinta del PIN de administrador)." },
                {
                  id: "biometrico",
                  label: "Huella o rostro (biométrico)",
                  desc: isWebAuthnSupported()
                    ? "Usa el lector de huella o Face ID de este dispositivo."
                    : "Este dispositivo/navegador no es compatible con esta opción.",
                  disabled: !isWebAuthnSupported(),
                },
              ].map((opt) => {
                const selected = metodoModal.draft.tipo === opt.id;
                return (
                  <button
                    key={opt.id}
                    disabled={opt.disabled}
                    onClick={() => setMetodoModal((m) => ({ ...m, draft: { ...m.draft, tipo: opt.id }, error: "" }))}
                    className="flex flex-col items-start px-3 py-2.5 rounded-sm text-left disabled:opacity-40"
                    style={{
                      background: selected ? sage + "14" : ink + "06",
                      border: `1px solid ${selected ? sage + "55" : ink + "11"}`,
                    }}
                  >
                    <span className="text-xs font-bold" style={{ color: ink }}>
                      {opt.label}
                    </span>
                    <span className="text-[10px]" style={{ color: ink + "77" }}>
                      {opt.desc}
                    </span>
                  </button>
                );
              })}
            </div>

            {metodoModal.draft.tipo === "clave" && (
              <div className="mb-3">
                <input
                  value={metodoModal.draft.clave}
                  onChange={(e) =>
                    setMetodoModal((m) => ({
                      ...m,
                      draft: { ...m.draft, clave: e.target.value.replace(/\D/g, "").slice(0, 4) },
                      error: "",
                    }))
                  }
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="Clave de 4 dígitos"
                  className="w-full px-3 py-2.5 rounded-sm text-lg tracking-[0.3em] text-center outline-none"
                  style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                />
              </div>
            )}

            {metodoModal.draft.tipo === "biometrico" && (
              <div className="mb-3">
                {metodoModal.draft.bioCredentialId ? (
                  <div className="flex items-center justify-between px-3 py-2 rounded-sm" style={{ background: sage + "14" }}>
                    <span className="text-xs font-bold" style={{ color: sage }}>
                      ✓ Registrado en este dispositivo
                    </span>
                    <button
                      onClick={enrollBiometricForModal}
                      disabled={metodoModal.enrolling}
                      className="text-[10px] font-bold uppercase"
                      style={{ color: ink + "77" }}
                    >
                      Volver a registrar
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={enrollBiometricForModal}
                    disabled={metodoModal.enrolling || !isWebAuthnSupported()}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-sm font-bold text-xs uppercase disabled:opacity-40"
                    style={{ background: brass, color: ink }}
                  >
                    <Fingerprint size={14} />
                    {metodoModal.enrolling ? "Esperando lector…" : "Registrar huella/rostro en este dispositivo"}
                  </button>
                )}
              </div>
            )}

            {metodoModal.error && (
              <p className="text-xs mb-3" style={{ color: paprika }}>
                {metodoModal.error}
              </p>
            )}

            <button
              onClick={saveMetodo}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-sm font-bold text-sm uppercase"
              style={{ background: brass, color: ink }}
            >
              <Check size={15} /> Guardar método
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
