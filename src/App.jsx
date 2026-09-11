import React from "react";
import RelojChecador from "./RelojChecador.jsx";
import SuperAdmin from "./SuperAdmin.jsx";

export default function App() {
  // La pantalla de Súper Admin (alta de clientes) vive aparte del Checador
  // normal y no aparece en ningún menú — se abre agregando ?admin=1 al final
  // del link de la app, y además pide su propia clave.
  const esAdmin = new URLSearchParams(window.location.search).get("admin") === "1";
  return esAdmin ? <SuperAdmin /> : <RelojChecador />;
}
