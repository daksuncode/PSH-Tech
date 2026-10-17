import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "maplibre-gl/dist/maplibre-gl.css";
import "./index.css";
import PshExplorer from "./components/PshExplorer";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PshExplorer />
  </StrictMode>,
);
