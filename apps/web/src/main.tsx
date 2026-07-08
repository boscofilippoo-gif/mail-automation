import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import "@/index.css";
import { App } from "@/App";
import { Login } from "@/pages/Login";
import { Dashboard } from "@/pages/Dashboard";
import { Keywords } from "@/pages/Keywords";
import { Settings } from "@/pages/Settings";
import { Listino } from "@/pages/Listino";
import { EditDocument } from "@/pages/EditDocument";
import { PrivacyApp } from "@/pages/legal/Privacy";
import { TerminiApp } from "@/pages/legal/Termini";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        {/* pagine legali: pubbliche, fuori dal layout autenticato */}
        <Route path="/privacy" element={<PrivacyApp />} />
        <Route path="/termini" element={<TerminiApp />} />
        <Route element={<App />}>
          <Route index element={<Login />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="keywords" element={<Keywords />} />
          <Route path="settings" element={<Settings />} />
          <Route path="listino" element={<Listino />} />
          <Route path="documents/:id/edit" element={<EditDocument />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
