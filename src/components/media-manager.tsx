
'use client';

import { useState, useEffect, useTransition } from 'react';
import Image from 'next/image';
import { DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Trash2, UploadCloud, X, AlertTriangle } from 'lucide-react';
import { getProductWithImages, addImageFromUrl, assignImageToVariant, deleteImage } from '@/app/actions';
import { Product, ShopifyProductImage } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';

interface MediaManagerProps {
    productId: string;
}

export function MediaManager({ productId }: MediaManagerProps) {
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [variants, setVariants] = useState<Partial<Product>[]>([]);
    const [images, setImages] = useState<ShopifyProductImage[]>([]);
    const [newImageUrl, setNewImageUrl] = useState('');
    const [isSubmitting, startSubmitting] = useTransition();
    const { toast } = useToast();

    const fetchMediaData = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await getProductWithImages(productId);
            setVariants(data.variants);
            setImages(data.images);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load media data.');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchMediaData();
    }, [productId]);
    
    const handleAddImage = () => {
        if(!newImageUrl) {
            toast({ title: 'URL Required', description: 'Please enter an image URL.', variant: 'destructive' });
            return;
        }
        startSubmitting(async () => {
            const result = await addImageFromUrl(productId, newImageUrl);
            if(result.success && result.image) {
                setImages(prev => [...prev, result.image!]);
                setNewImageUrl('');
                toast({ title: 'Success!', description: 'Image has been added.' });
            } else {
                toast({ title: 'Error', description: result.message, variant: 'destructive' });
            }
        });
    }

    const handleAssignImage = (variantId: string, imageId: number | null) => {
        // Optimistic UI update
        const originalVariants = [...variants];
        const newVariants = variants.map(v => v.variantId === variantId ? { ...v, imageId: imageId } : v);
        setVariants(newVariants);
        
        startSubmitting(async () => {
            const result = await assignImageToVariant(variantId, imageId!);
            if(result.success) {
                toast({ title: 'Success!', description: 'Image assigned to variant.' });
            } else {
                 setVariants(originalVariants);
                 toast({ title: 'Error', description: result.message, variant: 'destructive' });
            }
        });
    }
    
    const handleDeleteImage = (imageId: number) => {
        startSubmitting(async () => {
            // Check if image is assigned to any variant
            const isAssigned = variants.some(v => v.imageId === imageId);
            if (isAssigned) {
                toast({ title: 'Cannot Delete', description: 'This image is currently assigned to one or more variants. Please unassign it first.', variant: 'destructive' });
                return;
            }

            const result = await deleteImage(productId, imageId);
            if(result.success) {
                setImages(prev => prev.filter(img => img.id !== imageId));
                toast({ title: 'Success!', description: 'Image has been deleted.' });
            } else {
                 toast({ title: 'Error', description: result.message, variant: 'destructive' });
            }
        });
    }

    return (
        <DialogContent className="max-w-5xl">
            <DialogHeader>
                <DialogTitle>Manage Product Media</DialogTitle>
                <DialogDescription>
                    Add, remove, and assign images for this product and its variants.
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
                    {/* Left side: Image Gallery & Add */}
                    <div className="flex flex-col gap-4 overflow-y-auto pr-2">
                        <h3 className="font-semibold text-lg border-b pb-2">Image Gallery ({images.length})</h3>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                            {images.map(image => (
                                <div key={image.id} className="relative group border rounded-md overflow-hidden">
                                     <Image
                                        src={image.src}
                                        alt={`Product image ${image.id}`}
                                        width={150}
                                        height={150}
                                        className="object-cover w-full aspect-square"
                                    />
                                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                       <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <Button size="icon" variant="destructive" disabled={isSubmitting}>
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                                <AlertDialogHeader>
                                                    <AlertDialogTitle>Delete this image?</AlertDialogTitle>
                                                    <AlertDialogDescription>
                                                        This action cannot be undone. Are you sure you want to permanently delete this image from the product?
                                                    </AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                    <AlertDialogAction onClick={() => handleDeleteImage(image.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                                        Yes, delete image
                                                    </AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>

                                    </div>
                                </div>
                            ))}
                        </div>
                         <div className="p-4 border rounded-md mt-4 bg-muted/20">
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
