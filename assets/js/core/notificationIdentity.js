export function notificationFingerprint(title, detail) {
  return `${title}|${detail}`
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function notificationDedupeKey(title, detail, deliveryKey = '') {
  const fingerprint = notificationFingerprint(title, detail);
  return deliveryKey ? `DELIVERY ${deliveryKey}` : fingerprint;
}
