import * as photoshop from "./photoshop";
import * as uxp from "./uxp";

export type API = typeof photoshop & typeof uxp;
export const api: API = { ...uxp, ...photoshop };
