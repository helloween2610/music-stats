// ZaUI stylesheet
import "zmp-ui/zaui.css";
// Tailwind stylesheet
import "@/css/tailwind.scss";
// Your stylesheet
import "@/css/app.scss";

// React core
import React from "react";
import { createRoot } from "react-dom/client";

// Mount the app
import Layout from "@/components/layout";
import { IOS_APP } from "@/config";

// Expose app configuration
import appConfig from "../app-config.json";

if (!window.APP_CONFIG) {
  window.APP_CONFIG = appConfig as any;
}
function lockIOSViewportZoom() {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "viewport";
    document.head.appendChild(meta);
  }
  meta.content = "width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover";
  document.addEventListener("gesturestart", event => event.preventDefault(), { passive: false } as AddEventListenerOptions);
  document.addEventListener("gesturechange", event => event.preventDefault(), { passive: false } as AddEventListenerOptions);
  document.addEventListener("touchmove", event => {
    if (event.touches.length > 1) event.preventDefault();
  }, { passive: false });
}
if (IOS_APP) {
  document.body.classList.add("ios-app");
  lockIOSViewportZoom();
}

const root = createRoot(document.getElementById("app")!);
root.render(React.createElement(Layout));
