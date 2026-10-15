import type { Status } from '../../../core/types.ts';
import { useWorkflow } from '../hooks.ts';
import { statusBadgeStyle } from '../lib/workflow.ts';

/** A status pill: label and color from the configured status definition. */
export function StatusBadge({
  status,
  onClick,
}: {
  status: Status;
  onClick?: () => void;
}) {
  const workflow = useWorkflow();
  const { className, style } = statusBadgeStyle(workflow.source, status);
  const label = workflow.statusLabels[status] ?? status;

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`inline-block px-2 py-0.5 rounded text-xs font-medium cursor-pointer hover:opacity-80 ${className}`}
        style={style}
      >
        {label}
      </button>
    );
  }

  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${className}`}
      style={style}
    >
      {label}
    </span>
  );
}
