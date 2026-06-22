import React from 'react';
import { ChevronDownIcon, ChevronUpIcon } from '../../constants';

export type SortDirection = 'asc' | 'desc';

interface SortableHeaderProps<K extends string> {
    column: K;
    activeColumn: K;
    direction: SortDirection;
    onSort: (column: K) => void;
    children: React.ReactNode;
    align?: 'left' | 'right';
    className?: string;
}

const SortableHeader = <K extends string>({
    column,
    activeColumn,
    direction,
    onSort,
    children,
    align = 'left',
    className = '',
}: SortableHeaderProps<K>) => (
    <th
        className={`p-2 cursor-pointer select-none text-sm font-semibold text-brand-text-secondary uppercase ${align === 'right' ? 'text-right' : ''} ${className}`}
        onClick={() => onSort(column)}
        aria-sort={activeColumn === column ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
        <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'justify-end' : ''}`}>
            {children}
            {activeColumn === column && (direction === 'asc'
                ? <ChevronUpIcon className="w-4 h-4" />
                : <ChevronDownIcon className="w-4 h-4" />)}
        </span>
    </th>
);

export const compareSortValues = (left: unknown, right: unknown): number => {
    if (left == null) return right == null ? 0 : 1;
    if (right == null) return -1;
    if (typeof left === 'number' && typeof right === 'number') return left - right;
    return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' });
};

export default SortableHeader;
