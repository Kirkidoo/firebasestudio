'use server';

import {
  Product,
  AuditResult,
  DuplicateSku,
  MismatchDetail,
  ShopifyProductImage,
} from '@/lib/types';
import {
  getShopifyProductsBySku,
  updateProduct,
  updateProductVariant,
  inventorySetQuantities,
  createProduct,
  addProductVariant,
  connectInventoryToLocation,
  linkProductToCollection,
  getCollectionIdByTitle,
  getShopifyLocations,
  disconnectInventoryFromLocation,
  publishProductToSalesChannels,
  deleteProduct,
  deleteProductVariant,
  startProductExportBulkOperation as startShopifyBulkOp,
  checkBulkOperationStatus as checkShopifyBulkOpStatus,
  getBulkOperationResult,
  parseBulkOperationResult,
  getFullProduct,
  addProductImage,
  deleteProductImage,
  getProductImageCounts as getShopifyProductImageCounts,
  getProductByHandle,
  addProductTags,
  removeProductTags,
} from '@/lib/shopify';
import { revalidatePath } from 'next/cache';
import fs from 'fs/promises';
import path from 'path';
import * as ftpService from '@/services/ftp';
import * as csvService from '@/services/csv';
import * as auditService from '@/services/audit';
import { log, getLogs, clearLogs } from '@/services/logger';

const GAMMA_WAREhouse_LOCATION_ID = process.env.GAMMA_WAREHOUSE_LOCATION_ID
  ? parseInt(process.env.GAMMA_WAREHOUSE_LOCATION_ID, 10)
  : 93998154045;
const CACHE_DIR = path.join(process.cwd(), '.cache');
const CACHE_FILE_PATH = path.join(CACHE_DIR, 'shopify-bulk-export.jsonl');
const CACHE_INFO_PATH = path.join(CACHE_DIR, 'cache-info.json');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function ensureCacheDirExists() {
  try {
    await fs.access(CACHE_DIR);
  } catch {
    await fs.mkdir(CACHE_DIR, { recursive: true });
  }
}

export async function connectToFtp(data: FormData) {
  return await ftpService.connectToFtp(data);
}

export async function listCsvFiles(data: FormData) {
  return await ftpService.listCsvFiles(data);
}

export async function getFtpCredentials() {
  return {
    host: process.env.FTP_HOST || process.env.NEXT_PUBLIC_FTP_HOST || '',
    username: process.env.FTP_USER || process.env.NEXT_PUBLIC_FTP_USERNAME || '',
    password: process.env.FTP_PASSWORD || process.env.NEXT_PUBLIC_FTP_PASSWORD || '',
  };
}

export async function runAudit(
  csvFileName: string,
  ftpData: FormData
): Promise<{ report: AuditResult[]; summary: any; duplicates: DuplicateSku[] } | null> {
  return await auditService.runAudit(csvFileName, ftpData);
}

export async function checkBulkCacheStatus(): Promise<{ lastModified: string | null }> {
  try {
    await fs.access(CACHE_INFO_PATH);
    const info = JSON.parse(await fs.readFile(CACHE_INFO_PATH, 'utf-8'));
    return { lastModified: info.lastModified };
  } catch (error) {
    return { lastModified: null };
  }
}

// --- BULK AUDIT - REFACTORED ACTIONS ---

export async function getCsvProducts(
  csvFileName: string,
  ftpData: FormData
): Promise<Product[] | null> {
  return await csvService.getCsvProducts(csvFileName, ftpData);
}

export async function getShopifyProductsFromCache(): Promise<Product[] | null> {
  try {
    const fileContent = await fs.readFile(CACHE_FILE_PATH, 'utf-8');
    return await parseBulkOperationResult(fileContent);
  } catch (error) {
    console.error('Failed to read or parse cache file.', error);
    // This is not a throw-worthy error, it just means we need to fetch.
    return null;
  }
}

export async function startBulkOperation(): Promise<{ id: string; status: string; resultUrl?: string }> {
  return await startShopifyBulkOp();
}

export async function checkBulkOperationStatus(
  id: string
): Promise<{ id: string; status: string; resultUrl?: string }> {
  return await checkShopifyBulkOpStatus(id);
}

