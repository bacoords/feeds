/**
 * Main entry point for the Feeds React App
 */
import { createRoot } from "@wordpress/element";
import App from "./App";
import "./index.scss";

// Render the app when DOM is ready.
const rootElement = document.getElementById("feeds-app");

if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<App />);
}
