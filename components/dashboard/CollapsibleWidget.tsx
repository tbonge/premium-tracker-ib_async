import React, { createContext, useContext, useState } from 'react';
import { ChevronDownIcon, ChevronUpIcon } from '../../constants';

interface CollapsibleWidgetProps {
    id: string;
    title: string;
    summary: React.ReactNode;
    children: React.ReactNode;
}

interface SortContextValue {
    order: string[];
    move: (source: string, target: string) => void;
}

const SortContext = createContext<SortContextValue | null>(null);

export const SortableWidgetGroup: React.FC<{ ids: string[]; children: React.ReactNode }> = ({ ids, children }) => {
    const [order, setOrder] = useState<string[]>(() => {
        try {
            const saved = JSON.parse(window.localStorage.getItem('dashboard-widget-order') || '[]') as string[];
            return [...saved.filter(id => ids.includes(id)), ...ids.filter(id => !saved.includes(id))];
        } catch {
            return ids;
        }
    });

    const move = (source: string, target: string) => {
        if (source === target) return;
        setOrder(current => {
            const next = [...current];
            const sourceIndex = next.indexOf(source);
            const targetIndex = next.indexOf(target);
            if (sourceIndex < 0 || targetIndex < 0) return current;
            next.splice(sourceIndex, 1);
            next.splice(targetIndex, 0, source);
            try {
                window.localStorage.setItem('dashboard-widget-order', JSON.stringify(next));
            } catch {
                // Storage may be unavailable in private browsing contexts.
            }
            return next;
        });
    };

    return <SortContext.Provider value={{ order, move }}><div className="flex flex-col">{children}</div></SortContext.Provider>;
};

const CollapsibleWidget: React.FC<CollapsibleWidgetProps> = ({ id, title, summary, children }) => {
    const sorting = useContext(SortContext);
    const storageKey = `dashboard-widget-${id}`;
    const [expanded, setExpanded] = useState(() => {
        try {
            return window.localStorage.getItem(storageKey) === 'expanded';
        } catch {
            return false;
        }
    });

    const toggle = () => {
        setExpanded(current => {
            const next = !current;
            try {
                window.localStorage.setItem(storageKey, next ? 'expanded' : 'collapsed');
            } catch {
                // Storage may be unavailable in private browsing contexts.
            }
            return next;
        });
    };

    if (!expanded) {
        return (
            <section
                className="bg-brand-surface rounded-lg shadow-lg mb-4 cursor-grab active:cursor-grabbing"
                style={{ order: sorting?.order.indexOf(id) ?? 0 }}
                draggable
                onDragStart={event => {
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/widget-id', id);
                }}
                onDragOver={event => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                }}
                onDrop={event => {
                    event.preventDefault();
                    sorting?.move(event.dataTransfer.getData('text/widget-id'), id);
                }}
            >
                <button type="button" onClick={toggle} className="w-full min-h-20 p-4 flex items-center justify-between gap-4 text-left hover:bg-brand-card/40 transition-colors" aria-expanded={false}>
                    <span className="grid grid-cols-2 gap-0.5 shrink-0" aria-hidden="true">
                        {Array.from({ length: 6 }, (_, index) => <span key={index} className="w-1 h-1 rounded-full bg-brand-text-secondary" />)}
                    </span>
                    <span className="min-w-0 flex-1 text-left">
                        <span className="block text-lg font-semibold text-brand-text-primary">{title}</span>
                        <span className="block mt-1 text-sm text-brand-text-secondary truncate">{summary}</span>
                    </span>
                    <ChevronDownIcon className="w-5 h-5 shrink-0 text-brand-text-secondary" />
                </button>
            </section>
        );
    }

    return (
        <div className="relative" style={{ order: sorting?.order.indexOf(id) ?? 0 }}>
            <button type="button" onClick={toggle} className="absolute -right-2 -top-2 z-20 w-8 h-8 flex items-center justify-center rounded-full bg-brand-card text-brand-text-secondary shadow-md hover:text-brand-text-primary" title="Show compact summary" aria-label={`Collapse ${title}`} aria-expanded={true}>
                <ChevronUpIcon className="w-4 h-4" />
            </button>
            {children}
        </div>
    );
};

export default CollapsibleWidget;