export async function getBulkOperationResultAndParse(url: string): Promise<Product[] | null> {
  const resultJsonl = await getBulkOperationResult(url);
  if (!resultJsonl) return null;
  await ensureCacheDirExists();
  await fs.writeFile(CACHE_FILE_PATH, resultJsonl);
  await fs.writeFile(CACHE_INFO_PATH, JSON.stringify({ lastModified: new Date().toISOString() }));
  return await parseBulkOperationResult(resultJsonl);
}

export async function runBulkAuditComparison(
  csvProducts: Product[],
  shopifyProducts: Product[],
  csvFileName: string
): Promise<{ report: AuditResult[]; summary: any; duplicates: DuplicateSku[] }> {
  return await auditService.runBulkAuditComparison(csvProducts, shopifyProducts, csvFileName);
}

// --- FIX ACTIONS ---

async function _fixSingleMismatch(
  fixType: MismatchDetail['field'],
  csvProduct: Product,
  shopifyProduct: Product
): Promise<{ success: boolean; message: string }> {
  console.log(`Attempting to fix '${fixType}' for SKU: ${csvProduct.sku}`);
  await log('INFO', `Attempting to fix '${fixType}' for SKU: ${csvProduct.sku}`);

  const fixPayload: Product = {
    ...csvProduct,
    id: shopifyProduct.id,
    variantId: shopifyProduct.variantId,
    inventoryItemId: shopifyProduct.inventoryItemId,
    descriptionHtml: shopifyProduct.descriptionHtml,
  };

  try {
    switch (fixType) {

      case 'price':
        if (fixPayload.variantId) {
          const numericVariantId = parseInt(fixPayload.variantId.split('/').pop() || '0', 10);
          if (numericVariantId) {
            await updateProductVariant(numericVariantId, { price: fixPayload.price });
          }
        }
        break;
      case 'inventory':
        if (fixPayload.inventoryItemId && fixPayload.inventory !== null) {
          await inventorySetQuantities(
            fixPayload.inventoryItemId,
            fixPayload.inventory,
            GAMMA_WAREhouse_LOCATION_ID
          );
        }
        break;
      case 'h1_tag':
        if (fixPayload.id && fixPayload.descriptionHtml) {
          const newDescription = fixPayload.descriptionHtml
            .replace(/<h1/gi, '<h2')
            .replace(/<\/h1>/gi, '</h2>');
          await updateProduct(fixPayload.id, { bodyHtml: newDescription });
        }
        break;
      case 'missing_clearance_tag':
        await addProductTags(fixPayload.id, ['Clearance']);
        break;
      case 'incorrect_template_suffix':
        await updateProduct(fixPayload.id, { templateSuffix: 'clearance' });
        break;

      case 'clearance_price_mismatch':
        // Fix: Remove 'Clearance' tag and reset template to default
        await removeProductTags(fixPayload.id, ['Clearance', 'clearance']);
        await updateProduct(fixPayload.id, { templateSuffix: "" });
        break;
      case 'duplicate_in_shopify':
      case 'duplicate_handle':
      case 'heavy_product_flag':
        // This is a warning, cannot be fixed programmatically. Handled client-side.
        return {
          success: true,
          message: `SKU ${csvProduct.sku} is a warning, no server action taken.`,
        };
    }
    await log('SUCCESS', `Successfully fixed ${fixType} for ${csvProduct.sku}`);
    return { success: true, message: `Successfully fixed ${fixType} for ${csvProduct.sku}` };
  } catch (error) {
    console.error(`Failed to fix ${fixType} for SKU ${csvProduct.sku}:`, error);
    const message = error instanceof Error ? error.message : 'An unknown error occurred.';
    await log('ERROR', `Failed to fix ${fixType} for SKU ${csvProduct.sku}: ${message}`);
    return { success: false, message };
  }
}

