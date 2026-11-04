"use client";

/**
 * Shown when the API is cold. The hosted instance sleeps when idle, so the first
 * request after that can take up to a minute. This says so plainly, and keeps the
 * person from tapping again or assuming it broke.
 */
export default function WakeNotice({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div className="wake" role="status" aria-live="polite">
      <span className="wake-dot" aria-hidden="true" />
      <span className="wake-copy">
        <strong>Waking the service.</strong>
        <small>First request after idle can take up to a minute. Hang on.</small>
      </span>
    </div>
  );
}
