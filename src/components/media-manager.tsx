

'use client';

import { useState, useEffect, useTransition, useMemo, useCallback } from 'react';
import Image from 'next/image';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Trash2, UploadCloud, X, AlertTriangle, Blocks, CheckSquare, Square, Link } from 'lucide-react';
import { getProductWithImages, addImageFromUrl, assignImageToVariant, deleteImage } from '@/app/actions';
import { Product, ShopifyProductImage } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { cn } from '@/lib/utils';

interface MediaManagerProps {
    productId: string;
    onImageCountChange: (newCount: number) => void;
}

export function MediaManager({ productId, onImageCountChange }: MediaManagerProps) {
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [variants, setVariants] = useState<Partial<Product>[]>([]);
    const [images, setImages] = useState<ShopifyProductImage[]>([]);
    const [newImageUrl, setNewImageUrl] = useState('');
    const [isSubmitting, startSubmitting] = useTransition();
    const { toast } = useToast();
    const [selectedImageIds, setSelectedImageIds] = useState<Set<number>>(new Set());

    // State for bulk assign dialog
    const [bulkAssignImageId, setBulkAssignImageId] = useState<string>('');
    const [bulkAssignOption, setBulkAssignOption] = useState<string>('');
    const [bulkAssignValue, setBulkAssignValue] = useState<string>('');
    const [isBulkAssignDialogOpen, setIsBulkAssignDialogOpen] = useState(false);

    const fetchMediaData = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        setSelectedImageIds(new Set());
        try {
            const data = await getProductWithImages(productId);
            setVariants(data.variants);
            setImages(data.images);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load media data.');
        } finally {
            setIsLoading(false);
        }
    }, [productId]);

    useEffect(() => {
        fetchMediaData();
    }, [fetchMediaData]);
    
    const handleImageSelection = (imageId: number, checked: boolean) => {
        const newSet = new Set(selectedImageIds);
        if (checked) {
            newSet.add(imageId);
        } else {
            newSet.delete(imageId);
        }
        setSelectedImageIds(newSet);
    };

    const handleSelectAllImages = (checked: boolean) => {
        if (checked) {
            setSelectedImageIds(new Set(images.map(img => img.id)));
        } else {
            setSelectedImageIds(new Set());
        }
    };

    const handleAddImage = () => {
        if(!newImageUrl) {
            toast({ title: 'URL Required', description: 'Please enter an image URL.', variant: 'destructive' });
            return;
        }
        startSubmitting(async () => {
            const result = await addImageFromUrl(productId, newImageUrl);
            if(result.success && result.image) {
                const newImages = [...images, result.image];
                setImages(newImages);
                onImageCountChange(newImages.length);
                setNewImageUrl('');
                toast({ title: 'Success!', description: 'Image has been added.' });
            } else {
                toast({ title: 'Error', description: result.message, variant: 'destructive' });
            }
        });
    }

    const handleAssignImage = (variantId: string, imageId: number | null) => {
        const originalVariants = [...variants];
        const newVariants = variants.map(v => v.variantId === variantId ? { ...v, imageId: imageId } : v);
        setVariants(newVariants);
        
        startSubmitting(async () => {
            const result = await assignImageToVariant(variantId, imageId!);
            if(result.success) {
                toast({ title: 'Success!', description: 'Image assigned to variant.' });
                 // Refetch to confirm variant_ids on images
                fetchMediaData();
            } else {
                 setVariants(originalVariants);
                 toast({ title: 'Error', description: result.message, variant: 'destructive' });
            }
        });
    }
    
    const handleDeleteImage = (imageId: number) => {
        const imageToDelete = images.find(img => img.id === imageId);
        if (imageToDelete && imageToDelete.variant_ids.length > 0) {
            toast({ title: 'Cannot Delete', description: 'This image is currently assigned to one or more variants. Please unassign it first.', variant: 'destructive' });
            return;
        }
        startSubmitting(async () => {
            const result = await deleteImage(productId, imageId);
            if(result.success) {
                toast({ title: 'Success!', description: 'Image has been deleted.' });
                const newImages = images.filter(img => img.id !== imageId);
                setImages(newImages);
                onImageCountChange(newImages.length);
            } else {
                 toast({ title: 'Error', description: result.message, variant: 'destructive' });
            }
        });
    }

    const handleBulkDelete = () => {
         const assignedImages = Array.from(selectedImageIds).filter(id => {
            const image = images.find(img => img.id === id);
            return image && image.variant_ids.length > 0;
        });

        if (assignedImages.length > 0) {
             toast({ title: 'Cannot Delete', description: `Some selected images are assigned to variants and cannot be deleted. Please unassign them first.`, variant: 'destructive' });
             return;
        }

        startSubmitting(async () => {
            const idsToDelete = Array.from(selectedImageIds);
            let successfullyDeletedIds: number[] = [];
            
            for (const id of idsToDelete) {
                const res = await deleteImage(productId, id);
                if (res.success) {
                    successfullyDeletedIds.push(id);
                }
                await new Promise(resolve => setTimeout(resolve, 600)); // Delay
            }

            const failedCount = idsToDelete.length - successfullyDeletedIds.length;
            if (failedCount > 0) {
                 toast({ title: 'Some Deletions Failed', description: `Could not delete ${failedCount} images. Please try again.`, variant: 'destructive' });
            } else {
                toast({ title: 'Success!', description: `${successfullyDeletedIds.length} images have been deleted.` });
            }

            if (successfullyDeletedIds.length > 0) {
                const newImages = images.filter(img => !successfullyDeletedIds.includes(img.id));
                setImages(newImages);
                onImageCountChange(newImages.length);
            }
            setSelectedImageIds(new Set());
        });
    }

    const availableOptions = useMemo(() => {
        const options = new Map<string, Set<string>>();
        if (variants.length === 0) {
            return options;
        }
        
        const optionNames = {
            option1: variants.find(v => v.option1Name)?.option1Name || 'Option1',
            option2: variants.find(v => v.option2Name)?.option2Name || 'Option2',
            option3: variants.find(v => v.option3Name)?.option3Name || 'Option3',
        };

        variants.forEach(variant => {
            if (variant.option1Value) {
                if (!options.has(optionNames.option1)) options.set(optionNames.option1, new Set());
                options.get(optionNames.option1)!.add(variant.option1Value);
            }
            if (variant.option2Value) {
                if (!options.has(optionNames.option2)) options.set(optionNames.option2, new Set());
                options.get(optionNames.option2)!.add(variant.option2Value);
            }
            if (variant.option3Value) {
                 if (!options.has(optionNames.option3)) options.set(optionNames.option3, new Set());
                options.get(optionNames.option3)!.add(variant.option3Value);
            }
        });

        return options;
    }, [variants]);

    const handleBulkAssign = () => {
        const imageId = parseInt(bulkAssignImageId);
        if (!imageId || !bulkAssignOption) {
            toast({ title: 'Incomplete Selection', description: 'Please select an image and an option.', variant: 'destructive' });
            return;
        }
        
        let variantsToUpdate: Partial<Product>[] = [];

        if (bulkAssignOption === 'All Variants') {
            variantsToUpdate = [...variants];
        } else {
            if (!bulkAssignValue) {
                toast({ title: 'Incomplete Selection', description: 'Please select a value to match.', variant: 'destructive' });
                return;
            }

            let optionKeyToMatch: 'option1Value' | 'option2Value' | 'option3Value' | null = null;
            const firstVariantWithOptions = variants.find(v => v.option1Name || v.option2Name || v.option3Name);
            if(firstVariantWithOptions?.option1Name === bulkAssignOption) optionKeyToMatch = 'option1Value';
            else if(firstVariantWithOptions?.option2Name === bulkAssignOption) optionKeyToMatch = 'option2Value';
            else if(firstVariantWithOptions?.option3Name === bulkAssignOption) optionKeyToMatch = 'option3Value';
            else if (bulkAssignOption === 'Option1') optionKeyToMatch = 'option1Value';
            else if (bulkAssignOption === 'Option2') optionKeyToMatch = 'option2Value';
            else if (bulkAssignOption === 'Option3') optionKeyToMatch = 'option3Value';

            if (!optionKeyToMatch) {
                toast({ title: 'Option matching error', description: 'Could not determine which option to match on.', variant: 'destructive' });
                return;
            }
            variantsToUpdate = variants.filter(v => v[optionKeyToMatch as keyof typeof v] === bulkAssignValue);
        }
        
        if (variantsToUpdate.length === 0) {
            toast({ title: 'No variants found', description: 'No variants match the selected criteria.', variant: 'destructive' });
            return;
        }
        
        const originalVariants = [...variants];
        const newVariants = variants.map(v => {
             if (variantsToUpdate.some(vtu => vtu.variantId === v.variantId)) {
                return { ...v, imageId: imageId };
            }
            return v;
        });
        setVariants(newVariants);
        setIsBulkAssignDialogOpen(false);

        startSubmitting(async () => {
            const results = await Promise.all(
                variantsToUpdate.map(v => assignImageToVariant(v.variantId!, imageId))
            );

            const failedCount = results.filter(r => !r.success).length;
            if (failedCount > 0) {
                setVariants(originalVariants); // Revert on failure
                toast({ title: 'Bulk Assign Failed', description: `Could not assign image to ${failedCount} variants.`, variant: 'destructive' });
            } else {
                toast({ title: 'Success!', description: `Image assigned to ${variantsToUpdate.length} variants.` });
            }
            // Reset form
            setBulkAssignImageId('');
            setBulkAssignOption('');
            setBulkAssignValue('');
            fetchMediaData();
        });
    }

    return (
        <DialogContent className="max-w-5xl">
            <DialogHeader>
                <DialogTitle>Manage Product Media</DialogTitle>
                <DialogDescription>
                    Add, remove, and assign images for this product and its variants. Use checkboxes for bulk actions.
                </DialogDescription>
            </DialogHeader>
            {isLoading && (
                <div className="flex justify-center items-center h-96">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
            )}
            {error && (
                <div className="text-destructive-foreground bg-destructive/80 p-4 rounded-md flex items-center gap-4">
                   <AlertTriangle className="h-5 w-5" />
                   <div>
                     <h4 className="font-bold">Error Loading Media</h4>
                     <p>{error}</p>
                   </div>
                </div>
            )}
            {!isLoading && !error && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-h-[70vh] overflow-hidden">
                    <div className="flex flex-col gap-4 overflow-y-auto pr-2">
                        <div className="flex justify-between items-center border-b pb-2">
                            <h3 className="font-semibold text-lg">Image Gallery ({images.length})</h3>
                             <div className="flex items-center gap-2">
                                <Dialog open={isBulkAssignDialogOpen} onOpenChange={setIsBulkAssignDialogOpen}>
                                    <DialogTrigger asChild>
                                        <Button variant="outline" size="sm" disabled={isSubmitting || images.length === 0}>
                                            <Blocks className="mr-2 h-4 w-4" />
                                            Bulk Assign
                                        </Button>
                                    </DialogTrigger>
                                    <DialogContent>
                                        <DialogHeader>
                                            <DialogTitle>Bulk Assign Image</DialogTitle>
                                            <DialogDescription>Assign a single image to multiple variants based on an option or to all variants.</DialogDescription>
                                        </DialogHeader>
                                        <div className="space-y-4 py-4">
                                            <div className="space-y-2">
                                                <Label>1. Select Image to Assign</Label>
                                                <Select value={bulkAssignImageId} onValueChange={setBulkAssignImageId}>
                                                    <SelectTrigger><SelectValue placeholder="Select an image..." /></SelectTrigger>
                                                    <SelectContent>
                                                        {images.map(image => (
                                                            <SelectItem key={image.id} value={image.id.toString()}>
                                                                <div className="flex items-center gap-2">
                                                                    <Image src={image.src} alt="" width={20} height={20} className="rounded-sm" />
                                                                    <span>Image #{image.id}</span>
                                                                </div>
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="space-y-2">
                                                <Label>2. Select Target Variants</Label>
                                                <Select value={bulkAssignOption} onValueChange={val => { setBulkAssignOption(val); setBulkAssignValue(''); }}>
                                                    <SelectTrigger><SelectValue placeholder="Group by option or select all..." /></SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="All Variants">All Variants</SelectItem>
                                                        {[...availableOptions.keys()].map(optionName => (
                                                            <SelectItem key={optionName} value={optionName}>{optionName}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            {bulkAssignOption && bulkAssignOption !== 'All Variants' && (
                                                <div className="space-y-2">
                                                    <Label>3. Select Value to Match</Label>
                                                    <Select value={bulkAssignValue} onValueChange={setBulkAssignValue}>
                                                        <SelectTrigger><SelectValue placeholder="Select a value..." /></SelectTrigger>
                                                        <SelectContent>
                                                            {availableOptions.get(bulkAssignOption)?.size &&
                                                                Array.from(availableOptions.get(bulkAssignOption)!).map(value => (
                                                                    <SelectItem key={value} value={value}>{value}</SelectItem>
                                                                ))
                                                            }
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            )}
                                        </div>
                                        <DialogFooter>
                                            <Button variant="outline" onClick={() => setIsBulkAssignDialogOpen(false)}>Cancel</Button>
                                            <Button onClick={handleBulkAssign}>Assign Image</Button>
                                        </DialogFooter>
                                    </DialogContent>
                                </Dialog>
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button variant="destructive" size="sm" disabled={isSubmitting || selectedImageIds.size === 0}>
                                            <Trash2 className="mr-2 h-4 w-4" />
                                            Delete ({selectedImageIds.size})
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader><AlertDialogTitle>Delete Selected Images?</AlertDialogTitle></AlertDialogHeader>
                                        <AlertDialogDescription>Are you sure you want to permanently delete the {selectedImageIds.size} selected images? This action cannot be undone.</AlertDialogDescription>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                            <AlertDialogAction onClick={handleBulkDelete} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">Delete Images</AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            </div>
                        </div>

                         <div className="flex items-center space-x-2">
                             <Checkbox
                                id="select-all"
                                onCheckedChange={(checked) => handleSelectAllImages(!!checked)}
                                checked={selectedImageIds.size > 0 && selectedImageIds.size === images.length}
                                disabled={images.length === 0}
                             />
                            <Label htmlFor="select-all" className="text-sm font-normal">Select All</Label>
                        </div>
                        
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                            {images.map(image => {
                                const isAssigned = image.variant_ids && image.variant_ids.length > 0;
                                const isSelected = selectedImageIds.has(image.id);
                                return (
                                    <div key={image.id} className="relative group border rounded-md overflow-hidden cursor-pointer" onClick={() => handleImageSelection(image.id, !isSelected)}>
                                        <Image
                                            src={image.src}
                                            alt={`Product image ${image.id}`}
                                            width={150}
                                            height={150}
                                            className="object-cover w-full aspect-square"
                                        />
                                        <div className={cn(
                                            "absolute inset-0 bg-black/60 transition-opacity flex items-start justify-between p-1.5",
                                            (isSelected || isSubmitting) ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                                             isSubmitting ? "pointer-events-none" : "pointer-events-auto"
                                        )}>
                                             <Checkbox
                                                id={`image-select-${image.id}`}
                                                className="bg-white/80 data-[state=checked]:bg-primary pointer-events-auto"
                                                checked={isSelected}
                                                onCheckedChange={(checked) => handleImageSelection(image.id, !!checked)}
                                            />
                                             <AlertDialog>
                                                <AlertDialogTrigger asChild>
                                                    <Button variant="destructive" size="icon" className="h-6 w-6 pointer-events-auto" disabled={isSubmitting} onClick={(e) => e.stopPropagation()}>
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </Button>
                                                </AlertDialogTrigger>
                                                <AlertDialogContent>
                                                    <AlertDialogHeader><AlertDialogTitle>Delete this image?</AlertDialogTitle></AlertDialogHeader>
                                                    <AlertDialogDescription>
                                                        This will permanently delete the image from Shopify. This action cannot be undone.
                                                         {isAssigned && <span className="font-bold text-destructive-foreground mt-2 block">Warning: This image is assigned to {image.variant_ids.length} variant(s).</span>}
                                                    </AlertDialogDescription>
                                                    <AlertDialogFooter>
                                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                        <AlertDialogAction onClick={() => handleDeleteImage(image.id)} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">Delete Image</AlertDialogAction>
                                                    </AlertDialogFooter>
                                                </AlertDialogContent>
                                            </AlertDialog>
                                        </div>
                                        {isAssigned && (
                                            <TooltipProvider>
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <div className={cn(
                                                            "absolute top-1.5 right-1.5 h-6 w-6 inline-flex items-center justify-center rounded-full bg-secondary/80 text-secondary-foreground pointer-events-auto",
                                                            !isSelected && "group-hover:hidden"
                                                        )}>
                                                            <Link className="h-3.5 w-3.5" />
                                                        </div>
                                                    </TooltipTrigger>
                                                    <TooltipContent>
                                                        <p>Assigned to {image.variant_ids.length} variant(s)</p>
                                                    </TooltipContent>
                                                </Tooltip>
                                            </TooltipProvider>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                         <div className="p-4 border rounded-md mt-auto bg-muted/20">
                            <Label htmlFor="new-image-url" className="text-base font-medium">Add New Image</Label>
                            <div className="flex gap-2 mt-2">
                                <Input 
                                  id="new-image-url"
                                  placeholder="https://example.com/image.jpg"
                                  value={newImageUrl}
                                  onChange={(e) => setNewImageUrl(e.target.value)}
                                  disabled={isSubmitting}
                                />
                                <Button onClick={handleAddImage} disabled={isSubmitting}>
                                    {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}
                                    Add
                                </Button>
                            </div>
                        </div>
                    </div>
                    {/* Right side: Variant Assignments */}
                    <div className="flex flex-col gap-4 overflow-y-auto pr-2">
                        <h3 className="font-semibold text-lg border-b pb-2">Variant Assignments ({variants.length})</h3>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>SKU</TableHead>
                                    <TableHead>Options</TableHead>
                                    <TableHead>Assigned Image</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {variants.map(variant => (
                                    <TableRow key={variant.variantId}>
                                        <TableCell className="font-medium">{variant.sku}</TableCell>
                                        <TableCell className="text-xs text-muted-foreground">
                                            {[variant.option1Value, variant.option2Value, variant.option3Value].filter(Boolean).join(' / ')}
                                        </TableCell>
                                        <TableCell>
                                            <Select
                                                value={variant.imageId?.toString() ?? 'none'}
                                                onValueChange={(value) => handleAssignImage(variant.variantId!, value === 'none' ? null : parseInt(value))}
                                                disabled={isSubmitting}
                                            >
                                                <SelectTrigger className="w-[180px]">
                                                    <SelectValue placeholder="Select image..." />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="none">No Image</SelectItem>
                                                    {images.map(image => (
                                                         <SelectItem key={image.id} value={image.id.toString()}>
                                                            <div className="flex items-center gap-2">
                                                                <Image src={image.src} alt="" width={20} height={20} className="rounded-sm" />
                                                                <span>Image #{image.id}</span>
                                                            </div>
                                                         </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </div>
            )}
        </DialogContent>
    );
}
