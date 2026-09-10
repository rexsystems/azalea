import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { PopoutTerminal } from "./components/PopoutTerminal";
import { IconPackProvider } from "./components/IconPackProvider";
import { applyIconPack, getStoredIconPack } from "./lib/iconPack";
import { applyTheme, getStoredTheme } from "./lib/theme";
import "./styles/globals.css";

const initialTheme = getStoredTheme();
applyTheme(initialTheme);
applyIconPack(getStoredIconPack());

// Block WebKit/WebView native context menus app-wide. Custom Azalea menus still
// open via React handlers; this only suppresses the browser default menu.
document.addEventListener(
  "contextmenu",
  (event) => {
    event.preventDefault();
  },
  true,
);

const params = new URLSearchParams(window.location.search);
const popoutSessionId = params.get("popout");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <IconPackProvider>
      {popoutSessionId ? (
        <PopoutTerminal
          sessionId={popoutSessionId}
          title={params.get("title") ?? "Terminal"}
        />
      ) : (
        <App />
      )}
    </IconPackProvider>
  </React.StrictMode>,
);