export async function fixMultipleMismatches(
  items: AuditResult[],
  targetFields?: MismatchDetail['field'][]
): Promise<{ success: boolean; message: string; results: any[] }> {
  let fixCount = 0;
  const allResults: any[] = [];

  // Filter items to only include those with the target mismatch field if specified
  const itemsToProcess =
    targetFields && targetFields.length > 0
      ? items
        .map((item) => ({
          ...item,
          mismatches: item.mismatches.filter((m) => targetFields.includes(m.field)),
        }))
        .filter((item) => item.mismatches.length > 0)
      : items;

  // Group items by product ID to process fixes for the same product together
  const groupedByProductId = itemsToProcess.reduce(
    (acc, item) => {
      if (item.status === 'mismatched' && item.shopifyProducts.length > 0) {
        const productId = item.shopifyProducts[0].id;
        if (!acc[productId]) {
          acc[productId] = [];
        }
        acc[productId].push(item);
      }
      return acc;
    },
    {} as Record<string, AuditResult[]>
  );

  const CONCURRENCY_LIMIT = 2;
  const queue = Object.values(groupedByProductId);

  const worker = async () => {
    while (queue.length > 0) {
      const productItems = queue.shift();
      if (!productItems) break;

      await sleep(1000); // Rate limit protection

      const productId = productItems[0].shopifyProducts[0].id;
      const fixPromises: Promise<{
        sku: string;
        field: MismatchDetail['field'];
        success: boolean;
        message: string;
      }>[] = [];

      for (const item of productItems) {
        const csvProduct = item.csvProducts[0];
        const shopifyProduct = item.shopifyProducts[0];

        for (const mismatch of item.mismatches) {
          fixPromises.push(
            _fixSingleMismatch(mismatch.field, csvProduct, shopifyProduct).then((result) => ({
              sku: item.sku,
              field: mismatch.field,
              ...result,
            }))
          );
        }
      }

      try {
        const results = await Promise.all(fixPromises);
        allResults.push(...results);
        const successfulFixesInBatch = results.filter((r) => r.success).length;
        fixCount += successfulFixesInBatch;

        if (successfulFixesInBatch < results.length) {
          console.log(`Some fixes failed for product ID ${productId}`);
        }
      } catch (error) {
        console.error(
          `An error occurred during parallel fix execution for product ID ${productId}:`,
          error
        );
      }
    }
  };

  const workers = Array(Math.min(Object.keys(groupedByProductId).length, CONCURRENCY_LIMIT))
    .fill(null)
    .map(worker);
  await Promise.all(workers);

  if (fixCount > 0) {
    revalidatePath('/');
  }

  const totalFixesAttempted = allResults.length;
  const successfulFixes = allResults.filter((r) => r.success);
  const message = `Attempted to fix ${totalFixesAttempted} issues. Successfully fixed ${fixCount}.`;
  console.log(message);
  return { success: true, message, results: successfulFixes };
}

