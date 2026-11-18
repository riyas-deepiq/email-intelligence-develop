import React from 'react';
import { createPortal } from 'react-dom';
import IcCheck from '@/assets/icons/check.svg?react';
import IcChevronDown from '@/assets/icons/chevron-down.svg?react';
import styles from '@/styles/shared/components/ui/Combobox.module.css';

export interface ComboboxOption {
  value: string;
  label: string;
  /** Optional full-row content rendered instead of label/avatar/sublabel */
  content?: React.ReactNode;
  /** Optional avatar node rendered before the label */
  avatar?: React.ReactNode;
  /** Optional secondary line shown below the label in the dropdown */
  sublabel?: string;
}

export interface ComboboxProps {
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Show search input inside the dropdown (default: true) */
  searchable?: boolean;
  /** Fires whenever the panel closes, whether via selection or an outside click */
  onClose?: () => void;
  className?: string;
  /** Start with the panel already open (e.g. when mounted in response to an "Edit" click) */
  defaultOpen?: boolean;
  /** Trigger height/padding — 'sm' for dense toolbars and compact filter rows. Default 'md'. */
  size?: 'md' | 'sm';
  /** Open the panel above the trigger instead of below (e.g. for controls near the bottom of the page). */
  dropUp?: boolean;
  /** Optional dropdown panel height cap. Defaults to 330px. */
  dropdownMaxHeight?: number;
}

function findScrollParent(el: HTMLElement | null): HTMLElement {
  let node = el?.parentElement ?? null;
  while (node && node !== document.body) {
    const overflowY = window.getComputedStyle(node).overflowY;
    if (/(auto|scroll|overlay)/.test(overflowY)) return node;
    node = node.parentElement;
  }
  return (document.scrollingElement ?? document.documentElement) as HTMLElement;
}

function getPortalTarget(el: HTMLElement | null): HTMLElement {
  const dialog = el?.closest('dialog[open]');
  return dialog instanceof HTMLElement ? dialog : document.body;
}

