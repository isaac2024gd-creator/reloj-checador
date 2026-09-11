import React, { useState, useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import {
  Lock,
  LockOpen,
  Plus,
  Building2,
  AlertTriangle,
  Loader2,
  Check,
  X,
  ArrowLeft,
} from "lucide-react";

/* ============================================================
   SÚPER ADMIN — Alta de clientes (Reloj Checador)
   ------------------------------------------------------------
   Pantalla separada del Reloj Checador normal: aquí Isaac (único
   Súper Admin) da de alta cada negocio nuevo, según el flujo
   decidido en "alta-clientes-y-roles.md" (paso 2 de 5: se crea
   la cuenta/tenant). Se llega escribiendo ?admin=1 al final del
   link de la app — no aparece en ningún menú visible.

   IMPORTANTE (léase antes de usar con clientes reales): esta
   pantalla solo guarda el directorio de negocios (nombre, plan,
   contacto). El Checador/Bitácora/Nómina/etc. de la app todavía
   NO separan datos por negocio — hoy toda la app comparte una
   sola base. No des de alta clientes reales todavía; primero hay
   que construir la separación real de datos (siguiente fase).
   ============================================================ */

const SUPABASE_URL = "https://wcyistsgpzzqflezyput.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_7BqQa6MCxW8qfyAuCgOQVg_HTnSuu9X";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const paprika = "#C1442D";
const sage = "#5C7A5E";
const ink = "#211F1B";
const paper = "#F7F3EA";
const brass = "#D6A24C";
const steel = "#8A8F86";

const PLANES = {
  basico: { nombre: "Básico", precio: 399, limite_empleados: 10, limite_sucursales: 1 },
  profesional: { nombre: "Profesional", precio: 799, limite_empleados: 25, limite_sucursales: 2 },
  multi_sucursal: { nombre: "Multi-sucursal", precio: 1799, limite_empleados: null, limite_sucursales: null },
};

function money(n) {
  return `$${Number(n).toLocaleString("es-MX")} MXN/mes`;
}

// Link privado del negocio: la misma app, apuntando a sus propios datos.
function linkNegocio(token) {
  return `${window.location.origin}${window.location.pathname}?negocio=${token}`;
}

async function copiarLink(token, onDone) {
  const link = linkNegocio(token);
  try {
    await navigator.clipboard.writeText(link);
    onDone && onDone(true);
  } catch {
    onDone && onDone(false, link);
  }
}

export default function SuperAdmin() {
  // ---------- acceso con PIN propio (independiente del PIN del restaurante) ----------
  const [pinConfigured, setPinConfigured] = useState(undefined);
  const [unlocked, setUnlocked] = useState(false);
  const pinRef = useRef("");
  const [pinModal, setPinModal] = useState({ mode: "unlock", value: "", confirmValue: "", error: "", busy: false });

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase.rpc("pin_exists", { p_pin_name: "super_admin_access" });
        if (error) throw error;
        setPinConfigured(!!data);
        setPinModal((m) => ({ ...m, mode: data ? "unlock" : "setup" }));
      } catch {
        setPinConfigured(false);
        setPinModal((m) => ({ ...m, mode: "setup" }));
      }
    })();
  }, []);

  async function submitPin() {
    if (pinModal.busy) return;
    const digits = pinModal.value.trim();

    if (pinModal.mode === "unlock") {
      setPinModal((m) => ({ ...m, busy: true, error: "" }));
      let ok = false;
      try {
        const { data, error } = await supabase.rpc("verify_app_pin", {
          p_pin_name: "super_admin_access",
          p_pin: digits,
        });
        if (error) throw error;
        ok = !!data;
      } catch {
        setPinModal((m) => ({ ...m, busy: false, error: "No se pudo verificar. Revisa tu conexión." }));
        return;
      }
      if (!ok) {
        setPinModal((m) => ({ ...m, busy: false, value: "", error: "Clave incorrecta." }));
        return;
      }
      pinRef.current = digits;
      modulePin.current = digits;
      setUnlocked(true);
      return;
    }

    // setup (primera vez)
    if (digits.length < 6) {
      setPinModal((m) => ({ ...m, error: "Usa al menos 6 dígitos — esta clave protege datos de todos tus clientes." }));
      return;
    }
    if (digits !== pinModal.confirmValue.trim()) {
      setPinModal((m) => ({ ...m, error: "Las claves no coinciden." }));
      return;
    }
    setPinModal((m) => ({ ...m, busy: true, error: "" }));
    try {
      const { data, error } = await supabase.rpc("set_app_pin", {
        p_pin_name: "super_admin_access",
        p_new_pin: digits,
        p_old_pin: null,
      });
      if (error) throw error;
      if (!data) {
        setPinModal((m) => ({ ...m, busy: false, error: "No se pudo guardar la clave." }));
        return;
      }
    } catch {
      setPinModal((m) => ({ ...m, busy: false, error: "No se pudo guardar la clave. Revisa tu conexión." }));
      return;
    }
    pinRef.current = digits;
    modulePin.current = digits;
    setPinConfigured(true);
    setUnlocked(true);
  }

  if (!unlocked) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center p-4" style={{ background: "#2a2a2a" }}>
        <div className="w-full max-w-sm rounded-sm p-6" style={{ background: paper }}>
          <div className="flex items-center gap-2 mb-1">
            <Lock size={16} color={brass} />
            <div className="text-xs font-bold uppercase" style={{ color: ink, letterSpacing: "0.06em" }}>
              Súper Admin — Reloj Checador
            </div>
          </div>
          <p className="text-xs mb-4" style={{ color: ink + "88" }}>
            {pinConfigured === undefined
              ? "Cargando…"
              : pinModal.mode === "setup"
              ? "Primera vez aquí: crea la clave de Súper Admin (solo tú la debes conocer)."
              : "Escribe tu clave de Súper Admin para continuar."}
          </p>

          <div className="flex flex-col gap-2 mb-3">
            <input
              type="password"
              inputMode="numeric"
              maxLength={12}
              value={pinModal.value}
              onChange={(e) => setPinModal((m) => ({ ...m, value: e.target.value.replace(/\D/g, ""), error: "" }))}
              onKeyDown={(e) => e.key === "Enter" && pinModal.mode === "unlock" && submitPin()}
              placeholder={pinModal.mode === "setup" ? "Nueva clave (mín. 6 dígitos)" : "Clave de Súper Admin"}
              disabled={pinModal.busy || pinConfigured === undefined}
              autoFocus
              className="w-full px-3 py-3 rounded-sm text-lg tracking-[0.3em] text-center outline-none"
              style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
            />
            {pinModal.mode === "setup" && (
              <input
                type="password"
                inputMode="numeric"
                maxLength={12}
                value={pinModal.confirmValue}
                onChange={(e) => setPinModal((m) => ({ ...m, confirmValue: e.target.value.replace(/\D/g, ""), error: "" }))}
                onKeyDown={(e) => e.key === "Enter" && submitPin()}
                placeholder="Confirmar clave"
                disabled={pinModal.busy}
                className="w-full px-3 py-3 rounded-sm text-lg tracking-[0.3em] text-center outline-none"
                style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
              />
            )}
          </div>

          {pinModal.error && (
            <p className="text-xs mb-2" style={{ color: paprika }}>
              {pinModal.error}
            </p>
          )}

          <button
            onClick={submitPin}
            disabled={pinModal.busy || pinConfigured === undefined}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-sm font-bold text-sm uppercase mt-1"
            style={{ background: brass, color: ink, opacity: pinModal.busy ? 0.6 : 1 }}
          >
            <LockOpen size={15} />
            {pinModal.busy ? "Verificando…" : pinModal.mode === "unlock" ? "Entrar" : "Guardar clave"}
          </button>

          <a href="./" className="flex items-center gap-1 justify-center mt-4 text-xs" style={{ color: steel }}>
            <ArrowLeft size={12} /> Volver al Reloj Checador
          </a>
        </div>
      </div>
    );
  }

  return <PanelClientes />;
}

