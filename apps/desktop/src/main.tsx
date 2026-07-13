import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { PopoutTerminal } from "./components/PopoutTerminal";
import { applyTheme, getStoredTheme } from "./lib/theme";
import "./styles/globals.css";

applyTheme(getStoredTheme());

const params = new URLSearchParams(window.location.search);
const popoutSessionId = params.get("popout");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {popoutSessionId ? (
      <PopoutTerminal
        sessionId={popoutSessionId}
        title={params.get("title") ?? "Terminal"}
      />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
