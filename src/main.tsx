import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./styles.css";

try { registerSW({ immediate: true }); } catch { /* sin service worker (vista previa) */ }
navigator.storage?.persist?.(); // pide que el navegador no borre los datos guardados

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
