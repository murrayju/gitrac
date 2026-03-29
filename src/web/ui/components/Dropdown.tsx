import { useEffect, useRef, useState } from 'react';

export function Dropdown<T extends string>({
  value,
  options,
  labels,
  onChange,
  children,
}: {
  value: T;
  options: readonly T[];
  labels?: Record<string, string>;
  onChange: (value: T) => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="appearance-none bg-transparent border-none p-0 cursor-pointer"
      >
        {children}
      </button>
      {open && (
        <div className="absolute z-50 mt-1 min-w-32 rounded border border-gray-700 bg-gray-900 shadow-lg py-1">
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => {
                onChange(opt);
                setOpen(false);
              }}
              className={`block w-full text-left px-3 py-1.5 text-sm hover:bg-gray-800 ${
                opt === value ? 'text-white bg-gray-800' : 'text-gray-300'
              }`}
            >
              {labels?.[opt] ?? opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
