

'use client';

import { useState, useTransition, useEffect, useMemo, useCallback, useRef } from 'react';
import { AuditResult, AuditStatus, DuplicateSku, MismatchDetail, Product, ShopifyProductImage } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { downloadCsv, markMismatchAsFixed, getFixedMismatches, clearAuditMemory, getCreatedProductHandles, markProductAsCreated } from '@/lib/utils';
import { CheckCircle2, AlertTriangle, PlusCircle, ArrowLeft, Download, XCircle, Wrench, Siren, Loader2, RefreshCw, Text, DollarSign, List, FileText, Eye, Trash2, Search, Image as ImageIcon, FileWarning, Bot, Eraser, Check, Link, Copy, Sparkles, SquarePlay, SquareX, Wand2 } from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger, AccordionHeader } from '@/components/ui/accordion';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { fixMultipleMismatches, createInShopify, createMultipleInShopify, deleteFromShopify, deleteVariantFromShopify, getProductImageCounts, deleteUnlinkedImagesForMultipleProducts, getProductByHandleServer, createMultipleVariantsForProduct, addImageFromUrl } from '@/app/actions';
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
import { cn } from '@/lib/utils';


type FilterType = 'all' | 'mismatched' | 'missing_in_shopify' | 'not_in_csv' | 'duplicate_in_shopify';

const statusConfig: { [key in Exclude<AuditStatus, 'matched'>]: { icon: React.ElementType, text: string, badgeClass: string } } = {
  mismatched: { icon: AlertTriangle, text: 'Mismatched', badgeClass: 'bg-yellow-100 text-yellow-800 border-yellow-200 hover:bg-yellow-100 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-700' },
  not_in_csv: { icon: PlusCircle, text: 'Not in CSV', badgeClass: 'bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700' },
  missing_in_shopify: { icon: XCircle, text: 'Missing in Shopify', badgeClass: 'bg-red-100 text-red-800 border-red-200 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700' },
  duplicate_in_shopify: { icon: Copy, text: 'Duplicate in Shopify', badgeClass: 'bg-purple-100 text-purple-800 border-purple-200 hover:bg-purple-100 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700' },
};

const getHandle = (item: AuditResult) => item.shopifyProducts[0]?.handle || item.csvProducts[0]?.handle || `no-handle-${item.sku}`;

