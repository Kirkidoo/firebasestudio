'use client';

import { useState } from 'react';
import { AuditResult, AuditStatus, DuplicateSku, MismatchDetail } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { downloadCsv } from '@/lib/utils';
import { CheckCircle2, AlertTriangle, PlusCircle, ArrowLeft, Download, XCircle, Wrench, Siren, Copy } from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

type FilterType = 'all' | AuditStatus;

const statusConfig: { [key in AuditStatus]: { icon: React.ElementType, text: string, badgeClass: string } } = {
  matched: { icon: CheckCircle2, text: 'Matched', badgeClass: 'bg-green-100 text-green-800 border-green-200 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700' },
  mismatched: { icon: AlertTriangle, text: 'Mismatched', badgeClass: 'bg-yellow-100 text-yellow-800 border-yellow-200 hover:bg-yellow-100 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-700' },
  not_in_csv: { icon: PlusCircle, text: 'Not in CSV', badgeClass: 'bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700' },
  missing_in_shopify: { icon: XCircle, text: 'Missing in Shopify', badgeClass: 'bg-red-100 text-red-800 border-red-200 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700' },
};

const getHandle = (item: AuditResult) => item.csvProduct?.handle || item.shopifyProduct?.handle || `no-handle-${item.sku}`;

const MismatchDetails = ({ mismatches }: { mismatches: MismatchDetail[] }) => {
    return (
        <div className="flex flex-col gap-2 mt-2">
            {mismatches.map((mismatch, index) => (
                <div key={index} className="flex items-center gap-2 text-xs p-2 rounded-md bg-yellow-50 dark:bg-yellow-900/20">
                     <AlertTriangle className="h-4 w-4 text-yellow-600 shrink-0" />
                    <div className="flex-grow">
                        <span className="font-semibold capitalize">{mismatch.field.replace('_', ' ')}: </span>
                        <span className="text-red-500 line-through mr-2">{mismatch.shopifyValue ?? 'N/A'}</span>
                        <span className="text-green-500">{mismatch.csvValue ?? 'N/A'}</span>
                    </div>
                     <Button size="sm" variant="ghost" className="h-7">
                        <Wrench className="mr-1.5 h-3.5 w-3.5" />
                        Fix
                    </Button>
                </div>
            ))}
        </div>
    );
};


