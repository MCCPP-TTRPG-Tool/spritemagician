/**
 * Shim for `$env/dynamic/private`.
 * Values come from the in-app Settings screen (settings.json) first,
 * then from the process environment.
 */
export { env } from './settings.js';
