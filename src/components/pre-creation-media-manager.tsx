
'use client';

import { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Trash2, Link, Blocks } from 'lucide-react';
import { Product } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';

interface PreCreationMediaManagerProps {
    variants: Product[];
    onSave: (updatedVariants: Product[]) => void;
    onCancel: () => void;
}

export function PreCreationMediaManager({ variants, onSave, onCancel }: PreCreationMediaManagerProps) {
    const [localVariants, setLocalVariants] = useState<Product[]>([]);
    const [imageUrls, setImageUrls] = useState<string[]>([]);
    const [newImageUrl, setNewImageUrl] = useState('');
    const { toast } = useToast();
    const [selectedImageUrls, setSelectedImageUrls] = useState<Set<string>>(new Set());

    // State for bulk assign dialog
    const [bulkAssignImageUrl, setBulkAssignImageUrl] = useState<string>('');
    const [bulkAssignOption, setBulkAssignOption] = useState<string>('');
    const [bulkAssignValue, setBulkAssignValue] = useState<string>('');
    const [isBulkAssignDialogOpen, setIsBulkAssignDialogOpen] = useState(false);

    useEffect(() => {
        setLocalVariants(JSON.parse(JSON.stringify(variants)));
        const uniqueUrls = [...new Set(variants.map(v => v.mediaUrl).filter(Boolean) as string[])];
        setImageUrls(uniqueUrls);
        setSelectedImageUrls(new Set());
    }, [variants]);

    const handleImageSelection = (imageUrl: string, checked: boolean) => {
        const newSet = new Set(selectedImageUrls);
        if (checked) {
            newSet.add(imageUrl);
        } else {
            newSet.delete(imageUrl);
        }
        setSelectedImageUrls(newSet);
    };

    const handleSelectAllImages = (checked: boolean) => {
        if (checked) {
            setSelectedImageUrls(new Set(imageUrls));
        } else {
            setSelectedImageUrls(new Set());
        }
    };

    const handleAddImageUrl = () => {
        if (!newImageUrl || !newImageUrl.startsWith('http')) {
            toast({ title: 'Invalid URL', description: 'Please enter a valid image URL.', variant: 'destructive' });
            return;
        }
        if (imageUrls.includes(newImageUrl)) {
            toast({ title: 'Duplicate URL', description: 'This image URL has already been added.', variant: 'destructive' });
            return;
        }
        setImageUrls(prev => [...prev, newImageUrl]);
        setNewImageUrl('');
    };

    const handleDeleteImageUrl = (urlToDelete: string) => {
        setImageUrls(prev => prev.filter(url => url !== urlToDelete));
        setLocalVariants(prev => prev.map(v => v.mediaUrl === urlToDelete ? { ...v, mediaUrl: null } : v));
    };

    const handleBulkDelete = () => {
        const urlsToKeep = imageUrls.filter(url => !selectedImageUrls.has(url));
        setImageUrls(urlsToKeep);

        const updatedVariants = localVariants.map(v => {
            if (v.mediaUrl && selectedImageUrls.has(v.mediaUrl)) {
                return { ...v, mediaUrl: null };
            }
            return v;
        });
        setLocalVariants(updatedVariants);

        toast({ title: 'Images Removed', description: `${selectedImageUrls.size} image URLs were removed and unassigned.` });
        setSelectedImageUrls(new Set());
    };

    const handleAssignImage = (sku: string, url: string | null) => {
        setLocalVariants(prev => prev.map(v => v.sku === sku ? { ...v, mediaUrl: url } : v));
    };

    const availableOptions = useMemo(() => {
        const options = new Map<string, Set<string>>();
        if (variants.length > 0) {
            const firstVariant = variants[0];
            const optionNames = {
                option1: firstVariant.option1Name,
                option2: firstVariant.option2Name,
                option3: firstVariant.option3Name,
            };

            for (const [key, name] of Object.entries(optionNames)) {
                if (name && name !== 'Title') {
                    options.set(name, new Set());
                }
            }

            variants.forEach(variant => {
                if (optionNames.option1 && variant.option1Value) options.get(optionNames.option1)?.add(variant.option1Value);
                if (optionNames.option2 && variant.option2Value) options.get(optionNames.option2)?.add(variant.option2Value);
                if (optionNames.option3 && variant.option3Value) options.get(optionNames.option3)?.add(variant.option3Value);
            });
        }
        return options;
    }, [variants]);

    const handleBulkAssign = () => {
        if (!bulkAssignImageUrl || !bulkAssignOption || !bulkAssignValue) {
            toast({ title: 'Incomplete Selection', description: 'Please select an image, an option, and a value.', variant: 'destructive' });
            return;
        }

        let optionKey: keyof Product | null = null;
        if (variants[0]?.option1Name === bulkAssignOption) optionKey = 'option1Value';
        else if (variants[0]?.option2Name === bulkAssignOption) optionKey = 'option2Value';
        else if (variants[0]?.option3Name === bulkAssignOption) optionKey = 'option3Value';
        
        if (!optionKey) return;
        
        const variantsToUpdate = localVariants.filter(v => v[optionKey] === bulkAssignValue);
        
        if (variantsToUpdate.length === 0) {
            toast({ title: 'No variants found', description: 'No variants match the selected criteria.', variant: 'destructive' });
            return;
        }

        setLocalVariants(prev => prev.map(v => {
            if (v[optionKey as keyof Product] === bulkAssignValue) {
                return { ...v, mediaUrl: bulkAssignImageUrl };
            }
            return v;
        }));

        setIsBulkAssignDialogOpen(false);
        toast({ title: 'Success!', description: `Image assigned to ${variantsToUpdate.length} variants.` });
        
        // Reset form
        setBulkAssignImageUrl('');
        setBulkAssignOption('');
        setBulkAssignValue('');
    };

    const handleSave = () => {
        onSave(localVariants);
    };

    if (variants.length === 0) {
        return null;
    }

    const productTitle = variants[0]?.name || 'New Product';

    return (
        <DialogContent className="max-w-5xl">
            <DialogHeader>
                <DialogTitle>Manage Media for: {productTitle}</DialogTitle>
                <DialogDescription>
                    Add, remove, and assign images before creating the product. Changes are saved locally.
                </DialogDescription>
            </DialogHeader>
             <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-h-[70vh] overflow-hidden">
                <div className="flex flex-col gap-4 overflow-y-auto pr-2">
                    <div className="flex justify-between items-center border-b pb-2">
                        <h3 className="font-semibold text-lg">Image Gallery ({imageUrls.length})</h3>
                        <div className="flex items-center gap-2">
                            <Dialog open={isBulkAssignDialogOpen} onOpenChange={setIsBulkAssignDialogOpen}>
                                <DialogTrigger asChild>
                                    <Button variant="outline" size="sm" disabled={imageUrls.length === 0}>
                                        <Blocks className="mr-2 h-4 w-4" />
                                        Bulk Assign
                                    </Button>
                                </DialogTrigger>
                                <DialogContent>
                                    <DialogHeader>
                                        <DialogTitle>Bulk Assign Image</DialogTitle>
                                        <DialogDescription>Assign a single image to multiple variants based on an option.</DialogDescription>
                                    </DialogHeader>
                                    <div className="space-y-4 py-4">
                                        <div className="space-y-2">
                                            <Label>1. Select Image to Assign</Label>
                                            <Select value={bulkAssignImageUrl} onValueChange={setBulkAssignImageUrl}>
                                                <SelectTrigger><SelectValue placeholder="Select an image..." /></SelectTrigger>
                                                <SelectContent>
                                                    {imageUrls.map((url) => (
                                                        <SelectItem key={url} value={url}>
                                                            <div className="flex items-center gap-2">
                                                                <Image src={url} alt="" width={20} height={20} className="rounded-sm object-cover" />
                                                                <span className="truncate max-w-xs">{url.split('/').pop()}</span>
                                                            </div>
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-2">
                                            <Label>2. Select Option to Group By</Label>
                                            <Select value={bulkAssignOption} onValueChange={val => { setBulkAssignOption(val); setBulkAssignValue(''); }}>
                                                <SelectTrigger><SelectValue placeholder="Select an option..." /></SelectTrigger>
                                                <SelectContent>
                                                    {[...availableOptions.keys()].map(optionName => (
                                                        <SelectItem key={optionName} value={optionName}>{optionName}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-2">
                                            <Label>3. Select Value to Match</Label>
                                            <Select value={bulkAssignValue} onValueChange={setBulkAssignValue} disabled={!bulkAssignOption}>
                                                <SelectTrigger><SelectValue placeholder="Select a value..." /></SelectTrigger>
                                                <SelectContent>
                                                    {bulkAssignOption && availableOptions.get(bulkAssignOption)?.size &&
                                                        Array.from(availableOptions.get(bulkAssignOption)!).map(value => (
                                                            <SelectItem key={value} value={value}>{value}</SelectItem>
                                                        ))
                                                    }
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>
                                    <DialogFooter>
                                        <Button variant="outline" onClick={() => setIsBulkAssignDialogOpen(false)}>Cancel</Button>
                                        <Button onClick={handleBulkAssign}>Assign Image</Button>
                                    </DialogFooter>
                                </DialogContent>
                            </Dialog>
                             <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <Button variant="destructive" size="sm" disabled={selectedImageUrls.size === 0}>
                                        <Trash2 className="mr-2 h-4 w-4" />
                                        Delete ({selectedImageUrls.size})
                                    </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader><AlertDialogTitle>Remove Selected Images?</AlertDialogTitle></AlertDialogHeader>
                                    <AlertDialogDescription>Are you sure you want to remove the {selectedImageUrls.size} selected image URLs? They will be removed from the gallery and unassigned from all variants. This does not delete the files from their source.</AlertDialogDescription>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                        <AlertDialogAction onClick={handleBulkDelete} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">Remove URLs</AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        </div>
                    </div>
                     <div className="flex items-center space-x-2">
                         <Checkbox
                            id="select-all-pre"
                            onCheckedChange={(checked) => handleSelectAllImages(!!checked)}
                            checked={selectedImageUrls.size > 0 && selectedImageUrls.size === imageUrls.length}
                            disabled={imageUrls.length === 0}
                         />
                        <Label htmlFor="select-all-pre" className="text-sm font-normal">Select All</Label>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                        {imageUrls.map(url => (
                            <div key={url} className="relative group border rounded-md overflow-hidden">
                                 <Image
                                    src={url}
                                    alt={`Product image`}
                                    width={150}
                                    height={150}
                                    className="object-cover w-full aspect-square"
                                />
                                <div className="absolute inset-0 bg-black/60 opacity-100 flex items-start justify-between p-1.5">
                                    <Checkbox
                                        className="bg-white/80 data-[state=checked]:bg-primary"
                                        checked={selectedImageUrls.has(url)}
                                        onCheckedChange={(checked) => handleImageSelection(url, !!checked)}
                                    />
                                   <a href={url} target="_blank" rel="noopener noreferrer" className="h-6 w-6 inline-flex items-center justify-center rounded-md bg-secondary/80 text-secondary-foreground hover:bg-secondary">
                                      <Link className="h-3.5 w-3.5" />
                                   </a>
                                </div>
                            </div>
                        ))}
                    </div>
                     <div className="p-4 border rounded-md mt-auto bg-muted/20 sticky bottom-0">
                        <Label htmlFor="new-image-url" className="text-base font-medium">Add New Image from URL</Label>
                        <div className="flex gap-2 mt-2">
                            <Input 
                              id="new-image-url"
                              placeholder="https://example.com/image.jpg"
                              value={newImageUrl}
                              onChange={(e) => setNewImageUrl(e.target.value)}
                            />
                            <Button onClick={handleAddImageUrl}>
                                Add
                            </Button>
                        </div>
                    </div>
                </div>
                <div className="flex flex-col gap-4 overflow-y-auto pr-2">
                    <h3 className="font-semibold text-lg border-b pb-2">Variant Assignments</h3>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>SKU</TableHead>
                                <TableHead>Options</TableHead>
                                <TableHead>Assigned Image</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {localVariants.map(variant => (
                                <TableRow key={variant.sku}>
                                    <TableCell className="font-medium">{variant.sku}</TableCell>
                                    <TableCell className="text-xs text-muted-foreground">
                                        {[variant.option1Value, variant.option2Value, variant.option3Value].filter(Boolean).join(' / ')}
                                    </TableCell>
                                    <TableCell>
                                        <Select
                                            value={variant.mediaUrl || 'none'}
                                            onValueChange={(value) => handleAssignImage(variant.sku, value === 'none' ? null : value)}
                                        >
                                            <SelectTrigger className="w-[200px]">
                                                <SelectValue placeholder="Select image..." />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="none">No Image</SelectItem>
                                                {imageUrls.map((url, index) => (
                                                     <SelectItem key={url} value={url}>
                                                        <div className="flex items-center gap-2">
                                                            <Image src={url} alt="" width={20} height={20} className="rounded-sm object-cover" />
                                                            <span className="truncate max-w-[120px]">Image {index + 1}</span>
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
            <DialogFooter className="mt-4">
                <Button variant="outline" onClick={onCancel}>Cancel</Button>
                <Button onClick={handleSave}>Save Assignments</Button>
            </DialogFooter>
        </DialogContent>
    );
}

    