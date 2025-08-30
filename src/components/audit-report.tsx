
'use client';

import { useState, useTransition, useEffect, useMemo } from 'react';
import { AuditResult, AuditStatus, DuplicateSku, MismatchDetail, Product, Summary } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { downloadCsv, markMismatchAsFixed, getFixedMismatches, clearFixedMismatches } from '@/lib/utils';
import { CheckCircle2, AlertTriangle, PlusCircle, ArrowLeft, Download, XCircle, Wrench, Siren, Loader2, RefreshCw, Text, DollarSign, List, Weight, FileText, Eye, Trash2, Search, Image as ImageIcon, FileWarning, Bot, Eraser } from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { fixMultipleMismatches, createInShopify, deleteFromShopify, deleteVariantFromShopify } from '@/app/actions';
import { useToast } from '@/hooks/use-toast';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MediaManager } from '@/components/media-manager';
import { PreCreationMediaManager } from '@/components/pre-creation-media-manager';
import { Separator } from './ui/separator';


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
            {mismatches.map((mismatch, index) => {
                const canBeFixed = mismatch.field !== 'duplicate_sku';
                return (
                     <div key={index} className="flex items-center gap-2 text-xs p-2 rounded-md bg-yellow-50 dark:bg-yellow-900/20">
                         <AlertTriangle className="h-4 w-4 text-yellow-600 shrink-0" />
                        <div className="flex-grow">
                            <span className="font-semibold capitalize">{mismatch.field.replace(/_/g, ' ')}: </span>
                            {mismatch.field === 'h1_tag' && (
                                 <span className="text-muted-foreground">Product description contains an H1 tag.</span>
                            )}
                            {mismatch.field === 'duplicate_sku' && (
                                <span className="text-muted-foreground">SKU exists multiple times in the source CSV.</span>
                            )}
                            {mismatch.field !== 'h1_tag' && mismatch.field !== 'duplicate_sku' && (
                                 <>
                                    <span className="text-red-500 line-through mr-2">{mismatch.shopifyValue ?? 'N/A'}</span>
                                    <span className="text-green-500">{mismatch.csvValue ?? 'N/A'}</span>
                                </>
                            )}
                        </div>
                         {canBeFixed && (
                             <Button size="sm" variant="ghost" className="h-7" onClick={() => onFix(mismatch.field)} disabled={disabled}>
                                <Wrench className="mr-1.5 h-3.5 w-3.5" />
                                Fix
                            </Button>
                         )}
                    </div>
                )
            })}
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
        { label: "Variant Cost", value: product.costPerItem ? `$${product.costPerItem.toFixed(2) ?? 'N/A'}` : 'N/A', notes: "From 'Cost Per Item' column" },
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
};

const HANDLES_PER_PAGE = 20;

const MISMATCH_FILTER_TYPES: MismatchDetail['field'][] = ['name', 'price', 'inventory', 'h1_tag', 'duplicate_sku'];