export async function createInShopify(
  product: Product,
  allVariantsForHandle: Product[],
  fileName: string,
  missingType: 'product' | 'variant'
) {
  console.log(
    `Attempting to create product/variant for Handle: ${product.handle}, Missing Type: ${missingType}`
  );
  await log('INFO', `Starting creation of ${missingType} for handle: ${product.handle}`);

  // Final pre-creation check to prevent duplicates
  const skusToCreate =
    missingType === 'product' ? allVariantsForHandle.map((p) => p.sku) : [product.sku];

  console.log(`Performing final check for SKUs: ${skusToCreate.join(', ')}`);
  const existingProducts = await getShopifyProductsBySku(skusToCreate);
  if (existingProducts.length > 0) {
    const foundSkus = existingProducts.map((p) => p.sku).join(', ');
    const errorMessage = `Creation aborted. The following SKU(s) already exist in Shopify: ${foundSkus}. Please run a new audit.`;
    console.error(errorMessage);
    return { success: false, message: errorMessage };
  }
  console.log('Final check passed. No existing SKUs found.');

  try {
    let createdProduct;
    const addClearanceTag = fileName.toLowerCase().includes('clearance');

    if (missingType === 'product') {
      // Phase 1: Create Product
      console.log(
        `Phase 1: Creating product for handle ${product.handle} with ${allVariantsForHandle.length} variants.`
      );
      createdProduct = await createProduct(allVariantsForHandle, addClearanceTag);
    } else {
      // 'variant'
      console.log(`Adding variant with SKU ${product.sku} to existing product.`);
      createdProduct = await addProductVariant(product);
    }

    if (!createdProduct || !createdProduct.id) {
      throw new Error('Product creation or variant addition failed to return a valid result.');
    }

    const productGid = `gid://shopify/Product/${createdProduct.id}`;

    // --- Phase 2: Post-creation/addition tasks ---

    // 2a. Link variant to image
    if (createdProduct.images && createdProduct.images.length > 0) {
      console.log('Phase 2: Linking images to variants...');
      // Shopify may alter image URLs (e.g., by adding version query params).
      // A more robust way to match is by the image filename.
      const getImageFilename = (url: string) => url.split('/').pop()?.split('?')[0];

      const imageFilenameToIdMap = new Map<string, number>();
      createdProduct.images.forEach((img: any) => {
        const filename = getImageFilename(img.src);
        if (filename) {
          imageFilenameToIdMap.set(filename, img.id);
        }
      });

      const variantsToLink = missingType === 'product' ? allVariantsForHandle : [product];

      for (const sourceVariant of variantsToLink) {
        const createdVariant = createdProduct.variants.find(
          (v: any) => v.sku === sourceVariant.sku
        );
        if (!createdVariant) continue;

        let imageIdToAssign: number | null = null;

        // If the variant from the CSV has an image URL, try to match it by filename.
        if (sourceVariant.mediaUrl) {
          const sourceFilename = getImageFilename(sourceVariant.mediaUrl);
          if (sourceFilename && imageFilenameToIdMap.has(sourceFilename)) {
            imageIdToAssign = imageFilenameToIdMap.get(sourceFilename)!;
          }
        }
        // If the user assigned an imageId directly (for missing variants)
        else if (sourceVariant.imageId) {
          imageIdToAssign = sourceVariant.imageId;
        }

        if (imageIdToAssign) {
          console.log(
            ` - Assigning image ID ${imageIdToAssign} to variant ID ${createdVariant.id}...`
          );
          await updateProductVariant(createdVariant.id, { image_id: imageIdToAssign });
        } else if (sourceVariant.mediaUrl || sourceVariant.imageId) {
          console.warn(` - Could not find a matching image for SKU: ${sourceVariant.sku}`);
        }
      }
    }

    // 2b. Connect inventory & Set levels for each variant
    const locations = await getShopifyLocations();
    const garageLocation = locations.find((l) => l.name === 'Garage Harry Stanley');

    const variantsToProcess =
      missingType === 'product'
        ? createdProduct.variants
        : [createdProduct.variants.find((v: any) => v.sku === product.sku)];

    for (const variant of variantsToProcess) {
      if (!variant) continue;
      const sourceVariant = allVariantsForHandle.find((p) => p.sku === variant.sku);
      if (!sourceVariant) continue;

      const inventoryItemIdGid = `gid://shopify/InventoryItem/${variant.inventory_item_id}`;

      if (sourceVariant.inventory !== null && inventoryItemIdGid) {
        console.log(
          `Connecting inventory item ${inventoryItemIdGid} to location ${GAMMA_WAREhouse_LOCATION_ID}...`
        );
        await connectInventoryToLocation(inventoryItemIdGid, GAMMA_WAREhouse_LOCATION_ID);

        console.log('Setting inventory level...');
        await inventorySetQuantities(
          inventoryItemIdGid,
          sourceVariant.inventory,
          GAMMA_WAREhouse_LOCATION_ID
        );

        if (garageLocation) {
          console.log(
            `Found 'Garage Harry Stanley' (ID: ${garageLocation.id}). Disconnecting inventory...`
          );
          await disconnectInventoryFromLocation(inventoryItemIdGid, garageLocation.id);
        }
      }
    }

    // 2c. Link product to collection if category is specified (only for new products)
    if (missingType === 'product' && product.category && productGid) {
      console.log(`Linking product to collection: '${product.category}'...`);
      const collectionId = await getCollectionIdByTitle(product.category);
      if (collectionId) {
        await linkProductToCollection(productGid, collectionId);
      } else {
        console.warn(
          `Could not find collection with title '${product.category}'. Skipping linking.`
        );
      }
    }

    // 2d. Publish to all sales channels (only for new products)
    if (missingType === 'product' && productGid) {
      console.log(`Publishing product ${productGid} to all sales channels...`);
      await sleep(2000); // Add a 2-second wait to ensure the product is ready
      await publishProductToSalesChannels(productGid);
    } else {
      console.warn(
        `Could not publish product with handle ${product.handle} because its GID was not found or it's a new variant.`
      );
    }

    revalidatePath('/');

    await log('SUCCESS', `Successfully created ${missingType} for ${product.handle}`);
    return {
      success: true,
      message: `Successfully created ${missingType} for ${product.handle}`,
      createdProductData: createdProduct,
    };
  } catch (error) {
    console.error(`Failed to create ${missingType} for SKU ${product.sku}:`, error);
    const message = error instanceof Error ? error.message : 'An unknown error occurred.';
    await log('ERROR', `Failed to create ${missingType} for SKU ${product.sku}: ${message}`);
    return { success: false, message };
  }
}

