import React, { useEffect } from "react";
import { webviewInitHost } from "./webview-setup-host";

export const App = () => {
  useEffect(() => {
    void webviewInitHost({ multi: false });
  }, []);
  return null;
};