export default function AuditReport({ data, summary, duplicates, onReset }: { data: AuditResult[], summary: any, duplicates: DuplicateSku[], onReset: () => void }) {
  const [filter, setFilter] = useState<FilterType>('all');

  const filteredData = data.filter(item => filter === 'all' || item.status === filter);

  const groupedByHandle = filteredData.reduce((acc, item) => {
    const handle = getHandle(item);
    if (!acc[handle]) {
      acc[handle] = [];
    }
    acc[handle].push(item);
    return acc;
  }, {} as Record<string, AuditResult[]>);

  const handleDownload = () => {
    const csvData = data.map(item => ({
      Handle: getHandle(item),
      SKU: item.sku,
      Status: statusConfig[item.status].text,
      Mismatched_Fields: item.mismatches.map(m => m.field).join(', '),
      CSV_Product_Name: item.csvProduct?.name || 'N/A',
      Shopify_Product_Name: item.shopifyProduct?.name || 'N/A',
      CSV_Price: item.csvProduct ? item.csvProduct.price.toFixed(2) : 'N/A',
      Shopify_Price: item.shopifyProduct ? item.shopifyProduct.price.toFixed(2) : 'N/A',
      CSV_Inventory: item.csvProduct?.inventory ?? 'N/A',
      Shopify_Inventory: item.shopifyProduct?.inventory ?? 'N/A',
    }));
    downloadCsv(csvData, 'shopsync-audit-report.csv');
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Audit Report</CardTitle>
        <CardDescription>
          Comparison of product data between your CSV file (source of truth) and Shopify. Products are grouped by handle.
        </CardDescription>
         {duplicates.length > 0 && (
            <Alert variant="destructive" className="mt-4">
                <Siren className="h-4 w-4" />
                <AlertTitle>Duplicate SKUs Found in CSV!</AlertTitle>
                <AlertDescription>
                    The following SKUs are duplicated in your source CSV file, which can cause incorrect audit results. Please fix them in the source file.
                    <div className="mt-2 text-xs font-mono">
                        {duplicates.map(d => `${d.sku} (x${d.count})`).join(', ')}
                    </div>
                </AlertDescription>
            </Alert>
        )}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-card border shadow-sm">
                <CheckCircle2 className="w-6 h-6 text-green-500 shrink-0" />
                <div>
                    <div className="text-xl font-bold">{summary.matched}</div>
                    <div className="text-xs text-muted-foreground">SKUs Matched</div>
                </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-card border shadow-sm">
                <AlertTriangle className="w-6 h-6 text-yellow-500 shrink-0" />
                <div>
                    <div className="text-xl font-bold">{summary.mismatched}</div>
                    <div className="text-xs text-muted-foreground">SKUs Mismatched</div>
                </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-card border shadow-sm">
                <XCircle className="w-6 h-6 text-red-500 shrink-0" />
                <div>
                    <div className="text-xl font-bold">{summary.missing_in_shopify}</div>
                    <div className="text-xs text-muted-foreground">SKUs Missing in Shopify</div>
                </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-card border shadow-sm">
                <PlusCircle className="w-6 h-6 text-blue-500 shrink-0" />
                <div>
                    <div className="text-xl font-bold">{summary.not_in_csv}</div>
                    <div className="text-xs text-muted-foreground">SKUs Not in CSV</div>
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
            {Object.keys(groupedByHandle).length > 0 ? (
                <Accordion type="multiple" className="w-full">
                    {Object.entries(groupedByHandle).map(([handle, items]) => {
                         const productTitle = items[0].csvProduct?.name || items[0].shopifyProduct?.name || handle;
                         const hasMismatch = items.some(i => i.status === 'mismatched');
                         const isMissing = items.every(i => i.status === 'missing_in_shopify');
                         const notInCsv = items.every(i => i.status === 'not_in_csv');
                         
                         const overallStatus = hasMismatch ? 'mismatched' 
                             : isMissing ? 'missing_in_shopify'
                             : notInCsv ? 'not_in_csv'
                             : 'matched';
                         const config = statusConfig[overallStatus];

                        return (
                        <AccordionItem value={handle} key={handle}>
                            <AccordionTrigger className="px-4 hover:no-underline">
                                <div className="flex items-center gap-4 w-full">
                                    <config.icon className={`w-5 h-5 shrink-0 ${
                                            overallStatus === 'matched' ? 'text-green-500' 
                                            : overallStatus === 'mismatched' ? 'text-yellow-500' 
                                            : overallStatus === 'missing_in_shopify' ? 'text-red-500'
                                            : 'text-blue-500'
                                    }`} />
                                    <div className="flex-grow text-left">
                                        <p className="font-semibold">{productTitle}</p>
                                        <p className="text-sm text-muted-foreground">{handle}</p>
                                    </div>
                                    <Badge variant="outline" className="mr-4">{items.length} SKU{items.length > 1 ? 's' : ''}</Badge>
                                </div>
                            </AccordionTrigger>
                            <AccordionContent>
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="w-[150px]">SKU</TableHead>
                                            <TableHead className="w-[180px]">Status</TableHead>
                                            <TableHead>Details</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {items.map(item => {
                                            const itemConfig = statusConfig[item.status];
                                            return (
                                                <TableRow key={item.sku} className={
                                                    item.status === 'mismatched' ? 'bg-yellow-50/50 dark:bg-yellow-900/10' :
                                                    item.status === 'missing_in_shopify' ? 'bg-red-50/50 dark:bg-red-900/10' : ''
                                                }>
                                                    <TableCell className="font-medium">{item.sku}</TableCell>
                                                    <TableCell>
                                                    <Badge variant="outline" className={`whitespace-nowrap ${itemConfig.badgeClass}`}>
                                                        <itemConfig.icon className="mr-1.5 h-3.5 w-3.5" />
                                                        {itemConfig.text}
                                                    </Badge>
                                                    </TableCell>
                                                     <TableCell>
                                                       {item.status === 'mismatched' && <MismatchDetails mismatches={item.mismatches} />}
                                                       {item.status === 'missing_in_shopify' && <p className="text-sm text-muted-foreground">This product is in your CSV but could not be found in Shopify.</p>}
                                                       {item.status === 'not_in_csv' && <p className="text-sm text-muted-foreground">This product exists in Shopify but not in your CSV file.</p>}
                                                       {item.status === 'matched' && <p className="text-sm text-muted-foreground">Product data matches between CSV and Shopify.</p>}
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })}
                                    </TableBody>
                                </Table>
                            </AccordionContent>
                        </AccordionItem>
                    )})}
                </Accordion>
            ) : (
                <div className="h-24 text-center flex items-center justify-center">
                    No results for this filter.
                </div>
            )}
        </div>
      </CardContent>
    </Card>
  );
}