export async function createMultipleInShopify(
  itemsToCreate: { product: Product; allVariants: Product[]; missingType: 'product' | 'variant' }[],
  fileName: string
): Promise<{ success: boolean; message: string; results: any[] }> {
  let successCount = 0;
  const itemResults: any[] = [];

  // Group items by handle, since we create one product per handle.
  const groupedByHandle = itemsToCreate.reduce(
    (acc, item) => {
      const handle = item.product.handle;
      if (!acc[handle]) {
        acc[handle] = {
          product: item.product,
          allVariants: [],
          missingType: 'product', // Bulk create is always for new products
        };
      }
      // Correctly accumulate all variants for the handle
      acc[handle].allVariants.push(...item.allVariants.filter((v) => v.handle === handle));
      return acc;
    },
    {} as {
      [handle: string]: {
        product: Product;
        allVariants: Product[];
        missingType: 'product' | 'variant';
      };
    }
  );

  // De-duplicate variants within each handle group
  for (const handle in groupedByHandle) {
    const uniqueVariantsMap = new Map<string, Product>();
    groupedByHandle[handle].allVariants.forEach((variant) => {
      uniqueVariantsMap.set(variant.sku, variant);
    });
    groupedByHandle[handle].allVariants = Array.from(uniqueVariantsMap.values());
  }

  const CONCURRENCY_LIMIT = 2;
  const queue = Object.values(groupedByHandle);

  const worker = async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;

      await sleep(1000); // Rate limit protection

      const result = await createInShopify(item.product, item.allVariants, fileName, 'product');

      if (result.success) {
        successCount++;
      }
      itemResults.push({ handle: item.product.handle, ...result });
    }
  };

  const workers = Array(Math.min(Object.keys(groupedByHandle).length, CONCURRENCY_LIMIT))
    .fill(null)
    .map(worker);
  await Promise.all(workers);

  if (successCount > 0) {
    revalidatePath('/');
  }

  const totalProductsToCreate = Object.keys(groupedByHandle).length;
  const message = `Attempted to create ${totalProductsToCreate} products. Successfully created ${successCount}.`;
  console.log(message);
  return { success: true, message, results: itemResults };
}

export async function createMultipleVariantsForProduct(
  variants: Product[]
): Promise<{ success: boolean; message: string; results: any[] }> {
  let successCount = 0;
  const itemResults: any[] = [];

  if (variants.length === 0) {
    return { success: false, message: 'No variants provided to create.', results: [] };
  }

  const handle = variants[0].handle;
  console.log(`Starting bulk variant creation for handle: ${handle}`);

  const CONCURRENCY_LIMIT = 2;
  const queue = [...variants];

  const worker = async () => {
    while (queue.length > 0) {
      const variant = queue.shift();
      if (!variant) break;

      await sleep(1000); // Rate limit protection

      const result = await createInShopify(variant, variants, 'N/A', 'variant');
      if (result.success) {
        successCount++;
      }
      itemResults.push({ sku: variant.sku, ...result });
    }
  };

  const workers = Array(Math.min(variants.length, CONCURRENCY_LIMIT))
    .fill(null)
    .map(worker);
  await Promise.all(workers);

  if (successCount > 0) {
    revalidatePath('/');
  }

  const message = `Attempted to create ${variants.length} variants for handle ${handle}. Successfully created ${successCount}.`;
  console.log(message);
  return { success: successCount > 0, message, results: itemResults };
}

