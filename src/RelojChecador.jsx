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
  Info,
} from "lucide-react";

/* ============================================================
   CONFIGURACIÓN DE SUPABASE — proyecto compartido con PAR
   ============================================================ */
const SUPABASE_URL = "https://wcyistsgpzzqflezyput.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_7BqQa6MCxW8qfyAuCgOQVg_HTnSuu9X";

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

/* Nómina, propinas, personal externo y el resto de lo que en la app solo se ve tras
   ingresar el PIN de acceso YA NO vive en la tabla abierta: las políticas de la base de
   datos bloquean esas claves para cualquiera que no pase por aquí, y aquí mismo se exige
   otra vez el PIN correcto en cada lectura/escritura (ver migración protege_datos_sensibles). */
async function leerDatoProtegido(clave, pin) {
  const { data, error } = await supabase.rpc("leer_dato_protegido_reloj", { p_clave: clave, p_pin: pin });
  if (error) throw error;
  return data; // string guardado, o null si no existe / el PIN no es correcto
}

async function guardarDatoProtegido(clave, valor, pin) {
  const { data, error } = await supabase.rpc("guardar_dato_protegido_reloj", {
    p_clave: clave,
    p_valor: valor,
    p_pin: pin,
  });
  if (error) throw error;
  return !!data;
}

// ---------- helpers ----------

function pad(n) {
  return String(n).padStart(2, "0");
}

function localDateKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function localTimeKey(d = new Date()) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Formatea "YYYY-MM-DD" (string, sin objeto Date) a texto largo en español,
// evitando el corrimiento de un día que causa parsear con `new Date(...)` por zona horaria.
function formatFechaLargaEs(fechaStr) {
  if (!fechaStr) return "";
  const [y, m, d] = fechaStr.split("-").map(Number);
  if (!y || !m || !d) return fechaStr;
  const meses = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
  ];
  return `${d} de ${meses[m - 1]} de ${y}`;
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
    // seguro social
    tieneSeguroSocial: false,
    numSeguroSocial: "",
    rfcSeguroSocial: "",
    afiliadoDesde: "",
  };
}

function formatMoney(n) {
  return (Number(n) || 0).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}

// Versión sin decimales para propinas (cuando es número entero)
function formatMoneyNoDecimal(n) {
  const num = Number(n) || 0;
  const isInteger = Number.isInteger(num);
  if (isInteger) {
    // Mostrar como $33, $100, etc (sin .00)
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: "MXN",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(num);
  }
  // Si tiene decimales, mostrar con 2 decimales
  return (num).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}

function defaultPeriodDates(payPeriod) {
  const end = new Date();
  const start = new Date();
  if (payPeriod === "semanal") start.setDate(end.getDate() - 6);
  else if (payPeriod === "quincenal") start.setDate(end.getDate() - 14);
  else start.setDate(end.getDate() - 29);
  return { start: localDateKey(start), end: localDateKey(end) };
}

