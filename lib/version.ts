/** Single source of truth for the version string. Reads from package.json. */
import pkg from "../package.json";
export const VERSION: string = pkg.version;
