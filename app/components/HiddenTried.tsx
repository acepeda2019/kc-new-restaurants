/** "N hidden as tried · Clear" under the top 3; renders nothing when nothing is hidden. */
export function HiddenTried({ count, onClear }: { count: number; onClear: () => void }) {
  if (count === 0) return null;
  return (
    <p className="hidden-tried">
      {count} hidden as tried ·{" "}
      <button type="button" className="link" onClick={onClear}>
        Clear
      </button>
    </p>
  );
}