function PanelClientes() {
  const [clientes, setClientes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [toast, setToast] = useState(null);

  // La clave verificada vive en memoria en el componente padre (SuperAdmin);
  // para mantener este archivo simple sin pasar props por varias capas, cada
  // acción protegida vuelve a pedirla una sola vez por sesión vía closure.
  // Aquí la recuperamos del sessionStorage en memoria del módulo (no persiste
  // en disco ni entre pestañas).
  const pin = modulePin.current;

  const loadClientes = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("listar_clientes_reloj", { p_pin: pin });
      if (error) throw error;
      setClientes(data || []);
    } catch {
      setToast({ error: true, text: "No se pudo cargar la lista de clientes." });
    }
    setLoading(false);
  };

  useEffect(() => {
    loadClientes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <div className="min-h-screen w-full" style={{ background: "#2a2a2a" }}>
      <div className="max-w-2xl mx-auto p-4 sm:p-6">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Building2 size={18} color={brass} />
            <h1 className="text-sm font-bold uppercase" style={{ color: paper, letterSpacing: "0.06em" }}>
              Clientes — Reloj Checador
            </h1>
          </div>
          <a href="./" className="flex items-center gap-1 text-xs" style={{ color: steel }}>
            <ArrowLeft size={12} /> Salir
          </a>
        </div>

        <div
          className="flex items-start gap-2 rounded-sm p-3 mb-4 text-xs"
          style={{ background: "#F2DEA822", border: `1px solid ${brass}55`, color: paper }}
        >
          <AlertTriangle size={14} color={brass} className="flex-shrink-0 mt-0.5" />
          <span>
            Los datos de cada negocio ya están separados (cada uno con su propio link privado, abajo).
            <b> Todavía falta:</b> la pantalla para que el dueño agregue a su equipo con rol, y automatizar
            el envío del correo de invitación (por ahora se lo mandas tú a mano).
          </span>
        </div>

        <button
          onClick={() => setShowForm((v) => !v)}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-sm font-bold text-sm uppercase mb-4"
          style={{ background: sage, color: paper }}
        >
          <Plus size={16} />
          {showForm ? "Cerrar formulario" : "Agregar cliente"}
        </button>

        {showForm && (
          <FormularioCliente
            pin={pin}
            onCreated={() => { setShowForm(false); loadClientes(); setToast({ text: "Cliente creado." }); }}
            onError={(msg) => setToast({ error: true, text: msg })}
            onToast={(text) => setToast({ text })}
          />
        )}

        <div className="rounded-sm p-4" style={{ background: paper }}>
          <div className="text-xs font-bold uppercase mb-3" style={{ color: ink, letterSpacing: "0.06em" }}>
            {loading ? "Cargando…" : `${clientes.length} cliente${clientes.length === 1 ? "" : "s"}`}
          </div>
          {!loading && clientes.length === 0 && (
            <p className="text-xs" style={{ color: ink + "88" }}>Todavía no hay clientes dados de alta.</p>
          )}
          <div className="flex flex-col gap-2">
            {clientes.map((c) => (
              <div key={c.id} className="rounded-sm p-3" style={{ border: `1px solid ${ink}22` }}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-bold" style={{ color: ink }}>{c.nombre_negocio}</div>
                    <div className="text-xs" style={{ color: ink + "88" }}>
                      {PLANES[c.plan]?.nombre || c.plan} · {money(c.precio_mensual)}
                      {c.nombre_dueno ? ` · ${c.nombre_dueno}` : ""}
                      {c.email_dueno ? ` · ${c.email_dueno}` : ""}
                    </div>
                  </div>
                  <span
                    className="text-xs font-bold uppercase px-2 py-1 rounded-sm flex-shrink-0"
                    style={{
                      color: c.estado === "activo" ? sage : paprika,
                      border: `1px solid ${c.estado === "activo" ? sage : paprika}55`,
                    }}
                  >
                    {c.estado}
                  </span>
                </div>
                <button
                  onClick={() =>
                    copiarLink(c.acceso_token, (ok, link) =>
                      setToast(ok ? { text: "Link copiado." } : { error: true, text: `Copia a mano: ${link}` })
                    )
                  }
                  className="text-xs font-bold uppercase mt-2"
                  style={{ color: sage }}
                >
                  Copiar link privado
                </button>
              </div>
            ))}
          </div>
        </div>

        {toast && (
          <div
            className="fixed bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-sm text-xs font-bold"
            style={{ background: toast.error ? paprika : sage, color: paper }}
          >
            {toast.text}
          </div>
        )}
      </div>
    </div>
  );
}

