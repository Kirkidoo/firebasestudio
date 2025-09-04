

'use client';

import { useState, useTransition, useEffect, useMemo, useCallback, useRef } from 'react';
import { AuditResult, AuditStatus, DuplicateSku, MismatchDetail, Product, ShopifyProductImage } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { downloadCsv, markMismatchAsFixed, getFixedMismatches, clearAuditMemory, getCreatedProductHandles, markProductAsCreated } from '@/lib/utils';
import { CheckCircle2, AlertTriangle, PlusCircle, ArrowLeft, Download, XCircle, Wrench, Siren, Loader2, RefreshCw, Text, DollarSign, List, FileText, Eye, Trash2, Search, Image as ImageIcon, FileWarning, Bot, Eraser, Check, Link, Copy } from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger, AccordionHeader } from '@/components/ui/accordion';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { fixMultipleMismatches, createInShopify, createMultipleInShopify, deleteFromShopify, deleteVariantFromShopify, getProductWithImages, getProductImageCounts } from '@/app/actions';
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

const HANDLES_PER_PAGE = 20;

const MISMATCH_FILTER_TYPES: MismatchDetail['field'][] = ['name', 'price', 'inventory', 'h1_tag', 'duplicate_in_shopify', 'heavy_product_template', 'heavy_product_flag'];

