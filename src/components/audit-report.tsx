
'use client';

import { useState, useTransition, useEffect } from 'react';
import { AuditResult, AuditStatus, DuplicateSku, MismatchDetail, Product, Summary } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { downloadCsv } from '@/lib/utils';
import { CheckCircle2, AlertTriangle, PlusCircle, ArrowLeft, Download, XCircle, Wrench, Siren, Loader2, RefreshCw, Text, DollarSign, List, Weight, FileText, Eye, Trash2 } from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { fixMismatch, createInShopify, deleteFromShopify, deleteVariantFromShopify } from '@/app/actions';
import { useToast } from '@/hooks/use-toast';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';


type FilterType = 'all' | 'mismatched' | 'missing_in_shopify' | 'not_in_csv';

const statusConfig: { [key in Exclude<AuditStatus, 'matched'>]: { icon: React.ElementType, text: string, badgeClass: string } } = {
  mismatched: { icon: AlertTriangle, text: 'Mismatched', badgeClass: 'bg-yellow-100 text-yellow-800 border-yellow-200 hover:bg-yellow-100 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-700' },
  not_in_csv: { icon: PlusCircle, text: 'Not in CSV', badgeClass: 'bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700' },
  missing_in_shopify: { icon: XCircle, text: 'Missing in Shopify', badgeClass: 'bg-red-100 text-red-800 border-red-200 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700' },
};

const getHandle = (item: AuditResult) => item.csvProduct?.handle || item.shopifyProduct?.handle || `no-handle-${item.sku}`;

const MismatchDetails = ({ mismatches, onFix, disabled }: { mismatches: MismatchDetail[], onFix: (fixType: MismatchDetail['field']) => void, disabled: boolean }) => {
    return (
        <div className="flex flex-col gap-2 mt-2">
            {mismatches.map((mismatch, index) => (
                <div key={index} className="flex items-center gap-2 text-xs p-2 rounded-md bg-yellow-50 dark:bg-yellow-900/20">
                     <AlertTriangle className="h-4 w-4 text-yellow-600 shrink-0" />
                    <div className="flex-grow">
                        <span className="font-semibold capitalize">{mismatch.field.replace('_', ' ')}: </span>
                        {mismatch.field !== 'h1_tag' && (
                             <>
                                <span className="text-red-500 line-through mr-2">{mismatch.shopifyValue ?? 'N/A'}</span>
                                <span className="text-green-500">{mismatch.csvValue ?? 'N/A'}</span>
                            </>
                        )}
                        {mismatch.field === 'h1_tag' && (
                             <span className="text-muted-foreground">Product description contains an H1 tag.</span>
                        )}
                    </div>
                     <Button size="sm" variant="ghost" className="h-7" onClick={() => onFix(mismatch.field)} disabled={disabled}>
                        <Wrench className="mr-1.5 h-3.5 w-3.5" />
                        Fix
                    </Button>
                </div>
            ))}
        </div>
    );
};

