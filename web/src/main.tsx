import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import HomeownerPage from "./HomeownerPage";
import "./style.css";

const homeowner = /^\/homeowner\/?$/.test(window.location.pathname);
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {homeowner ? <HomeownerPage /> : <App />}
  </React.StrictMode>,
);
