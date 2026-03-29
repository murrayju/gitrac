export function LabelBadge({
  label,
  color,
  onRemove,
}: {
  label: string;
  color?: string;
  onRemove?: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border border-gray-200 bg-gray-100 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
      <span
        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
        style={{ backgroundColor: color || '#6b7280' }}
      />
      {label}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-opacity"
        >
          ×
        </button>
      )}
    </span>
  );
}
