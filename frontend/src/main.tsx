import { captureResetToken } from "./auth/resetToken";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import App from "./App";
import { AuthProvider } from "./auth/AuthProvider";
import { FavoritesProvider } from "./favorites/FavoritesProvider";
import { serviceWorker } from "./pwa/serviceWorker";
import "./styles/global.css";

// First statement to run: take a password-reset token out of the URL before
// React initializes, renders, or sends any request (M03-T03 Increment 5).
captureResetToken();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <FavoritesProvider>
          <App />
        </FavoritesProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);

// M06-T02 Increment 2: application-shell service worker (production builds in
// secure contexts only; never blocks or reloads the application).
serviceWorker.register();
