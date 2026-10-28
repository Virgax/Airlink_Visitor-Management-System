/** Cookie names shared by middleware (edge) and server code. Keep this file dependency-free. */
export const SESSION_COOKIE = "visitas_session";
export const SITE_COOKIE = "visitas_site";
export const DEVICE_COOKIE = "visitas_device";
/** "browser" when the kiosk's gate prints through Zebra Browser Print (middleware widens connect-src). */
export const PRINT_COOKIE = "visitas_print";
