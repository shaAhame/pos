import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "react-toastify/dist/ReactToastify.css";
import "./styles.css";
import App from "./App";

const printRoot = document.createElement("div");
printRoot.id = "print-root";
document.body.appendChild(printRoot);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
