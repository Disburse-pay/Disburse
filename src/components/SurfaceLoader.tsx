type SurfaceLoaderProps = {
  label: string;
};

/**
 * Shared route fallback for the independently-loaded public surfaces. The
 * three slabs move like a transfer progressing through request, relay, and
 * settlement without relying on a generic spinner.
 */
export default function SurfaceLoader({ label }: SurfaceLoaderProps) {
  return (
    <div className="surface-loader" role="status" aria-live="polite">
      <div className="surface-loader-mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="surface-loader-copy">
        <strong>Disburse</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}
