import { ArrowDown, ArrowRight } from 'lucide-react';
import { renderRichInline } from '../lib/inlineRichText';

interface FlowchartBlockProps {
  label?: string;
  steps: string[];
  compact?: boolean;
}

/**
 * Fluid, spacious process / causal flowchart renderer.
 * Avoids rigid box-in-box grids by letting steps size organically with larger, legible type
 * and soft tonal elevation connected by clear directional arrows.
 */
export function FlowchartBlock({ label, steps, compact = false }: FlowchartBlockProps) {
  if (!steps.length) return null;

  return (
    <div
      className={
        compact
          ? 'my-3 rounded-2xl bg-[color-mix(in_srgb,var(--note-accent,var(--e3))_5%,var(--bg))] px-4 py-4'
          : 'my-5 rounded-2xl bg-[color-mix(in_srgb,var(--note-accent,var(--e3))_5%,var(--bg))] px-5 py-5 sm:px-6 sm:py-6'
      }
    >
      {label && (
        <div
          className={
            compact
              ? 'mb-3 text-sm font-bold text-[var(--note-accent,var(--e3))]'
              : 'mb-4 text-[15px] font-bold text-[var(--note-accent,var(--e3))] sm:text-base'
          }
        >
          {label}
        </div>
      )}

      <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3 sm:gap-y-3.5">
        {steps.map((step, sIdx) => (
          <div
            key={sIdx}
            className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-3"
          >
            <div
              className={`flex items-start gap-3 rounded-[20px] bg-[var(--card)] ring-1 ring-[color-mix(in_srgb,var(--note-accent,var(--e3))_18%,transparent)] shadow-[0_1px_4px_rgba(0,0,0,0.06)] transition-transform duration-150 ${
                compact
                  ? 'px-4 py-3 text-[15.5px] leading-[1.52] sm:max-w-[340px]'
                  : 'px-5 py-3.5 text-[17px] leading-[1.55] sm:max-w-[380px] sm:text-[18.5px]'
              } text-[var(--ink)]`}
            >
              <span
                className={`font-mono-num inline-flex shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--note-accent,var(--e3))_14%,transparent)] font-extrabold text-[var(--note-accent,var(--e3))] ${
                  compact ? 'mt-0.5 h-6 w-6 text-xs' : 'mt-0.5 h-7 w-7 text-sm'
                }`}
              >
                {sIdx + 1}
              </span>
              <span className="min-w-0 font-medium">{renderRichInline(step)}</span>
            </div>

            {sIdx < steps.length - 1 && (
              <>
                <ArrowRight
                  className={`hidden shrink-0 text-[var(--note-accent,var(--e3))] sm:block ${
                    compact ? 'h-4 w-4' : 'h-5 w-5'
                  }`}
                  aria-hidden="true"
                />
                <ArrowDown
                  className="mx-auto h-4 w-4 shrink-0 text-[var(--note-accent,var(--e3))] sm:hidden"
                  aria-hidden="true"
                />
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
