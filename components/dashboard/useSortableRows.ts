import { useMemo, useState } from 'react';
import { compareSortValues, SortDirection } from './SortableHeader';

export const useSortableRows = <T, K extends string>(
    rows: T[],
    initialKey: K,
    valueFor: (row: T, key: K) => unknown,
    initialDirection: SortDirection = 'asc',
) => {
    const [sort, setSort] = useState<{ key: K; direction: SortDirection }>({ key: initialKey, direction: initialDirection });
    const sortedRows = useMemo(() => [...rows].sort((a, b) => {
        const result = compareSortValues(valueFor(a, sort.key), valueFor(b, sort.key));
        return sort.direction === 'asc' ? result : -result;
    }), [rows, sort, valueFor]);
    const requestSort = (key: K) => setSort(current => ({
        key,
        direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }));
    return { sortedRows, sort, requestSort };
};
