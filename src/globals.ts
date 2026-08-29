if (typeof require === "undefined") {
  // @ts-ignore UXP supplies require at runtime; this keeps browser bundling safe.
  window.require = () => ({});
}

export const uxp = require("uxp") as any;
export const photoshop = require("photoshop") as any;