// periodo sugerido para el SIGUIENTE recibo de un empleado: empieza justo el día después
// de donde terminó su último recibo generado, para no dejar huecos ni volver a pagar los
// mismos días sin querer. Si nunca se le ha generado un recibo, cae de vuelta al criterio
// anterior ("últimos N días contando desde hoy"). El fin nunca se adelanta más allá de hoy.
function nextPeriodDates(payPeriod, lastPeriodEnd) {
  if (!lastPeriodEnd) return defaultPeriodDates(payPeriod);
  const start = new Date(lastPeriodEnd + "T00:00:00");
  start.setDate(start.getDate() + 1);
  const spanDays = payPeriod === "semanal" ? 6 : payPeriod === "quincenal" ? 14 : 29;
  let end = new Date(start);
  end.setDate(start.getDate() + spanDays);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (end > today) end = today;
  if (end < start) end = start;
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

// días dentro del rango en los que el empleado NO checó entrada NI salida
// — candidatos a marcar como vacaciones tomadas (o simplemente días libres, sin registro alguno)
// FIX: No contar como "no trabajado" si al menos hay UNA salida (trabajó ese día)
function getNonWorkedDaysInRange(employeeId, startKey, endKey, recordsByDate) {
  const dias = [];
  const start = new Date(startKey + "T00:00:00");
  const end = new Date(endKey + "T00:00:00");
  if (isNaN(start) || isNaN(end) || start > end) return dias;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = localDateKey(d);
    const entrada = (recordsByDate[key] || []).some((r) => r.employeeId === employeeId && r.type === "entrada");
    const salida = (recordsByDate[key] || []).some((r) => r.employeeId === employeeId && r.type === "salida");
    // Si tiene entrada O salida, cuenta como "trabajado" (al menos parcialmente)
    const trabajado = entrada || salida;
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

// Validación de propinas: asegurar que no hay división por cero
function validateRepartoMontoOKForDivision(monto, totalEligibleDias) {
  if (!monto || monto <= 0) return { ok: false, error: "Monto debe ser > 0" };
  if (!totalEligibleDias || totalEligibleDias <= 0) return { ok: false, error: "Nadie calificó para propina en este periodo" };
  return { ok: true };
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

// pago correspondiente a UN día no trabajado marcado como vacaciones.
// - Si el empleado cobra por jornada, la tarifa ya es el pago de un día completo.
// - Si cobra por hora, pagarle "tarifa × 1" sería pagarle solo UNA hora, no el día — se usa
//   el horario asignado para ese día de la semana (cuántas horas tenía programadas) y, si no
//   hay horario configurado para ese día, el promedio de horas que sí trabajó en el periodo
//   (o 8 horas si tampoco hay ningún día trabajado con el que promediar).
function computeVacacionDayPay(employee, dateKey, draft, worked) {
  const rateAmount = Number(draft.rateAmount) || 0;
  if (draft.rateType !== "hora") return rateAmount;
  const weekday = new Date(dateKey + "T00:00:00").getDay();
  const daySchedule = getScheduleForDate(employee, dateKey)?.[weekday];
  if (daySchedule?.enabled && daySchedule.start && daySchedule.end) {
    const [sh, sm] = daySchedule.start.split(":").map(Number);
    const [eh, em] = daySchedule.end.split(":").map(Number);
    const horas = (eh * 60 + em - (sh * 60 + sm)) / 60;
    if (horas > 0) return horas * rateAmount;
  }
  const promedioHoras = worked.totalDias > 0 ? worked.totalHoras / worked.totalDias : 8;
  return promedioHoras * rateAmount;
}

function computePayrollTotals(draft, worked, bonoUnits, propinaMonto, employee) {
  const base = draft.rateType === "hora" ? worked.totalHoras * draft.rateAmount : worked.totalDias * draft.rateAmount;
  const bono = draft.enableBono ? (bonoUnits || 0) * draft.bonoPorJornada : 0;
  const propina = draft.enablePropina ? propinaMonto || 0 : 0;
  const vacaciones = draft.enableVacaciones
    ? (draft.vacacionesFechas || []).reduce((s, fecha) => s + computeVacacionDayPay(employee, fecha, draft, worked), 0)
    : 0;
  // horas extra: independientes del tiempo trabajado que ya se registró en el Checador —
  // se capturan a mano aquí (cuántas horas y a qué pago por hora cada una), en vez de
  // calcularse solas a partir de las entradas/salidas.
  const horasExtra = draft.enableHorasExtra
    ? (draft.horasExtra || []).reduce((s, h) => s + (Number(h.horas) || 0) * (Number(h.tarifaHora) || 0), 0)
    : 0;
  const descuentos = draft.enableDescuentos
    ? (draft.descuentos || []).reduce((s, d) => s + (Number(d.amount) || 0), 0)
    : 0;
  const consumo = draft.enableConsumo
    ? (draft.consumo || []).reduce((s, d) => s + (Number(d.amount) || 0), 0)
    : 0;
  const bruto = base + bono + propina + vacaciones + horasExtra;
  const leyDeduccion = draft.enableLey ? bruto * ((Number(draft.leyPercent) || 0) / 100) : 0;
  const neto = bruto - leyDeduccion - descuentos - consumo;
  return { base, bono, propina, vacaciones, horasExtra, descuentos, consumo, bruto, leyDeduccion, neto };
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
  // Trabajar DIRECTAMENTE en pesos enteros (sin decimales)
  const montoEntero = Math.floor(Number(monto) || 0);

  const lista = todosCandidatos
    .map((c) => {
      // Calcular pesos enteros (sin centavos), redondeando HACIA ABAJO
      const pesos = totalDiasPropina > 0 ? Math.floor((montoEntero * c.diasPropina) / totalDiasPropina) : 0;
      return { ...c, monto: pesos }; // Monto es un número entero, sin decimales
    })
    .sort((a, b) => (b.califica === a.califica ? a.employeeName.localeCompare(b.employeeName) : b.califica ? 1 : -1));

  // Sumar lo que se repartió (todo son números enteros)
  const repartidoPesos = lista.reduce((s, l) => s + l.monto, 0);
  // Sobrante en pesos (sin decimales)
  const sobrante = montoEntero - repartidoPesos;

  return { lista, sobrante };
}

// suma lo que a un empleado le tocó en los repartos de Propinas ya guardados, atribuyendo
// cada reparto al periodo de nómina en el que CAYÓ SU FECHA DE INICIO. Antes se exigía que
// el reparto cupiera COMPLETO dentro del periodo (inicio y fin), lo que hacía que un reparto
// se perdiera para siempre (no se sumaba en ningún periodo) cuando la frecuencia de propinas
// no coincidía exactamente con la frecuencia de nómina — por ejemplo, propinas semanales de
// lunes a domingo contra una nómina quincenal con otro corte. Usar solo la fecha de inicio
// garantiza que cada reparto se cuente exactamente una vez (nunca desaparece, nunca se
// duplica), siempre que los periodos de nómina de un mismo empleado no se traslapen entre sí.
function sumPropinaFromHistorial(employeeId, periodStart, periodEnd, propinasHistorial) {
  const sum = propinasHistorial
    .filter((p) => {
      const inicio = p.fechaInicio || p.fecha;
      return inicio >= periodStart && inicio <= periodEnd;
    })
    .reduce((sum, p) => {
      const linea = (p.reparto || []).find((r) => r.employeeId === employeeId);
      if (!linea) return sum;
      const monto = Number(linea.monto) || 0;
      // Sanitizar: descartar NaN y negativos
      const saneMonto = isNaN(monto) || monto < 0 ? 0 : monto;
      return sum + saneMonto;
    }, 0);
  // Garantizar que nunca retorna NaN o negativo
  return isNaN(sum) || sum < 0 ? 0 : sum;
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

// ---------- catálogos de Actas Administrativas ----------
const TIPOS_INFRACCION_ACTA = [
  "Impuntualidad reiterada",
  "Ausentismo injustificado",
  "Incumplimiento de normas de higiene o uso de uniforme",
  "Falta de respeto o actitud inapropiada",
  "Incumplimiento de procedimientos de trabajo",
  "Negligencia en el desempeño de sus funciones",
  "Daño a equipo, herramienta o mobiliario",
  "Manejo inadecuado de dinero, inventario o propinas",
  "Otro",
];

const MEDIDAS_DISCIPLINARIAS_ACTA = ["Amonestación verbal", "Amonestación escrita (esta acta)", "Suspensión sin goce de sueldo", "Otra"];

// Textos sugeridos: al elegir uno de estos tipos de infracción, se propone un texto
// preestablecido para la descripción de los hechos (el usuario lo puede editar libremente
// antes de guardar el acta; solo se inserta automáticamente si el campo está vacío).
const TEXTOS_PREESTABLECIDOS_ACTA = {
  "Ausentismo injustificado":
    "El colaborador faltó a su turno de trabajo programado sin presentar previamente una justificación válida ni dar aviso oportuno a su superior inmediato, incumpliendo con ello sus obligaciones de asistencia establecidas por la empresa.",
  "Impuntualidad reiterada":
    "El colaborador se presentó a laborar después de la hora de entrada establecida para su turno, incurriendo en un retardo que se suma a incidencias previas de la misma naturaleza, lo cual afecta la operación normal del establecimiento.",
  "Daño a equipo, herramienta o mobiliario":
    "El colaborador ocasionó daños al mobiliario, equipo, herramienta o instalaciones del establecimiento derivados de un manejo inadecuado o de la falta de cuidado en el desempeño de sus funciones, generando un perjuicio material a la empresa.",
  "Negligencia en el desempeño de sus funciones":
    "El colaborador incurrió en negligencia en el desempeño de sus funciones, al no observar el cuidado, la diligencia o los procedimientos que su puesto exige, poniendo en riesgo la operación, el servicio o los bienes del establecimiento.",
};

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
  const { ink, paprika } = colors;
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {(items || []).map((item, idx) => {
        // Validar monto: debe ser un número válido >= 0
        const amountNum = Number(item.amount) || 0;
        const amountIsInvalid = isNaN(amountNum) || amountNum < 0;
        return (
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
              onChange={(e) => {
                let val = e.target.value;
                // Permitir solo números y UN punto decimal
                val = val.replace(/[^0-9.]/g, "");
                // Evitar múltiples puntos: .0.5 -> .05
                const parts = val.split(".");
                if (parts.length > 2) val = parts[0] + "." + parts.slice(1).join("");
                onUpdate(idx, { amount: val });
              }}
              placeholder="$"
              inputMode="decimal"
              className="w-20 px-2 py-1.5 rounded-sm text-xs outline-none"
              style={{ 
                border: `1px solid ${amountIsInvalid && item.amount ? paprika : ink}33`, 
                background: "#fff", 
                color: ink 
              }}
            />
            <button onClick={() => onRemove(idx)} className="p-1.5 flex-shrink-0" style={{ color: ink + "55" }}>
              <Trash2 size={13} />
            </button>
            {amountIsInvalid && item.amount && (
              <span className="text-[9px]" style={{ color: paprika }}>
                ⚠️ monto inválido
              </span>
            )}
          </div>
        );
      })}
      <button onClick={onAdd} className="flex items-center gap-1 text-[11px] font-bold self-start" style={{ color: ink + "88" }}>
        <Plus size={12} /> Agregar línea
      </button>
    </div>
  );
}

// captura de horas extra: independiente de las horas ya registradas en el Checador — cada
// línea es "cuántas horas" × "pago por hora", pensado para cuando un empleado se queda más
// tiempo del que le tocaba y se le paga aparte, sin tener que tocar su tarifa normal.
function HorasExtraEditor({ items, onAdd, onUpdate, onRemove, colors }) {
  const { ink, paprika } = colors;
  return (
    <div className="mt-2 flex flex-col gap-2">
      {(items || []).map((item, idx) => {
        const horasNum = Number(item.horas) || 0;
        const tarifaNum = Number(item.tarifaHora) || 0;
        const subtotal = horasNum * tarifaNum;
        const horasInvalida = item.horas !== "" && item.horas !== undefined && (isNaN(horasNum) || horasNum < 0);
        const tarifaInvalida = item.tarifaHora !== "" && item.tarifaHora !== undefined && (isNaN(tarifaNum) || tarifaNum < 0);
        return (
          <div key={idx} className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <input
                value={item.horas}
                onChange={(e) => {
                  let val = e.target.value.replace(/[^0-9.]/g, "");
                  const parts = val.split(".");
                  if (parts.length > 2) val = parts[0] + "." + parts.slice(1).join("");
                  onUpdate(idx, { horas: val });
                }}
                placeholder="Núm. de horas"
                inputMode="decimal"
                className="flex-1 px-2 py-1.5 rounded-sm text-xs outline-none"
                style={{ border: `1px solid ${horasInvalida ? paprika : ink}33`, background: "#fff", color: ink }}
              />
              <input
                value={item.tarifaHora}
                onChange={(e) => {
                  let val = e.target.value.replace(/[^0-9.]/g, "");
                  const parts = val.split(".");
                  if (parts.length > 2) val = parts[0] + "." + parts.slice(1).join("");
                  onUpdate(idx, { tarifaHora: val });
                }}
                placeholder="Pago por hora"
                inputMode="decimal"
                className="w-28 px-2 py-1.5 rounded-sm text-xs outline-none"
                style={{ border: `1px solid ${tarifaInvalida ? paprika : ink}33`, background: "#fff", color: ink }}
              />
              <button onClick={() => onRemove(idx)} className="p-1.5 flex-shrink-0" style={{ color: ink + "55" }}>
                <Trash2 size={13} />
              </button>
            </div>
            {(item.horas || item.tarifaHora) && (
              <span className="text-[10px] pl-1" style={{ color: ink + "66" }}>
                Subtotal: {formatMoney(subtotal)}
              </span>
            )}
          </div>
        );
      })}
      <button onClick={onAdd} className="flex items-center gap-1 text-[11px] font-bold self-start" style={{ color: ink + "88" }}>
        <Plus size={12} /> Agregar horas extra
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
  onAddHorasExtra,
  onSaveConfig,
  onGenerate,
  onSaveNombreCompleto,
  onSaveCurp,
  colors,
}) {
  const { paprika, sage, ink, paper, brass, steel } = colors;
  const [editingNombreCompleto, setEditingNombreCompleto] = useState(false);
  const [nombreCompletoDraft, setNombreCompletoDraft] = useState(employee?.nombreCompleto || "");
  const [editingCurp, setEditingCurp] = useState(false);
  const [curpDraft, setCurpDraft] = useState(employee?.curp || "");
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
  const totals = computePayrollTotals(draft, worked, bonoUnits, propinaSeSuma ? propinaAuto : 0, employee);
  const bonoLabel =
    draft.bonoFrecuencia === "semana" ? "semana perfecta" : draft.bonoFrecuencia === "mes" ? "mes perfecto" : "jornada";
  const mostrarLineaBono = draft.enableBono && totals.bono > 0;
  const mostrarLineaHorasExtra = draft.enableHorasExtra && totals.horasExtra > 0;
  const diasNoTrabajados = draft.enableVacaciones
    ? getNonWorkedDaysInRange(employee.id, draft.periodStart, draft.periodEnd, recordsByDate)
    : [];
  // detalle de cuánto corresponde a cada día de vacaciones — se congela al generar el
  // recibo (ver onGenerate) para que reimprimirlo después dé siempre el mismo resultado,
  // aunque el horario del empleado cambie más adelante.
  const vacacionesDetalle = draft.enableVacaciones
    ? (draft.vacacionesFechas || []).map((fecha) => ({ fecha, monto: computeVacacionDayPay(employee, fecha, draft, worked) }))
    : [];

  return (
    <div className="flex-1 overflow-y-auto flex flex-col gap-4 pb-4">
      {/* HEADER PROMINENTE DEL EMPLEADO */}
      <div className="rounded-sm p-5" style={{ background: brass, color: ink }}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1">
            <h2 style={{ fontSize: "1.6rem", fontWeight: 900, margin: 0, letterSpacing: "-0.02em" }}>
              {employee.name}
            </h2>
            <div className="text-xs mt-1" style={{ opacity: 0.9, letterSpacing: "0.05em" }}>
              NÓMINA
            </div>
          </div>
          <button 
            onClick={onBack} 
            className="flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-sm"
            style={{ background: ink + "22", color: ink }}
          >
            <ChevronLeft size={14} /> Volver
          </button>
        </div>
        
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <span style={{ opacity: 0.75, fontSize: "0.65rem", textTransform: "uppercase", display: "block", letterSpacing: "0.04em" }}>
              Puesto
            </span>
            <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>{employee.puesto || "—"}</span>
          </div>
          {(employee.areas || []).length > 0 && (
            <div>
              <span style={{ opacity: 0.75, fontSize: "0.65rem", textTransform: "uppercase", display: "block", letterSpacing: "0.04em" }}>
                Área(s)
              </span>
              <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>{(employee.areas || []).join(", ") || "—"}</span>
            </div>
          )}
        </div>

        {/* nombre completo: para que el recibo de nómina y las actas administrativas
            queden con el dato preciso, en vez del nombre corto/apodo de Checador */}
        <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${ink}22` }}>
          <span style={{ opacity: 0.75, fontSize: "0.65rem", textTransform: "uppercase", display: "block", letterSpacing: "0.04em" }}>
            Nombre completo (para nómina y actas)
          </span>
          {editingNombreCompleto ? (
            <div className="flex items-center gap-2 mt-1">
              <input
                value={nombreCompletoDraft}
                onChange={(e) => setNombreCompletoDraft(e.target.value)}
                placeholder="Nombre completo del trabajador"
                autoFocus
                className="flex-1 px-2 py-1.5 rounded-sm text-xs outline-none"
                style={{ border: `1px solid ${ink}55`, background: "#fff", color: ink }}
              />
              <button
                onClick={() => {
                  onSaveNombreCompleto(employee.id, nombreCompletoDraft.trim());
                  setEditingNombreCompleto(false);
                }}
                className="text-[10px] font-bold uppercase px-2.5 py-1.5 rounded-sm flex-shrink-0"
                style={{ background: ink, color: paper }}
              >
                Guardar
              </button>
              <button
                onClick={() => {
                  setNombreCompletoDraft(employee.nombreCompleto || "");
                  setEditingNombreCompleto(false);
                }}
                className="text-[10px] font-bold uppercase px-2.5 py-1.5 rounded-sm flex-shrink-0"
                style={{ background: ink + "22", color: ink }}
              >
                Cancelar
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 mt-1">
              <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>{employee.nombreCompleto || "Sin capturar"}</span>
              <button
                onClick={() => setEditingNombreCompleto(true)}
                className="flex items-center gap-1 text-[10px] font-bold uppercase px-2.5 py-1.5 rounded-sm flex-shrink-0"
                style={{ background: ink + "22", color: ink }}
              >
                <Pencil size={11} /> {employee.nombreCompleto ? "Editar" : "Capturar"}
              </button>
            </div>
          )}
        </div>

        {/* CURP: se usa en las actas administrativas, dentro de "Datos del trabajador" */}
        <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${ink}22` }}>
          <span style={{ opacity: 0.75, fontSize: "0.65rem", textTransform: "uppercase", display: "block", letterSpacing: "0.04em" }}>
            CURP (para actas)
          </span>
          {editingCurp ? (
            <div className="flex items-center gap-2 mt-1">
              <input
                value={curpDraft}
                onChange={(e) => setCurpDraft(e.target.value.toUpperCase())}
                placeholder="CURP del trabajador"
                maxLength={18}
                autoFocus
                className="flex-1 px-2 py-1.5 rounded-sm text-xs outline-none"
                style={{ border: `1px solid ${ink}55`, background: "#fff", color: ink }}
              />
              <button
                onClick={() => {
                  onSaveCurp(employee.id, curpDraft.trim());
                  setEditingCurp(false);
                }}
                className="text-[10px] font-bold uppercase px-2.5 py-1.5 rounded-sm flex-shrink-0"
                style={{ background: ink, color: paper }}
              >
                Guardar
              </button>
              <button
                onClick={() => {
                  setCurpDraft(employee.curp || "");
                  setEditingCurp(false);
                }}
                className="text-[10px] font-bold uppercase px-2.5 py-1.5 rounded-sm flex-shrink-0"
                style={{ background: ink + "22", color: ink }}
              >
                Cancelar
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 mt-1">
              <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>{employee.curp || "Sin capturar"}</span>
              <button
                onClick={() => setEditingCurp(true)}
                className="flex items-center gap-1 text-[10px] font-bold uppercase px-2.5 py-1.5 rounded-sm flex-shrink-0"
                style={{ background: ink + "22", color: ink }}
              >
                <Pencil size={11} /> {employee.curp ? "Editar" : "Capturar"}
              </button>
            </div>
          )}
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
        <p className="text-[10px] mb-3" style={{ color: ink + "66" }}>
          Los cambios aquí se guardan automáticamente cuando presionas el botón "Guardar como configuración".
        </p>
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
            style={{ border: `1px solid ${draft.periodStart && draft.periodEnd && draft.periodStart > draft.periodEnd ? paprika : ink}33`, background: "#fff", color: ink }}
          />
          <span className="text-[10px]" style={{ color: ink + "66" }}>
            a
          </span>
          <input
            type="date"
            value={draft.periodEnd}
            onChange={(e) => onChange({ periodEnd: e.target.value })}
            className="flex-1 px-2 py-1.5 rounded-sm text-xs outline-none"
            style={{ border: `1px solid ${draft.periodStart && draft.periodEnd && draft.periodStart > draft.periodEnd ? paprika : ink}33`, background: "#fff", color: ink }}
          />
        </div>
        {draft.periodStart && draft.periodEnd && draft.periodStart > draft.periodEnd && (
          <p className="text-xs mb-3" style={{ color: paprika }}>
            ⚠️ La fecha de inicio no puede ser posterior a la de fin.
          </p>
        )}
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
        <p className="text-[10px] mt-2" style={{ color: ink + "66" }}>
          ℹ️ Estos números se actualizan automáticamente cuando se registran nuevas entradas/salidas.
        </p>
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
                  onChange={(e) => {
                    let val = e.target.value.replace(/[^0-9]/g, "");
                    // Evitar vacío; si queda vacío, se pone "10" como default
                    if (val === "") val = "10";
                    onChange({ toleranciaBonoMin: val });
                  }}
                  onBlur={(e) => {
                    // Asegurar que al perder foco nunca está vacío
                    if (!draft.toleranciaBonoMin || draft.toleranciaBonoMin === "") {
                      onChange({ toleranciaBonoMin: "10" });
                    }
                  }}
                  inputMode="numeric"
                  minLength={1}
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
                {draft.vacacionesFechas.length} día(s) marcado(s) como vacaciones = {formatMoney(totals.vacaciones)}
                {draft.rateType === "hora" && (
                  <> (calculado según el horario asignado de cada día, no la tarifa por hora tal cual)</>
                )}
                .
              </p>
            )}
          </div>
        )}

        <ToggleRow label="Horas extra" checked={draft.enableHorasExtra} onChange={(v) => onChange({ enableHorasExtra: v })} colors={colors} />
        {draft.enableHorasExtra && (
          <div className="pl-1">
            <p className="text-[11px] mb-1.5" style={{ color: ink + "88" }}>
              Independiente del tiempo trabajado que ya se registró en el Checador — captura cuántas
              horas extra hizo y a qué pago por hora cada una.
            </p>
            <HorasExtraEditor
              items={draft.horasExtra}
              onAdd={onAddHorasExtra}
              onUpdate={(idx, patch) => onUpdateLine("horasExtra", idx, patch)}
              onRemove={(idx) => onRemoveLine("horasExtra", idx)}
              colors={colors}
            />
            {mostrarLineaHorasExtra && (
              <p className="text-[10px] mt-1.5" style={{ color: sage }}>
                Total horas extra: {formatMoney(totals.horasExtra)}
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
            <p className="text-[10px] mt-1.5 flex items-start gap-1" style={{ color: brass }}>
              <Info size={11} className="flex-shrink-0 mt-0.5" />
              Se calcula como: Bruto × (% ingresado) ÷ 100. Ejemplo: si Bruto es $1000 y escribes "10", descuenta $100.
            </p>
            <p className="text-[10px] mt-1 flex items-start gap-1" style={{ color: paprika }}>
              <AlertTriangle size={11} className="flex-shrink-0 mt-0.5" />
              Esto es un porcentaje simple, no un cálculo real de ISR/IMSS. Antes de usarlo con nómina de
              verdad, valídalo con tu contador.
            </p>
          </div>
        )}

        <ToggleRow
          label="Seguro Social"
          checked={draft.tieneSeguroSocial}
          onChange={(v) => onChange({ tieneSeguroSocial: v })}
          colors={colors}
        />
        {draft.tieneSeguroSocial && (
          <div className="pl-1 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[11px]" style={{ color: ink + "88" }}>
                Número de afiliación (IMSS):
              </span>
              <input
                value={draft.numSeguroSocial}
                onChange={(e) => onChange({ numSeguroSocial: e.target.value.replace(/[^0-9-]/g, "") })}
                placeholder="ej. 123-45-67890-1"
                className="flex-1 px-2 py-1.5 rounded-sm text-xs outline-none"
                style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px]" style={{ color: ink + "88" }}>
                RFC:
              </span>
              <input
                value={draft.rfcSeguroSocial}
                onChange={(e) => onChange({ rfcSeguroSocial: e.target.value.toUpperCase() })}
                placeholder="ej. ABCD123456XYZ"
                maxLength={13}
                className="flex-1 px-2 py-1.5 rounded-sm text-xs outline-none"
                style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px]" style={{ color: ink + "88" }}>
                Afiliado desde (opcional):
              </span>
              <input
                type="date"
                value={draft.afiliadoDesde}
                onChange={(e) => onChange({ afiliadoDesde: e.target.value })}
                className="flex-1 px-2 py-1.5 rounded-sm text-xs outline-none"
                style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
              />
            </div>
            <p className="text-[10px]" style={{ color: ink + "66" }}>
              Estos datos se guardan en la configuración de {employee.name} — aparecerán en futuros recibos de nómina.
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
          {mostrarLineaHorasExtra && (
            <div className="flex justify-between">
              <span>Horas extra</span>
              <span>+{formatMoney(totals.horasExtra)}</span>
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
          <div className="flex justify-between font-black text-base pt-2 mt-1" style={{ borderTop: `2px solid ${ink}33`, color: totals.neto < 0 ? paprika : sage }}>
            <span>Neto a pagar</span>
            <span>{formatMoney(totals.neto)}</span>
          </div>
        </div>

        {totals.neto < 0 && (
          <div className="mt-3 p-2 rounded-sm" style={{ background: paprika + "22" }}>
            <p className="text-xs" style={{ color: paprika }}>
              ⚠️ <strong>El neto es negativo.</strong> Revisa descuentos, consumo y ley — algo está mal configurado.
            </p>
          </div>
        )}

        <div className="mt-4 p-3 rounded-sm" style={{ background: brass + "11" }}>
          <p className="text-[10px] mb-3" style={{ color: ink + "88" }}>
            <strong>Generar recibo:</strong> Crea la nómina imprimible. El botón de guardar configuración arriba
            guarda los datos de pago de este empleado (tarifa, frecuencia, bono, seguro social) — NO guarda las
            fechas del periodo, esas se ajustan cada vez aquí arriba.
          </p>
        </div>

        <button
          onClick={() => onGenerate(worked, totals, propinaSeSuma, vacacionesDetalle)}
          disabled={totals.neto < 0}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-sm font-bold text-sm uppercase disabled:opacity-50"
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

  // ---------- access pin (protects Bitácora, Nómina, Ajustes, etc.) ----------
  // El PIN real ya NO se descarga nunca al navegador: solo sabemos si ya hay
  // uno configurado (pinConfigured) y validamos cada intento contra Supabase
  // con la función verify_app_pin, que solo contesta true/false.
  // Declarado aquí arriba (y no más abajo, donde vive el resto del código del PIN)
  // porque varias funciones de guardado protegido (nómina, ajustes, configuración
  // del negocio) lo usan antes en el archivo, y en JS un "const"/"useState" no se
  // puede usar antes de la línea donde se declara.
  const [pinConfigured, setPinConfigured] = useState(undefined); // undefined = cargando, true/false
  const [unlockedSession, setUnlockedSession] = useState(false);
  // Guarda el PIN ya verificado SOLO en memoria (nunca en localStorage ni en Supabase),
  // mientras la sesión sigue desbloqueada. Nómina, propinas, personal externo, etc. viven
  // en la base de datos protegidas por este mismo PIN (ver migración protege_datos_sensibles),
  // así que cada lectura/escritura de esos datos necesita volver a mandarlo.
  const verifiedPinRef = useRef("");

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

  // ---------- función (grupo padre) de cada área, ej. "Cocina Caliente" y "Cocina Fría"
  // pertenecen a la función "Cocina"; "Barra" y "Servicio" a "Salón" ----------
  const [areaFuncion, setAreaFuncion] = useState({}); // { [nombreArea]: "Cocina" | "Salón" | ... }
  const [loadingAreaFuncion, setLoadingAreaFuncion] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await storageGet("area_funcion");
        setAreaFuncion(r ? JSON.parse(r.value) : {});
      } catch {
        setAreaFuncion({});
      }
      setLoadingAreaFuncion(false);
    })();
  }, []);

  function setAreaFuncionValue(areaName, value) {
    const next = { ...areaFuncion, [areaName]: value };
    setAreaFuncion(next);
    scheduleSync("area_funcion", JSON.stringify(next));
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
  const punchInFlightRef = useRef(false); // bloquea doble-tap/doble ejecución de confirmPunch
  const [toast, setToast] = useState(null);
  const fileInputRef = useRef(null);

  // ---------- background sync queue (optimistic UI, never blocks, never reverts) ----------
  const pendingValuesRef = useRef({}); // key -> latest JSON string awaiting sync
  const syncingRef = useRef({}); // key -> in-flight flag
  const [pendingKeys, setPendingKeys] = useState({}); // key -> true, drives the small status dot
  const syncFailCountRef = useRef({}); // key -> intentos fallidos consecutivos

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
        syncFailCountRef.current[key] = 0;
      } catch (err) {
        console.error(`Sincronización pendiente de "${key}":`, err);
        // se queda en la cola; el intervalo de abajo lo reintenta solo
        syncFailCountRef.current[key] = (syncFailCountRef.current[key] || 0) + 1;
        // FIX medio: si el guardado de entradas/salidas lleva varios intentos
        // fallidos seguidos, avisamos con un toast visible en vez de solo el
        // puntito pequeño de "Sincronizando…" (fácil de no ver al marcar y salir).
        if (key === "records" && syncFailCountRef.current[key] === 3) {
          setToast({
            color: paprika,
            text: "No se ha podido guardar el último registro — revisa tu conexión. Se sigue intentando solo.",
          });
        }
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
  const [businessConfig, setBusinessConfig] = useState({ nombre: "Restaurante Bondiola", sucursal: "", direccion: "", encabezado: "" });
  const [businessConfigDraft, setBusinessConfigDraft] = useState({ nombre: "", sucursal: "", direccion: "", encabezado: "" });
  const [businessLogo, setBusinessLogo] = useState(null); // data URL, se queda local en este dispositivo
  const [showBusinessConfigEdit, setShowBusinessConfigEdit] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await storageGet("business_config");
        const cfg = r ? JSON.parse(r.value) : { nombre: "Restaurante Bondiola", sucursal: "", direccion: "", encabezado: "" };
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

  async function saveBusinessConfig() {
    const draft = businessConfigDraft;
    let ok = false;
    try {
      ok = await guardarDatoProtegido("business_config", JSON.stringify(draft), verifiedPinRef.current);
    } catch {
      ok = false;
    }
    if (!ok) {
      setToast({ color: paprika, text: "No se pudo guardar. Vuelve a desbloquear e intenta otra vez." });
      return;
    }
    setBusinessConfig(draft);
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
  const [payrollPrintView, setPayrollPrintView] = useState(null); // { employee, worked, totals, draft, propinaSeSuma } | null
  const [confirmGeneratePayroll, setConfirmGeneratePayroll] = useState(null); // { employee, worked, totals, draft, propinaSeSuma, duplicado } | null
  const [payrollRuns, setPayrollRuns] = useState([]);
  const [loadingPayrollRuns, setLoadingPayrollRuns] = useState(true);
  // historial de recibos ya generados: se ve dentro de la misma pestaña de Nómina, no
  // se captura nada aquí — solo permite consultar, reimprimir o borrar recibos pasados.
  const [showPayrollHistory, setShowPayrollHistory] = useState(false);
  const [payrollHistoryFiltro, setPayrollHistoryFiltro] = useState("");
  const [confirmDeletePayrollRunId, setConfirmDeletePayrollRunId] = useState(null);

  useEffect(() => {
    if (!unlockedSession) return;
    (async () => {
      setLoadingPayrollRuns(true);
      try {
        const val = await leerDatoProtegido("payroll_runs", verifiedPinRef.current);
        setPayrollRuns(val ? JSON.parse(val) : []);
      } catch {
        setPayrollRuns([]);
      }
      setLoadingPayrollRuns(false);
    })();
  }, [unlockedSession]);

  // guarda el recibo generado en el histórico y deja el formulario listo para la siguiente jornada
  function handleGeneratePayroll(worked, totals, propinaSeSuma, vacacionesDetalle) {
    const emp = employees.find((e) => e.id === payrollSelectedEmployeeId);
    if (!emp || !payrollDraft) return;
    // Si ya existe un recibo generado para este mismo empleado y exactamente el mismo
    // periodo, se avisa en la confirmación — no se bloquea (puede ser intencional, p.ej.
    // corregir algo), pero así no pasa desapercibido.
    const duplicado = payrollRuns.find(
      (r) =>
        r.employeeId === emp.id &&
        r.periodStart === payrollDraft.periodStart &&
        r.periodEnd === payrollDraft.periodEnd
    );
    setConfirmGeneratePayroll({
      employee: emp,
      worked,
      totals,
      draft: payrollDraft,
      propinaSeSuma,
      vacacionesDetalle,
      duplicado: duplicado || null,
    });
  }

  async function confirmAndGeneratePayroll() {
    if (!confirmGeneratePayroll) return;
    const { employee: emp, worked, totals, draft, propinaSeSuma, vacacionesDetalle } = confirmGeneratePayroll;

    const run = {
      id: uid("nomina"),
      employeeId: emp.id,
      employeeName: emp.name,
      periodStart: draft.periodStart,
      periodEnd: draft.periodEnd,
      draft: draft,
      worked,
      totals,
      propinaSeSuma,
      vacacionesDetalle,
      creadoEn: new Date().toISOString(),
    };
    const actualizado = [run, ...payrollRuns].slice(0, 200);
    let ok = false;
    try {
      ok = await guardarDatoProtegido("payroll_runs", JSON.stringify(actualizado), verifiedPinRef.current);
    } catch {
      ok = false;
    }
    if (!ok) {
      setToast({ color: paprika, text: "No se pudo guardar el recibo. Vuelve a desbloquear e intenta otra vez." });
      return;
    }
    setPayrollRuns(actualizado);

    setPayrollPrintView({ employee: emp, draft: draft, worked, totals, propinaSeSuma, vacacionesDetalle });
    setConfirmGeneratePayroll(null);
    openPayroll(emp.id); // reinicia el formulario a un borrador limpio para la siguiente jornada
  }

  // reabre un recibo ya generado (desde el historial) en la vista imprimible, tal cual
  // quedó guardado — no vuelve a calcular nada, para que el reimpreso sea idéntico al
  // original aunque la configuración de propinas o el horario del empleado hayan cambiado
  // desde entonces.
  function reimprimirPayrollRun(run) {
    const emp = employees.find((e) => e.id === run.employeeId) || {
      id: run.employeeId,
      name: run.employeeName,
      puesto: "",
      nombreCompleto: "",
    };
    setPayrollPrintView({
      employee: emp,
      draft: run.draft,
      worked: run.worked,
      totals: run.totals,
      propinaSeSuma: run.propinaSeSuma,
      vacacionesDetalle: run.vacacionesDetalle,
    });
  }

  async function borrarPayrollRun(id) {
    const actualizado = payrollRuns.filter((r) => r.id !== id);
    let ok = false;
    try {
      ok = await guardarDatoProtegido("payroll_runs", JSON.stringify(actualizado), verifiedPinRef.current);
    } catch {
      ok = false;
    }
    if (!ok) {
      setToast({ color: paprika, text: "No se pudo borrar. Intenta otra vez." });
      return;
    }
    setPayrollRuns(actualizado);
    setConfirmDeletePayrollRunId(null);
    setToast({ color: steel, text: "Recibo eliminado del historial." });
  }

  // ---------- propinas ----------
  const [propinasPeriodoInicio, setPropinasPeriodoInicio] = useState(localDateKey());
  const [propinasPeriodoFin, setPropinasPeriodoFin] = useState(localDateKey());
  const [propinasMonto, setPropinasMonto] = useState("");
  const [propinasQuien, setPropinasQuien] = useState("");
  const [propinasHistorial, setPropinasHistorial] = useState([]);
  const [loadingPropinasHistorial, setLoadingPropinasHistorial] = useState(true);
  const [showPropinasHistorial, setShowPropinasHistorial] = useState(false);
  const [expandidosHistorial, setExpandidosHistorial] = useState(new Set()); // Para mostrar/ocultar desglose
  
  // Estado para confirmación de sobrescritura + guard de concurrencia
  const [propinasOverwriteConfirm, setPropinasOverwriteConfirm] = useState(null);
  const propinasGuardandoRef = useRef(false);

  // configuración global de propinas: visible para cualquiera, pero solo se edita con PIN.
  // toleranciaMin: minutos para calificar a propina · frecuencia: cada cuánto se cierra el
  // reparto (diaria/semanal/mensual) · modoEntrega: si se paga aparte cada vez, o se junta
  // y se entrega hasta la nómina del periodo.
  const [propinasConfig, setPropinasConfig] = useState({ toleranciaMin: 15, frecuencia: "diaria", modoEntrega: "diaria" });
  const [propinasConfigDraft, setPropinasConfigDraft] = useState({ toleranciaMin: "15", frecuencia: "diaria", modoEntrega: "diaria" });
  const [showPropinasConfigEdit, setShowPropinasConfigEdit] = useState(false);

  useEffect(() => {
    // Se lee sin PIN a propósito: la configuración de propinas es visible para cualquiera
    // que use el Checador (para calcular quién califica), solo EDITARLA pide el PIN.
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

  async function savePropinasConfig() {
    const cfg = {
      toleranciaMin: Number(propinasConfigDraft.toleranciaMin) || 0,
      frecuencia: propinasConfigDraft.frecuencia,
      modoEntrega: propinasConfigDraft.modoEntrega,
    };
    let ok = false;
    try {
      ok = await guardarDatoProtegido("propinas_config", JSON.stringify(cfg), verifiedPinRef.current);
    } catch {
      ok = false;
    }
    if (!ok) {
      setToast({ color: paprika, text: "No se pudo guardar. Vuelve a desbloquear e intenta otra vez." });
      return;
    }
    setPropinasConfig(cfg);
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
    if (!unlockedSession) return;
    (async () => {
      try {
        const val = await leerDatoProtegido("ajustes_manuales_log", verifiedPinRef.current);
        setAjustesLog(val ? JSON.parse(val) : []);
      } catch {
        setAjustesLog([]);
      }
    })();
  }, [unlockedSession]);

  async function aplicarCorreccionManual() {
    if (!ajusteEmpleadoId || !ajusteFecha || !ajusteMotivo.trim()) return;
    if (!ajusteBono && !ajustePropina) return;

    const dayRecords = recordsByDate[ajusteFecha] || [];
    const idx = dayRecords.findIndex((r) => r.employeeId === ajusteEmpleadoId && r.type === "entrada");
    if (idx === -1) {
      setToast({ color: paprika, text: "Esa persona no tiene una entrada registrada ese día." });
      return;
    }

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
    const actualizadoLog = [logEntry, ...ajustesLog].slice(0, 100);

    // Se guarda primero la bitácora de la corrección (protegida por PIN); solo si eso
    // queda bien se toca el registro real, para no dejar un cambio a medias.
    let ok = false;
    try {
      ok = await guardarDatoProtegido("ajustes_manuales_log", JSON.stringify(actualizadoLog), verifiedPinRef.current);
    } catch {
      ok = false;
    }
    if (!ok) {
      setToast({ color: paprika, text: "No se pudo aplicar la corrección. Vuelve a desbloquear e intenta otra vez." });
      return;
    }
    setAjustesLog(actualizadoLog);

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

    setAjusteEmpleadoId("");
    setAjusteMotivo("");
    setAjusteBono(false);
    setAjustePropina(false);
    setToast({ color: sage, text: `Corrección aplicada a ${emp?.name || "empleado"} — ya se refleja en todos lados.` });
  }

  // ---------- Actas administrativas (amonestaciones/infracciones del personal) ----------
  // Vive detrás del mismo PIN de acceso que Nómina/Ajustes y usa las mismas funciones
  // protegidas de Supabase (leerDatoProtegido/guardarDatoProtegido con la clave
  // "actas_administrativas") — nadie puede leer o escribir esto sin el PIN correcto, ni
  // siquiera consultando la tabla directo. A diferencia del log de ajustes, aquí NO se
  // recorta el historial: son documentos que se pueden necesitar meses o años después.
  const [actas, setActas] = useState([]);
  const [loadingActas, setLoadingActas] = useState(true);
  const [actaForm, setActaForm] = useState(null);
  const [actaPrintView, setActaPrintView] = useState(null);
  const [confirmDeleteActaId, setConfirmDeleteActaId] = useState(null);
  const [actaFiltroEmpleado, setActaFiltroEmpleado] = useState("");

  useEffect(() => {
    if (!unlockedSession) return;
    (async () => {
      setLoadingActas(true);
      try {
        const val = await leerDatoProtegido("actas_administrativas", verifiedPinRef.current);
        setActas(val ? JSON.parse(val) : []);
      } catch {
        setActas([]);
      }
      setLoadingActas(false);
    })();
  }, [unlockedSession]);

  // lugar de los hechos, por defecto: nombre del negocio + sucursal (si existe) + dirección,
  // en ese orden — el usuario lo puede editar libremente al elaborar el acta.
  function lugarHechosBase() {
    return [businessConfig?.nombre, businessConfig?.sucursal, businessConfig?.direccion].filter(Boolean).join(" · ");
  }

  function nuevoFolioActa(lista) {
    const anio = new Date().getFullYear();
    const marca = `ACTA-${anio}-`;
    const delAnio = lista.filter((a) => (a.folio || "").startsWith(marca)).length;
    return `${marca}${String(delAnio + 1).padStart(3, "0")}`;
  }

  function abrirNuevaActa(employeeId = "") {
    setActaForm({
      employeeId: employeeId || "",
      fecha: localDateKey(),
      hora: localTimeKey(),
      lugar: lugarHechosBase(),
      tipo: "",
      tipoOtro: "",
      narracion: "",
      medida: "",
      suspensionDias: "",
      usoVoz: "",
      usoVozMotivo: "",
      testigo1: "",
      testigo2: "",
      elaboroNombre: "",
      error: "",
      guardando: false,
    });
  }

  async function guardarActa() {
    if (!actaForm || actaForm.guardando) return;
    const f = actaForm;
    const emp = employees.find((e) => e.id === f.employeeId);
    if (!emp) return setActaForm((s) => ({ ...s, error: "Selecciona al empleado." }));
    if (!f.fecha) return setActaForm((s) => ({ ...s, error: "Falta la fecha de los hechos." }));
    const tipoFinal = f.tipo === "Otro" ? f.tipoOtro.trim() : f.tipo;
    if (!tipoFinal) return setActaForm((s) => ({ ...s, error: "Indica el tipo de infracción." }));
    if (!f.narracion.trim() || f.narracion.trim().length < 10) {
      return setActaForm((s) => ({ ...s, error: "Describe los hechos con un poco más de detalle." }));
    }
    if (!f.medida) return setActaForm((s) => ({ ...s, error: "Selecciona la medida disciplinaria aplicada." }));
    if (f.medida === "Suspensión sin goce de sueldo" && !(Number(f.suspensionDias) > 0)) {
      return setActaForm((s) => ({ ...s, error: "Indica cuántos días de suspensión." }));
    }
    if (!f.usoVoz) {
      return setActaForm((s) => ({ ...s, error: "Indica si el trabajador está de acuerdo o no en el apartado de uso de la voz." }));
    }
    if (f.usoVoz === "no_de_acuerdo" && (!f.usoVozMotivo || f.usoVozMotivo.trim().length < 10)) {
      return setActaForm((s) => ({
        ...s,
        error: "Describe qué manifestó el trabajador respecto de su inconformidad (uso de la voz).",
      }));
    }
    if (!f.elaboroNombre.trim()) return setActaForm((s) => ({ ...s, error: "Indica quién elabora el acta." }));

    setActaForm((s) => ({ ...s, error: "", guardando: true }));

    const nueva = {
      id: uid("acta"),
      folio: nuevoFolioActa(actas),
      employeeId: emp.id,
      employeeName: emp.name,
      employeeNombreCompleto: emp.nombreCompleto || "",
      employeeCurp: emp.curp || "",
      puesto: emp.puesto || "",
      fecha: f.fecha,
      hora: f.hora || "",
      lugar: f.lugar.trim(),
      tipo: tipoFinal,
      narracion: f.narracion.trim(),
      medida: f.medida,
      suspensionDias: f.medida === "Suspensión sin goce de sueldo" ? Number(f.suspensionDias) : null,
      usoVoz: f.usoVoz,
      usoVozMotivo: f.usoVoz === "no_de_acuerdo" ? f.usoVozMotivo.trim() : "",
      testigo1: f.testigo1.trim(),
      testigo2: f.testigo2.trim(),
      elaboroNombre: f.elaboroNombre.trim(),
      creadoEn: new Date().toISOString(),
    };

    const actualizado = [nueva, ...actas];
    let ok = false;
    try {
      ok = await guardarDatoProtegido("actas_administrativas", JSON.stringify(actualizado), verifiedPinRef.current);
    } catch {
      ok = false;
    }
    if (!ok) {
      setActaForm((s) => ({ ...s, guardando: false, error: "No se pudo guardar. Vuelve a desbloquear e intenta otra vez." }));
      return;
    }
    setActas(actualizado);
    setActaForm(null);
    setToast({ color: sage, text: `Acta ${nueva.folio} generada — se guardó en el expediente de ${emp.name}.` });
    setActaPrintView(nueva);
  }

  async function borrarActa(id) {
    const actualizado = actas.filter((a) => a.id !== id);
    let ok = false;
    try {
      ok = await guardarDatoProtegido("actas_administrativas", JSON.stringify(actualizado), verifiedPinRef.current);
    } catch {
      ok = false;
    }
    if (!ok) {
      setToast({ color: paprika, text: "No se pudo borrar. Intenta otra vez." });
      return;
    }
    setActas(actualizado);
    setConfirmDeleteActaId(null);
    setToast({ color: steel, text: "Acta eliminada." });
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

  async function guardarReparto(fechaInicio, fechaFin, monto, reparto, quien, confirmedOverwrite = false) {
    // Guard: evitar doble-click o guardados simultáneos
    if (propinasGuardandoRef.current) {
      setToast({ color: steel, text: "Guardando... espera a que termine." });
      return;
    }

    // VALIDACIÓN CRÍTICA: monto > 0 y hay gente elegible
    const montoNum = Number(monto) || 0;
    if (montoNum <= 0) {
      setToast({ color: paprika, text: "El monto de propinas debe ser mayor a $0." });
      return;
    }
    if (!reparto || reparto.length === 0) {
      setToast({ color: paprika, text: "No hay nadie elegible para propina en este periodo." });
      return;
    }
    // Validar que ningún monto en reparto sea NaN
    if (reparto.some((r) => isNaN(Number(r.monto)))) {
      setToast({ color: paprika, text: "Error: hay montos inválidos en el reparto (NaN). Recalcula." });
      return;
    }

    // Verificar si ya existe un reparto para este rango
    const existente = propinasHistorial.find(
      (p) => (p.fechaInicio || p.fecha) === fechaInicio && (p.fechaFin || p.fecha) === fechaFin
    );

    // Si existe y NO ha sido confirmado, pedir confirmación
    if (existente && !confirmedOverwrite) {
      const rangoLabel =
        fechaInicio === fechaFin
          ? formatDateLabel(fechaInicio, today)
          : `${formatDateLabel(fechaInicio, today)} – ${formatDateLabel(fechaFin, today)}`;
      setPropinasOverwriteConfirm({
        rangoLabel,
        montoAnterior: existente.monto,
        montoNuevo: Number(monto) || 0,
        fechaInicio,
        fechaFin,
        monto,
        reparto,
        quien,
      });
      return;
    }

    // Proceder al guardado
    propinasGuardandoRef.current = true;
    try {
      const nuevo = {
        id: uid("propina"),
        fechaInicio,
        fechaFin,
        monto: Number(monto) || 0,
        reparto,
        quien: quien || "",
        creadoEn: new Date().toISOString(),
        reemplazadoEn: existente ? new Date().toISOString() : undefined, // Audit trail
      };

      const sinEseRango = propinasHistorial.filter(
        (p) => !((p.fechaInicio || p.fecha) === fechaInicio && (p.fechaFin || p.fecha) === fechaFin)
      );
      const actualizado = [nuevo, ...sinEseRango].slice(0, 60); // conserva los últimos 60 repartos

      setPropinasHistorial(actualizado);
      setPropinasOverwriteConfirm(null); // Limpiar confirmación si estaba
      setPropinasMonto("");
      setPropinasQuien("");

      // Intentar sincronizar con Supabase
      await scheduleSync("propinas_historial", JSON.stringify(actualizado));

      const rangoLabel =
        fechaInicio === fechaFin
          ? formatDateLabel(fechaInicio, today)
          : `${formatDateLabel(fechaInicio, today)} – ${formatDateLabel(fechaFin, today)}`;
      setToast({ color: sage, text: `Propinas de ${rangoLabel} guardadas correctamente.` });
    } catch (err) {
      console.error("Error al guardar reparto:", err);
      setToast({ color: paprika, text: "Error al guardar — revisa tu conexión e intenta de nuevo." });
    } finally {
      propinasGuardandoRef.current = false;
    }
  }

  function openPayroll(employeeId) {
    const emp = employees.find((e) => e.id === employeeId);
    if (!emp) return;
    const payroll = emp.payroll || defaultPayroll();
    // payrollRuns está ordenado del más reciente al más viejo (se inserta al frente al
    // generar), así que el primero que coincida con este empleado es su último recibo.
    const ultimoRun = payrollRuns.find((r) => r.employeeId === employeeId);
    const period = nextPeriodDates(payroll.payPeriod, ultimoRun?.periodEnd);
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
      enableHorasExtra: false,
      enableDescuentos: false,
      enableConsumo: false,
      enableLey: false,
      horasExtra: [],
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
  function addHorasExtraItem() {
    setPayrollDraft((d) => ({ ...d, horasExtra: [...(d.horasExtra || []), { horas: "", tarifaHora: "" }] }));
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
      // Seguro Social
      tieneSeguroSocial: payrollDraft.tieneSeguroSocial || false,
      numSeguroSocial: payrollDraft.numSeguroSocial || "",
      rfcSeguroSocial: payrollDraft.rfcSeguroSocial || "",
      afiliadoDesde: payrollDraft.afiliadoDesde || "",
    };
    saveEmployeesList(
      employees.map((e) => (e.id === payrollSelectedEmployeeId ? { ...e, payroll: configToSave } : e))
    );
    setToast({ color: sage, text: "Configuración de pago guardada — incluye datos de seguro social." });
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
    setToast({ color: sage, text: `Datos de ${monthLabel(monthKeyStr)} borrados para todo el restaurante.` });
  }

  // ---------- resto del sistema de PIN (pinConfigured, unlockedSession y verifiedPinRef
  // ya quedaron declarados arriba, junto con el resto de los hooks del componente) ----------
  const [pinModal, setPinModal] = useState(null); // {mode:'setup'|'unlock'|'change', target, value, confirmValue, oldValue, error, busy}

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase.rpc("pin_exists", { p_pin_name: "reloj_access" });
        if (error) throw error;
        setPinConfigured(!!data);
      } catch {
        setPinConfigured(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function requestUnlock(target) {
    if (pinConfigured === undefined) {
      // Todavía no termina de consultar si hay PIN configurado.
      // Si seguimos de largo aquí, la app puede creer que "no hay PIN configurado"
      // y ofrecer crear uno nuevo, sobreescribiendo en silencio la clave real.
      setToast({ color: steel, text: "Un momento, cargando… vuelve a intentar en un segundo." });
      return;
    }
    if (unlockedSession) {
      if (target === "bitacora" || target === "nomina" || target === "actas") setTab(target);
      if (target === "propinas_historial") setShowPropinasHistorial(true);
      if (target === "propinas_config_editar") setShowPropinasConfigEdit(true);
      if (target === "propinas_ajuste_manual") setShowAjusteManual(true);
      if (target === "business_config_editar") setShowBusinessConfigEdit(true);
      return;
    }
    if (!pinConfigured) {
      setPinModal({ mode: "setup", target, value: "", confirmValue: "", error: "" });
    } else {
      setPinModal({ mode: "unlock", target, value: "", error: "" });
    }
  }

  function openChangePin() {
    setPinModal({ mode: "change", target: null, value: "", confirmValue: "", oldValue: "", error: "" });
  }

  function lockNow() {
    setUnlockedSession(false);
    verifiedPinRef.current = "";
    setShowPropinasHistorial(false);
    setShowPropinasConfigEdit(false);
    setShowAjusteManual(false);
    setShowBusinessConfigEdit(false);
    if (tab === "bitacora" || tab === "nomina" || tab === "actas") setTab("checador");
  }

  async function submitPin() {
    if (!pinModal || pinModal.busy) return;
    const digits = pinModal.value.trim();

    if (pinModal.mode === "unlock") {
      setPinModal((m) => ({ ...m, busy: true, error: "" }));
      let ok = false;
      try {
        const { data, error } = await supabase.rpc("verify_app_pin", {
          p_pin_name: "reloj_access",
          p_pin: digits,
        });
        if (error) throw error;
        ok = !!data;
      } catch {
        setPinModal((m) => ({ ...m, busy: false, error: "No se pudo verificar la clave. Revisa tu conexión." }));
        return;
      }
      if (!ok) {
        setPinModal((m) => ({ ...m, busy: false, value: "", error: "Clave incorrecta." }));
        return;
      }
      verifiedPinRef.current = digits;
      setUnlockedSession(true);
      const target = pinModal.target;
      setPinModal(null);
      if (target === "bitacora" || target === "nomina" || target === "actas") setTab(target);
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
    if (pinModal.mode === "change" && pinModal.oldValue.trim().length < 4) {
      setPinModal((m) => ({ ...m, error: "Ingresa tu clave actual." }));
      return;
    }
    setPinModal((m) => ({ ...m, busy: true, error: "" }));
    let ok = false;
    try {
      const { data, error } = await supabase.rpc("set_app_pin", {
        p_pin_name: "reloj_access",
        p_new_pin: digits,
        p_old_pin: pinModal.mode === "change" ? pinModal.oldValue.trim() : null,
      });
      if (error) throw error;
      ok = !!data;
    } catch {
      setPinModal((m) => ({ ...m, busy: false, error: "No se pudo guardar la clave. Revisa tu conexión." }));
      return;
    }
    if (!ok) {
      setPinModal((m) => ({ ...m, busy: false, error: "Tu clave actual no es correcta." }));
      return;
    }
    verifiedPinRef.current = digits;
    setPinConfigured(true);
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
      // FIX crítico: si todavía hay un guardado de "records" pendiente de confirmar
      // (scheduleSync en curso), NO pisamos el estado local con la versión del
      // servidor — de lo contrario un punch recién hecho puede "desaparecer" de
      // pantalla si el poll cae justo antes de que termine de sincronizar.
      if (pendingValuesRef.current["records"] === undefined) {
        const all = r ? JSON.parse(r.value) : {};
        setRecordsByDate(all);
      }
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

  // nombre completo: dato aparte del "name" corto que se usa a diario en Checador/Bitácora —
  // solo se usa en documentos formales (recibo de nómina, actas administrativas).
  function saveNombreCompleto(id, valor) {
    saveEmployeesList(employees.map((e) => (e.id === id ? { ...e, nombreCompleto: valor } : e)));
  }

  // CURP: igual que nombreCompleto, dato aparte para documentos formales (actas administrativas).
  function saveCurp(id, valor) {
    saveEmployeesList(employees.map((e) => (e.id === id ? { ...e, curp: valor } : e)));
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
    // area === undefined -> todavía sin resolver, obliga a pasar por el paso de
    // selección de área (elegir área / actividades mixtas / omitir) antes de continuar.
    // area === null -> se omitió a propósito. area === "<nombre>" -> área elegida.
    const area = type === "entrada" ? undefined : null;
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

  async function confirmPunch() {
    if (!punchModal || !selectedEmployeeId) return;
    // FIX alto: bloquea una segunda ejecución (doble-tap) mientras la primera sigue en curso.
    if (punchInFlightRef.current) return;

    const emp = employees.find((e) => e.id === selectedEmployeeId);
    if (!emp) return;

    const metodo = punchModal.metodo || "foto";
    if (punchModal.type === "entrada") {
      if (metodo === "foto" && !punchModal.photo) return;
      if (metodo === "clave") {
        if (punchModal.claveInput !== emp.checadaClave) {
          // FIX alto: antes esto fallaba en silencio (el botón "no hacía nada").
          // Ahora se muestra el error junto al campo de clave.
          setPunchModal((p) => (p ? { ...p, claveError: "Clave incorrecta. Intenta de nuevo." } : p));
          return;
        }
      }
      if (metodo === "biometrico" && punchModal.bioStatus !== "success") return;
    }

    if (punchModal.type === "entrada" && punchModal.area === undefined) return;

    punchInFlightRef.current = true;
    setPunchModal((p) => (p ? { ...p, saving: true } : p));

    try {
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

      // FIX crítico: lectura fresca de Supabase justo antes de escribir, en vez de
      // partir siempre de `recordsByDate` (que puede estar unos segundos desactualizado).
      // Esto reduce mucho la ventana en la que dos marcajes casi simultáneos (dos
      // dispositivos, o dos personas marcando seguido) se pisan entre sí y uno se pierde.
      let baseRecords = recordsByDate;
      try {
        const fresh = await storageGet("records");
        if (fresh) baseRecords = JSON.parse(fresh.value);
      } catch (err) {
        console.error("No se pudo releer records antes de guardar, se usa el estado local:", err);
      }

      const updatedAll = pruneOldDates({
        ...baseRecords,
        [today]: [...(baseRecords[today] || []), record],
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
    } finally {
      punchInFlightRef.current = false;
    }
  }

  const activeEmployees = employees.filter((e) => e.active);
  const selectedEmployee = employees.find((e) => e.id === selectedEmployeeId) || null;
  const selectedStatus = selectedEmployee ? statusFor(selectedEmployee.id) : null;

  const monthTotal = monthDateKeys.reduce((sum, d) => sum + (recordsByDate[d]?.length || 0), 0);
  const secsAgo = lastUpdated ? Math.max(0, Math.round((Date.now() - lastUpdated.getTime()) / 1000)) : null;

  // ---------- style tokens ----------
  const paprika = "#C1442D";
  const sage = "#5C7A5E";
  const pastelGreen = "#BFE6BA"; // verde pastel para identificar "Dentro" a simple vista
  const pastelGold = "#F2DEA8"; // dorado pastel — "dentro de tolerancia de propina" en Bitácora
  const pastelPaprika = "#F3C6B9"; // rojo pastel — "fuera de tolerancia" en Bitácora
  const ink = "#211F1B";
  const paper = "#F7F3EA";
  const charcoal = "#201E1B";
  const brass = "#D6A24C";
  const steel = "#8A8F86";

  // ---------- recibo de nómina imprimible ----------
  if (payrollPrintView) {
    const { employee: pEmp, draft: pDraft, worked: pWorked, totals: pTotals } = payrollPrintView;
    // recibos generados antes de guardar esta bandera no la tienen — se recalcula con la
    // configuración actual de Propinas como respaldo, igual que hacía antes este cálculo.
    const pPropinaSeSuma =
      payrollPrintView.propinaSeSuma !== undefined
        ? payrollPrintView.propinaSeSuma
        : pDraft.enablePropina && propinasConfig.modoEntrega === "nomina";
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
    const mostrarBono = pDraft.enableBono && pTotals.bono > 0;
    const mostrarPropina = pDraft.enablePropina && pPropinaSeSuma;
    const mostrarVacaciones = pDraft.enableVacaciones && (pDraft.vacacionesFechas || []).length > 0;
    const horasExtraConDatos = (pDraft.horasExtra || []).filter((h) => (Number(h.horas) || 0) > 0);
    const mostrarHorasExtra = pDraft.enableHorasExtra && pTotals.horasExtra > 0;
    // recibos generados antes de guardar este detalle no lo tienen — se recalcula con el
    // horario actual del empleado como respaldo.
    const pVacacionesDetalle =
      payrollPrintView.vacacionesDetalle ||
      (pDraft.vacacionesFechas || []).map((fecha) => ({ fecha, monto: computeVacacionDayPay(pEmp, fecha, pDraft, pWorked) }));
    const mostrarSeguroSocial =
      pDraft.tieneSeguroSocial && (pDraft.numSeguroSocial || pDraft.rfcSeguroSocial || pDraft.afiliadoDesde);
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
              <span style={{ fontWeight: 700 }}>{pEmp.nombreCompleto || pEmp.name}</span>
            </div>
            <div>
              <span style={{ fontSize: "0.56rem", textTransform: "uppercase", letterSpacing: "0.04em", color: "#666", display: "block" }}>
                Puesto
              </span>
              <span style={{ fontWeight: 700 }}>{pEmp.puesto}</span>
            </div>
            <div style={{ marginTop: "0.3rem" }}>
              <span style={{ fontSize: "0.56rem", textTransform: "uppercase", letterSpacing: "0.04em", color: "#666", display: "block" }}>
                {pDraft.rateType === "hora" ? "Pago por hora" : "Salario diario"}
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
              {mostrarPropina && (
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
              {mostrarHorasExtra &&
                horasExtraConDatos.map((h, i) => (
                  <tr key={i}>
                    <td>
                      Horas extra ({Number(h.horas) || 0} hrs × {formatMoney(h.tarifaHora)})
                    </td>
                    <td className="amt">+{formatMoney((Number(h.horas) || 0) * (Number(h.tarifaHora) || 0))}</td>
                  </tr>
                ))}
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
                <strong>{pDraft.rateType === "hora" ? "Tarifa por hora:" : "Salario diario base:"}</strong>{" "}
                {formatMoney(pDraft.rateAmount)}
              </div>
              {pDraft.rateType === "hora" && (
                <p style={{ fontSize: "0.52rem", color: "#666", marginTop: "2px" }}>
                  El monto de cada día de vacaciones se calculó según el horario asignado para ese día de la
                  semana, no la tarifa por hora aplicada a una sola hora.
                </p>
              )}

              <table className="recibo-table">
                <thead>
                  <tr>
                    <th>Día</th>
                    <th>Fecha</th>
                    <th className="amt">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {pVacacionesDetalle.map(({ fecha, monto }) => (
                    <tr key={fecha}>
                      <td>{formatDateLabel(fecha, today)}</td>
                      <td>{fecha}</td>
                      <td className="amt">{formatMoney(monto)}</td>
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

          {/* Sección de Seguro Social — solo aparece si en Nómina se indicó que el empleado
              SÍ cuenta con seguro social y además se capturó al menos un dato (número de
              afiliación, RFC o fecha de afiliación). Si no, no se imprime nada al respecto. */}
          {mostrarSeguroSocial && (
            <div style={{ marginTop: "0.8rem", padding: "0.6rem 0.75rem", backgroundColor: "#f5f5f5", borderRadius: 3, border: "1px solid #ddd" }}>
              <p style={{ fontSize: "0.56rem", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 700, color: "#666", margin: "0 0 0.25rem 0" }}>
                Seguro Social
              </p>
              <div style={{ fontSize: "0.66rem", lineHeight: 1.5 }}>
                <div>
                  <strong>Afiliado:</strong> Sí
                  {pDraft.afiliadoDesde && ` (desde ${pDraft.afiliadoDesde})`}
                </div>
                {pDraft.numSeguroSocial && (
                  <div>
                    <strong>No. de afiliación:</strong> {pDraft.numSeguroSocial}
                  </div>
                )}
                {pDraft.rfcSeguroSocial && (
                  <div>
                    <strong>RFC:</strong> {pDraft.rfcSeguroSocial}
                  </div>
                )}
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

  // ---------- acta administrativa imprimible ----------
  if (actaPrintView) {
    const a = actaPrintView;
    const bizNombreActa = businessConfig.nombre || "Restaurante";

    return (
      <div style={{ background: "#2a2a2a", minHeight: "100vh", fontFamily: "'Helvetica Neue', Arial, sans-serif" }}>
        <style>{`
          @page { size: letter; margin: 0.5in; }
          @media print { .no-print { display: none !important; } .acta-page { box-shadow: none !important; } }
          .acta-page, .acta-page * { box-sizing: border-box; }
          .acta-page { font-family: Georgia, 'Times New Roman', serif; }
          .acta-section-title {
            font-family: 'Helvetica Neue', Arial, sans-serif;
            font-size: 0.62rem; font-weight: 900; text-transform: uppercase; letter-spacing: 0.06em;
            color: #111; margin-top: 0.65rem; padding-bottom: 0.14rem; border-bottom: 1.5px solid #111;
          }
          .acta-field { font-size: 0.76rem; line-height: 1.42; }
          .acta-narracion { font-size: 0.76rem; line-height: 1.42; white-space: pre-wrap; margin-top: 0.25rem; }
          .acta-legend {
            margin-top: 0.7rem; padding: 0.35rem 0.6rem; border: 1px solid #111; border-radius: 2px;
            font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 0.58rem; line-height: 1.35;
            font-style: italic; color: #222; text-align: center;
          }
          .acta-firma { flex: 1; min-width: 160px; text-align: center; }
          .acta-firma-linea { border-top: 1.5px solid #111; padding-top: 3px; font-size: 0.68rem; font-weight: 600; min-height: 0.9rem; }
          .acta-firma-caption {
            font-family: 'Helvetica Neue', Arial, sans-serif;
            font-size: 0.55rem; color: #666; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.03em;
          }
          .acta-firma-voz { margin-top: 0.5rem; display: flex; justify-content: center; }
          .acta-footer {
            font-family: 'Helvetica Neue', Arial, sans-serif;
            text-align: center; margin-top: 0.9rem; padding-top: 0.4rem; border-top: 1px solid #ccc;
            font-size: 0.48rem; color: #888; text-transform: uppercase; letter-spacing: 0.03em; line-height: 1.5;
          }
        `}</style>

        <div
          className="no-print flex items-center justify-between px-4 py-3"
          style={{ borderBottom: `1px solid ${ink}22`, position: "sticky", top: 0, background: paper, maxWidth: 680, margin: "0 auto" }}
        >
          <button onClick={() => setActaPrintView(null)} className="text-sm font-bold" style={{ color: ink }}>
            ← Volver
          </button>
          <div className="text-xs font-bold uppercase" style={{ color: ink + "88" }}>
            Acta administrativa
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
          className="acta-page"
          style={{
            maxWidth: 680,
            margin: "0 auto",
            background: "#fff",
            color: "#111",
            padding: "0.9rem 1.4rem 1rem",
            boxShadow: "0 4px 24px #00000055",
          }}
        >
          <div
            style={{
              fontFamily: "'Helvetica Neue', Arial, sans-serif",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: "1rem",
              borderBottom: "2.5px double #111",
              paddingBottom: "0.4rem",
            }}
          >
            <div style={{ textAlign: "left" }}>
              <div style={{ fontSize: "0.92rem", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.02em" }}>{bizNombreActa}</div>
              {businessConfig.direccion && <div style={{ fontSize: "0.62rem", color: "#666", marginTop: "0.1rem" }}>{businessConfig.direccion}</div>}
            </div>
            <div style={{ textAlign: "center", border: "1px solid #111", borderRadius: "3px", padding: "0.22rem 0.6rem", flexShrink: 0 }}>
              <div style={{ fontSize: "0.52rem", textTransform: "uppercase", color: "#666", letterSpacing: "0.06em" }}>Folio</div>
              <div style={{ fontSize: "0.78rem", fontWeight: 900 }}>{a.folio}</div>
            </div>
          </div>

          <div style={{ textAlign: "center", marginTop: "0.5rem" }}>
            <div
              style={{
                fontFamily: "'Helvetica Neue', Arial, sans-serif",
                fontSize: "0.98rem",
                fontWeight: 900,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Acta Administrativa
            </div>
            <div style={{ fontFamily: "'Helvetica Neue', Arial, sans-serif", fontSize: "0.66rem", color: "#555", marginTop: "0.15rem" }}>
              {formatFechaLargaEs(a.fecha)}
              {a.hora ? ` · ${a.hora} hrs` : ""} · {a.lugar || lugarHechosBase() || bizNombreActa}
            </div>
          </div>

          <div className="acta-section-title">Datos del trabajador</div>
          <div className="acta-field" style={{ marginTop: "0.3rem" }}>
            <strong>Nombre:</strong> {a.employeeNombreCompleto || a.employeeName}
            {a.employeeNombreCompleto && a.employeeNombreCompleto !== a.employeeName ? ` (${a.employeeName})` : ""}
            &nbsp;·&nbsp; <strong>Puesto:</strong> {a.puesto || "—"}
            &nbsp;·&nbsp; <strong>CURP:</strong> {a.employeeCurp || "—"}
          </div>

          <div className="acta-section-title">Tipo de infracción</div>
          <div className="acta-field" style={{ marginTop: "0.3rem" }}>
            {a.tipo}
          </div>

          <div className="acta-section-title">Descripción de los hechos</div>
          <div className="acta-narracion">{a.narracion}</div>

          <div className="acta-section-title">Medida disciplinaria aplicada</div>
          <div className="acta-field" style={{ marginTop: "0.3rem" }}>
            {a.medida}
            {a.medida === "Suspensión sin goce de sueldo" && a.suspensionDias ? ` — ${a.suspensionDias} día(s)` : ""}
          </div>

          <div className="acta-section-title">Uso de la voz del trabajador</div>
          {a.usoVoz === "no_de_acuerdo" ? (
            <>
              <div className="acta-field" style={{ marginTop: "0.25rem" }}>
                El trabajador no está conforme y hace uso de la voz. A continuación se describe lo manifestado
                por el trabajador respecto de su inconformidad:
              </div>
              <div className="acta-narracion">{a.usoVozMotivo}</div>
            </>
          ) : (
            <div className="acta-field" style={{ marginTop: "0.25rem" }}>
              El trabajador hizo uso de la voz y manifestó estar de acuerdo con el contenido de la presente acta.
            </div>
          )}
          <div className="acta-firma-voz">
            <div className="acta-firma" style={{ flex: "0 1 240px" }}>
              <div className="acta-firma-linea">{a.employeeNombreCompleto || a.employeeName}</div>
              <div className="acta-firma-caption">
                {a.usoVoz === "no_de_acuerdo" ? "Firma — uso de la voz (inconformidad manifestada)" : "Firma — uso de la voz (de acuerdo)"}
              </div>
            </div>
          </div>

          <p className="acta-field" style={{ marginTop: "0.7rem", color: "#333" }}>
            El trabajador firma de enterado del contenido de la presente acta. Se levanta la presente para
            dejar constancia y ser integrada a su expediente.
          </p>

          <div className="acta-legend">
            Requisito de validez: leído que fue el presente documento por todas y cada una de las partes en él,
            fue impreso y se firma el día y hora en que se actúa.
          </div>

          <div style={{ marginTop: "0.9rem", display: "flex", justifyContent: "space-between", gap: "1.2rem", flexWrap: "wrap" }}>
            <div className="acta-firma">
              <div className="acta-firma-linea">{a.elaboroNombre}</div>
              <div className="acta-firma-caption">Elaboró</div>
            </div>
            <div className="acta-firma">
              <div className="acta-firma-linea">{a.employeeNombreCompleto || a.employeeName}</div>
              <div className="acta-firma-caption">Firma del trabajador (enterado)</div>
            </div>
          </div>

          {(a.testigo1 || a.testigo2) && (
            <div style={{ marginTop: "0.9rem", display: "flex", justifyContent: "space-between", gap: "1.2rem", flexWrap: "wrap" }}>
              {a.testigo1 && (
                <div className="acta-firma">
                  <div className="acta-firma-linea">{a.testigo1}</div>
                  <div className="acta-firma-caption">Testigo</div>
                </div>
              )}
              {a.testigo2 && (
                <div className="acta-firma">
                  <div className="acta-firma-linea">{a.testigo2}</div>
                  <div className="acta-firma-caption">Testigo</div>
                </div>
              )}
            </div>
          )}

          <div className="acta-footer">
            <div>Formato de uso interno · Generado por Reloj Checador · {bizNombreActa}</div>
            <div style={{ marginTop: "0.12rem" }}>
              Este documento es un registro interno de la empresa. Se sugiere la revisión de un profesional
              (legal/laboral) para su uso formal.
            </div>
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
            onClick={() => {
              setPrintView(null);
              setConfirmPurgeMonth(false);
            }}
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
                  ¿Ya subiste el respaldo a Drive? Esto borra {monthLabel(printView.month)} para TODO el
                  restaurante (todos los dispositivos), no solo este equipo. No se puede deshacer.
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
        capture="environment"
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
            { id: "actas", label: "Actas", icon: unlockedSession ? FileSignature : Lock },
          ].map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            const protectedTabs = ["bitacora", "nomina", "actas"];
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
                  const porNombre = (a, b) => a.name.localeCompare(b.name, "es");

                  // agrupa las áreas que comparten "función" (ej. Cocina Caliente + Cocina
                  // Fría -> "Cocina"); las que no tienen función asignada quedan como su
                  // propio grupo, igual que antes.
                  const funcionesOrden = [];
                  const areasPorFuncion = {};
                  const areasSueltas = [];
                  areasList.forEach((area) => {
                    const funcion = (areaFuncion[area] || "").trim();
                    if (!funcion) {
                      areasSueltas.push(area);
                      return;
                    }
                    if (!areasPorFuncion[funcion]) {
                      areasPorFuncion[funcion] = [];
                      funcionesOrden.push(funcion);
                    }
                    areasPorFuncion[funcion].push(area);
                  });

                  const grupos = [];
                  funcionesOrden.forEach((funcion) => {
                    const areasDeFuncion = areasPorFuncion[funcion];
                    const emps = activeEmployees
                      .filter((e) => (e.areas || []).some((a) => areasDeFuncion.includes(a)))
                      .sort(porNombre);
                    if (emps.length > 0) grupos.push({ area: funcion, emps });
                  });
                  areasSueltas.forEach((area) => {
                    const emps = activeEmployees.filter((e) => (e.areas || []).includes(area)).sort(porNombre);
                    if (emps.length > 0) grupos.push({ area, emps });
                  });

                  const sinArea = activeEmployees.filter((e) => !e.areas || e.areas.length === 0).sort(porNombre);
                  if (sinArea.length > 0) grupos.push({ area: "Sin área asignada", emps: sinArea });

                  return grupos.map(({ area, emps }) => (
                    <div key={area} className="mb-3 last:mb-0">
                      <div className="text-[10px] font-bold mb-1.5" style={{ color: brass }}>
                        {area}
                      </div>
                      <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(9rem, 1fr))" }}>
                        {emps.map((emp) => {
                          const st = statusFor(emp.id);
                          const dentro = st === "dentro";
                          const sel = emp.id === selectedEmployeeId;
                          const fondoClaro = dentro || sel; // texto oscuro cuando el fondo es claro
                          return (
                            <button
                              key={emp.id}
                              onClick={() => setSelectedEmployeeId(emp.id)}
                              className="w-full flex flex-col items-start gap-1 px-3 py-2 rounded-sm"
                              style={{
                                background: dentro ? pastelGreen : sel ? paper : "transparent",
                                border: `2px solid ${sel ? brass : dentro ? sage : steel + "55"}`,
                              }}
                            >
                              <span className="text-xs font-bold" style={{ color: fondoClaro ? ink : paper }}>
                                {emp.name}
                              </span>
                              <span className="text-[10px] font-bold" style={{ color: fondoClaro ? ink + "99" : steel }}>
                                {emp.puesto} · {dentro ? "Dentro" : "Fuera"}
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
                        const cardBg =
                          meta?.color === sage
                            ? pastelGreen
                            : meta?.color === brass
                            ? pastelGold
                            : meta?.color === paprika
                            ? pastelPaprika
                            : paper;
                        return (
                          <div
                            key={r.id}
                            className="flex items-center gap-3 px-3 py-2 rounded-sm"
                            style={{
                              background: cardBg,
                              borderTop: `2px dashed ${ink}22`,
                              borderLeft: meta?.color ? `1px solid ${meta.color}55` : "1px solid transparent",
                              borderRight: meta?.color ? `1px solid ${meta.color}55` : "1px solid transparent",
                              borderBottom: meta?.color ? `1px solid ${meta.color}55` : "1px solid transparent",
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
                  que se agrupa el selector del Checador. Si varias áreas comparten el mismo texto en
                  "Función" (ej. "Cocina"), en el Checador aparecerán juntas bajo ese nombre.
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
                                    Función
                                  </span>
                                  <input
                                    value={areaFuncion[area] ?? ""}
                                    onChange={(e) => setAreaFuncionValue(area, e.target.value)}
                                    disabled={!unlockedSession}
                                    placeholder="ej. Cocina"
                                    className="w-20 px-1.5 py-1 rounded-sm text-[11px] outline-none disabled:opacity-60"
                                    style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                                  />
                                </div>
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
                      value={businessConfigDraft.sucursal}
                      onChange={(e) => setBusinessConfigDraft((c) => ({ ...c, sucursal: e.target.value }))}
                      placeholder="Sucursal (opcional)"
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
                  {showPayrollHistory ? "Historial de recibos" : "Selecciona un empleado"}
                </div>
                <button
                  onClick={lockNow}
                  className="flex items-center gap-1 text-[10px] font-bold uppercase"
                  style={{ color: steel }}
                >
                  <Lock size={11} /> Bloquear
                </button>
              </div>

              <button
                onClick={() => {
                  setShowPayrollHistory((v) => !v);
                  setPayrollHistoryFiltro("");
                  setConfirmDeletePayrollRunId(null);
                }}
                className="flex items-center justify-center gap-1.5 text-xs font-bold uppercase px-4 py-2.5 rounded-sm mb-3"
                style={{ border: `1px solid ${ink}33`, color: ink }}
              >
                <ScrollText size={14} /> {showPayrollHistory ? "Ver empleados" : "Ver historial de recibos"}
              </button>

              {showPayrollHistory ? (
                <>
                  {employees.length > 1 && (
                    <select
                      value={payrollHistoryFiltro}
                      onChange={(e) => setPayrollHistoryFiltro(e.target.value)}
                      className="px-2 py-1.5 rounded-sm text-xs outline-none mb-2"
                      style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                    >
                      <option value="">Todos los empleados</option>
                      {employees
                        .slice()
                        .sort((a, b) => a.name.localeCompare(b.name, "es"))
                        .map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.name}
                          </option>
                        ))}
                    </select>
                  )}

                  {loadingPayrollRuns ? (
                    <div className="flex items-center gap-2 text-sm" style={{ color: steel }}>
                      <Loader2 size={16} className="animate-spin" /> Cargando recibos…
                    </div>
                  ) : (
                    (() => {
                      const lista = payrollHistoryFiltro
                        ? payrollRuns.filter((r) => r.employeeId === payrollHistoryFiltro)
                        : payrollRuns;
                      if (lista.length === 0) {
                        return (
                          <div className="rounded-sm p-4 text-sm" style={{ background: paper, color: ink + "88" }}>
                            {payrollHistoryFiltro
                              ? "Este empleado no tiene recibos generados."
                              : "Aún no se ha generado ningún recibo."}
                          </div>
                        );
                      }
                      return (
                        <div className="flex flex-col gap-2 overflow-y-auto">
                          {lista.map((r) => (
                            <div key={r.id} className="rounded-sm p-3" style={{ background: paper }}>
                              <div className="flex items-start justify-between gap-2">
                                <button onClick={() => reimprimirPayrollRun(r)} className="text-left flex-1 min-w-0">
                                  <div className="text-xs font-bold truncate" style={{ color: ink }}>
                                    {r.employeeName}
                                  </div>
                                  <div className="text-[11px] mt-0.5" style={{ color: ink + "99" }}>
                                    {r.periodStart} a {r.periodEnd}
                                  </div>
                                  <div className="text-[10px] mt-0.5" style={{ color: ink + "77" }}>
                                    Neto {formatMoney(r.totals?.neto)} · generado{" "}
                                    {formatDateLabel(localDateKey(new Date(r.creadoEn)), today)}
                                  </div>
                                </button>
                                {confirmDeletePayrollRunId === r.id ? (
                                  <div className="flex items-center gap-1 flex-shrink-0">
                                    <button
                                      onClick={() => borrarPayrollRun(r.id)}
                                      className="text-[10px] font-bold uppercase px-2 py-1 rounded-sm"
                                      style={{ background: paprika, color: "#fff" }}
                                    >
                                      Sí, borrar
                                    </button>
                                    <button
                                      onClick={() => setConfirmDeletePayrollRunId(null)}
                                      className="text-[10px] font-bold uppercase px-2 py-1 rounded-sm"
                                      style={{ border: `1px solid ${ink}33`, color: ink }}
                                    >
                                      Cancelar
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => setConfirmDeletePayrollRunId(r.id)}
                                    className="flex-shrink-0 p-1"
                                  >
                                    <Trash2 size={14} color={ink + "55"} />
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })()
                  )}
                </>
              ) : (
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
              )}
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
              onAddHorasExtra={addHorasExtraItem}
              onSaveConfig={savePayrollConfig}
              onGenerate={handleGeneratePayroll}
              onSaveNombreCompleto={saveNombreCompleto}
              onSaveCurp={saveCurp}
              colors={{ paprika, sage, ink, paper, brass, steel }}
            />
          )}
        </div>
      )}

      {/* ---------------- ACTAS ADMINISTRATIVAS TAB ---------------- */}
      {tab === "actas" && (
        <div className="flex-1 px-5 py-5 flex flex-col gap-4 overflow-y-auto">
          {actaForm ? (
            <div className="rounded-sm p-4 flex flex-col gap-3" style={{ background: paper }}>
              <div className="text-[11px] font-bold uppercase" style={{ color: ink, letterSpacing: "0.05em" }}>
                Nueva acta administrativa
              </div>

              <div>
                <div className="text-[10px] font-bold uppercase mb-1" style={{ color: steel }}>
                  Empleado
                </div>
                <select
                  value={actaForm.employeeId}
                  onChange={(e) => setActaForm((s) => ({ ...s, employeeId: e.target.value }))}
                  className="w-full px-2 py-1.5 rounded-sm text-xs outline-none"
                  style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                >
                  <option value="">Selecciona…</option>
                  {employees
                    .slice()
                    .sort((a, b) => a.name.localeCompare(b.name, "es"))
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                        {e.nombreCompleto ? ` — ${e.nombreCompleto}` : ""} {e.active ? "" : "(inactivo)"}
                      </option>
                    ))}
                </select>
                {actaForm.employeeId && !employees.find((e) => e.id === actaForm.employeeId)?.nombreCompleto && (
                  <div className="text-[10px] mt-1" style={{ color: steel }}>
                    Este empleado no tiene nombre completo capturado (se usará su nombre corto en el acta). Puedes
                    agregarlo desde Nómina → selecciona al empleado.
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <div className="flex-1">
                  <div className="text-[10px] font-bold uppercase mb-1" style={{ color: steel }}>
                    Fecha de los hechos
                  </div>
                  <input
                    type="date"
                    value={actaForm.fecha}
                    onChange={(e) => setActaForm((s) => ({ ...s, fecha: e.target.value }))}
                    className="w-full px-2 py-1.5 rounded-sm text-xs outline-none"
                    style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                  />
                </div>
                <div className="flex-1">
                  <div className="text-[10px] font-bold uppercase mb-1" style={{ color: steel }}>
                    Hora de los hechos
                  </div>
                  <input
                    type="time"
                    value={actaForm.hora}
                    onChange={(e) => setActaForm((s) => ({ ...s, hora: e.target.value }))}
                    className="w-full px-2 py-1.5 rounded-sm text-xs outline-none"
                    style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                  />
                </div>
              </div>

              <div>
                <div className="text-[10px] font-bold uppercase mb-1" style={{ color: steel }}>
                  Lugar de los hechos
                </div>
                <input
                  value={actaForm.lugar}
                  onChange={(e) => setActaForm((s) => ({ ...s, lugar: e.target.value }))}
                  placeholder="Lugar de los hechos"
                  className="w-full px-2 py-1.5 rounded-sm text-xs outline-none"
                  style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                />
              </div>

              <div>
                <div className="text-[10px] font-bold uppercase mb-1" style={{ color: steel }}>
                  Tipo de infracción
                </div>
                <select
                  value={actaForm.tipo}
                  onChange={(e) => {
                    const nuevoTipo = e.target.value;
                    const sugerido = TEXTOS_PREESTABLECIDOS_ACTA[nuevoTipo];
                    setActaForm((s) => ({
                      ...s,
                      tipo: nuevoTipo,
                      // Solo se autocompleta si el campo sigue vacío, para no pisar texto que Isaac ya escribió.
                      narracion: sugerido && !s.narracion.trim() ? sugerido : s.narracion,
                    }));
                  }}
                  className="w-full px-2 py-1.5 rounded-sm text-xs outline-none"
                  style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                >
                  <option value="">Selecciona…</option>
                  {TIPOS_INFRACCION_ACTA.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                {actaForm.tipo === "Otro" && (
                  <input
                    value={actaForm.tipoOtro}
                    onChange={(e) => setActaForm((s) => ({ ...s, tipoOtro: e.target.value }))}
                    placeholder="Describe el tipo de infracción"
                    className="w-full px-2 py-1.5 rounded-sm text-xs outline-none mt-2"
                    style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                  />
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="text-[10px] font-bold uppercase" style={{ color: steel }}>
                    Descripción de los hechos
                  </div>
                  {TEXTOS_PREESTABLECIDOS_ACTA[actaForm.tipo] && (
                    <button
                      type="button"
                      onClick={() => setActaForm((s) => ({ ...s, narracion: TEXTOS_PREESTABLECIDOS_ACTA[s.tipo] || s.narracion }))}
                      className="text-[9px] font-bold uppercase"
                      style={{ color: sage }}
                    >
                      Usar texto sugerido
                    </button>
                  )}
                </div>
                <textarea
                  value={actaForm.narracion}
                  onChange={(e) => setActaForm((s) => ({ ...s, narracion: e.target.value }))}
                  placeholder="Describe con el mayor detalle posible qué pasó, cuándo y quién estuvo involucrado."
                  rows={5}
                  className="w-full px-2 py-1.5 rounded-sm text-xs outline-none"
                  style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink, resize: "vertical" }}
                />
                {TEXTOS_PREESTABLECIDOS_ACTA[actaForm.tipo] && (
                  <div className="text-[10px] mt-1" style={{ color: steel }}>
                    Se sugirió un texto para este tipo de infracción — puedes editarlo libremente antes de guardar.
                  </div>
                )}
              </div>

              <div>
                <div className="text-[10px] font-bold uppercase mb-1" style={{ color: steel }}>
                  Medida disciplinaria aplicada
                </div>
                <select
                  value={actaForm.medida}
                  onChange={(e) => setActaForm((s) => ({ ...s, medida: e.target.value }))}
                  className="w-full px-2 py-1.5 rounded-sm text-xs outline-none"
                  style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                >
                  <option value="">Selecciona…</option>
                  {MEDIDAS_DISCIPLINARIAS_ACTA.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                {actaForm.medida === "Suspensión sin goce de sueldo" && (
                  <input
                    type="number"
                    min="1"
                    value={actaForm.suspensionDias}
                    onChange={(e) => setActaForm((s) => ({ ...s, suspensionDias: e.target.value }))}
                    placeholder="Número de días"
                    className="w-full px-2 py-1.5 rounded-sm text-xs outline-none mt-2"
                    style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                  />
                )}
              </div>

              <div className="flex gap-2">
                <div className="flex-1">
                  <div className="text-[10px] font-bold uppercase mb-1" style={{ color: steel }}>
                    Testigo 1 (opcional)
                  </div>
                  <input
                    value={actaForm.testigo1}
                    onChange={(e) => setActaForm((s) => ({ ...s, testigo1: e.target.value }))}
                    placeholder="Nombre"
                    className="w-full px-2 py-1.5 rounded-sm text-xs outline-none"
                    style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                  />
                </div>
                <div className="flex-1">
                  <div className="text-[10px] font-bold uppercase mb-1" style={{ color: steel }}>
                    Testigo 2 (opcional)
                  </div>
                  <input
                    value={actaForm.testigo2}
                    onChange={(e) => setActaForm((s) => ({ ...s, testigo2: e.target.value }))}
                    placeholder="Nombre"
                    className="w-full px-2 py-1.5 rounded-sm text-xs outline-none"
                    style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                  />
                </div>
              </div>

              <div>
                <div className="text-[10px] font-bold uppercase mb-1" style={{ color: steel }}>
                  Uso de la voz del trabajador
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setActaForm((s) => ({ ...s, usoVoz: "de_acuerdo", usoVozMotivo: "" }))}
                    className="flex-1 text-xs font-bold uppercase px-3 py-2 rounded-sm"
                    style={
                      actaForm.usoVoz === "de_acuerdo"
                        ? { background: sage, color: paper }
                        : { border: `1px solid ${ink}33`, color: ink, background: "#fff" }
                    }
                  >
                    Estoy de acuerdo
                  </button>
                  <button
                    type="button"
                    onClick={() => setActaForm((s) => ({ ...s, usoVoz: "no_de_acuerdo" }))}
                    className="flex-1 text-xs font-bold uppercase px-3 py-2 rounded-sm"
                    style={
                      actaForm.usoVoz === "no_de_acuerdo"
                        ? { background: paprika, color: "#fff" }
                        : { border: `1px solid ${ink}33`, color: ink, background: "#fff" }
                    }
                  >
                    No estoy de acuerdo
                  </button>
                </div>
                {actaForm.usoVoz === "de_acuerdo" && (
                  <div className="text-[10px] mt-1" style={{ color: steel }}>
                    En el acta quedará asentado que el trabajador hizo uso de la voz y estuvo de acuerdo, con una
                    firma específica para este apartado.
                  </div>
                )}
                {actaForm.usoVoz === "no_de_acuerdo" && (
                  <div className="mt-2">
                    <textarea
                      value={actaForm.usoVozMotivo}
                      onChange={(e) => setActaForm((s) => ({ ...s, usoVozMotivo: e.target.value }))}
                      placeholder="Especifica qué manifestó el trabajador o por qué no está de acuerdo con el contenido del acta."
                      rows={4}
                      className="w-full px-2 py-1.5 rounded-sm text-xs outline-none"
                      style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink, resize: "vertical" }}
                    />
                    <div className="text-[10px] mt-1" style={{ color: steel }}>
                      En el acta quedará asentado que el trabajador no está conforme y hizo uso de la voz, seguido
                      de este texto, con una firma específica para este apartado.
                    </div>
                  </div>
                )}
              </div>

              <div>
                <div className="text-[10px] font-bold uppercase mb-1" style={{ color: steel }}>
                  Elabora el acta
                </div>
                <input
                  value={actaForm.elaboroNombre}
                  onChange={(e) => setActaForm((s) => ({ ...s, elaboroNombre: e.target.value }))}
                  placeholder="Nombre de quién levanta el acta"
                  className="w-full px-2 py-1.5 rounded-sm text-xs outline-none"
                  style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                />
              </div>

              {actaForm.error && (
                <div className="text-xs rounded-sm px-3 py-2" style={{ background: paprika + "22", color: paprika }}>
                  {actaForm.error}
                </div>
              )}

              <div className="flex items-center gap-2 mt-1">
                <button
                  onClick={guardarActa}
                  disabled={actaForm.guardando}
                  className="text-xs font-bold uppercase px-4 py-2 rounded-sm"
                  style={{ background: sage, color: paper, opacity: actaForm.guardando ? 0.6 : 1 }}
                >
                  {actaForm.guardando ? "Guardando…" : "Generar acta"}
                </button>
                <button
                  onClick={() => setActaForm(null)}
                  className="text-xs font-bold uppercase px-4 py-2 rounded-sm"
                  style={{ border: `1px solid ${ink}33`, color: ink }}
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-bold uppercase" style={{ color: steel, letterSpacing: "0.1em" }}>
                  Actas administrativas
                </div>
                <button onClick={lockNow} className="flex items-center gap-1 text-[10px] font-bold uppercase" style={{ color: steel }}>
                  <Lock size={11} /> Bloquear
                </button>
              </div>

              <button
                onClick={() => abrirNuevaActa()}
                className="flex items-center justify-center gap-1.5 text-xs font-bold uppercase px-4 py-2.5 rounded-sm"
                style={{ background: brass, color: ink }}
              >
                <FileSignature size={14} /> Nueva acta
              </button>

              {employees.length > 1 && (
                <select
                  value={actaFiltroEmpleado}
                  onChange={(e) => setActaFiltroEmpleado(e.target.value)}
                  className="px-2 py-1.5 rounded-sm text-xs outline-none"
                  style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                >
                  <option value="">Todos los empleados</option>
                  {employees
                    .slice()
                    .sort((a, b) => a.name.localeCompare(b.name, "es"))
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                </select>
              )}

              {loadingActas ? (
                <div className="flex items-center gap-2 text-sm" style={{ color: steel }}>
                  <Loader2 size={16} className="animate-spin" /> Cargando actas…
                </div>
              ) : (
                (() => {
                  const lista = actaFiltroEmpleado ? actas.filter((a) => a.employeeId === actaFiltroEmpleado) : actas;
                  if (lista.length === 0) {
                    return (
                      <div className="rounded-sm p-4 text-sm" style={{ background: paper, color: ink + "88" }}>
                        {actaFiltroEmpleado ? "Este empleado no tiene actas registradas." : "Aún no se ha generado ninguna acta."}
                      </div>
                    );
                  }
                  return (
                    <div className="flex flex-col gap-2">
                      {lista.map((a) => (
                        <div key={a.id} className="rounded-sm p-3" style={{ background: paper }}>
                          <div className="flex items-start justify-between gap-2">
                            <button onClick={() => setActaPrintView(a)} className="text-left flex-1">
                              <div className="text-xs font-bold" style={{ color: ink }}>
                                {a.employeeName} <span style={{ color: ink + "66", fontWeight: 400 }}>· {a.folio}</span>
                              </div>
                              <div className="text-[11px] mt-0.5" style={{ color: ink + "99" }}>
                                {a.fecha} · {a.tipo}
                              </div>
                              <div className="text-[10px] mt-0.5" style={{ color: ink + "77" }}>
                                {a.medida}
                                {a.suspensionDias ? ` (${a.suspensionDias} día(s))` : ""}
                              </div>
                            </button>
                            {confirmDeleteActaId === a.id ? (
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <button
                                  onClick={() => borrarActa(a.id)}
                                  className="text-[10px] font-bold uppercase px-2 py-1 rounded-sm"
                                  style={{ background: paprika, color: "#fff" }}
                                >
                                  Sí, borrar
                                </button>
                                <button
                                  onClick={() => setConfirmDeleteActaId(null)}
                                  className="text-[10px] font-bold uppercase px-2 py-1 rounded-sm"
                                  style={{ border: `1px solid ${ink}33`, color: ink }}
                                >
                                  Cancelar
                                </button>
                              </div>
                            ) : (
                              <button onClick={() => setConfirmDeleteActaId(a.id)} className="flex-shrink-0 p-1">
                                <Trash2 size={14} color={ink + "55"} />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()
              )}
            </>
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
                            {formatMoneyNoDecimal(p.monto)}
                          </div>
                        </div>
                      ))}
                      {monto > 0 && sobrante > 0 && (
                        <p className="text-[10px] mt-1" style={{ color: ink + "66" }}>
                          Sobrante sin repartir (redondeo hacia abajo): {formatMoneyNoDecimal(sobrante)}
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
                    onClick={() => guardarReparto(propinasPeriodoInicio, fin, monto, lista, propinasQuien, false)}
                    disabled={!propinasQuien.trim() || monto <= 0 || propinasGuardandoRef.current}
                    className="w-full flex items-center justify-center gap-2 py-2.5 mt-2 rounded-sm font-bold text-xs uppercase disabled:opacity-40"
                    style={{ background: brass, color: ink }}
                  >
                    <Coins size={14} /> {propinasGuardandoRef.current ? "Guardando..." : "Guardar reparto"}
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

          {/* MODAL: Confirmación de sobrescritura de propinas */}
          {propinasOverwriteConfirm && (
            <div
              className="fixed inset-0 flex items-end sm:items-center justify-center z-50 p-4"
              style={{ background: "#00000099" }}
            >
              <div className="w-full max-w-sm rounded-sm p-5" style={{ background: paper }}>
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle size={18} color={brass} />
                  <div className="text-sm font-bold" style={{ color: ink }}>
                    Ya existe un reparto guardado
                  </div>
                </div>

                <p className="text-xs mb-4" style={{ color: ink + "88" }}>
                  Período: <strong>{propinasOverwriteConfirm.rangoLabel}</strong>
                </p>

                <div className="bg-yellow-50 border border-yellow-200 rounded-sm p-3 mb-4">
                  <div className="text-[10px] mb-2" style={{ color: ink + "77" }}>
                    Anterior:
                  </div>
                  <div className="text-sm font-bold" style={{ color: paprika }}>
                    {formatMoney(propinasOverwriteConfirm.montoAnterior)}
                  </div>
                </div>

                <div className="bg-sage rounded-sm p-3 mb-4">
                  <div className="text-[10px] mb-2" style={{ color: ink + "77" }}>
                    Nuevo:
                  </div>
                  <div className="text-sm font-bold" style={{ color: sage }}>
                    {formatMoney(propinasOverwriteConfirm.montoNuevo)}
                  </div>
                </div>

                <p className="text-xs mb-4" style={{ color: ink + "88" }}>
                  ¿Reemplazar el reparto anterior? Esta acción no se puede deshacer.
                </p>

                <div className="flex gap-2">
                  <button
                    onClick={() => setPropinasOverwriteConfirm(null)}
                    className="flex-1 py-2.5 rounded-sm font-bold text-xs uppercase"
                    style={{ background: ink + "11", color: ink }}
                  >
                    <X size={14} className="inline mr-1" /> Cancelar
                  </button>
                  <button
                    onClick={() => {
                      if (propinasOverwriteConfirm) {
                        guardarReparto(
                          propinasOverwriteConfirm.fechaInicio,
                          propinasOverwriteConfirm.fechaFin,
                          propinasOverwriteConfirm.monto,
                          propinasOverwriteConfirm.reparto,
                          propinasOverwriteConfirm.quien,
                          true // confirmedOverwrite = true
                        );
                      }
                    }}
                    className="flex-1 py-2.5 rounded-sm font-bold text-xs uppercase"
                    style={{ background: brass, color: ink }}
                  >
                    <Check size={14} className="inline mr-1" /> Reemplazar
                  </button>
                </div>
              </div>
            </div>
          )}

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
              <div>
                <div className="text-[11px] font-bold uppercase" style={{ color: ink, letterSpacing: "0.05em" }}>
                  Bitácora de propinas
                </div>
                <div className="text-[9px]" style={{ color: ink + "66" }}>
                  Solo lectura — edita desde pestaña Propinas
                </div>
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
              <div className="flex flex-col gap-2 mt-2 max-h-96 overflow-y-auto">
                {propinasHistorial.map((p) => {
                  const inicio = p.fechaInicio || p.fecha;
                  const fin = p.fechaFin || p.fecha;
                  const isExpandido = expandidosHistorial.has(p.id);
                  const toggleExpand = () => {
                    const next = new Set(expandidosHistorial);
                    if (next.has(p.id)) next.delete(p.id);
                    else next.add(p.id);
                    setExpandidosHistorial(next);
                  };
                  
                  return (
                    <div key={p.id} className="px-3 py-2 rounded-sm" style={{ background: ink + "06" }}>
                      <div className="flex items-center justify-between" onClick={toggleExpand} style={{ cursor: p.reparto && p.reparto.length > 0 ? "pointer" : "default" }}>
                        <div className="flex-1">
                          <span className="text-xs font-bold" style={{ color: ink }}>
                            {inicio === fin
                              ? formatDateLabel(inicio, today)
                              : `${formatDateLabel(inicio, today)} – ${formatDateLabel(fin, today)}`}
                          </span>
                          <div className="text-[10px]" style={{ color: ink + "77" }}>
                            Registró: {p.quien || "—"} {p.reparto && p.reparto.length > 0 && `(${p.reparto.length} personas)`}
                          </div>
                        </div>
                        <div className="text-right flex items-center gap-2">
                          <span className="text-xs font-bold" style={{ color: sage }}>
                            {formatMoneyNoDecimal(p.monto)}
                          </span>
                          {p.reparto && p.reparto.length > 0 && (
                            <ChevronRight 
                              size={14} 
                              style={{ 
                                color: ink + "77", 
                                transform: isExpandido ? "rotate(90deg)" : "rotate(0deg)",
                                transition: "transform 0.2s"
                              }}
                            />
                          )}
                        </div>
                      </div>
                      
                      {isExpandido && p.reparto && p.reparto.length > 0 && (
                        <div className="mt-2 pt-2 border-t" style={{ borderColor: ink + "22" }}>
                          <div className="flex flex-col gap-1">
                            {p.reparto.map((item, i) => (
                              <div key={i} className="flex items-center justify-between text-[10px]">
                                <span style={{ color: ink }}>{item.employeeName}</span>
                                <div className="flex gap-2 items-center">
                                  <span className="text-[9px]" style={{ color: ink + "66" }}>
                                    {item.diasPropina}/{item.diasTrabajados} días
                                  </span>
                                  <span style={{ color: sage, fontWeight: "bold", minWidth: "60px", textAlign: "right" }}>
                                    {formatMoneyNoDecimal(item.monto)}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---------------- CONFIRMACIÓN GENERAR RECIBO NÓMINA ---------------- */}
      {confirmGeneratePayroll && (
        <div
          className="fixed inset-0 flex items-end sm:items-center justify-center z-50 p-4"
          style={{ background: "#00000099" }}
        >
          <div className="w-full max-w-sm rounded-sm p-5" style={{ background: paper }}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-[11px] font-bold uppercase" style={{ color: ink, letterSpacing: "0.05em" }}>
                Generar recibo de nómina
              </div>
              <button onClick={() => setConfirmGeneratePayroll(null)}>
                <X size={18} color={ink} />
              </button>
            </div>
            <p className="text-xs mb-4" style={{ color: ink + "88" }}>
              ¿Confirmas que deseas generar el recibo para <strong>{confirmGeneratePayroll.employee.name}</strong> del periodo{" "}
              <strong>
                {confirmGeneratePayroll.draft.periodStart} a {confirmGeneratePayroll.draft.periodEnd}
              </strong>
              ?
            </p>
            {confirmGeneratePayroll.duplicado && (
              <div className="rounded-sm px-3 py-2 mb-3" style={{ background: paprika + "22" }}>
                <p className="text-xs" style={{ color: paprika }}>
                  ⚠️ Ya generaste un recibo para <strong>{confirmGeneratePayroll.employee.name}</strong> en este
                  mismo periodo, el{" "}
                  {formatDateLabel(localDateKey(new Date(confirmGeneratePayroll.duplicado.creadoEn)), today)} por{" "}
                  {formatMoney(confirmGeneratePayroll.duplicado.totals?.neto)}. Si continúas, se guardará como un
                  recibo adicional — no reemplaza al anterior.
                </p>
              </div>
            )}
            <p className="text-xs font-bold mb-4" style={{ color: sage }}>
              Neto a pagar: {formatMoney(confirmGeneratePayroll.totals.neto)}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={confirmAndGeneratePayroll}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-sm font-bold text-sm uppercase"
                style={{ background: brass, color: ink }}
              >
                <Check size={15} /> Sí, generar
              </button>
              <button
                onClick={() => setConfirmGeneratePayroll(null)}
                className="flex-1 px-3 py-2.5 rounded-sm font-bold text-sm uppercase"
                style={{ border: `1px solid ${ink}33`, color: ink }}
              >
                Cancelar
              </button>
            </div>
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
              <button onClick={() => setPunchModal(null)} disabled={punchModal.saving} className="disabled:opacity-30">
                <X size={18} color={ink} />
              </button>
            </div>

            <div className="text-sm font-bold mb-1" style={{ color: ink }}>
              {selectedEmployee.name}
            </div>
            <div className="text-xs mb-4" style={{ color: ink + "88" }}>
              {formatTime(new Date().toISOString())} · Hoy
            </div>

            {punchModal.type === "entrada" && punchModal.area === undefined ? (
              <div className="mb-4">
                <p className="text-xs mb-3" style={{ color: ink + "aa" }}>
                  ¿En qué área trabajas hoy?
                </p>
                {areasList.length > 0 && (
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    {areasList.map((area) => (
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
                )}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setPunchModal((p) => ({ ...p, area: "Actividades mixtas" }))}
                    className="py-2.5 rounded-sm text-xs font-bold"
                    style={{ border: `1px solid ${brass}88`, color: ink, background: brass + "14" }}
                  >
                    Actividades mixtas
                  </button>
                  <button
                    onClick={() => setPunchModal((p) => ({ ...p, area: null }))}
                    className="py-2.5 rounded-sm text-xs font-bold"
                    style={{ border: `1px solid ${ink}22`, color: ink + "88" }}
                  >
                    Omitir
                  </button>
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
                {punchModal.type === "entrada" && punchModal.area && (
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
                        setPunchModal((p) => ({
                          ...p,
                          claveInput: e.target.value.replace(/\D/g, "").slice(0, 4),
                          claveError: "",
                        }))
                      }
                      type="password"
                      inputMode="numeric"
                      maxLength={4}
                      placeholder="Clave"
                      className="w-full px-3 py-3 rounded-sm text-lg tracking-[0.3em] text-center outline-none"
                      style={{ border: `1px solid ${punchModal.claveError ? paprika : ink + "33"}`, background: "#fff", color: ink }}
                    />
                    {punchModal.claveError && (
                      <p className="text-xs mt-2 font-bold" style={{ color: paprika }}>
                        {punchModal.claveError}
                      </p>
                    )}
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
                    disabled={punchModal.saving}
                    className="py-2.5 rounded-sm font-bold text-sm uppercase disabled:opacity-40"
                    style={{ border: `1px solid ${ink}33`, color: ink }}
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={confirmPunch}
                    disabled={
                      punchModal.saving ||
                      (punchModal.type === "entrada" &&
                        ((punchModal.metodo === "foto" && !punchModal.photo) ||
                          (punchModal.metodo === "clave" && punchModal.claveInput.length !== 4) ||
                          (punchModal.metodo === "biometrico" && punchModal.bioStatus !== "success")))
                    }
                    className="flex items-center justify-center gap-2 py-2.5 rounded-sm font-bold text-sm uppercase disabled:opacity-40"
                    style={{ background: punchModal.type === "entrada" ? paprika : sage, color: paper }}
                  >
                    {punchModal.saving ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <Check size={15} />
                    )}
                    {punchModal.saving ? "Guardando…" : "Confirmar"}
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
                disabled={pinModal.busy}
                className="w-full px-3 py-3 rounded-sm text-lg tracking-[0.3em] text-center outline-none mb-2"
                style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
              />
            ) : (
              <div className="flex flex-col gap-2 mb-2">
                {pinModal.mode === "change" && (
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={8}
                    value={pinModal.oldValue}
                    onChange={(e) =>
                      setPinModal((m) => ({ ...m, oldValue: e.target.value.replace(/\D/g, ""), error: "" }))
                    }
                    placeholder="Clave actual"
                    disabled={pinModal.busy}
                    className="w-full px-3 py-3 rounded-sm text-lg tracking-[0.3em] text-center outline-none"
                    style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
                  />
                )}
                <input
                  autoFocus={pinModal.mode !== "change"}
                  type="password"
                  inputMode="numeric"
                  maxLength={8}
                  value={pinModal.value}
                  onChange={(e) =>
                    setPinModal((m) => ({ ...m, value: e.target.value.replace(/\D/g, ""), error: "" }))
                  }
                  placeholder="Nueva clave (mín. 4 dígitos)"
                  disabled={pinModal.busy}
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
                  disabled={pinModal.busy}
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
              disabled={pinModal.busy}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-sm font-bold text-sm uppercase mt-2"
              style={{ background: brass, color: ink, opacity: pinModal.busy ? 0.6 : 1 }}
            >
              <LockOpen size={15} />
              {pinModal.busy
                ? "Verificando…"
                : pinModal.mode === "unlock"
                ? "Desbloquear"
                : "Guardar clave"}
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
