"use client";

import { useEffect } from "react";

export function RegisterSw() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/scan" }).catch(() => {
        /* offline queue still works without the worker; only offline page loads are lost */
      });
    }
  }, []);
  return null;
}