const MissingProductDetailsDialog = ({ product }: { product: Product }) => {
    const dataMap: { label: string; value: any; notes?: string }[] = [
        // Product Level
        { label: "Shopify Product Title", value: product.name, notes: "From 'Title' column" },
        { label: "Shopify Product Handle", value: product.handle, notes: "From 'Handle' column" },
        { label: "Product Description", value: product.descriptionHtml || 'N/A', notes: "From 'Body (HTML)' column. H1 tags will be converted to H2." },
        { label: "Vendor", value: product.vendor, notes: "From 'Vendor' column" },
        { label: "Product Type", value: product.productType, notes: "From 'Tags' column (3rd tag)" },
        { label: "Collection", value: product.category, notes: "From 'Category' column. Will be linked to a collection with this title." },
        { label: "Tags", value: 'N/A', notes: "'Clearance' tag added if filename contains 'clearance'" },
        
        // Variant Level
        { label: "Variant SKU", value: product.sku, notes: "From 'SKU' column" },
        { label: "Variant Image", value: product.mediaUrl, notes: "From 'Variant Image' column. Will be assigned to this variant." },
        { label: "Variant Price", value: `$${product.price?.toFixed(2)}`, notes: "From 'Price' column" },
        { label: "Variant Compare At Price", value: product.compareAtPrice ? `$${product.compareAtPrice.toFixed(2)}` : 'N/A', notes: "From 'Compare At Price' column" },
        { label: "Variant Cost", value: product.costPerItem ? `$${product.costPerItem.toFixed(2)}` : 'N/A', notes: "From 'Cost Per Item' column" },
        { label: "Variant Barcode (GTIN)", value: product.barcode || 'N/A', notes: "From 'Variant Barcode' column" },
        { label: "Variant Weight", value: product.weight ? `${(product.weight / 453.592).toFixed(2)} lbs` : 'N/A', notes: "From 'Variant Grams' column. Will be stored in Shopify as pounds." },
        { label: "Variant Inventory", value: product.inventory, notes: "From 'Variant Inventory Qty'. Will be set at 'Gamma Warehouse' location." },

        // Options
        { label: "Option 1", value: product.option1Name ? `${product.option1Name}: ${product.option1Value}` : 'N/A', notes: "From 'Option1 Name' and 'Option1 Value'" },
        { label: "Option 2", value: product.option2Name ? `${product.option2Name}: ${product.option2Value}` : 'N/A', notes: "From 'Option2 Name' and 'Option2 Value'" },
        { label: "Option 3", value: product.option3Name ? `${product.option3Name}: ${product.option3Value}` : 'N/A', notes: "From 'Option3 Name' and 'Option3 Value'" },
    ];

    return (
        <Dialog>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="h-7">
                    <Eye className="mr-1.5 h-3.5 w-3.5" />
                    View Details
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl">
                <DialogHeader>
                    <DialogTitle>Product Creation Preview</DialogTitle>
                    <DialogDescription>
                        This is the data that will be sent to Shopify to create the new product variant with SKU: <span className="font-bold text-foreground">{product.sku}</span>
                    </DialogDescription>
                </DialogHeader>
                <div className="max-h-[60vh] overflow-y-auto pr-4">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-1/3">Shopify Field</TableHead>
                                <TableHead>Value from FTP File</TableHead>
                                <TableHead>Notes / Source Column</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {dataMap.map(({ label, value, notes }) => (
                                <TableRow key={label}>
                                    <TableCell className="font-medium">{label}</TableCell>
                                    <TableCell>
                                        {typeof value === 'string' && value.startsWith('http') ? (
                                            <a href={value} target="_blank" rel="noopener noreferrer" className="text-primary underline hover:text-primary/80 truncate block max-w-xs">{value}</a>
                                        ) : (
                                            <span className="truncate">{value ?? 'N/A'}</span>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-muted-foreground text-xs">{notes}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </DialogContent>
        </Dialog>
    );
};

const gToLbs = (grams: number | null | undefined): string => {
    if (grams === null || grams === undefined) return 'N/A';
    const lbs = grams * 0.00220462;
    return `${lbs.toFixed(2)} lbs`;
};

const ProductDetails = ({ product }: { product: Product | null }) => {
    if (!product) return null;
    return (
        <div className="flex items-center gap-4 text-xs text-muted-foreground mt-2">
            <span className="flex items-center gap-1.5">
                <DollarSign className="h-3.5 w-3.5" /> Price: <span className="font-medium text-foreground">${product.price.toFixed(2)}</span>
            </span>
            <span className="flex items-center gap-1.5">
                <List className="h-3.5 w-3.5" /> Stock: <span className="font-medium text-foreground">{product.inventory ?? 'N/A'}</span>
            </span>
            <span className="flex items-center gap-1.5">
                <Weight className="h-3.5 w-3.5" /> Weight: <span className="font-medium text-foreground">{gToLbs(product.weight)}</span>
            </span>
        </div>
    );
}

const HANDLES_PER_PAGE = 20;

export default function AuditReport({ data, summary, duplicates, fileName, onReset, onRefresh }: { data: AuditResult[], summary: Summary, duplicates: DuplicateSku[], fileName: string, onReset: () => void, onRefresh: () => void }) {
  const [filter, setFilter] = useState<FilterType>('all');
  const [isFixing, startTransition] = useTransition();
  const { toast } = useToast();
  
  const [reportData, setReportData] = useState<AuditResult[]>(data);
  const [reportSummary, setReportSummary] = useState<Summary>(summary);
  const [showRefresh, setShowRefresh] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    setReportData(data);
    setReportSummary(summary);
    setShowRefresh(false);
    setCurrentPage(1); // Reset page on new data
  }, [data, summary]);


  const filteredData = reportData.filter(item => filter === 'all' || item.status === filter);

  const groupedByHandle = filteredData.reduce((acc, item) => {
    const handle = getHandle(item);
    if (!acc[handle]) {
      acc[handle] = [];
    }
    acc[handle].push(item);
    return acc;
  }, {} as Record<string, AuditResult[]>);

  const handleKeys = Object.keys(groupedByHandle);
  const totalPages = Math.ceil(handleKeys.length / HANDLES_PER_PAGE);
  const paginatedHandleKeys = handleKeys.slice(
      (currentPage - 1) * HANDLES_PER_PAGE,
      currentPage * HANDLES_PER_PAGE
  );

  const handleDownload = () => {
    const csvData = reportData.map(item => ({
      Handle: getHandle(item),
      SKU: item.sku,
      Status: item.status,
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

  const handleFix = (fixType: MismatchDetail['field'], item: AuditResult) => {
      const productToFix = fixType === 'h1_tag' 
        ? item.shopifyProduct 
        : item.csvProduct;

      if (!productToFix || !item.shopifyProduct) {
          toast({ title: 'Error', description: 'Cannot fix item, missing product data.', variant: 'destructive' });
          return;
      }
      
      const fixPayload: Product = {
          ...productToFix,
          id: item.shopifyProduct.id,
          variantId: item.shopifyProduct.variantId,
          inventoryItemId: item.shopifyProduct.inventoryItemId,
          descriptionHtml: item.shopifyProduct.descriptionHtml,
      };

      startTransition(async () => {
          const result = await fixMismatch(fixType, fixPayload);
          if (result.success) {
              toast({ title: 'Success!', description: result.message });
              
              // --- Optimistic UI Update ---
              const newData = [...reportData];
              const itemIndex = newData.findIndex(d => d.sku === item.sku);
              if(itemIndex > -1) {
                  const updatedItem = { ...newData[itemIndex] };
                  updatedItem.mismatches = updatedItem.mismatches.filter(m => m.field !== fixType);

                  if (updatedItem.mismatches.length === 0) {
                      // Item is now matched, so remove it from the report
                      newData.splice(itemIndex, 1);
                      setReportSummary(prev => ({
                          ...prev,
                          mismatched: prev.mismatched - 1,
                          matched: (prev.matched ?? 0) + 1,
                      }));
                  } else {
                     // Still mismatched, but update the shopify product data for instant UI feedback
                     if (fixType === 'h1_tag' && updatedItem.shopifyProduct) {
                         updatedItem.shopifyProduct.descriptionHtml = updatedItem.shopifyProduct.descriptionHtml?.replace(/<h1/gi, '<h2').replace(/<\/h1>/gi, '</h2>') ?? null;
                     } else if (updatedItem.shopifyProduct && updatedItem.csvProduct) {
                        switch(fixType) {
                           case 'name': updatedItem.shopifyProduct.name = updatedItem.csvProduct.name; break;
                           case 'price': updatedItem.shopifyProduct.price = updatedItem.csvProduct.price; break;
                           case 'inventory': updatedItem.shopifyProduct.inventory = updatedItem.csvProduct.inventory; break;
                        }
                     }
                      newData[itemIndex] = updatedItem;
                  }

                  setReportData(newData);
                  setShowRefresh(true);
              }
              // No full refresh here
          } else {
              toast({ title: 'Fix Failed', description: result.message, variant: 'destructive' });
          }
      });
  };

  const handleCreate = (item: AuditResult) => {
    const productToCreate = item.csvProduct;
    const missingType = item.mismatches[0]?.missingType;

    if (!productToCreate || !missingType) {
        toast({ title: 'Error', description: 'Cannot create item, missing product data.', variant: 'destructive' });
        return;
    }
    
    // Find all variants with the same handle from the original full data set
    const allVariantsForHandle = data
      .filter(d => d.csvProduct?.handle === productToCreate.handle && d.status === 'missing_in_shopify')
      .map(d => d.csvProduct)
      .filter((p): p is Product => p !== null);

    if (allVariantsForHandle.length === 0) {
        toast({ title: 'Error', description: 'Could not find any variants to create for this handle.', variant: 'destructive' });
        return;
    }

    startTransition(async () => {
        const result = await createInShopify(productToCreate, allVariantsForHandle, missingType, fileName);
        if (result.success) {
            toast({ title: 'Success!', description: result.message });
            
            // --- Optimistic UI Update ---
            const handleToUpdate = productToCreate.handle;
            let itemsUpdatedCount = 0;

            const updatedData = reportData.filter(d => {
                const shouldRemove = d.csvProduct?.handle === handleToUpdate && d.status === 'missing_in_shopify';
                if(shouldRemove) {
                    itemsUpdatedCount++;
                }
                return !shouldRemove;
            });
            
            setReportData(updatedData);

            setReportSummary(prev => ({
                ...prev,
                missing_in_shopify: prev.missing_in_shopify - itemsUpdatedCount,
                matched: (prev.matched ?? 0) + itemsUpdatedCount,
            }));
            setShowRefresh(true);

        } else {
            toast({ title: 'Creation Failed', description: result.message, variant: 'destructive' });
        }
    });
  };

  const handleDeleteProduct = (item: AuditResult) => {
      const productToDelete = item.shopifyProduct;
      if (!productToDelete || !productToDelete.id) {
          toast({ title: 'Error', description: 'Cannot delete product, missing product ID.', variant: 'destructive' });
          return;
      }

      startTransition(async () => {
          const result = await deleteFromShopify(productToDelete.id);
          if (result.success) {
              toast({ title: 'Success!', description: result.message });
              // Optimistic UI update
              const newData = reportData.filter(d => d.shopifyProduct?.id !== productToDelete.id);
              setReportData(newData);
              setReportSummary(prev => ({
                  ...prev,
                  not_in_csv: prev.not_in_csv - 1, // This needs adjustment if deleting multiple variants
              }));
              setShowRefresh(true);
          } else {
              toast({ title: 'Delete Failed', description: result.message, variant: 'destructive' });
          }
      });
  };

  const handleDeleteVariant = (item: AuditResult) => {
      const variantToDelete = item.shopifyProduct;
      if (!variantToDelete || !variantToDelete.id || !variantToDelete.variantId) {
          toast({ title: 'Error', description: 'Cannot delete variant, missing ID.', variant: 'destructive' });
          return;
      }

      startTransition(async () => {
          const result = await deleteVariantFromShopify(variantToDelete.id, variantToDelete.variantId);
          if (result.success) {
              toast({ title: 'Success!', description: result.message });
              // Optimistic UI update
              const newData = reportData.filter(d => d.sku !== item.sku);
              setReportData(newData);
              setReportSummary(prev => ({
                  ...prev,
                  not_in_csv: prev.not_in_csv - 1,
              }));
              setShowRefresh(true);
          } else {
              toast({ title: 'Delete Failed', description: result.message, variant: 'destructive' });
          }
      });
  };


  const mismatchIcons: Record<MismatchDetail['field'], React.ReactElement> = {
    name: <TooltipContent>Name</TooltipContent>,
    price: <TooltipContent>Price</TooltipContent>,
    inventory: <TooltipContent>Inventory</TooltipContent>,
    h1_tag: <TooltipContent>H1 Tag</TooltipContent>,
    missing_in_shopify: <TooltipContent>Missing</TooltipContent>,
  };

  const MismatchIcon = ({field}: {field: MismatchDetail['field']}) => {
    const icons = {
      name: <Text className="h-4 w-4" />,
      price: <DollarSign className="h-4 w-4" />,
      inventory: <List className="h-4 w-4" />,
      h1_tag: <span className="text-xs font-bold">H1</span>,
      missing_in_shopify: <XCircle className="h-4 w-4" />,
    }
    return (
        <TooltipProvider>
          <Tooltip>
              <TooltipTrigger asChild>
                  <div className="p-1.5 bg-yellow-100 dark:bg-yellow-900/30 rounded-md">
                      {icons[field]}
                  </div>
              </TooltipTrigger>
              <TooltipContent>
                  <p className="capitalize">{field.replace('_', ' ')} Mismatch</p>
              </TooltipContent>
          </Tooltip>
        </TooltipProvider>
    )
  }

  const handleFilterChange = (newFilter: FilterType) => {
    setFilter(newFilter);
    setCurrentPage(1);
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex justify-between items-start">
          <div>
            <CardTitle>Audit Report</CardTitle>
            <CardDescription>
              Comparison of product data between your CSV file and Shopify. Products are grouped by handle.
            </CardDescription>
             <div className="flex items-center text-sm text-muted-foreground mt-2">
                <FileText className="h-4 w-4 mr-2" />
                <span className="font-medium">Auditing File:</span>
                <code className="ml-2 text-primary bg-primary/10 px-2 py-1 rounded-md">{fileName}</code>
            </div>
          </div>
          { isFixing && 
            <div className="flex items-center gap-2 text-sm text-muted-foreground p-2 rounded-md bg-card-foreground/5">
              <Loader2 className="h-4 w-4 animate-spin"/>
              Applying changes...
            </div>
          }
        </div>
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-card border shadow-sm">
                <AlertTriangle className="w-6 h-6 text-yellow-500 shrink-0" />
                <div>
                    <div className="text-xl font-bold">{reportSummary.mismatched}</div>
                    <div className="text-xs text-muted-foreground">SKUs Mismatched</div>
                </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-card border shadow-sm">
                <XCircle className="w-6 h-6 text-red-500 shrink-0" />
                <div>
                    <div className="text-xl font-bold">{reportSummary.missing_in_shopify}</div>
                    <div className="text-xs text-muted-foreground">SKUs Missing in Shopify</div>
                </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-card border shadow-sm">
                <PlusCircle className="w-6 h-6 text-blue-500 shrink-0" />
                <div>
                    <div className="text-xl font-bold">{reportSummary.not_in_csv}</div>
                    <div className="text-xs text-muted-foreground">SKUs Not in CSV</div>
                </div>
            </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col sm:flex-row justify-between items-center mb-4 gap-4">
          <div className="flex flex-wrap gap-2">
            {(['all', 'mismatched', 'missing_in_shopify', 'not_in_csv'] as const).map(f => {
                const config = statusConfig[f as keyof typeof statusConfig];
                 const count = f === 'all' 
                    ? filteredData.length 
                    : (reportSummary as any)[f];

                // Don't render filter button if there are no items for that status
                if (count === 0 && f !== 'all') return null;

                return (
                    <Button key={f} variant={filter === f ? 'default' : 'outline'} size="sm" onClick={() => handleFilterChange(f)} disabled={isFixing}>
                       {f === 'all' ? 'All' : config.text} ({f === 'all' ? handleKeys.length : count})
                    </Button>
                )
             })}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onReset} disabled={isFixing}><ArrowLeft className="mr-2 h-4 w-4" />New Audit</Button>
            {showRefresh && <Button variant="secondary" onClick={onRefresh} disabled={isFixing}><RefreshCw className="mr-2 h-4 w-4" />Refresh Data</Button>}
            <Button onClick={handleDownload} disabled={isFixing}><Download className="mr-2 h-4 w-4" />Download Report</Button>
          </div>
        </div>
        <div className="rounded-md border">
            {paginatedHandleKeys.length > 0 ? (
                <Accordion type="multiple" className="w-full">
                    {paginatedHandleKeys.map((handle) => {
                         const items = groupedByHandle[handle];
                         const productTitle = items[0].csvProduct?.name || items[0].shopifyProduct?.name || handle;
                         const hasMismatch = items.some(i => i.status === 'mismatched');
                         const isMissing = items.every(i => i.status === 'missing_in_shopify');
                         const notInCsv = items.every(i => i.status === 'not_in_csv');
                         
                         const uniqueMismatchTypes = new Set<MismatchDetail['field']>();
                         if(hasMismatch) {
                             items.forEach(item => {
                                 item.mismatches.forEach(mismatch => {
                                     uniqueMismatchTypes.add(mismatch.field);
                                 });
                             });
                         }

                         const overallStatus: AuditStatus = hasMismatch ? 'mismatched' 
                             : isMissing ? 'missing_in_shopify'
                             : notInCsv ? 'not_in_csv'
                             : 'mismatched'; // Fallback, should not happen with current filter
                         
                         if (overallStatus === 'mismatched' && !hasMismatch && !isMissing && !notInCsv) {
                             return null;
                         }

                         const config = statusConfig[overallStatus];

                         const allVariantsForHandleInShopify = data.filter(d => d.shopifyProduct?.handle === handle);
                         const isOnlyVariantNotInCsv = notInCsv && allVariantsForHandleInShopify.length === items.length;

                        return (
                        <AccordionItem value={handle} key={handle}>
                            <AccordionTrigger className="px-4 hover:no-underline" disabled={isFixing}>
                                <div className="flex items-center gap-4 w-full">
                                    <config.icon className={`w-5 h-5 shrink-0 ${
                                            overallStatus === 'mismatched' ? 'text-yellow-500' 
                                            : overallStatus === 'missing_in_shopify' ? 'text-red-500'
                                            : 'text-blue-500'
                                    }`} />
                                    <div className="flex-grow text-left">
                                        <p className="font-semibold">{productTitle}</p>
                                        <p className="text-sm text-muted-foreground">{handle}</p>
                                    </div>
                                    {hasMismatch && (
                                        <div className="flex items-center gap-1.5 text-yellow-600">
                                            {Array.from(uniqueMismatchTypes).map(field => (
                                                <MismatchIcon key={field} field={field} />
                                            ))}
                                        </div>
                                    )}
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
                                            <TableHead className="w-[240px] text-right">Actions</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {items.map((item, index) => {
                                            const itemConfig = statusConfig[item.status];
                                            const productForDetails = item.csvProduct || item.shopifyProduct;
                                            
                                            return (
                                                <TableRow key={item.sku} className={
                                                    item.status === 'mismatched' ? 'bg-yellow-50/50 dark:bg-yellow-900/10' :
                                                    item.status === 'missing_in_shopify' ? 'bg-red-50/50 dark:bg-red-900/10' :
                                                    item.status === 'not_in_csv' ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''
                                                }>
                                                    <TableCell className="font-medium">{item.sku}</TableCell>
                                                    <TableCell>
                                                    <Badge variant="outline" className={`whitespace-nowrap ${itemConfig.badgeClass}`}>
                                                        <itemConfig.icon className="mr-1.5 h-3.5 w-3.5" />
                                                        {itemConfig.text}
                                                    </Badge>
                                                    </TableCell>
                                                     <TableCell>
                                                        <div>
                                                            {item.status === 'mismatched' && <MismatchDetails mismatches={item.mismatches} onFix={(fixType) => handleFix(fixType, item)} disabled={isFixing}/>}
                                                            {item.status === 'missing_in_shopify' && item.csvProduct && (
                                                                <p className="text-sm text-muted-foreground">
                                                                    This SKU is in your CSV but is a{' '}
                                                                    <span className="font-semibold text-foreground">
                                                                        {item.mismatches[0]?.missingType === 'product' ? 'Missing Product' : 'Missing Variant'}
                                                                    </span>.
                                                                </p>
                                                            )}
                                                            {item.status === 'not_in_csv' && <p className="text-sm text-muted-foreground">This product exists in Shopify but not in your CSV file.</p>}
                                                            <ProductDetails product={productForDetails} />
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        <div className="flex justify-end items-center gap-2">
                                                            {item.status === 'missing_in_shopify' && item.csvProduct && (
                                                                <MissingProductDetailsDialog product={item.csvProduct} />
                                                            )}
                                                            {isMissing && index === 0 && (
                                                                <Button size="sm" onClick={() => handleCreate(item)} disabled={isFixing}>
                                                                    <PlusCircle className="mr-2 h-4 w-4" />
                                                                    Create Product
                                                                </Button>
                                                            )}
                                                            
                                                             {item.status === 'not_in_csv' && !isOnlyVariantNotInCsv && (
                                                                <AlertDialog>
                                                                    <AlertDialogTrigger asChild>
                                                                        <Button size="sm" variant="destructive" disabled={isFixing}>
                                                                            <Trash2 className="mr-2 h-4 w-4" /> Delete Variant
                                                                        </Button>
                                                                    </AlertDialogTrigger>
                                                                    <AlertDialogContent>
                                                                        <AlertDialogHeader>
                                                                            <AlertDialogTitle>Delete this variant?</AlertDialogTitle>
                                                                            <AlertDialogDescription>
                                                                                This will permanently delete the variant with SKU "{item.sku}" from Shopify. This action cannot be undone.
                                                                            </AlertDialogDescription>
                                                                        </AlertDialogHeader>
                                                                        <AlertDialogFooter>
                                                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                                            <AlertDialogAction onClick={() => handleDeleteVariant(item)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                                                                Yes, delete variant
                                                                            </AlertDialogAction>
                                                                        </AlertDialogFooter>
                                                                    </AlertDialogContent>
                                                                </AlertDialog>
                                                            )}

                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })}
                                         {notInCsv && isOnlyVariantNotInCsv && (
                                                <TableRow>
                                                    <TableCell colSpan={4} className="text-right p-2">
                                                         <AlertDialog>
                                                            <AlertDialogTrigger asChild>
                                                                <Button size="sm" variant="destructive" disabled={isFixing}>
                                                                    <Trash2 className="mr-2 h-4 w-4" /> Delete Entire Product
                                                                </Button>
                                                            </AlertDialogTrigger>
                                                            <AlertDialogContent>
                                                                <AlertDialogHeader>
                                                                    <AlertDialogTitle>Delete this entire product?</AlertDialogTitle>
                                                                    <AlertDialogDescription>
                                                                        All variants for "{productTitle}" are not in the CSV. This will permanently delete the entire product and its {items.length} variants from Shopify. This action cannot be undone.
                                                                    </AlertDialogDescription>
                                                                </AlertDialogHeader>
                                                                <AlertDialogFooter>
                                                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                                    <AlertDialogAction onClick={() => handleDeleteProduct(items[0])} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                                                        Yes, delete product
                                                                    </AlertDialogAction>
                                                                </AlertDialogFooter>
                                                            </AlertDialogContent>
                                                        </AlertDialog>
                                                    </TableCell>
                                                </TableRow>
                                            )}
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

        {totalPages > 1 && (
            <div className="flex items-center justify-end gap-4 mt-4">
                <span className="text-sm text-muted-foreground">
                    Page {currentPage} of {totalPages}
                </span>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                    disabled={currentPage === 1 || isFixing}
                >
                    Previous
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                    disabled={currentPage === totalPages || isFixing}
                >
                    Next
                </Button>
            </div>
        )}
      </CardContent>
    </Card>
  );
}

    