export default function AuditReport({ data, summary, duplicates, fileName, onReset, onRefresh }: { data: AuditResult[], summary: Summary, duplicates: DuplicateSku[], fileName: string, onReset: () => void, onRefresh: () => void }) {
  const [filter, setFilter] = useState<FilterType>('all');
  const [isFixing, startTransition] = useTransition();
  const { toast } = useToast();
  
  const [reportData, setReportData] = useState<AuditResult[]>(data);
  const [reportSummary, setReportSummary] = useState<Summary>(summary);
  const [showRefresh, setShowRefresh] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [mismatchFilters, setMismatchFilters] = useState<Set<MismatchDetail['field']>>(new Set());
  const [selectedVendor, setSelectedVendor] = useState<string>('all');
  const [editingMissingMedia, setEditingMissingMedia] = useState<string | null>(null);
  const [selectedHandles, setSelectedHandles] = useState<Set<string>>(new Set());
  const [fixedMismatches, setFixedMismatches] = useState<Set<string>>(new Set());

  useEffect(() => {
    setReportData(data);
    setReportSummary(summary);
    setShowRefresh(false);
    setCurrentPage(1);
    setSelectedHandles(new Set());
    setFixedMismatches(getFixedMismatches());
  }, [data, summary]);

  const uniqueVendors = useMemo(() => {
    const vendors = new Set<string>();
    data.forEach(item => {
        if (item.status === 'not_in_csv' && item.shopifyProduct?.vendor) {
            vendors.add(item.shopifyProduct.vendor);
        }
    });
    return ['all', ...Array.from(vendors).sort()];
  }, [data]);


  const filteredData = useMemo(() => {
    // Start with the raw report data
    let results: AuditResult[] = reportData.map(item => {
        // If the item has mismatches, filter out any that have been fixed
        if (item.mismatches && item.mismatches.length > 0) {
            const remainingMismatches = item.mismatches.filter(m => !fixedMismatches.has(`${item.sku}-${m.field}`));
            // If all mismatches were fixed, we could potentially treat this item as 'matched'
            // For now, we'll just remove the fixed mismatches from the list.
            return { ...item, mismatches: remainingMismatches };
        }
        return item;
    }).filter(item => {
        // Remove items from the report if their only status was 'mismatched' and all mismatches are now fixed
        if (item.status === 'mismatched' && item.mismatches.length === 0) {
            return false;
        }
        return true;
    });

    // 1. Filter by main tab
    if (filter !== 'all') {
        results = results.filter(item => item.status === filter);
    }
    
    // 2. Filter by search term
    if (searchTerm) {
        const lowercasedTerm = searchTerm.toLowerCase();
        results = results.filter(item => {
            const product = item.csvProduct || item.shopifyProduct;
            return (
                item.sku.toLowerCase().includes(lowercasedTerm) ||
                (product && product.handle.toLowerCase().includes(lowercasedTerm)) ||
                (product && product.name.toLowerCase().includes(lowercasedTerm))
            );
        });
    }

    // 3. Apply tab-specific filters
    if (filter === 'mismatched' && mismatchFilters.size > 0) {
        results = results.filter(item => 
            item.mismatches.some(mismatch => mismatchFilters.has(mismatch.field))
        );
    }
    
    if (filter === 'not_in_csv' && selectedVendor !== 'all') {
        results = results.filter(item => item.shopifyProduct?.vendor === selectedVendor);
    }

    return results;
  }, [reportData, filter, searchTerm, mismatchFilters, selectedVendor, fixedMismatches]);

  const groupedByHandle = useMemo(() => {
      return filteredData.reduce((acc, item) => {
        const handle = getHandle(item);
        if (!acc[handle]) {
          acc[handle] = [];
        }
        acc[handle].push(item);
        return acc;
      }, {} as Record<string, AuditResult[]>);
  }, [filteredData]);


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
  
  const handleBulkFix = (itemsToFix: AuditResult[]) => {
      setShowRefresh(true);
      
      startTransition(async () => {
          const result = await fixMultipleMismatches(itemsToFix);
           if (result.success && result.results.length > 0) {
              toast({ title: 'Bulk Fix Complete!', description: result.message });
              const newFixed = new Set(fixedMismatches);
              result.results.forEach(fixedItem => {
                markMismatchAsFixed(fixedItem.sku, fixedItem.field);
                newFixed.add(`${fixedItem.sku}-${fixedItem.field}`);
              });
              setFixedMismatches(newFixed);
          } else {
              toast({ title: 'Bulk Fix Failed', description: result.message || "No items were fixed.", variant: 'destructive' });
          }
          setSelectedHandles(new Set());
      });
  }

  const handleFixSingleItem = (item: AuditResult) => {
     handleBulkFix([item]);
  };
  
  const handleFixSelected = () => {
      const itemsToFix = reportData.filter(item => 
          item.status === 'mismatched' && selectedHandles.has(getHandle(item))
      );
      if (itemsToFix.length > 0) {
          handleBulkFix(itemsToFix);
      } else {
          toast({ title: "No items to fix", description: "Please select products with mismatches to fix.", variant: "destructive" });
      }
  };


  const handleCreate = (item: AuditResult) => {
    const productToCreate = item.csvProduct;
    const missingType = item.mismatches[0]?.missingType;

    if (!productToCreate || !missingType) {
        toast({ title: 'Error', description: 'Cannot create item, missing product data.', variant: 'destructive' });
        return;
    }
    
    // Use the potentially modified reportData to get the latest variants
    const allVariantsForHandle = reportData
      .filter(d => d.csvProduct?.handle === productToCreate.handle && d.status === 'missing_in_shopify')
      .map(d => d.csvProduct)
      .filter((p): p is Product => p !== null);

    if (allVariantsForHandle.length === 0) {
        toast({ title: 'Error', description: 'Could not find any variants to create for this handle.', variant: 'destructive' });
        return;
    }
    
    setShowRefresh(true);
    const originalData = [...reportData];
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


    startTransition(async () => {
        const result = await createInShopify(productToCreate, allVariantsForHandle, fileName);
        if (result.success) {
            toast({ title: 'Success!', description: result.message });
        } else {
            toast({ title: 'Creation Failed', description: result.message, variant: 'destructive' });
            setReportData(originalData);
            setReportSummary(summary);
        }
    });
  };

  const handleDeleteProduct = (item: AuditResult) => {
      const productToDelete = item.shopifyProduct;
      if (!productToDelete || !productToDelete.id) {
          toast({ title: 'Error', description: 'Cannot delete product, missing product ID.', variant: 'destructive' });
          return;
      }

      setShowRefresh(true);
      const originalData = [...reportData];
      const itemsInHandle = reportData.filter(d => d.shopifyProduct?.handle === productToDelete.handle).length;
      const newData = reportData.filter(d => d.shopifyProduct?.handle !== productToDelete.handle);
      setReportData(newData);
      setReportSummary(prev => ({
          ...prev,
          not_in_csv: prev.not_in_csv - itemsInHandle,
      }));


      startTransition(async () => {
          const result = await deleteFromShopify(productToDelete.id);
          if (result.success) {
              toast({ title: 'Success!', description: result.message });
          } else {
              toast({ title: 'Delete Failed', description: result.message, variant: 'destructive' });
              setReportData(originalData);
              setReportSummary(summary);
          }
      });
  };

  const handleDeleteVariant = (item: AuditResult) => {
      const variantToDelete = item.shopifyProduct;
      if (!variantToDelete || !variantToDelete.id || !variantToDelete.variantId) {
          toast({ title: 'Error', description: 'Cannot delete variant, missing ID.', variant: 'destructive' });
          return;
      }
      
      setShowRefresh(true);
      const originalData = [...reportData];
      const newData = reportData.filter(d => d.sku !== item.sku);
      setReportData(newData);
      setReportSummary(prev => ({
          ...prev,
          not_in_csv: prev.not_in_csv - 1,
      }));

      startTransition(async () => {
          const result = await deleteVariantFromShopify(variantToDelete.id, variantToDelete.variantId);
          if (result.success) {
              toast({ title: 'Success!', description: result.message });
          } else {
              toast({ title: 'Delete Failed', description: result.message, variant: 'destructive' });
              setReportData(originalData);
              setReportSummary(summary);
          }
      });
  };

    const handleSavePreCreationMedia = (updatedVariants: Product[]) => {
        setReportData(currentReportData => {
            const newReportData = currentReportData.map(auditResult => {
                // Find the matching variant in the updated list
                const updatedVariant = updatedVariants.find(uv => uv.sku === auditResult.csvProduct?.sku);
                // If this auditResult corresponds to one of the updated variants, update it
                if (auditResult.csvProduct && updatedVariant) {
                    return {
                        ...auditResult,
                        csvProduct: {
                            ...auditResult.csvProduct,
                            mediaUrl: updatedVariant.mediaUrl,
                        },
                    };
                }
                // Otherwise, return the original auditResult
                return auditResult;
            });
            return newReportData;
        });
        setEditingMissingMedia(null);
         toast({
            title: "Media Saved",
            description: "Image assignments have been updated. Click 'Create Product' to finalize.",
        });
    };

  const MismatchIcon = ({field}: {field: MismatchDetail['field']}) => {
    const icons: { [key in MismatchDetail['field']]: React.ReactNode } = {
      name: <Text className="h-4 w-4" />,
      price: <DollarSign className="h-4 w-4" />,
      inventory: <List className="h-4 w-4" />,
      h1_tag: <span className="text-xs font-bold">H1</span>,
      duplicate_sku: <FileWarning className="h-4 w-4" />,
      missing_in_shopify: <XCircle className="h-4 w-4" />,
    };
    return (
        <TooltipProvider>
          <Tooltip>
              <TooltipTrigger asChild>
                  <div className="p-1.5 bg-yellow-100 dark:bg-yellow-900/30 rounded-md">
                      {icons[field]}
                  </div>
              </TooltipTrigger>
              <TooltipContent>
                  <p className="capitalize">{field.replace(/_/g, ' ')}</p>
              </TooltipContent>
          </Tooltip>
        </TooltipProvider>
    )
  }

  const handleFilterChange = (newFilter: FilterType) => {
    setFilter(newFilter);
    setCurrentPage(1);
    setSearchTerm('');
    setMismatchFilters(new Set());
    setSelectedVendor('all');
    setSelectedHandles(new Set());
  }
  
  const handleMismatchFilterChange = (field: MismatchDetail['field'], checked: boolean) => {
    setCurrentPage(1);
    setMismatchFilters(prev => {
        const newSet = new Set(prev);
        if (checked) {
            newSet.add(field);
        } else {
            newSet.delete(field);
        }
        return newSet;
    });
  };

  const handleSelectHandle = (handle: string, checked: boolean) => {
    setSelectedHandles(prev => {
        const newSet = new Set(prev);
        if(checked) {
            newSet.add(handle);
        } else {
            newSet.delete(handle);
        }
        return newSet;
    })
  }
  
  const handleClearFixedMismatches = () => {
    clearFixedMismatches();
    setFixedMismatches(new Set());
    toast({ title: "Cleared 'Remembered' Fixes", description: "The report is now showing all original mismatches. Run a new bulk audit for the latest data." });
  }

  const editingMissingMediaVariants = useMemo(() => {
    if (!editingMissingMedia) return [];
    return reportData
      .filter(d => d.csvProduct?.handle === editingMissingMedia && d.status === 'missing_in_shopify')
      .map(d => d.csvProduct)
      .filter((p): p is Product => p !== null);
  }, [editingMissingMedia, reportData]);
  
  const currentSummary = useMemo(() => {
      return filteredData.reduce((acc, item) => {
          if(item.status === 'mismatched' && item.mismatches.length > 0) acc.mismatched++;
          if(item.status === 'missing_in_shopify') acc.missing_in_shopify++;
          if(item.status === 'not_in_csv') acc.not_in_csv++;
          return acc;
      }, { mismatched: 0, missing_in_shopify: 0, not_in_csv: 0 });
  }, [filteredData]);

  return (
    <>
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
         {duplicates.length > 0 && filter !== 'mismatched' && (
            <Alert variant="destructive" className="mt-4">
                <Siren className="h-4 w-4" />
                <AlertTitle>Duplicate SKUs Found in CSV!</AlertTitle>
                <AlertDescription>
                    Your CSV file contains {duplicates.length} duplicated SKUs. These are marked as mismatches in the report but must be fixed in the source file.
                </AlertDescription>
            </Alert>
        )}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-card border shadow-sm">
                <AlertTriangle className="w-6 h-6 text-yellow-500 shrink-0" />
                <div>
                    <div className="text-xl font-bold">{currentSummary.mismatched}</div>
                    <div className="text-xs text-muted-foreground">SKUs Mismatched</div>
                </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-card border shadow-sm">
                <XCircle className="w-6 h-6 text-red-500 shrink-0" />
                <div>
                    <div className="text-xl font-bold">{currentSummary.missing_in_shopify}</div>
                    <div className="text-xs text-muted-foreground">SKUs Missing in Shopify</div>
                </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-card border shadow-sm">
                <PlusCircle className="w-6 h-6 text-blue-500 shrink-0" />
                <div>
                    <div className="text-xl font-bold">{currentSummary.not_in_csv}</div>
                    <div className="text-xs text-muted-foreground">SKUs Not in CSV</div>
                </div>
            </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col sm:flex-row justify-between items-center mb-4 gap-4">
          <div className="flex flex-wrap gap-2">
            {(['all', 'mismatched', 'missing_in_shopify', 'not_in_csv'] as const).map(f => {
                const count = f === 'all' 
                    ? filteredData.length
                    : currentSummary[f];
                const config = statusConfig[f as keyof typeof statusConfig];
                if (count === 0 && f !== 'all') return null;

                return (
                    <Button key={f} variant={filter === f ? 'default' : 'outline'} size="sm" onClick={() => handleFilterChange(f)} disabled={isFixing}>
                       {f === 'all' ? 'All Items' : config.text} ({count})
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

        <div className="flex flex-col md:flex-row gap-4 mb-4 p-4 border rounded-lg">
            <div className="relative flex-grow">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder="Filter by Handle, SKU, or Title..."
                    value={searchTerm}
                    onChange={(e) => {
                        setCurrentPage(1);
                        setSearchTerm(e.target.value);
                    }}
                    className="pl-10"
                    disabled={isFixing}
                />
            </div>
            {filter === 'mismatched' && (
                 <Popover>
                    <PopoverTrigger asChild>
                        <Button variant="outline" className="w-full md:w-auto">
                            <List className="mr-2 h-4 w-4" />
                            Filter Mismatches ({mismatchFilters.size > 0 ? `${mismatchFilters.size} selected` : 'All'})
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-60 p-0">
                        <div className="p-4">
                            <h4 className="font-medium leading-none mb-4">Mismatch Types</h4>
                            <div className="space-y-2">
                                {MISMATCH_FILTER_TYPES.map(type => (
                                    <div key={type} className="flex items-center space-x-2">
                                        <Checkbox
                                            id={type}
                                            checked={mismatchFilters.has(type)}
                                            onCheckedChange={(checked) => handleMismatchFilterChange(type, !!checked)}
                                        />
                                        <Label htmlFor={type} className="font-normal capitalize">{type.replace(/_/g, ' ')}</Label>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <Separator />
                        <div className="p-2">
                           <Button variant="ghost" size="sm" className="w-full justify-start" onClick={handleClearFixedMismatches}>
                             <Eraser className="mr-2 h-4 w-4"/>
                             Clear remembered fixes
                           </Button>
                        </div>
                    </PopoverContent>
                </Popover>
            )}
            {filter === 'not_in_csv' && (
                <Select value={selectedVendor} onValueChange={(value) => {setCurrentPage(1); setSelectedVendor(value)}}>
                    <SelectTrigger className="w-full md:w-[200px]">
                        <SelectValue placeholder="Filter by vendor..." />
                    </SelectTrigger>
                    <SelectContent>
                        {uniqueVendors.map(vendor => (
                            <SelectItem key={vendor} value={vendor}>
                                {vendor === 'all' ? 'All Vendors' : vendor}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            )}
            {filter === 'mismatched' && selectedHandles.size > 0 && (
                <Button onClick={handleFixSelected} disabled={isFixing} className="w-full md:w-auto">
                    <Bot className="mr-2 h-4 w-4" />
                    Fix {selectedHandles.size} Selected
                </Button>
            )}
        </div>


        <div className="rounded-md border">
            {paginatedHandleKeys.length > 0 ? (
                <Accordion type="multiple" className="w-full">
                    {paginatedHandleKeys.map((handle) => {
                         const items = groupedByHandle[handle];
                         const productTitle = items[0].csvProduct?.name || items[0].shopifyProduct?.name || handle;
                         const hasMismatch = items.some(i => i.status === 'mismatched' && i.mismatches.some(m => m.field !== 'duplicate_sku'));
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

                         const overallStatus: AuditStatus | 'matched' = items.some(i => i.status === 'mismatched' && i.mismatches.length > 0) ? 'mismatched' 
                             : isMissing ? 'missing_in_shopify'
                             : notInCsv ? 'not_in_csv'
                             : 'matched';
                         
                         if (overallStatus === 'matched') {
                             return null;
                         }
                         
                         const config = statusConfig[overallStatus];
                         
                         const allVariantsForHandleInShopify = data.filter(d => d.shopifyProduct?.handle === handle);
                         const isOnlyVariantNotInCsv = notInCsv && allVariantsForHandleInShopify.length === items.length;

                        return (
                        <AccordionItem value={handle} key={handle} className="border-b last:border-b-0">
                            <div className="grid grid-cols-[auto_1fr_auto] items-center">
                                 {filter === 'mismatched' && (
                                    <div className="p-4">
                                         <Checkbox
                                            checked={selectedHandles.has(handle)}
                                            onCheckedChange={(checked) => handleSelectHandle(handle, !!checked)}
                                            aria-label={`Select product ${handle}`}
                                        />
                                    </div>
                                )}
                                <AccordionTrigger className={`grid grid-cols-[auto_1fr] items-center gap-4 py-3 text-left hover:no-underline ${filter !== 'mismatched' ? 'px-4' : ''}`} disabled={isFixing}>
                                    <config.icon className={`w-5 h-5 shrink-0 ${
                                        overallStatus === 'mismatched' ? 'text-yellow-500' 
                                        : overallStatus === 'missing_in_shopify' ? 'text-red-500'
                                        : 'text-blue-500'
                                    }`} />
                                    <div className="flex-grow">
                                        <p className="font-semibold">{productTitle}</p>
                                        <p className="text-sm text-muted-foreground">{handle}</p>
                                    </div>
                                </AccordionTrigger>

                                <div className="flex items-center justify-end gap-2 px-4">
                                     {items.some(i => i.status === 'mismatched' && i.mismatches.length > 0) && (
                                        <Button size="sm" onClick={() => handleBulkFix(items.filter(i => i.status === 'mismatched'))} disabled={isFixing}>
                                            <Bot className="mr-2 h-4 w-4" />
                                            Fix All ({items.flatMap(i => i.mismatches).filter(m => m.field !== 'duplicate_sku').length})
                                        </Button>
                                    )}
                                    <Badge variant="outline" className="w-[80px] justify-center">{items.length} SKU{items.length > 1 ? 's' : ''}</Badge>
                                    
                                    {items[0].shopifyProduct?.id && (
                                        <Dialog>
                                            <DialogTrigger asChild>
                                                <Button size="sm" variant="outline" className="w-[160px]">
                                                    <ImageIcon className="mr-2 h-4 w-4" />
                                                    Manage Media
                                                </Button>
                                            </DialogTrigger>
                                            <MediaManager productId={items[0].shopifyProduct!.id} />
                                        </Dialog>
                                    )}
                                    {isMissing && (
                                        <Button size="sm" variant="outline" className="w-[160px]" onClick={() => setEditingMissingMedia(handle)}>
                                            <ImageIcon className="mr-2 h-4 w-4" />
                                            Manage Media
                                        </Button>
                                    )}
                                </div>
                            </div>
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
                                            const itemConfig = statusConfig[item.status as Exclude<AuditStatus, 'matched'>];
                                            const productForDetails = item.csvProduct || item.shopifyProduct;
                                            
                                            if (item.status === 'mismatched' && item.mismatches.length === 0) return null;

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
                                                            {item.status === 'mismatched' && item.mismatches.length > 0 && <MismatchDetails mismatches={item.mismatches} onFix={(fixType) => handleBulkFix([item])} disabled={isFixing}/>}
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
                        )
                    })}
                </Accordion>
            ) : (
                <div className="h-48 text-center flex flex-col items-center justify-center text-muted-foreground">
                    <Search className="h-10 w-10 mb-4" />
                    <h3 className="font-semibold text-lg text-foreground">No Results Found</h3>
                    <p>Your search or filter combination returned no results.</p>
                    <p>Try adjusting your filters or clearing the search term.</p>
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
      <Dialog open={!!editingMissingMedia} onOpenChange={(open) => !open && setEditingMissingMedia(null)}>
        <PreCreationMediaManager
            key={editingMissingMedia} 
            variants={editingMissingMediaVariants}
            onSave={handleSavePreCreationMedia}
            onCancel={() => setEditingMissingMedia(null)}
        />
    </Dialog>
    </>
  );
}

    

    