export default function AuditReport({ data, summary, duplicates, fileName, onReset, onRefresh }: { data: AuditResult[], summary: any, duplicates: DuplicateSku[], fileName: string, onReset: () => void, onRefresh: () => void }) {
  const [filter, setFilter] = useState<FilterType>('all');
  const [isFixing, startTransition] = useTransition();
  const { toast } = useToast();
  
  const [reportData, setReportData] = useState<AuditResult[]>(data);
  const [reportSummary, setReportSummary] = useState<any>(summary);
  const [showRefresh, setShowRefresh] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [mismatchFilters, setMismatchFilters] = useState<Set<MismatchDetail['field']>>(new Set());
  const [selectedVendor, setSelectedVendor] = useState<string>('all');
  const [editingMissingMedia, setEditingMissingMedia] = useState<string | null>(null);
  const [selectedHandles, setSelectedHandles] = useState<Set<string>>(new Set());
  const [fixedMismatches, setFixedMismatches] = useState<Set<string>>(new Set());
  const [createdProductHandles, setCreatedProductHandles] = useState<Set<string>>(new Set());
  const [imageCounts, setImageCounts] = useState<Record<string, number>>({});
  const [loadingImageCounts, setLoadingImageCounts] = useState<Set<string>>(new Set());
  const [editingMediaFor, setEditingMediaFor] = useState<string | null>(null);
  
  const selectAllCheckboxRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setReportData(data);
    setReportSummary(summary);
    setShowRefresh(false);
    setCurrentPage(1);
    setSelectedHandles(new Set());
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
        if (item.status === 'missing_in_shopify' && item.mismatches.length === 1 && item.mismatches[0].field === 'missing_in_shopify') {
            // This is a "missing" product that has had its other warnings (like heavy_product) hidden.
            // If the handle has been created, we hide it completely.
             return !createdProductHandles.has(getHandle(item));
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

    return results;
  }, [reportData, filter, searchTerm, mismatchFilters, selectedVendor, fixedMismatches, createdProductHandles]);

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


  const handleKeys = filter === 'duplicate_in_shopify' ? Object.keys(groupedBySku) : Object.keys(groupedByHandle);
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
      CSV_Product_Name: item.csvProducts[0]?.name || 'N/A',
      Shopify_Product_Name: item.shopifyProducts[0]?.name || 'N/A',
      CSV_Price: item.csvProducts[0] ? item.csvProducts[0].price.toFixed(2) : 'N/A',
      Shopify_Price: item.shopifyProducts[0] ? item.shopifyProducts[0].price.toFixed(2) : 'N/A',
      CSV_Inventory: item.csvProducts[0]?.inventory ?? 'N/A',
      Shopify_Inventory: item.shopifyProducts[0]?.inventory ?? 'N/A',
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

  const handleFixSingleMismatch = (item: AuditResult, fixType: MismatchDetail['field']) => {
    const itemToFix: AuditResult = {
        ...item,
        mismatches: item.mismatches.filter(m => m.field === fixType)
    };
    handleBulkFix([itemToFix]);
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
    const productToCreate = item.csvProducts[0];
    const missingType = item.mismatches[0]?.missingType;

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

  const handleBulkCreate = (itemsToCreate: { product: Product; allVariants: Product[]; missingType: 'product' | 'variant' }[]) => {
      setShowRefresh(true);

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
      });
  };
  
  const handleCreateSelected = () => {
      const itemsToCreate = Array.from(selectedHandles).map(handle => {
          const firstItemForHandle = reportData.find(d => d.csvProducts[0]?.handle === handle && d.status === 'missing_in_shopify');
          if (!firstItemForHandle || !firstItemForHandle.csvProducts[0]) return null;
          
          const allVariantsForHandle = reportData
              .filter(d => d.csvProducts[0]?.handle === handle && d.status === 'missing_in_shopify')
              .map(d => d.csvProducts[0])
              .filter((p): p is Product => p !== null);
          
          const missingType = firstItemForHandle.mismatches[0]?.missingType ?? 'product';

          return {
              product: firstItemForHandle.csvProducts[0],
              allVariants: allVariantsForHandle,
              missingType: missingType,
          };
      }).filter((item): item is { product: Product; allVariants: Product[]; missingType: 'product' | 'variant' } => item !== null);

      if (itemsToCreate.length > 0) {
          handleBulkCreate(itemsToCreate);
      } else {
          toast({ title: "No items to create", description: "Please select products to create.", variant: "destructive" });
      }
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

    const MismatchIcons = ({mismatches}: {mismatches: MismatchDetail[]}) => {
        const uniqueFields = [...new Set(mismatches.map(m => m.field))];
        
        const icons: { [key in MismatchDetail['field']]: React.ReactElement } = {
            name: <Text className="h-4 w-4" />,
            price: <DollarSign className="h-4 w-4" />,
            inventory: <List className="h-4 w-4" />,
            heavy_product_flag: <FileWarning className="h-4 w-4" />,
            h1_tag: <span className="text-xs font-bold leading-none">H1</span>,
            heavy_product_template: <FileWarning className="h-4 w-4" />,
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
  
  const handleSelectAllOnPage = (checked: boolean | 'indeterminate') => {
    const newSelectedHandles = new Set(selectedHandles);
    if (checked === true) {
      paginatedHandleKeys.forEach(handle => newSelectedHandles.add(handle));
    } else {
      paginatedHandleKeys.forEach(handle => newSelectedHandles.delete(handle));
    }
    setSelectedHandles(newSelectedHandles);
  };
  
  const handleClearAuditMemory = () => {
    clearAuditMemory();
    setFixedMismatches(new Set());
    setCreatedProductHandles(new Set());
    toast({ title: "Cleared 'Remembered' Fixes & Creations", description: "The report is now showing all original items. Run a new non-cached audit for the latest data." });
  }
  
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
            const handlesToFetch: string[] = [];

            for (const handle of paginatedHandleKeys) {
                const items = groupedByHandle[handle];
                const productId = items?.[0]?.shopifyProducts?.[0]?.id;
                if (productId && imageCounts[productId] === undefined && !loadingImageCounts.has(productId)) {
                    productIdsToFetch.push(productId);
                    handlesToFetch.push(productId);
                }
            }

            if (productIdsToFetch.length === 0) return;

            setLoadingImageCounts(prev => {
                const newSet = new Set(prev);
                handlesToFetch.forEach(h => newSet.add(h));
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
                    handlesToFetch.forEach(h => newSet.delete(h));
                    return newSet;
                });
            }
        };

        fetchCounts();
    }, [paginatedHandleKeys, groupedByHandle, toast, imageCounts, loadingImageCounts]);


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

  const renderRegularReport = () => (
    <Accordion type="single" collapsible className="w-full">
        {paginatedHandleKeys.map((handle) => {
             const items = groupedByHandle[handle];
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

            return (
            <AccordionItem value={handle} key={handle} className="border-b last:border-b-0">
                <AccordionHeader className="flex items-center p-0">
                    {(filter === 'mismatched' || filter === 'missing_in_shopify') && (
                        <div className="p-3 pl-4">
                            <Checkbox
                                checked={selectedHandles.has(handle)}
                                onCheckedChange={(checked) => handleSelectHandle(handle, !!checked)}
                                aria-label={`Select product ${handle}`}
                                disabled={isFixing || (filter === 'missing_in_shopify' && items[0].mismatches[0]?.missingType === 'variant')}
                            />
                        </div>
                    )}
                    <AccordionTrigger className="flex-grow p-3 text-left" disabled={isFixing}>
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
                        {items.some(i => i.status === 'mismatched' && i.mismatches.length > 0) && (
                            <Button size="sm" onClick={(e) => { e.stopPropagation(); handleBulkFix(items.filter(i => i.status === 'mismatched'))}} disabled={isFixing}>
                                <Bot className="mr-2 h-4 w-4" />
                                Fix All ({items.flatMap(i => i.mismatches).filter(m => m.field !== 'duplicate_in_shopify' && m.field !== 'heavy_product_flag').length})
                            </Button>
                        )}
                         {isMissing && items[0].mismatches[0]?.missingType === 'product' && (
                            <>
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={(e) => {e.stopPropagation(); handleMarkAsCreated(handle);}} disabled={isFixing}>
                                                <Check className="h-4 w-4" />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            <p>Mark as created (hide from report)</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                                <Button size="sm" onClick={(e) => { e.stopPropagation(); handleCreate(items[0])}} disabled={isFixing}>
                                    <PlusCircle className="mr-2 h-4 w-4" />
                                    Create Product
                                </Button>
                            </>
                        )}
                        <Badge variant="outline" className="w-[80px] justify-center">{items.length} SKU{items.length > 1 ? 's' : ''}</Badge>
                        
                        {productId && (
                            <Dialog open={editingMediaFor === productId} onOpenChange={(open) => setEditingMediaFor(open ? productId : null)}>
                                <DialogTrigger asChild>
                                    <Button size="sm" variant="outline" className="w-[180px]" onClick={(e) => e.stopPropagation()}>
                                        {isLoadingImages ? (
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin"/>
                                        ) : (
                                            <ImageIcon className="mr-2 h-4 w-4" />
                                        )}
                                        Manage Media {imageCount !== undefined && `(${imageCount})`}
                                    </Button>
                                </DialogTrigger>
                                {editingMediaFor === productId && (
                                     <MediaManager 
                                        key={productId}
                                        productId={productId}
                                        onImageCountChange={(newCount) => handleImageCountChange(productId, newCount)}
                                    />
                                )}
                            </Dialog>
                        )}
                        {isMissing && items[0].mismatches[0]?.missingType === 'product' && (
                            <Button size="sm" variant="outline" className="w-[160px]" onClick={(e) => {e.stopPropagation(); setEditingMissingMedia(handle)}}>
                                <ImageIcon className="mr-2 h-4 w-4" />
                                Manage Media
                            </Button>
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
                                if (item.status === 'missing_in_shopify' && item.mismatches.every(m => m.field !== 'missing_in_shopify')) return null;

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
                                                        disabled={isFixing}
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
                                                    <MissingProductDetailsDialog product={item.csvProducts[0]} />
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
                      <AccordionTrigger className="p-3 text-left" disabled={isFixing}>
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
                                                          <Button size="sm" variant="destructive" disabled={isFixing}>
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
          { isFixing && 
            <div className="flex items-center gap-2 text-sm text-muted-foreground p-2 rounded-md bg-card-foreground/5">
              <Loader2 className="h-4 w-4 animate-spin"/>
              Applying changes...
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
            {filter === 'missing_in_shopify' && selectedHandles.size > 0 && (
                <Button onClick={handleCreateSelected} disabled={isFixing} className="w-full md:w-auto">
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Create {selectedHandles.size} Selected
                </Button>
            )}
        </div>

        {(filter === 'mismatched' || filter === 'missing_in_shopify') && paginatedHandleKeys.length > 0 && (
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
