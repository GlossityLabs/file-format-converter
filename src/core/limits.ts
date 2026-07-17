export const MAX_QUEUE_FILES = 20;
export const MAX_QUEUE_BYTES = 1024 * 1024 * 1024;
export const MAX_BROWSER_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_COMPANION_MEDIA_BYTES = 500 * 1024 * 1024;

export const QUEUE_LIMITS = Object.freeze({
  maxFiles: MAX_QUEUE_FILES,
  maxBytes: MAX_QUEUE_BYTES,
  maxBrowserFileBytes: MAX_BROWSER_FILE_BYTES,
  maxCompanionMediaBytes: MAX_COMPANION_MEDIA_BYTES,
});