export async function deleteFromShopify(productId: string) {
  console.log(`Attempting to delete product with GID: ${productId}`);
  try {
    await deleteProduct(productId);
    revalidatePath('/');
    return { success: true, message: `Successfully deleted product ${productId}` };
  } catch (error) {
    console.error(`Failed to delete product ${productId}:`, error);
    const message = error instanceof Error ? error.message : 'An unknown error occurred.';
    return { success: false, message };
  }
}

export async function deleteVariantFromShopify(productId: string, variantId: string) {
  console.log(`Attempting to delete variant ${variantId} from product ${productId}`);
  try {
    const numericProductId = parseInt(productId.split('/').pop() || '0', 10);
    const numericVariantId = parseInt(variantId.split('/').pop() || '0', 10);

    if (!numericProductId || !numericVariantId) {
      throw new Error(
        `Invalid Product or Variant GID. Product: ${productId}, Variant: ${variantId}`
      );
    }

    await deleteProductVariant(numericProductId, numericVariantId);
    revalidatePath('/');
    return { success: true, message: `Successfully deleted variant ${variantId}` };
  } catch (error) {
    console.error(`Failed to delete variant ${variantId}:`, error);
    const message = error instanceof Error ? error.message : 'An unknown error occurred.';
    return { success: false, message };
  }
}

// --- MEDIA ACTIONS ---

export async function getProductWithImages(
  productId: string
): Promise<{ variants: Product[]; images: ShopifyProductImage[] }> {
  try {
    const numericProductId = parseInt(productId.split('/').pop() || '0', 10);
    if (!numericProductId) {
      throw new Error(`Invalid Product GID: ${productId}`);
    }
    const productData = await getFullProduct(numericProductId);

    const variants = productData.variants.map((v: any) => ({
      id: `gid://shopify/Product/${productData.id}`,
      variantId: `gid://shopify/ProductVariant/${v.id}`,
      sku: v.sku,
      name: productData.title, // Parent product title
      price: parseFloat(v.price),
      option1Name: productData.options[0]?.name || null,
      option1Value: v.option1,
      option2Name: productData.options[1]?.name || null,
      option2Value: v.option2,
      option3Name: productData.options[2]?.name || null,
      option3Value: v.option3,
      imageId: v.image_id,
    }));

    const images = productData.images.map((img: any) => ({
      id: img.id,
      productId: img.product_id,
      src: img.src,
      variant_ids: img.variant_ids,
    }));

    return { variants, images };
  } catch (error) {
    console.error(`Failed to get product with images for ID ${productId}:`, error);
    const message = error instanceof Error ? error.message : 'An unknown error occurred.';
    throw new Error(message);
  }
}

export async function getProductByHandleServer(handle: string): Promise<Product | null> {
  try {
    const product = await getProductByHandle(handle);
    if (!product) return null;

    return {
      id: product.id,
      handle: product.handle,
      // Map other fields if necessary for the client
    } as Product;
  } catch (error) {
    console.error(`Failed to get product by handle ${handle}:`, error);
    return null;
  }
}

export async function getProductImageCounts(productIds: string[]): Promise<Record<string, number>> {
  try {
    const numericProductIds = productIds.map((gid) => {
      const id = gid.split('/').pop();
      if (!id || isNaN(parseInt(id, 10))) {
        throw new Error(`Invalid Product GID for image count: ${gid}`);
      }
      return parseInt(id, 10);
    });

    if (numericProductIds.length === 0) {
      return {};
    }

    const counts = await getShopifyProductImageCounts(numericProductIds);

    // Remap keys back to GIDs
    const gidCounts: Record<string, number> = {};
    for (const [numericId, count] of Object.entries(counts)) {
      gidCounts[`gid://shopify/Product/${numericId}`] = count;
    }

    return gidCounts;
  } catch (error) {
    console.error(`Failed to get product image counts for IDs ${productIds.join(', ')}:`, error);
    const message = error instanceof Error ? error.message : 'An unknown error occurred.';
    throw new Error(message);
  }
}

export async function addImageFromUrl(
  productId: string,
  imageUrl: string
): Promise<{ success: boolean; message: string; image?: ShopifyProductImage }> {
  try {
    await sleep(600); // Add delay to prevent rate limiting
    const numericProductId = parseInt(productId.split('/').pop() || '0', 10);
    if (!numericProductId) {
      throw new Error(`Invalid Product GID: ${productId}`);
    }
    const newImage = await addProductImage(numericProductId, imageUrl);
    return { success: true, message: 'Image added successfully.', image: newImage };
  } catch (error) {
    console.error(`Failed to add image for product ${productId}:`, error);
    const message = error instanceof Error ? error.message : 'An unknown error occurred.';
    return { success: false, message };
  }
}

