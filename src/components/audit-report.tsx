'use client';

import { useState } from 'react';
import { AuditResult, AuditStatus } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { downloadCsv } from '@/lib/utils';
import { CheckCircle2, AlertTriangle, PlusCircle, ArrowLeft, Download, FileQuestion, HelpCircle, XCircle } from 'lucide-react';

type FilterType = 'all' | AuditStatus;

const statusConfig: { [key in AuditStatus]: { icon: React.ElementType, text: string, badgeClass: string } } = {
  matched: { icon: CheckCircle2, text: 'Matched', badgeClass: 'bg-green-100 text-green-800 border-green-200 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700' },
  mismatched: { icon: AlertTriangle, text: 'Mismatched', badgeClass: 'bg-yellow-100 text-yellow-800 border-yellow-200 hover:bg-yellow-100 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-700' },
  not_in_csv: { icon: PlusCircle, text: 'Not in CSV', badgeClass: 'bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700' },
  missing_in_shopify: { icon: XCircle, text: 'Missing in Shopify', badgeClass: 'bg-red-100 text-red-800 border-red-200 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700' },
};

export default function AuditReport({ data, summary, onReset }: { data: AuditResult[], summary: any, onReset: () => void }) {
  const [filter, setFilter] = useState<FilterType>('all');

  const filteredData = data.filter(item => filter === 'all' || item.status === filter);

  const handleDownload = () => {
    const csvData = data.map(item => ({
      SKU: item.sku,
      Status: statusConfig[item.status].text,
      CSV_Product_Name: item.csvProduct?.name || 'N/A',
      CSV_Price: item.csvProduct ? item.csvProduct.price.toFixed(2) : 'N/A',
      Shopify_Product_Name: item.shopifyProduct?.name || 'N/A',
      Shopify_Price: item.shopifyProduct ? item.shopifyProduct.price.toFixed(2) : 'N/A',
    }));
    downloadCsv(csvData, 'shopsync-audit-report.csv');
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Audit Report</CardTitle>
        <CardDescription>
          Comparison of product data between your CSV file (source of truth) and Shopify.
        </CardDescription>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-card border shadow-sm">
                <CheckCircle2 className="w-6 h-6 text-green-500 shrink-0" />
                <div>
                    <div className="text-xl font-bold">{summary.matched}</div>
                    <div className="text-xs text-muted-foreground">Matched</div>
                </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-card border shadow-sm">
                <AlertTriangle className="w-6 h-6 text-yellow-500 shrink-0" />
                <div>
                    <div className="text-xl font-bold">{summary.mismatched}</div>
                    <div className="text-xs text-muted-foreground">Mismatched</div>
                </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-card border shadow-sm">
                <XCircle className="w-6 h-6 text-red-500 shrink-0" />
                <div>
                    <div className="text-xl font-bold">{summary.missing_in_shopify}</div>
                    <div className="text-xs text-muted-foreground">Missing in Shopify</div>
                </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-card border shadow-sm">
                <PlusCircle className="w-6 h-6 text-blue-500 shrink-0" />
                <div>
                    <div className="text-xl font-bold">{summary.not_in_csv}</div>
                    <div className="text-xs text-muted-foreground">Not in CSV</div>
                </div>
            </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col sm:flex-row justify-between items-center mb-4 gap-4">
          <div className="flex flex-wrap gap-2">
            {(['all', 'matched', 'mismatched', 'missing_in_shopify', 'not_in_csv'] as const).map(f => (
                <Button key={f} variant={filter === f ? 'default' : 'outline'} size="sm" onClick={() => setFilter(f)}>
                    {f === 'all' ? `All (${data.length})` : `${statusConfig[f].text} (${summary[f]})`}
                </Button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onReset}><ArrowLeft className="mr-2 h-4 w-4" />New Audit</Button>
            <Button onClick={handleDownload}><Download className="mr-2 h-4 w-4" />Download Report</Button>
          </div>
        </div>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[120px]">SKU</TableHead>
                <TableHead className="w-[180px]">Status</TableHead>
                <TableHead>CSV Product Details</TableHead>
                <TableHead>Shopify Product Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredData.length > 0 ? filteredData.map(item => {
                const config = statusConfig[item.status];
                return (
                  <TableRow key={item.sku} className={
                      item.status === 'mismatched' ? 'bg-yellow-50/50 dark:bg-yellow-900/10' :
                      item.status === 'missing_in_shopify' ? 'bg-red-50/50 dark:bg-red-900/10' : ''
                  }>
                    <TableCell className="font-medium">{item.sku}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`whitespace-nowrap ${config.badgeClass}`}>
                        <config.icon className="mr-1.5 h-3.5 w-3.5" />
                        {config.text}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {item.csvProduct ? (
                        <div>
                          <p>{item.csvProduct.name}</p>
                          <p className="text-sm text-muted-foreground">${item.csvProduct.price.toFixed(2)}</p>
                        </div>
                      ) : <span className="text-sm text-muted-foreground">N/A</span>}
                    </TableCell>
                    <TableCell>
                      {item.shopifyProduct ? (
                        <div>
                          <p>{item.shopifyProduct.name}</p>
                          <p className="text-sm text-muted-foreground">${item.shopifyProduct.price.toFixed(2)}</p>
                        </div>
                      ) : <span className="text-sm text-muted-foreground">N/A</span>}
                    </TableCell>
                  </TableRow>
                );
              }) : (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center">
                    No results for this filter.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
