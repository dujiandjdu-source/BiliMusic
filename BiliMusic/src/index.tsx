import "./index.css";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import MiniPlayer from "./components/MiniPlayer";
import DesktopLyrics from './components/DesktopLyrics';
import { ToastProvider } from "./components/Toast";
import { I18nProvider } from "./hooks/useI18n";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <I18nProvider>
      <ToastProvider>
        {new URLSearchParams(window.location.search).get('panel') === 'mini' ? <MiniPlayer /> :
          new URLSearchParams(window.location.search).get('panel') === 'lyrics' ? <DesktopLyrics /> : <App />}
      </ToastProvider>
    </I18nProvider>
  </React.StrictMode>,
);