function FormularioCliente({ pin, onCreated, onError, onToast }) {
  const [nombreNegocio, setNombreNegocio] = useState("");
  const [plan, setPlan] = useState("basico");
  const [nombreDueno, setNombreDueno] = useState("");
  const [emailDueno, setEmailDueno] = useState("");
  const [telefonoDueno, setTelefonoDueno] = useState("");
  const [busy, setBusy] = useState(false);
  const [resumen, setResumen] = useState(null);

  const info = PLANES[plan];

  async function crear() {
    if (!nombreNegocio.trim()) {
      onError("Falta el nombre del negocio.");
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("crear_cliente_reloj", {
        p_pin: pin,
        p_nombre_negocio: nombreNegocio.trim(),
        p_plan: plan,
        p_precio_mensual: info.precio,
        p_limite_empleados: info.limite_empleados,
        p_limite_sucursales: info.limite_sucursales,
        p_nombre_dueno: nombreDueno.trim() || null,
        p_email_dueno: emailDueno.trim() || null,
        p_telefono_dueno: telefonoDueno.trim() || null,
      });
      if (error) throw error;
      setResumen(data);
    } catch (e) {
      onError("No se pudo crear el cliente. " + (e?.message?.includes("falta") ? "Falta el nombre del negocio." : ""));
    }
    setBusy(false);
  }

  if (resumen) {
    return (
      <div className="rounded-sm p-4 mb-4" style={{ background: paper }}>
        <div className="flex items-center gap-2 mb-2">
          <Check size={16} color={sage} />
          <div className="text-xs font-bold uppercase" style={{ color: ink }}>Cliente creado</div>
        </div>
        <p className="text-xs mb-3" style={{ color: ink + "99" }}>
          Todavía falta enviarle la invitación al dueño — por ahora hazlo tú manualmente (correo o WhatsApp)
          con estos datos:
        </p>
        <div className="text-xs rounded-sm p-3 mb-3" style={{ background: "#fff", border: `1px solid ${ink}22`, color: ink }}>
          <div><b>Negocio:</b> {resumen.nombre_negocio}</div>
          <div><b>Plan:</b> {PLANES[resumen.plan]?.nombre} — {money(resumen.precio_mensual)}</div>
          {resumen.nombre_dueno && <div><b>Dueño:</b> {resumen.nombre_dueno}</div>}
          {resumen.email_dueno && <div><b>Correo:</b> {resumen.email_dueno}</div>}
          {resumen.telefono_dueno && <div><b>Teléfono:</b> {resumen.telefono_dueno}</div>}
        </div>

        <p className="text-xs mb-2" style={{ color: ink + "99" }}>
          Su link privado (mándaselo junto con lo de arriba — con él configura su propia clave la primera vez):
        </p>
        <div className="text-xs rounded-sm p-3 mb-3 break-all" style={{ background: "#fff", border: `1px solid ${ink}22`, color: ink }}>
          {linkNegocio(resumen.acceso_token)}
        </div>
        <button
          onClick={() =>
            copiarLink(resumen.acceso_token, (ok, link) =>
              ok ? onToast("Link copiado.") : onError(`Copia a mano: ${link}`)
            )
          }
          className="w-full py-2.5 rounded-sm font-bold text-sm uppercase mb-2"
          style={{ background: sage, color: paper }}
        >
          Copiar link privado
        </button>
        <button
          onClick={onCreated}
          className="w-full py-2.5 rounded-sm font-bold text-sm uppercase"
          style={{ background: brass, color: ink }}
        >
          Listo
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-sm p-4 mb-4" style={{ background: paper }}>
      <div className="text-xs font-bold uppercase mb-3" style={{ color: ink, letterSpacing: "0.06em" }}>
        Datos del negocio nuevo
      </div>

      <label className="text-xs font-bold block mb-1" style={{ color: ink + "99" }}>Nombre del negocio</label>
      <input
        value={nombreNegocio}
        onChange={(e) => setNombreNegocio(e.target.value)}
        placeholder="Ej. Restaurante El Faro"
        className="w-full px-3 py-2 rounded-sm text-sm outline-none mb-3"
        style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
      />

      <label className="text-xs font-bold block mb-1" style={{ color: ink + "99" }}>Plan</label>
      <div className="flex flex-col gap-2 mb-3">
        {Object.entries(PLANES).map(([key, p]) => (
          <button
            key={key}
            onClick={() => setPlan(key)}
            className="flex items-center justify-between px-3 py-2 rounded-sm text-left"
            style={{
              border: `1px solid ${plan === key ? sage : ink + "33"}`,
              background: plan === key ? sage + "18" : "#fff",
            }}
          >
            <span className="text-sm font-bold" style={{ color: ink }}>{p.nombre}</span>
            <span className="text-xs" style={{ color: ink + "88" }}>
              {money(p.precio)} · {p.limite_empleados ? `hasta ${p.limite_empleados} empleados` : "sin límite de empleados"}
              {p.limite_sucursales ? ` · hasta ${p.limite_sucursales} sucursal${p.limite_sucursales > 1 ? "es" : ""}` : " · sin límite de sucursales"}
            </span>
          </button>
        ))}
      </div>

      <label className="text-xs font-bold block mb-1" style={{ color: ink + "99" }}>Nombre del dueño (opcional)</label>
      <input
        value={nombreDueno}
        onChange={(e) => setNombreDueno(e.target.value)}
        className="w-full px-3 py-2 rounded-sm text-sm outline-none mb-3"
        style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
      />

      <label className="text-xs font-bold block mb-1" style={{ color: ink + "99" }}>Correo del dueño (opcional)</label>
      <input
        value={emailDueno}
        onChange={(e) => setEmailDueno(e.target.value)}
        type="email"
        className="w-full px-3 py-2 rounded-sm text-sm outline-none mb-3"
        style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
      />

      <label className="text-xs font-bold block mb-1" style={{ color: ink + "99" }}>Teléfono del dueño (opcional)</label>
      <input
        value={telefonoDueno}
        onChange={(e) => setTelefonoDueno(e.target.value)}
        className="w-full px-3 py-2 rounded-sm text-sm outline-none mb-4"
        style={{ border: `1px solid ${ink}33`, background: "#fff", color: ink }}
      />

      <div className="text-xs rounded-sm p-3 mb-4" style={{ background: "#fff", border: `1px solid ${ink}22`, color: ink + "aa" }}>
        Resumen: <b>{nombreNegocio || "(nombre del negocio)"}</b> — plan <b>{info.nombre}</b>, {money(info.precio)}.
      </div>

      <button
        onClick={crear}
        disabled={busy}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-sm font-bold text-sm uppercase"
        style={{ background: brass, color: ink, opacity: busy ? 0.6 : 1 }}
      >
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
        {busy ? "Creando…" : "Crear cuenta cliente"}
      </button>
    </div>
  );
}

// El PIN verificado vive aquí, en memoria del módulo (no en localStorage ni
// en disco) — se llena al desbloquear y se usa en cada llamada protegida.
const modulePin = { current: "" };
