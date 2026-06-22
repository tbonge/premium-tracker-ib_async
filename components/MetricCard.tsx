
import React, { useMemo, useState } from 'react';
import { ChevronDownIcon, ChevronUpIcon } from '../constants';
import Tooltip from './Tooltip';
import { useLocalization } from '../context/LocalizationContext';
import SortableHeader, { compareSortValues, SortDirection } from './dashboard/SortableHeader';

interface DetailRow {
    [key: string]: string | number;
}
  
interface MetricCardProps {
  title: string;
  value: React.ReactNode;
  icon: React.ReactNode;
  isPositive?: boolean;
  description?: string;
  details?: {
    headers: string[];
    rows: DetailRow[];
  };
  tooltip?: string;
}

const MetricCard: React.FC<MetricCardProps> = ({ title, value, icon, isPositive, description, details, tooltip }) => {
  const [isDetailsVisible, setIsDetailsVisible] = useState(false);
  const [detailsSort, setDetailsSort] = useState<{ key: string; direction: SortDirection }>({ key: details?.headers[0] || '', direction: 'asc' });
  const { t } = useLocalization();
  const valueColor = isPositive === undefined ? 'text-brand-text-primary' : isPositive ? 'text-brand-success' : 'text-brand-danger';

  const detailsHeaders = details?.headers.map(headerKey => t(`dynamicHeaders.${headerKey}`));
  const sortedDetailRows = useMemo(() => details ? [...details.rows].sort((a, b) => {
    const result = compareSortValues(a[detailsSort.key], b[detailsSort.key]);
    return detailsSort.direction === 'asc' ? result : -result;
  }) : [], [details, detailsSort]);
  const requestDetailsSort = (key: string) => setDetailsSort(current => ({ key, direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc' }));

  return (
    <div className="bg-brand-surface p-6 rounded-lg shadow-lg flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between mb-2">
            <h3 className="text-md font-semibold text-brand-text-secondary">
                {tooltip ? (
                    <Tooltip content={tooltip}>
                        <span className="border-b border-dotted border-brand-text-secondary cursor-help">{title}</span>
                    </Tooltip>
                ) : (
                    title
                )}
            </h3>
            <span className="text-brand-text-secondary">{icon}</span>
        </div>
        <p className={`text-3xl font-bold ${valueColor}`}>{value}</p>
      </div>
      {description && <p className="text-sm text-brand-text-secondary mt-4">{description}</p>}
      
      {details && details.rows.length > 0 && (
        <div className="mt-4">
            <button
                onClick={() => setIsDetailsVisible(!isDetailsVisible)}
                className="flex items-center text-sm text-brand-accent hover:text-brand-accent-hover font-semibold"
            >
                {isDetailsVisible ? t('metricCard.hideDetails') : t('metricCard.showDetails')}
                {isDetailsVisible ? <ChevronUpIcon className="w-4 h-4 ml-1" /> : <ChevronDownIcon className="w-4 h-4 ml-1" />}
            </button>
            {isDetailsVisible && (
                <div className="mt-2 overflow-x-auto text-xs">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="border-b border-brand-card">
                                {detailsHeaders?.map((header, idx) => <SortableHeader key={header} column={details.headers[idx]} activeColumn={detailsSort.key} direction={detailsSort.direction} onSort={requestDetailsSort} align={idx > 0 ? 'right' : 'left'}>{header}</SortableHeader>)}
                            </tr>
                        </thead>
                        <tbody>
                            {sortedDetailRows.map((row, index) => (
                                <tr key={index} className="border-b border-brand-card last:border-b-0">
                                    {details.headers.map((header, idx) => <td key={header} className={`p-2 font-mono ${idx > 0 ? 'text-right' : ''}`}>{row[header]}</td>)}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
      )}
    </div>
  );
};

export default MetricCard;