export async function assignImageToVariant(
  variantId: string,
  imageId: number | null
): Promise<{ success: boolean; message: string }> {
  try {
    await sleep(600); // Add delay to prevent rate limiting
    const numericVariantId = parseInt(variantId.split('/').pop() || '0', 10);
    if (!numericVariantId) {
      throw new Error(`Invalid Variant GID: ${variantId}`);
    }
    await updateProductVariant(numericVariantId, { image_id: imageId });
    return { success: true, message: 'Image assigned successfully.' };
  } catch (error) {
    console.error(`Failed to assign image ${imageId} to variant ${variantId}:`, error);
    const message = error instanceof Error ? error.message : 'An unknown error occurred.';
    return { success: false, message };
  }
}

export async function deleteImage(
  productId: string,
  imageId: number
): Promise<{ success: boolean; message: string }> {
  try {
    await sleep(600); // Add delay to prevent rate limiting
    const numericProductId = parseInt(productId.split('/').pop() || '0', 10);
    if (!numericProductId) {
      throw new Error(`Invalid Product GID: ${productId}`);
    }
    await deleteProductImage(numericProductId, imageId);
    return { success: true, message: 'Image deleted successfully.' };
  } catch (error) {
    console.error(`Failed to delete image ${imageId} from product ${productId}:`, error);
    const message = error instanceof Error ? error.message : 'An unknown error occurred.';
    return { success: false, message };
  }
}

export async function deleteUnlinkedImages(
  productId: string
): Promise<{ success: boolean; message: string; deletedCount: number }> {
  console.log(`Starting to delete unlinked images for product GID: ${productId}`);
  try {
    const { images, variants } = await getProductWithImages(productId);
    const linkedImageIds = new Set(variants.map((v) => v.imageId).filter((id) => id !== null));

    const unlinkedImages = images.filter((image) => !linkedImageIds.has(image.id));

    if (unlinkedImages.length === 0) {
      return { success: true, message: 'No unlinked images found to delete.', deletedCount: 0 };
    }

    console.log(`Found ${unlinkedImages.length} unlinked images to delete.`);
    let deletedCount = 0;

    for (const image of unlinkedImages) {
      const result = await deleteImage(productId, image.id);
      if (result.success) {
        deletedCount++;
      } else {
        console.warn(`Failed to delete image ID ${image.id}: ${result.message}`);
      }
      await sleep(600); // Add delay between each deletion to avoid rate limiting
    }

    const message = `Successfully deleted ${deletedCount} of ${unlinkedImages.length} unlinked images.`;
    console.log(message);
    return { success: true, message, deletedCount };
  } catch (error) {
    console.error(`Failed to delete unlinked images for product ${productId}:`, error);
    const message = error instanceof Error ? error.message : 'An unknown error occurred.';
    return { success: false, message, deletedCount: 0 };
  }
}

export async function deleteUnlinkedImagesForMultipleProducts(
  productIds: string[]
): Promise<{
  success: boolean;
  message: string;
  results: { productId: string; success: boolean; deletedCount: number; message: string }[];
}> {
  console.log(`Starting bulk deletion of unlinked images for ${productIds.length} products.`);
  const results = [];
  let totalSuccessCount = 0;
  let totalDeletedCount = 0;

  for (const productId of productIds) {
    const result = await deleteUnlinkedImages(productId);
    results.push({ productId, ...result });
    if (result.success && result.deletedCount > 0) {
      totalSuccessCount++;
      totalDeletedCount += result.deletedCount;
    }
    await sleep(500); // Add delay to avoid rate limiting
  }

  const message = `Bulk operation complete. Processed ${productIds.length} products and deleted a total of ${totalDeletedCount} unlinked images.`;
  console.log(message);
  return { success: totalSuccessCount > 0, message, results };
}
// --- LOGGING ACTIONS ---

export async function fetchActivityLogs() {
  return await getLogs();
}

export async function clearActivityLogs() {
  return await clearLogs();
}