export function Combobox({
  options,
  value,
  onChange,
  placeholder = 'Select…',
  searchable = true,
  onClose,
  className,
  defaultOpen = false,
  size = 'md',
  dropUp = false,
  dropdownMaxHeight = 330,
}: ComboboxProps) {
  const [open,  setOpen]  = React.useState(defaultOpen);
  const [query, setQuery] = React.useState('');
  const containerRef = React.useRef<HTMLDivElement>(null);
  const panelRef     = React.useRef<HTMLDivElement>(null);
  const scrollSpaceRef = React.useRef<{ el: HTMLElement; previous: string } | null>(null);

  // Rendered via a portal (see below), so its position is computed from the
  // trigger's viewport rect rather than CSS `position: absolute` — this is
  // what lets the panel escape any ancestor's stacking context/overflow
  // clipping instead of being trapped behind unrelated page content that
  // happens to sit in a competing local stacking context.
  const [panelRect, setPanelRect] = React.useState<{
    top: number;
    bottom: number;
    left: number;
    width: number;
    maxHeight: number;
    dropUp: boolean;
    position: 'fixed' | 'absolute';
  } | null>(null);
  const updatePanelRect = React.useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const portalTarget = getPortalTarget(el);
    const portalRect = portalTarget === document.body ? null : portalTarget.getBoundingClientRect();
    const gap = 6;
    const viewportMargin = 12;
    const preferredHeight = dropdownMaxHeight;
    const spaceAbove = rect.top - gap - viewportMargin;
    const shouldDropUp = dropUp;
    const available = shouldDropUp ? spaceAbove : window.innerHeight - (viewportMargin * 2);

    setPanelRect({
      top: portalRect ? rect.bottom - portalRect.top + gap : rect.bottom + gap,
      bottom: portalRect ? portalRect.bottom - rect.top + gap : window.innerHeight - rect.top + gap,
      left: portalRect ? rect.left - portalRect.left : rect.left,
      width: rect.width,
      maxHeight: Math.max(96, Math.min(preferredHeight, available)),
      dropUp: shouldDropUp,
      position: portalRect ? 'absolute' : 'fixed',
    });
  }, [dropUp, dropdownMaxHeight]);

  const selected = options.find((o) => o.value === value);
  const filtered = query.trim()
    ? options.filter((o) =>
        o.label.toLowerCase().includes(query.toLowerCase()) ||
        (o.sublabel ?? '').toLowerCase().includes(query.toLowerCase()),
      )
    : options;

  const close = React.useCallback(() => {
    setOpen(false);
    setQuery('');
    onClose?.();
  }, [onClose]);

  const clearScrollSpace = React.useCallback(() => {
    if (!scrollSpaceRef.current) return;
    scrollSpaceRef.current.el.style.paddingBottom = scrollSpaceRef.current.previous;
    scrollSpaceRef.current = null;
  }, []);

  React.useLayoutEffect(() => {
    if (!open) return;
    updatePanelRect();
  }, [open, updatePanelRect]);

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      close();
    };
    // Keep the portalled panel aligned while the page scrolls, but ignore
    // scrolls inside the panel so option-list scrolling does not close it.
    const onReposition = (e: Event) => {
      const target = e.target;
      if (target instanceof Node && panelRef.current?.contains(target)) return;
      updatePanelRect();
    };
    document.addEventListener('mousedown', handler);
    window.addEventListener('scroll', onReposition, true);
    window.addEventListener('resize', onReposition);
    return () => {
      document.removeEventListener('mousedown', handler);
      window.removeEventListener('scroll', onReposition, true);
      window.removeEventListener('resize', onReposition);
    };
  }, [open, close, updatePanelRect]);

  React.useLayoutEffect(() => {
    if (!open || !panelRect || panelRect.dropUp || panelRect.position !== 'fixed') {
      clearScrollSpace();
      return;
    }
    if (scrollSpaceRef.current) return;

    const overflow = panelRect.top + panelRect.maxHeight + 12 - window.innerHeight;
    if (overflow <= 0) return;

    const scrollParent = findScrollParent(containerRef.current);
    const computedPadding = Number.parseFloat(window.getComputedStyle(scrollParent).paddingBottom) || 0;
    scrollSpaceRef.current = { el: scrollParent, previous: scrollParent.style.paddingBottom };
    scrollParent.style.paddingBottom = `${computedPadding + overflow + 24}px`;
    requestAnimationFrame(() => scrollParent.scrollBy({ top: overflow + 12, behavior: 'auto' }));
  }, [clearScrollSpace, open, panelRect]);

  React.useEffect(() => clearScrollSpace, [clearScrollSpace]);

  const handleSelect = (val: string) => {
    onChange(val);
    close();
  };

  return (
    <div ref={containerRef} className={`${styles.wrap} ${className ?? ''}`}>
      {/* Trigger */}
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`${styles.trigger} ${size === 'sm' ? styles.triggerSm : ''} ${open ? styles.open : ''}`}
        onClick={() => { setOpen((v) => !v); setQuery(''); }}
      >
        <span className={styles.triggerContent}>
          {selected?.content ? (
            <span className={styles.triggerCustom}>{selected.content}</span>
          ) : (
            <>
              {selected?.avatar && <span className={styles.triggerAvatar}>{selected.avatar}</span>}
              <span className={`${styles.triggerLabel} ${!selected ? styles.triggerPlaceholder : ''}`}>
                {selected ? selected.label : placeholder}
              </span>
            </>
          )}
        </span>
        <span className={`${styles.chevron} ${open ? styles.open : ''}`}><IcChevronDown width={14} height={14} /></span>
      </button>

      {/* Dropdown panel — portalled to <body> so it can never be trapped
          behind other page content by an ancestor's stacking context. */}
      {open && panelRect && createPortal(
        <div
          ref={panelRef}
          className={`${styles.panel} ${panelRect.dropUp ? styles.panelUp : ''}`}
          style={{
            position: panelRect.position,
            left:  panelRect.left,
            width: panelRect.width,
            maxHeight: panelRect.maxHeight,
            ...(panelRect.dropUp ? { bottom: panelRect.bottom, top: 'auto' } : { top: panelRect.top, bottom: 'auto' }),
          }}
        >
          {searchable && (
            <div className={styles.searchWrap}>
              <input
                autoFocus
                type="text"
                className={styles.searchInput}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                aria-label="Search options"
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    panelRef.current?.querySelector<HTMLElement>('[role="option"]')?.focus();
                  }
                  if (e.key === 'Escape') close();
                }}
              />
            </div>
          )}
          <ul className={styles.list} role="listbox" aria-label="Available options">
            {filtered.length === 0 ? (
              <li className={styles.empty}>No options found</li>
            ) : filtered.map((o) => {
              const isSelected = o.value === value;
              return (
                <li
                  key={o.value}
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleSelect(o.value);
                      containerRef.current?.querySelector('button')?.focus();
                    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                      e.preventDefault();
                      const sibling = e.key === 'ArrowDown' ? e.currentTarget.nextElementSibling : e.currentTarget.previousElementSibling;
                      if (sibling instanceof HTMLElement) sibling.focus();
                    } else if (e.key === 'Escape') {
                      close();
                      containerRef.current?.querySelector('button')?.focus();
                    }
                  }}
                  onMouseDown={() => handleSelect(o.value)}
                  className={`${styles.option} ${isSelected ? styles.selected : ''}`}
                >
                  {o.content ? (
                    <span className={styles.optionCustom}>{o.content}</span>
                  ) : (
                    <>
                      {o.avatar && <span className={styles.optionAvatar}>{o.avatar}</span>}
                      <span className={styles.optionText}>
                        <span className={styles.optionLabel}>{o.label}</span>
                        {o.sublabel && <span className={styles.optionSublabel}>{o.sublabel}</span>}
                      </span>
                    </>
                  )}
                  {isSelected && <span className={styles.optionCheck}><IcCheck width={14} height={14} /></span>}
                </li>
              );
            })}
          </ul>
        </div>,
        getPortalTarget(containerRef.current),
      )}
    </div>
  );
}
