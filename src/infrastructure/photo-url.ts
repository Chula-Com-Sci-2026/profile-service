/**
 * A photo's public address — `{OBJECT_STORAGE_PUBLIC_ENDPOINT}/{OBJECT_STORAGE_BUCKET}/{photoRef}`,
 * path style, the way MinIO serves a public bucket.
 *
 * Worked out wherever a card is serialised and never stored: the domain holds only the key, so
 * moving storage changes a setting, not a row. The composition root builds this once from
 * configuration and hands it to whatever serialises a card — the HTTP views and the events.
 */
export function photoUrlFor(storage: { publicEndpoint: string; bucket: string }): (photoRef: string) => string {
  // A trailing slash on the setting would otherwise double up: `http://host:9000//profile-service/…`.
  const base = `${storage.publicEndpoint.replace(/\/+$/, '')}/${storage.bucket}`
  return (photoRef) => `${base}/${photoRef}`
}