const MismatchDetails = ({ mismatches, onFix, onMarkAsFixed, disabled, sku }: { mismatches: MismatchDetail[], onFix: (fixType: MismatchDetail['field']) => void, onMarkAsFixed: (fixType: MismatchDetail['field']) => void, disabled: boolean, sku: string }) => {
    return (
        <div className="flex flex-col gap-2 mt-2">
            {mismatches.map((mismatch, index) => {
                const canBeFixed = mismatch.field !== 'duplicate_in_shopify' && mismatch.field !== 'heavy_product_flag';
                const isWarningOnly = mismatch.field === 'heavy_product_flag';

                return (
                     <div key={`${sku}-${mismatch.field}-${index}`} className="flex items-center gap-2 text-xs p-2 rounded-md bg-yellow-50 dark:bg-yellow-900/20">
                         <AlertTriangle className="h-4 w-4 text-yellow-600 shrink-0" />
                        <div className="flex-grow">
                            <span className="font-semibold capitalize">{mismatch.field.replace(/_/g, ' ')}: </span> 
                            {mismatch.field === 'h1_tag' && (
                                 <span className="text-muted-foreground">Product description contains an H1 tag.</span>
                            )}
                            {mismatch.field === 'duplicate_in_shopify' && (
                                <span className="text-muted-foreground">SKU exists multiple times in Shopify.</span>
                            )}
                             {mismatch.field === 'heavy_product_flag' && (
                                <span className="text-muted-foreground">Product is over 50lbs ({mismatch.csvValue}).</span>
                            )}
                            {mismatch.field !== 'h1_tag' && mismatch.field !== 'duplicate_in_shopify' && mismatch.field !== 'heavy_product_flag' && (
                                 <>
                                    <span className="text-red-500 line-through mr-2">{mismatch.shopifyValue ?? 'N/A'}</span>
                                    <span className="text-green-500">{mismatch.csvValue ?? 'N/A'}</span>
                                </>
                            )}
                        </div>
                         <div className="flex items-center gap-1">
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onMarkAsFixed(mismatch.field)} disabled={disabled}>
                                            <Check className="h-4 w-4" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        <p>Mark as fixed (hide from report)</p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                            {canBeFixed && (
                                <Button size="sm" variant="ghost" className="h-7" onClick={() => onFix(mismatch.field)} disabled={disabled}>
                                    <Wrench className="mr-1.5 h-3.5 w-3.5" />
                                    Fix
                                </Button>
                            )}
                         </div>
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
        </div>
    );
};

const MISMATCH_FILTER_TYPES: MismatchDetail['field'][] = ['name', 'price', 'inventory', 'h1_tag', 'duplicate_in_shopify', 'heavy_product_flag'];

export default function AuditReport({ data, summary, duplicates, fileName, onReset, onRefresh }: { data: AuditResult[], summary: any, duplicates: DuplicateSku[], fileName: string, onReset: () => void, onRefresh: () => void }) {
  const [filter, setFilter] = useState<FilterType>('all');
  const [isFixing, startTransition] = useTransition();
  const { toast } = useToast();
  
  const [reportData, setReportData] = useState<AuditResult[]>(data);
  const [reportSummary, setReportSummary] = useState<any>(summary);
  const [showRefresh, setShowRefresh] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [handlesPerPage, setHandlesPerPage] = useState(10);
  const [searchTerm, setSearchTerm] = useState('');
  const [mismatchFilters, setMismatchFilters] = useState<Set<MismatchDetail['field']>>(new Set());
  const [filterSingleSku, setFilterSingleSku] = useState(false);
  const [selectedVendor, setSelectedVendor] = useState<string>('all');
  const [editingMissingMedia, setEditingMissingMedia] = useState<string | null>(null);
  const [selectedHandles, setSelectedHandles] = useState<Set<string>>(new Set());
  const [hasSelectionWithUnlinkedImages, setHasSelectionWithUnlinkedImages] = useState(false);
  const [hasSelectionWithMismatches, setHasSelectionWithMismatches] = useState(false);
  const [fixedMismatches, setFixedMismatches] = useState<Set<string>>(new Set());
  const [createdProductHandles, setCreatedProductHandles] = useState<Set<string>>(new Set());
  const [imageCounts, setImageCounts] = useState<Record<string, number>>({});
  const [loadingImageCounts, setLoadingImageCounts] = useState<Set<string>>(new Set());
  const [editingMediaFor, setEditingMediaFor] = useState<string | null>(null);
  const [isAutoRunning, setIsAutoRunning] = useState(false);
  const [isAutoCreating, setIsAutoCreating] = useState(false);
  const [editingMissingVariantMedia, setEditingMissingVariantMedia] = useState<{item: AuditResult[], parentProductId: string} | null>(null);
  
  const selectAllCheckboxRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setReportData(data);
    setReportSummary(summary);
    setShowRefresh(false);
    setCurrentPage(1);
    setSelectedHandles(new Set());
    setHasSelectionWithUnlinkedImages(false);
    setHasSelectionWithMismatches(false);
    setFixedMismatches(getFixedMismatches());
    setCreatedProductHandles(getCreatedProductHandles());
    setImageCounts({});
    setLoadingImageCounts(new Set());
    setEditingMediaFor(null);
  }, [data, summary]);

  const uniqueVendors = useMemo(() => {
    const vendors = new Set<string>();
    data.forEach(item => {
        if (item.status === 'not_in_csv' && item.shopifyProducts[0]?.vendor) {
            vendors.add(item.shopifyProducts[0].vendor);
        }
    });
    return ['all', ...Array.from(vendors).sort()];
  }, [data]);

  const groupedByHandle = useMemo(() => {
      return data.reduce((acc, item) => {
        const handle = getHandle(item);
        if (!acc[handle]) {
          acc[handle] = [];
        }
        acc[handle].push(item);
        return acc;
      }, {} as Record<string, AuditResult[]>);
  }, [data]);


  const filteredData = useMemo(() => {
    let results: AuditResult[] = reportData.map(item => {
        if (item.status === 'mismatched' && item.mismatches && item.mismatches.length > 0) {
            const remainingMismatches = item.mismatches.filter(m => !fixedMismatches.has(`${item.sku}-${m.field}`));
            return { ...item, mismatches: remainingMismatches };
        }
        if (item.status === 'missing_in_shopify') {
             const remainingMismatches = item.mismatches.filter(m => !fixedMismatches.has(`${item.sku}-${m.field}`));
             if (createdProductHandles.has(getHandle(item))) {
                 return { ...item, mismatches: [] }; // Effectively hide it
             }
             return { ...item, mismatches: remainingMismatches };
        }
        return item;
    }).filter(item => {
        if (item.status === 'mismatched' && item.mismatches.length === 0) {
            return false;
        }
        if (item.status === 'missing_in_shopify') {
             if (createdProductHandles.has(getHandle(item))) {
                 return false;
             }
             if (item.mismatches.length === 1 && item.mismatches[0].field === 'missing_in_shopify') {
                return !createdProductHandles.has(getHandle(item));
             }
        }
         if (item.status === 'missing_in_shopify' && item.mismatches.length === 0) {
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
            const product = item.csvProducts[0] || item.shopifyProducts[0];
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
        results = results.filter(item => item.shopifyProducts[0]?.vendor === selectedVendor);
    }

    // 4. Apply single SKU filter
    if (filterSingleSku) {
        results = results.filter(item => {
            const handle = getHandle(item);
            // This check ensures we only keep items whose handle group has exactly one member.
            return groupedByHandle[handle] && groupedByHandle[handle].length === 1;
        });
    }

    return results;
  }, [reportData, filter, searchTerm, mismatchFilters, selectedVendor, fixedMismatches, createdProductHandles, filterSingleSku, groupedByHandle]);

  const filteredGroupedByHandle = useMemo(() => {
      return filteredData.reduce((acc, item) => {
        const handle = getHandle(item);
        if (!acc[handle]) {
          acc[handle] = [];
        }
        acc[handle].push(item);
        return acc;
      }, {} as Record<string, AuditResult[]>);
  }, [filteredData]);

  const groupedBySku = useMemo(() => {
      if (filter !== 'duplicate_in_shopify') return {};
      return filteredData.reduce((acc, item) => {
        if (item.status === 'duplicate_in_shopify') {
             if (!acc[item.sku]) {
                acc[item.sku] = [];
            }
            // A single audit result for 'duplicate_in_shopify' contains all duplicated products.
            // So we just need to assign it once.
            acc[item.sku] = item.shopifyProducts;
        }
        return acc;
      }, {} as Record<string, Product[]>);
  }, [filteredData, filter]);


  const handleKeys = filter === 'duplicate_in_shopify' ? Object.keys(groupedBySku) : Object.keys(filteredGroupedByHandle);
  const totalPages = Math.ceil(handleKeys.length / handlesPerPage);
  const paginatedHandleKeys = handleKeys.slice(
      (currentPage - 1) * handlesPerPage,
      currentPage * handlesPerPage
  );

  const handleDownload = () => {
    const csvData = reportData.map(item => ({
      Handle: getHandle(item),
      SKU: item.sku,
      Status: item.status,
      Mismatched_Fields: item.mismatches.map(m => m.field).join(', '),
      CSV_Product_Name: item.csvProducts[0]?.name || 'N/A',
      Shopify_Product_Name: item.shopifyProducts[0]?.name || 'N/A',
      CSV_Price: item.csvProducts[0] ? item.csvProducts[0].price.toFixed(2) : 'N/A',
      Shopify_Price: item.shopifyProducts[0] ? item.shopifyProducts[0].price.toFixed(2) : 'N/A',
      CSV_Inventory: item.csvProducts[0]?.inventory ?? 'N/A',
      Shopify_Inventory: item.shopifyProducts[0]?.inventory ?? 'N/A',
    }));
    downloadCsv(csvData, 'shopsync-audit-report.csv');
  };
  
  const handleBulkFix = (handles: Set<string> | null = null) => {
      const handlesToProcess = handles || selectedHandles;
       if (handlesToProcess.size === 0) {
        toast({ title: "No Action Taken", description: "No items were selected to fix.", variant: "destructive" });
        return Promise.resolve();
      }

      const itemsToFix = reportData.filter(item => 
          item.status === 'mismatched' && handlesToProcess.has(getHandle(item))
      );

       if (itemsToFix.length === 0) {
            toast({ title: "No Action Needed", description: "Selected products have no mismatches to fix.", variant: "default" });
            return Promise.resolve();
        }

      setShowRefresh(true);
      
      return new Promise<void>((resolve) => {
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
            resolve();
        });
      })
  }

  const handleFixSingleMismatch = (item: AuditResult, fixType: MismatchDetail['field']) => {
    const itemToFix: AuditResult = {
        ...item,
        mismatches: item.mismatches.filter(m => m.field === fixType)
    };
    handleBulkFix().then(() => {
        // Since handleBulkFix uses selectedHandles, we need to add the handle of the single item.
        const handle = getHandle(item);
        const tempHandles = new Set([handle]);
        handleBulkFix(tempHandles);
    });
  };
  
  const handleBulkDeleteUnlinked = (handles: Set<string> | null = null) => {
      const handlesToProcess = handles || selectedHandles;
      if (handlesToProcess.size === 0) {
          toast({ title: "No Action Taken", description: "No items were selected.", variant: "destructive" });
          return Promise.resolve();
      }

      const productIdsWithUnlinked = Array.from(handlesToProcess).map(handle => {
          const items = filteredGroupedByHandle[handle];
          const productId = items?.[0]?.shopifyProducts?.[0]?.id;
          const imageCount = productId ? imageCounts[productId] : undefined;
          if (productId && imageCount !== undefined && items.length < imageCount) {
              return productId;
          }
          return null;
      }).filter((id): id is string => id !== null);

      if (productIdsWithUnlinked.length === 0) {
          toast({ title: "No Action Needed", description: "Selected products have no unlinked images to clean." });
          return Promise.resolve();
      }

      setShowRefresh(true);

      return new Promise<void>((resolve) => {
          startTransition(async () => {
              const result = await deleteUnlinkedImagesForMultipleProducts(productIdsWithUnlinked);
              if (result.success) {
                  toast({ title: 'Deletion Complete!', description: result.message });
                  result.results.forEach(deleteRes => {
                      if (deleteRes.success && deleteRes.deletedCount > 0) {
                          handleImageCountChange(deleteRes.productId, imageCounts[deleteRes.productId] - deleteRes.deletedCount);
                      }
                  });
              } else {
                  toast({ title: 'Deletion Failed', description: result.message || "An error occurred.", variant: 'destructive' });
              }
              setSelectedHandles(new Set());
              resolve();
          });
      });
  };


  const handleCreate = (item: AuditResult) => {
    const productToCreate = item.csvProducts[0];
    const missingType = item.mismatches.find(m => m.field === 'missing_in_shopify')?.missingType;

    if (!productToCreate || !missingType) {
        toast({ title: 'Error', description: 'Cannot create item, missing product data.', variant: 'destructive' });
        return;
    }
    
    // Use the potentially modified reportData to get the latest variants
    const allVariantsForHandle = reportData
      .filter(d => d.csvProducts[0]?.handle === productToCreate.handle && d.status === 'missing_in_shopify')
      .map(d => d.csvProducts[0])
      .filter((p): p is Product => p !== null);

    if (allVariantsForHandle.length === 0) {
        toast({ title: 'Error', description: 'Could not find any variants to create for this handle.', variant: 'destructive' });
        return;
    }
    
    setShowRefresh(true);
    
    startTransition(async () => {
        const result = await createInShopify(productToCreate, allVariantsForHandle, fileName, missingType);
        if (result.success) {
            toast({ title: 'Success!', description: result.message });
            // Remember that this handle has been created
            markProductAsCreated(productToCreate.handle);
            setCreatedProductHandles(prev => new Set(prev).add(productToCreate.handle));
        } else {
            toast({ title: 'Creation Failed', description: result.message, variant: 'destructive' });
        }
    });
  };
  
    const handleBulkCreateVariants = (items: AuditResult[]) => {
        const variantsToCreate = items.map(i => i.csvProducts[0]).filter((p): p is Product => !!p);
        
        if (variantsToCreate.length === 0) {
            toast({ title: 'No variants to create', description: 'Could not find any variant data to create.', variant: 'destructive' });
            return;
        }

        const handle = variantsToCreate[0].handle;
        setShowRefresh(true);

        startTransition(async () => {
            const result = await createMultipleVariantsForProduct(variantsToCreate);
            if (result.success) {
                toast({ title: 'Success!', description: result.message });
                markProductAsCreated(handle);
                setCreatedProductHandles(prev => new Set(prev).add(handle));
            } else {
                toast({ title: 'Creation Failed', description: result.message, variant: 'destructive' });
            }
        });
    };


  const handleBulkCreate = (handlesToCreate: Set<string> | null = null) => {
      const handles = handlesToCreate || selectedHandles;
      if (handles.size === 0) {
        toast({ title: "No Action Taken", description: "No items were selected to create.", variant: "destructive" });
        return Promise.resolve();
      }

      const itemsToCreate = Array.from(handles).map(handle => {
          const firstItemForHandle = reportData.find(d => d.csvProducts[0]?.handle === handle && d.status === 'missing_in_shopify');
          if (!firstItemForHandle || !firstItemForHandle.csvProducts[0]) return null;
          
          const allVariantsForHandle = reportData
              .filter(d => d.csvProducts[0]?.handle === handle && d.status === 'missing_in_shopify')
              .map(d => d.csvProducts[0])
              .filter((p): p is Product => p !== null);
          
          const missingType = firstItemForHandle.mismatches.find(m => m.field === 'missing_in_shopify')?.missingType ?? 'product';

          // We only want to bulk-create *new products*, not add variants to existing ones.
          if (missingType !== 'product') return null;

          return {
              product: firstItemForHandle.csvProducts[0],
              allVariants: allVariantsForHandle,
              missingType: missingType,
          };
      }).filter((item): item is { product: Product; allVariants: Product[]; missingType: 'product' } => item !== null);


      if (itemsToCreate.length === 0) {
          toast({ title: "No Products to Create", description: "The selected items are for adding variants to existing products, which cannot be done in bulk. Please create them individually.", variant: "default" });
          return Promise.resolve();
      }
      
      setShowRefresh(true);

      return new Promise<void>((resolve) => {
        startTransition(async () => {
            const result = await createMultipleInShopify(itemsToCreate, fileName);
            if (result.success) {
                toast({ title: 'Bulk Create Complete!', description: result.message });
                const newCreatedHandles = new Set(createdProductHandles);
                result.results.forEach(createdItem => {
                    if (createdItem.success) {
                      markProductAsCreated(createdItem.handle);
                      newCreatedHandles.add(createdItem.handle);
                    }
                });
                setCreatedProductHandles(newCreatedHandles);
            } else {
                toast({ title: 'Bulk Create Failed', description: result.message, variant: 'destructive' });
            }
            setSelectedHandles(new Set());
            resolve();
        });
      });
  };

  const handleDeleteProduct = (item: AuditResult, productToDelete?: Product) => {
      const product = productToDelete || item.shopifyProducts[0];
      if (!product || !product.id) {
          toast({ title: 'Error', description: 'Cannot delete product, missing product ID.', variant: 'destructive' });
          return;
      }

      setShowRefresh(true);
      const originalData = [...reportData];
      
      const itemsInHandle = reportData.filter(d => d.shopifyProducts.some(p => p.handle === product.handle)).length;
      const newData = reportData.filter(d => !d.shopifyProducts.some(p => p.handle === product.handle));
      
      setReportData(newData);

      setReportSummary((prev: any) => {
          const newSummary = {...prev};
          if(item.status === 'not_in_csv') {
            newSummary.not_in_csv -= itemsInHandle;
          }
          if(item.status === 'duplicate_in_shopify') {
            newSummary.duplicate_in_shopify -= 1; // It's one duplicate issue resolved
          }
          return newSummary;
      });


      startTransition(async () => {
          const result = await deleteFromShopify(product.id);
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
      const variantToDelete = item.shopifyProducts[0];
      if (!variantToDelete || !variantToDelete.id || !variantToDelete.variantId) {
          toast({ title: 'Error', description: 'Cannot delete variant, missing ID.', variant: 'destructive' });
          return;
      }
      
      setShowRefresh(true);
      const originalData = [...reportData];
      const newData = reportData.filter(d => d.sku !== item.sku);
      setReportData(newData);
      setReportSummary((prev: any) => ({
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
                const updatedVariant = updatedVariants.find(uv => uv.sku === auditResult.csvProducts[0]?.sku);
                // If this auditResult corresponds to one of the updated variants, update it
                if (auditResult.csvProducts[0] && updatedVariant) {
                    return {
                        ...auditResult,
                        csvProducts: [updatedVariant],
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
    
    const handleSaveMissingVariantMedia = (updatedVariants: Product[]) => {
        setReportData(currentReportData => {
            return currentReportData.map(item => {
                const updatedVariant = updatedVariants.find(uv => uv.sku === item.sku);
                if (updatedVariant) {
                    return {
                        ...item,
                        csvProducts: [updatedVariant],
                    };
                }
                return item;
            });
        });
        setEditingMissingVariantMedia(null);
         toast({
            title: "Media Saved",
            description: "Image assignments have been updated. Click 'Add Variants' to finalize.",
        });
    };

    const MismatchIcons = ({mismatches}: {mismatches: MismatchDetail[]}) => {
        const uniqueFields = [...new Set(mismatches.map(m => m.field))];
        
        const icons: { [key in MismatchDetail['field']]: React.ReactElement } = {
            name: <Text className="h-4 w-4" />,
            price: <DollarSign className="h-4 w-4" />,
            inventory: <List className="h-4 w-4" />,
            heavy_product_flag: <FileWarning className="h-4 w-4" />,
            h1_tag: <span className="text-xs font-bold leading-none">H1</span>,
            duplicate_in_shopify: <Copy className="h-4 w-4" />,
            missing_in_shopify: <XCircle className="h-4 w-4" />,
        };

        return (
            <div className="flex items-center gap-1.5">
                {uniqueFields.map(field => (
                    <TooltipProvider key={field}>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="p-1.5 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 rounded-md">
                                    {icons[field]}
                                </div>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p className="capitalize">{field.replace(/_/g, ' ')}</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                ))}
            </div>
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

  const updateSelectionState = (selection: Set<string>) => {
    let hasUnlinked = false;
    let hasMismatchesFlag = false;

    for (const handle of Array.from(selection)) {
      const items = filteredGroupedByHandle[handle];
      if (!items) continue;

      // Check for unlinked images
      const productId = items[0]?.shopifyProducts[0]?.id;
      const imageCount = productId ? imageCounts[productId] : undefined;
      if (imageCount !== undefined && items.length < imageCount) {
        hasUnlinked = true;
      }
      
      // Check for mismatches
      if (items.some(item => item.status === 'mismatched')) {
        hasMismatchesFlag = true;
      }
    }

    setHasSelectionWithUnlinkedImages(hasUnlinked);
    setHasSelectionWithMismatches(hasMismatchesFlag);
  };


  const handleSelectHandle = (handle: string, checked: boolean) => {
    const newSelectedHandles = new Set(selectedHandles);
    if (checked) {
        newSelectedHandles.add(handle);
    } else {
        newSelectedHandles.delete(handle);
    }
    setSelectedHandles(newSelectedHandles);
    updateSelectionState(newSelectedHandles);
  };
  
  const handleSelectAllOnPage = (checked: boolean | 'indeterminate') => {
    const newSelectedHandles = new Set(selectedHandles);
    if (checked === true) {
      paginatedHandleKeys.forEach(handle => {
        const items = filteredGroupedByHandle[handle];
        const isMissingVariant = items?.some(item => item.status === 'missing_in_shopify' && item.mismatches.some(m => m.missingType === 'variant'));
        if (!isMissingVariant) {
            newSelectedHandles.add(handle);
        }
      });
    } else {
      paginatedHandleKeys.forEach(handle => newSelectedHandles.delete(handle));
    }
    setSelectedHandles(newSelectedHandles);
    updateSelectionState(newSelectedHandles);
  };
  
  const handleClearAuditMemory = () => {
    clearAuditMemory();
    setFixedMismatches(new Set());
    setCreatedProductHandles(new Set());
    toast({ title: "Cleared 'Remembered' Fixes & Creations", description: "The report is now showing all original items. Run a new non-cached audit for the latest data." });
  };
  
  const handleMarkAsFixed = (sku: string, field: MismatchDetail['field']) => {
    markMismatchAsFixed(sku, field);
    setFixedMismatches(prev => new Set(prev).add(`${sku}-${field}`));
    toast({ title: 'Item hidden', description: 'This item will be hidden until you clear remembered fixes or run a new non-cached audit.' });
  };
  
  const handleMarkAsCreated = (handle: string) => {
    markProductAsCreated(handle);
    setCreatedProductHandles(prev => new Set(prev).add(handle));
    toast({ title: 'Product hidden', description: 'This product will be hidden until you clear remembered fixes or run a new non-cached audit.' });
  }

  const editingMissingMediaVariants = useMemo(() => {
    if (!editingMissingMedia) return [];
    return reportData
      .filter(d => d.csvProducts[0]?.handle === editingMissingMedia && d.status === 'missing_in_shopify')
      .map(d => d.csvProducts[0])
      .filter((p): p is Product => p !== null);
  }, [editingMissingMedia, reportData]);
  
  const currentSummary = useMemo(() => {
      return filteredData.reduce((acc, item) => {
          if(item.status === 'mismatched' && item.mismatches.length > 0) acc.mismatched++;
          if(item.status === 'missing_in_shopify') acc.missing_in_shopify++;
          if(item.status === 'not_in_csv') acc.not_in_csv++;
          if(item.status === 'duplicate_in_shopify') acc.duplicate_in_shopify++;
          return acc;
      }, { mismatched: 0, missing_in_shopify: 0, not_in_csv: 0, duplicate_in_shopify: 0 });
  }, [filteredData]);
  
    useEffect(() => {
        const fetchCounts = async () => {
            if (paginatedHandleKeys.length === 0) return;

            const productIdsToFetch: string[] = [];

            for (const handle of paginatedHandleKeys) {
                const items = filteredGroupedByHandle[handle];
                const productId = items?.[0]?.shopifyProducts?.[0]?.id;
                if (productId && imageCounts[productId] === undefined && !loadingImageCounts.has(productId)) {
                    productIdsToFetch.push(productId);
                }
            }

            if (productIdsToFetch.length === 0) return;

            setLoadingImageCounts(prev => {
                const newSet = new Set(prev);
                productIdsToFetch.forEach(id => newSet.add(id));
                return newSet;
            });

            try {
                const counts = await getProductImageCounts(productIdsToFetch);
                setImageCounts(prev => ({ ...prev, ...counts }));
            } catch (error) {
                console.error("Failed to fetch image counts for page", error);
                toast({
                    title: "Could not load image counts",
                    description: error instanceof Error ? error.message : "An unknown error occurred.",
                    variant: "destructive"
                });
            } finally {
                setLoadingImageCounts(prev => {
                    const newSet = new Set(prev);
                    productIdsToFetch.forEach(id => newSet.delete(id));
                    return newSet;
                });
            }
        };

        fetchCounts();
    }, [paginatedHandleKeys, filteredGroupedByHandle, toast, imageCounts, loadingImageCounts]);


  const { isAllOnPageSelected, isSomeOnPageSelected } = useMemo(() => {
    const currentPageHandles = new Set(paginatedHandleKeys);
    const selectedOnPageCount = Array.from(selectedHandles).filter(h => currentPageHandles.has(h)).length;
    
    if (paginatedHandleKeys.length === 0) {
        return { isAllOnPageSelected: false, isSomeOnPageSelected: false };
    }

    return {
      isAllOnPageSelected: selectedOnPageCount === paginatedHandleKeys.length,
      isSomeOnPageSelected: selectedOnPageCount > 0 && selectedOnPageCount < paginatedHandleKeys.length,
    };
  }, [paginatedHandleKeys, selectedHandles]);

  const handleImageCountChange = useCallback((productId: string, newCount: number) => {
      setImageCounts(prev => ({...prev, [productId]: newCount}));
  }, []);

  const handleDeleteUnlinked = useCallback((productId: string) => {
      startTransition(async () => {
          const result = await deleteUnlinkedImagesForMultipleProducts([productId]);
          if (result.success && result.results[0]?.deletedCount > 0) {
              toast({ title: "Success!", description: result.results[0].message });
              handleImageCountChange(productId, imageCounts[productId] - result.results[0].deletedCount);
          } else {
              toast({ title: "Error Deleting Images", description: result.message, variant: "destructive" });
          }
      });
  }, [imageCounts, toast, handleImageCountChange]);

  const runAutoFix = useCallback(async () => {
    // This function will be called by the useEffect hook
    const handlesOnPage = new Set(paginatedHandleKeys);
    const fixableHandles = Array.from(handlesOnPage).filter(handle => {
        const items = filteredGroupedByHandle[handle];
        if (!items) return false;
        const hasMismatches = items.some(item => item.status === 'mismatched' && item.mismatches.length > 0);
        return hasMismatches;
    });

    if (fixableHandles.length === 0) {
        toast({ title: 'Auto-Fix Complete', description: 'No more fixable items found on this page matching your filters.' });
        setIsAutoRunning(false);
        return;
    }

    toast({ title: 'Auto-Fixing Page...', description: `Processing ${fixableHandles.length} items.` });
    
    try {
        await handleBulkFix(new Set(fixableHandles));
        // The loop continues via the useEffect, so no recursive call here.
    } catch(error) {
        toast({ title: 'Auto-Fix Error', description: 'The process was stopped due to an error.', variant: 'destructive' });
        setIsAutoRunning(false);
    }
  }, [paginatedHandleKeys, filteredGroupedByHandle, handleBulkFix, toast]);

    useEffect(() => {
        if (!isAutoRunning || isFixing) {
            return;
        }

        // A small delay to allow UI to update before starting the logic
        const timer = setTimeout(() => {
            runAutoFix();
        }, 1000); 

        return () => clearTimeout(timer);
    }, [isAutoRunning, isFixing, filteredData, runAutoFix]);


  const startAutoRun = () => {
      setIsAutoRunning(true);
      // The useEffect will now pick this up and start the first run.
  };

  const stopAutoRun = () => {
      setIsAutoRunning(false);
      toast({ title: 'Auto-Fix Stopped', description: 'The automation process has been stopped.' });
  };

  const runAutoCreate = useCallback(async () => {
    const handlesOnPage = new Set(paginatedHandleKeys);
    const creatableHandles = Array.from(handlesOnPage).filter(handle => {
        const items = filteredGroupedByHandle[handle];
        if (!items) return false;
        // Only consider handles that are new products
        return items.every(item => item.status === 'missing_in_shopify' && item.mismatches.some(m => m.missingType === 'product'));
    });
    
    if (creatableHandles.length === 0) {
        toast({ title: 'Auto-Create Complete', description: 'No more new products to create on this page.' });
        setIsAutoCreating(false);
        return;
    }

    toast({ title: 'Auto-Creating Page...', description: `Creating ${creatableHandles.length} products.` });

    try {
        await handleBulkCreate(new Set(creatableHandles));
    } catch (error) {
        toast({ title: 'Auto-Create Error', description: 'The process was stopped due to an error.', variant: 'destructive' });
        setIsAutoCreating(false);
    }
  }, [paginatedHandleKeys, filteredGroupedByHandle, handleBulkCreate, toast]);

    useEffect(() => {
        if (!isAutoCreating || isFixing) {
            return;
        }

        const timer = setTimeout(() => {
            runAutoCreate();
        }, 1000);

        return () => clearTimeout(timer);
    }, [isAutoCreating, isFixing, filteredData, runAutoCreate]);


  const startAutoCreate = () => {
      setIsAutoCreating(true);
  };

  const stopAutoCreate = () => {
      setIsAutoCreating(false);
      toast({ title: 'Auto-Create Stopped', description: 'The automation process has been stopped.' });
  };

  const handleOpenMissingVariantMediaManager = async (items: AuditResult[]) => {
    if (items.length === 0 || !items[0].csvProducts[0]?.handle) return;
    
    toast({ title: "Loading Parent Product...", description: "Fetching existing product data from Shopify."});
    
    let parentProductId: string | undefined;
    const siblingInShopify = data.find(d => d.shopifyProducts.length > 0 && d.shopifyProducts[0].handle === items[0].csvProducts[0]!.handle);
    parentProductId = siblingInShopify?.shopifyProducts[0]?.id;

    if (!parentProductId) {
        const parentProduct = await getProductByHandleServer(items[0].csvProducts[0]!.handle);
        parentProductId = parentProduct?.id;
    }
    
     if (!parentProductId) {
        toast({
            title: "Could not find parent product",
            description: "Unable to load media. No existing variants of this product were found in the audit data.",
            variant: "destructive"
        });
        return;
    }
    
    // Check for new image URLs in the missing variants and upload them if necessary
    const newImageUrls = [...new Set(items.map(i => i.csvProducts[0]?.mediaUrl).filter((url): url is string => !!url))];
    
    if (newImageUrls.length > 0) {
        toast({ title: "Adding New Images...", description: `Found ${newImageUrls.length} new images in the CSV. Adding them to the product gallery.` });
        
        const uploads = await Promise.all(
            newImageUrls.map(url => addImageFromUrl(parentProductId!, url))
        );
        
        const failedUploads = uploads.filter(u => !u.success);
        if (failedUploads.length > 0) {
            toast({
                title: "Some Images Failed to Add",
                description: `${failedUploads.length} new images could not be added to the product. They will not be available in the gallery.`,
                variant: "destructive"
            });
        }
    }


    if (parentProductId) {
        setEditingMissingVariantMedia({ items: items, parentProductId });
    }
  };


  const renderRegularReport = () => (
    <Accordion type="single" collapsible className="w-full">
        {paginatedHandleKeys.map((handle) => {
             const items = filteredGroupedByHandle[handle];
             const productTitle = items[0].csvProducts[0]?.name || items[0].shopifyProducts[0]?.name || handle;
             const hasMismatch = items.some(i => i.status === 'mismatched' && i.mismatches.length > 0);
             const isMissing = items.every(i => i.status === 'missing_in_shopify');
             const notInCsv = items.every(i => i.status === 'not_in_csv');
             
             const allMismatches = items.flatMap(i => i.mismatches);
             
             const overallStatus: AuditStatus | 'matched' = hasMismatch ? 'mismatched' 
                 : isMissing ? 'missing_in_shopify'
                 : notInCsv ? 'not_in_csv'
                 : 'matched';
             
             if (overallStatus === 'matched') {
                 return null;
             }
             
             const config = statusConfig[overallStatus];
             
             const allVariantsForHandleInShopify = data.filter(d => d.shopifyProducts[0]?.handle === handle);
             const isOnlyVariantNotInCsv = notInCsv && allVariantsForHandleInShopify.length === items.length;
            
            const productId = items[0].shopifyProducts[0]?.id;
            const imageCount = productId ? imageCounts[productId] : undefined;
            const isLoadingImages = productId ? loadingImageCounts.has(productId) : false;
            const canHaveUnlinkedImages = imageCount !== undefined && items.length < imageCount;

            const isMissingProductCase = isMissing && items.every(i => i.mismatches.some(m => m.missingType === 'product'));
            const isMissingVariantCase = isMissing && !isMissingProductCase;

            return (
            <AccordionItem value={handle} key={handle} className="border-b last:border-b-0">
                <AccordionHeader className="flex items-center p-0">
                    {(filter === 'mismatched' || (filter === 'missing_in_shopify' && isMissingProductCase) || filter === 'all') && (
                        <div className="p-3 pl-4">
                            <Checkbox
                                checked={selectedHandles.has(handle)}
                                onCheckedChange={(checked) => handleSelectHandle(handle, !!checked)}
                                aria-label={`Select product ${handle}`}
                                disabled={isFixing || isAutoRunning || isAutoCreating || isMissingVariantCase}
                            />
                        </div>
                    )}
                    <AccordionTrigger className="flex-grow p-3 text-left" disabled={isFixing || isAutoRunning || isAutoCreating}>
                        <div className="flex items-center gap-4 flex-grow">
                            <config.icon className={`w-5 h-5 shrink-0 ${
                                overallStatus === 'mismatched' ? 'text-yellow-500' 
                                : overallStatus === 'missing_in_shopify' ? 'text-red-500'
                                : 'text-blue-500'
                            }`} />
                            <div className="flex-grow text-left">
                                <p className="font-semibold">{productTitle}</p>
                                <p className="text-sm text-muted-foreground">{handle}</p>
                            </div>
                        </div>
                    </AccordionTrigger>
                    <div className="flex items-center gap-2 p-3">
                         {hasMismatch && <MismatchIcons mismatches={allMismatches} />}
                        {canHaveUnlinkedImages && (
                          <AlertDialog>
                              <AlertDialogTrigger asChild>
                                  <Button size="sm" variant="destructive" onClick={(e) => e.stopPropagation()} disabled={isFixing || isAutoRunning || isAutoCreating}>
                                      <Trash2 className="mr-2 h-4 w-4" />
                                      Delete Unlinked ({imageCount! - items.length})
                                  </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                  <AlertDialogHeader>
                                      <AlertDialogTitle>Delete Unlinked Images?</AlertDialogTitle>
                                      <AlertDialogDescription>
                                          This product has {imageCount} images but only {items.length} variants (SKUs). This action will permanently delete the {imageCount! - items.length} unlinked images from Shopify. This cannot be undone.
                                      </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                                      <AlertDialogAction onClick={(e) => {e.stopPropagation(); handleDeleteUnlinked(productId!)}} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                          Yes, Delete Images
                                      </AlertDialogAction>
                                  </AlertDialogFooter>
                              </AlertDialogContent>
                          </AlertDialog>
                        )}
                        {items.some(i => i.status === 'mismatched' && i.mismatches.length > 0) && (
                            <Button size="sm" onClick={(e) => { e.stopPropagation(); handleBulkFix(new Set([handle]))}} disabled={isFixing || isAutoRunning || isAutoCreating}>
                                <Bot className="mr-2 h-4 w-4" />
                                Fix All ({items.flatMap(i => i.mismatches).filter(m => m.field !== 'duplicate_in_shopify' && m.field !== 'heavy_product_flag').length})
                            </Button>
                        )}
                         {isMissingProductCase && (
                            <>
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={(e) => {e.stopPropagation(); handleMarkAsCreated(handle);}} disabled={isFixing || isAutoRunning || isAutoCreating}>
                                                <Check className="h-4 w-4" />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            <p>Mark as created (hide from report)</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                                <Button size="sm" onClick={(e) => { e.stopPropagation(); handleCreate(items[0])}} disabled={isFixing || isAutoRunning || isAutoCreating}>
                                    <PlusCircle className="mr-2 h-4 w-4" />
                                    Create Product
                                </Button>
                            </>
                        )}
                        {isMissingVariantCase && (
                             <>
                                <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); handleOpenMissingVariantMediaManager(items)}}>
                                    <ImageIcon className="mr-2 h-4 w-4" /> Manage Media
                                </Button>
                                <Button size="sm" onClick={(e) => { e.stopPropagation(); handleBulkCreateVariants(items)}} disabled={isFixing}>
                                    <PlusCircle className="mr-2 h-4 w-4" /> Add All {items.length} Variants
                                </Button>
                            </>
                        )}
                        <Badge variant="outline" className="w-[80px] justify-center">{items.length} SKU{items.length > 1 ? 's' : ''}</Badge>
                        
                        {productId && !isMissingVariantCase && (
                             <Dialog open={editingMediaFor === productId} onOpenChange={(open) => setEditingMediaFor(open ? productId : null)}>
                                <DialogTrigger asChild>
                                    <Button size="sm" variant="outline" className="w-[180px]" onClick={(e) => e.stopPropagation()} disabled={isAutoRunning || isAutoCreating}>
                                        {isLoadingImages ? (
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin"/>
                                        ) : (
                                            <ImageIcon className="mr-2 h-4 w-4" />
                                        )}
                                        Manage Media{' '}
                                        {imageCount !== undefined && (
                                            <span className={cn(imageCount > items.length ? "text-yellow-400 font-bold" : "")}>
                                                ({imageCount})
                                            </span>
                                        )}
                                    </Button>
                                </DialogTrigger>
                                {editingMediaFor === productId && (
                                    <DialogContent className="max-w-5xl">
                                        <MediaManager 
                                            key={productId}
                                            productId={productId}
                                            onImageCountChange={(newCount) => handleImageCountChange(productId, newCount)}
                                        />
                                    </DialogContent>
                                )}
                            </Dialog>
                        )}
                        {isMissingProductCase && (
                            <Dialog open={editingMissingMedia === handle} onOpenChange={(open) => setEditingMissingMedia(open ? handle : null)}>
                                <DialogTrigger asChild>
                                    <Button size="sm" variant="outline" className="w-[160px]" onClick={(e) => {e.stopPropagation(); setEditingMissingMedia(handle)}} disabled={isAutoRunning || isAutoCreating}>
                                        <ImageIcon className="mr-2 h-4 w-4" />
                                        Manage Media
                                    </Button>
                                </DialogTrigger>
                                {editingMissingMedia === handle && (
                                    <DialogContent className="max-w-5xl">
                                        <PreCreationMediaManager
                                            key={handle} 
                                            variants={editingMissingMediaVariants}
                                            onSave={handleSavePreCreationMedia}
                                            onCancel={() => setEditingMissingMedia(null)}
                                        />
                                    </DialogContent>
                                )}
                            </Dialog>
                        )}
                    </div>
                </AccordionHeader>

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
                                const productForDetails = item.csvProducts[0] || item.shopifyProducts[0];

                                if (item.status === 'mismatched' && item.mismatches.length === 0) return null;
                                if (item.status === 'missing_in_shopify' && !item.mismatches.some(m => m.field === 'missing_in_shopify')) return null;

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
                                                {item.status === 'mismatched' && item.mismatches.length > 0 && 
                                                    <MismatchDetails 
                                                        sku={item.sku}
                                                        mismatches={item.mismatches} 
                                                        onFix={(fixType) => handleFixSingleMismatch(item, fixType)} 
                                                        onMarkAsFixed={(fixType) => handleMarkAsFixed(item.sku, fixType)}
                                                        disabled={isFixing || isAutoRunning || isAutoCreating}
                                                    />
                                                }
                                                {item.status === 'missing_in_shopify' && (
                                                    <p className="text-sm text-muted-foreground">
                                                        This SKU is a{' '}
                                                        <span className="font-semibold text-foreground">
                                                            {item.mismatches.find(m => m.field === 'missing_in_shopify')?.missingType === 'product' ? 'Missing Product' : 'Missing Variant'}
                                                        </span>.
                                                         {item.mismatches.some(m => m.field === 'heavy_product_flag') && <span className="block mt-1"> <AlertTriangle className="inline-block h-4 w-4 mr-1 text-yellow-500" /> This is a heavy product.</span>}
                                                    </p>
                                                )}
                                                {item.status === 'not_in_csv' && <p className="text-sm text-muted-foreground">This product exists in Shopify but not in your CSV file.</p>}
                                                <ProductDetails product={productForDetails} />
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex justify-end items-center gap-2">
                                                {item.status === 'missing_in_shopify' && item.csvProducts[0] && (
                                                   <>
                                                      <MissingProductDetailsDialog product={item.csvProducts[0]} />
                                                   </>
                                                )}
                                                
                                                 {item.status === 'not_in_csv' && !isOnlyVariantNotInCsv && (
                                                    <AlertDialog>
                                                        <AlertDialogTrigger asChild>
                                                            <Button size="sm" variant="destructive" disabled={isFixing || isAutoRunning || isAutoCreating}>
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
                                                    <Button size="sm" variant="destructive" disabled={isFixing || isAutoRunning || isAutoCreating}>
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
  );

  const renderDuplicateReport = () => (
      <Accordion type="single" collapsible className="w-full">
          {paginatedHandleKeys.map((sku) => {
              const products = groupedBySku[sku];
              if (!products || products.length === 0) return null;
              
              const issueItem = filteredData.find(item => item.sku === sku && item.status === 'duplicate_in_shopify');
              if(!issueItem) return null;

              const config = statusConfig.duplicate_in_shopify;
              
              return (
                  <AccordionItem value={sku} key={sku} className="border-b last:border-b-0">
                      <AccordionTrigger className="p-3 text-left" disabled={isFixing || isAutoRunning}>
                          <div className="flex items-center gap-4 flex-grow">
                              <config.icon className="w-5 h-5 shrink-0 text-purple-500" />
                              <div className="flex-grow text-left">
                                  <p className="font-semibold">SKU: {sku}</p>
                                  <p className="text-sm text-muted-foreground">This SKU is used in {products.length} different products.</p>
                              </div>
                          </div>
                      </AccordionTrigger>
                      <AccordionContent>
                          <Table>
                              <TableHeader>
                                  <TableRow>
                                      <TableHead>Product Title / Handle</TableHead>
                                      <TableHead>Price</TableHead>
                                      <TableHead>Stock</TableHead>
                                      <TableHead>Status</TableHead>
                                      <TableHead className="text-right">Actions</TableHead>
                                  </TableRow>
                              </TableHeader>
                              <TableBody>
                                  {products.map(product => {
                                      const auditInfo = reportData.find(r => r.shopifyProducts[0]?.variantId === product.variantId);
                                      const hasMismatches = auditInfo && auditInfo.status === 'mismatched' && auditInfo.mismatches.length > 0;
                                      
                                      return (
                                          <TableRow key={product.variantId} className={hasMismatches ? 'bg-yellow-50/50 dark:bg-yellow-900/10' : ''}>
                                              <TableCell>
                                                  <div className="font-medium">{product.name}</div>
                                                  <div className="text-xs text-muted-foreground font-mono">{product.handle}</div>
                                              </TableCell>
                                              <TableCell>${product.price.toFixed(2)}</TableCell>
                                              <TableCell>{product.inventory ?? 'N/A'}</TableCell>
                                              <TableCell>
                                                 {hasMismatches ? (
                                                    <Badge variant="outline" className={statusConfig.mismatched.badgeClass}>
                                                        <AlertTriangle className="mr-1.5 h-3.5 w-3.5" />
                                                        Mismatched
                                                    </Badge>
                                                 ) : (
                                                    <Badge variant="outline">Matched</Badge>
                                                 )}
                                              </TableCell>
                                              <TableCell className="text-right">
                                                   <AlertDialog>
                                                      <AlertDialogTrigger asChild>
                                                          <Button size="sm" variant="destructive" disabled={isFixing || isAutoRunning}>
                                                              <Trash2 className="mr-2 h-4 w-4" /> Delete Product
                                                          </Button>
                                                      </AlertDialogTrigger>
                                                      <AlertDialogContent>
                                                          <AlertDialogHeader>
                                                              <AlertDialogTitle>Delete this product?</AlertDialogTitle>
                                                              <AlertDialogDescription>
                                                                  This will permanently delete the product "{product.name}" (handle: {product.handle}) from Shopify. This action cannot be undone.
                                                              </AlertDialogDescription>
                                                          </AlertDialogHeader>
                                                          <AlertDialogFooter>
                                                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                              <AlertDialogAction onClick={() => handleDeleteProduct(issueItem, product)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                                                  Yes, delete product
                                                              </AlertDialogAction>
                                                          </AlertDialogFooter>
                                                      </AlertDialogContent>
                                                  </AlertDialog>
                                              </TableCell>
                                          </TableRow>
                                      );
                                  })}
                              </TableBody>
                          </Table>
                      </AccordionContent>
                  </AccordionItem>
              )
          })}
      </Accordion>
  );


  return (
    <>
    <Card className="w-full">
      <CardHeader>
        <div className="flex justify-between items-start">
          <div>
            <CardTitle>Audit Report</CardTitle>
            <CardDescription>
              {filter === 'duplicate_in_shopify' 
                ? "SKUs that are incorrectly used across multiple products in your Shopify store."
                : "Comparison of product data between your CSV file and Shopify. Products are grouped by handle."
              }
            </CardDescription>
             <div className="flex items-center text-sm text-muted-foreground mt-2">
                <FileText className="h-4 w-4 mr-2" />
                <span className="font-medium">Auditing File:</span>
                <code className="ml-2 text-primary bg-primary/10 px-2 py-1 rounded-md">{fileName}</code>
            </div>
          </div>
          { isFixing && !isAutoRunning && !isAutoCreating &&
            <div className="flex items-center gap-2 text-sm text-muted-foreground p-2 rounded-md bg-card-foreground/5">
              <Loader2 className="h-4 w-4 animate-spin"/>
              Applying changes...
            </div>
          }
          { isAutoRunning &&
             <div className="flex items-center gap-2 text-sm text-green-500 p-2 rounded-md bg-green-500/10 border border-green-500/20">
              <Loader2 className="h-4 w-4 animate-spin"/>
              Auto-Fix is running...
            </div>
          }
          { isAutoCreating &&
             <div className="flex items-center gap-2 text-sm text-blue-500 p-2 rounded-md bg-blue-500/10 border border-blue-500/20">
              <Loader2 className="h-4 w-4 animate-spin"/>
              Auto-Create is running...
            </div>
          }
        </div>
         {duplicates.length > 0 && filter !== 'duplicate_in_shopify' && (
            <Alert variant="destructive" className="mt-4">
                <Siren className="h-4 w-4" />
                <AlertTitle>Duplicate SKUs Found in Shopify!</AlertTitle>
                <AlertDescription>
                    Your Shopify store contains {duplicates.length} SKUs that are assigned to multiple products. This can cause issues with inventory and order fulfillment. View them in the 'Duplicate in Shopify' tab.
                </AlertDescription>
            </Alert>
        )}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-4">
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
            <div className="flex items-center gap-3 p-3 rounded-lg bg-card border shadow-sm">
                <Copy className="w-6 h-6 text-purple-500 shrink-0" />
                <div>
                    <div className="text-xl font-bold">{reportSummary.duplicate_in_shopify || 0}</div>
                    <div className="text-xs text-muted-foreground">Duplicate SKUs in Shopify</div>
                </div>
            </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col sm:flex-row justify-between items-center mb-4 gap-4">
          <div className="flex flex-wrap gap-2">
            {(['all', 'mismatched', 'missing_in_shopify', 'not_in_csv', 'duplicate_in_shopify'] as const).map(f => {
                const count = f === 'all' 
                    ? handleKeys.length
                    : currentSummary[f as Exclude<FilterType, 'all'>];
                const config = statusConfig[f as keyof typeof statusConfig];
                if (count === 0 && f !== 'all') return null;

                return (
                    <Button key={f} variant={filter === f ? 'default' : 'outline'} size="sm" onClick={() => handleFilterChange(f)} disabled={isFixing || isAutoRunning || isAutoCreating}>
                       {f === 'all' ? 'All Items' : config.text} ({count})
                    </Button>
                )
             })}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onReset} disabled={isFixing || isAutoRunning || isAutoCreating}><ArrowLeft className="mr-2 h-4 w-4" />New Audit</Button>
            {showRefresh && <Button variant="secondary" onClick={onRefresh} disabled={isFixing || isAutoRunning || isAutoCreating}><RefreshCw className="mr-2 h-4 w-4" />Refresh Data</Button>}
            <Button onClick={handleDownload} disabled={isFixing || isAutoRunning || isAutoCreating}><Download className="mr-2 h-4 w-4" />Download Report</Button>
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
                    disabled={isFixing || isAutoRunning || isAutoCreating}
                />
            </div>
             <div className="flex items-center space-x-2">
                <Checkbox
                    id="single-sku-filter"
                    checked={filterSingleSku}
                    onCheckedChange={(checked) => {
                        setCurrentPage(1);
                        setFilterSingleSku(!!checked);
                    }}
                    disabled={isFixing || isAutoRunning || isAutoCreating}
                />
                <Label htmlFor="single-sku-filter" className="font-normal whitespace-nowrap">
                    Show only single SKU products
                </Label>
            </div>
            <Separator orientation="vertical" className="h-auto hidden md:block" />
            {filter === 'mismatched' && (
                 <Popover>
                    <PopoverTrigger asChild>
                        <Button variant="outline" className="w-full md:w-auto" disabled={isFixing || isAutoRunning || isAutoCreating}>
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
                                            disabled={type === 'duplicate_in_shopify'}
                                        />
                                        <Label htmlFor={type} className="font-normal capitalize">{type.replace(/_/g, ' ')}</Label>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <Separator />
                        <div className="p-2">
                           <Button variant="ghost" size="sm" className="w-full justify-start" onClick={handleClearAuditMemory}>
                             <Eraser className="mr-2 h-4 w-4"/>
                             Clear remembered fixes
                           </Button>
                        </div>
                    </PopoverContent>
                </Popover>
            )}
            {filter === 'not_in_csv' && (
                <Select value={selectedVendor} onValueChange={(value) => {setCurrentPage(1); setSelectedVendor(value)}} disabled={isFixing || isAutoRunning || isAutoCreating}>
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
            {selectedHandles.size > 0 && (
                <>
                    {hasSelectionWithMismatches && (
                        <Button onClick={() => handleBulkFix()} disabled={isFixing || isAutoRunning || isAutoCreating}>
                            <Wand2 className="mr-2 h-4 w-4" />
                             Fix Mismatches ({selectedHandles.size})
                        </Button>
                    )}
                    {hasSelectionWithUnlinkedImages && (
                         <Button variant="destructive" onClick={() => handleBulkDeleteUnlinked()} disabled={isFixing || isAutoRunning || isAutoCreating}>
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete Unlinked
                        </Button>
                    )}
                </>
            )}
            {filter === 'missing_in_shopify' && selectedHandles.size > 0 && (
                <Button onClick={() => handleBulkCreate()} disabled={isFixing || isAutoRunning || isAutoCreating} className="w-full md:w-auto">
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Create {selectedHandles.size} Selected
                </Button>
            )}
             {filter === 'mismatched' && !isAutoRunning && (
                <Button onClick={startAutoRun} disabled={isFixing} className="w-full md:w-auto bg-green-600 hover:bg-green-600/90 text-white">
                    <SquarePlay className="mr-2 h-4 w-4" />
                    Auto Fix Page
                </Button>
            )}
            {isAutoRunning && (
                 <Button onClick={stopAutoRun} disabled={isFixing} variant="destructive" className="w-full md:w-auto">
                    <SquareX className="mr-2 h-4 w-4" />
                    Stop
                </Button>
            )}
            {filter === 'missing_in_shopify' && !isAutoCreating && (
                <Button onClick={startAutoCreate} disabled={isFixing} className="w-full md:w-auto bg-blue-600 hover:bg-blue-600/90 text-white">
                    <SquarePlay className="mr-2 h-4 w-4" />
                    Auto Create Page
                </Button>
            )}
            {isAutoCreating && (
                 <Button onClick={stopAutoCreate} disabled={isFixing} variant="destructive" className="w-full md:w-auto">
                    <SquareX className="mr-2 h-4 w-4" />
                    Stop
                </Button>
            )}
        </div>

        {(filter === 'mismatched' || (filter === 'missing_in_shopify' && Array.from(selectedHandles).every(h => filteredGroupedByHandle[h]?.every(i => i.mismatches.some(m => m.missingType === 'product')))) || filter === 'all') && paginatedHandleKeys.length > 0 && (
          <div className="flex items-center border-t border-b px-4 py-2 bg-muted/50">
            <Checkbox
              ref={selectAllCheckboxRef}
              id="select-all-page"
              onCheckedChange={(checked) => {
                 if (isSomeOnPageSelected) {
                    handleSelectAllOnPage(true);
                } else {
                    handleSelectAllOnPage(!!checked);
                }
              }}
              checked={isSomeOnPageSelected ? 'indeterminate' : isAllOnPageSelected}
              disabled={isAutoRunning || isAutoCreating}
            />
            <Label htmlFor="select-all-page" className="ml-2 text-sm font-medium">
              Select all on this page ({paginatedHandleKeys.length} items)
            </Label>
          </div>
        )}

        <div className="rounded-md border">
            {paginatedHandleKeys.length > 0 ? (
                filter === 'duplicate_in_shopify' ? renderDuplicateReport() : renderRegularReport()
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
                 <div className="flex items-center gap-2 text-sm">
                    <Label htmlFor="handles-per-page">Items per page</Label>
                    <Select
                        value={handlesPerPage.toString()}
                        onValueChange={(value) => {
                            setHandlesPerPage(Number(value));
                            setCurrentPage(1);
                        }}
                        disabled={isFixing || isAutoRunning || isAutoCreating}
                    >
                        <SelectTrigger id="handles-per-page" className="w-20">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {[5, 10, 25, 50].map(size => (
                                <SelectItem key={size} value={size.toString()}>{size}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <span className="text-sm text-muted-foreground">
                    Page {currentPage} of {totalPages}
                </span>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                    disabled={currentPage === 1 || isFixing || isAutoRunning || isAutoCreating}
                >
                    Previous
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                    disabled={currentPage === totalPages || isFixing || isAutoRunning || isAutoCreating}
                >
                    Next
                </Button>
            </div>
        )}
      </CardContent>
    </Card>
    {editingMissingMedia && (
        <Dialog open={!!editingMissingMedia} onOpenChange={(open) => setEditingMissingMedia(open ? editingMissingMedia : null)}>
            <DialogContent className="max-w-5xl">
                <PreCreationMediaManager
                    key={editingMissingMedia} 
                    variants={editingMissingMediaVariants}
                    onSave={handleSavePreCreationMedia}
                    onCancel={() => setEditingMissingMedia(null)}
                />
            </DialogContent>
        </Dialog>
    )}
    {editingMissingVariantMedia && (
        <Dialog open={!!editingMissingVariantMedia} onOpenChange={(open) => setEditingMissingVariantMedia(open ? editingMissingVariantMedia : null)}>
            <DialogContent className="max-w-5xl">
             <MediaManager 
                key={editingMissingVariantMedia.parentProductId}
                productId={editingMissingVariantMedia.parentProductId}
                onImageCountChange={() => {}} // No need to change counts here
                isMissingVariantMode={true}
                missingVariants={editingMissingVariantMedia.items.map(i => i.csvProducts[0]).filter((p): p is Product => !!p)}
                onSaveMissingVariant={handleSaveMissingVariantMedia}
             />
            </DialogContent>
        </Dialog>
    )}
    </>
  );
}


