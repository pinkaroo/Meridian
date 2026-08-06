import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Keep diagnostics non-blocking. Browser ResizeObserver notifications and other
// development warnings must not interrupt the app with modal alert dialogs.
window.addEventListener("error", (e) => console.error("Meridian error", e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => console.error("Meridian unhandled rejection", e.reason));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>
);
