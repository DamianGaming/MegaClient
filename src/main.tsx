import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
// UI polish + seasonal backgrounds/particles
import "./ui/styles.css";
import App from "./ui/App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
