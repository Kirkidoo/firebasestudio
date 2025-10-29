
'use server';

import { Product, AuditResult, DuplicateSku, MismatchDetail, ShopifyProductImage } from '@/lib/types';
import { Client } from 'basic-ftp';
import { Readable, Writable } from 'stream';
import { parse } from 'csv-parse';
import { getShopifyProductsBySku, updateProduct, updateProductVariant, updateInventoryLevel, createProduct, addProductVariant, connectInventoryToLocation, linkProductToCollection, getCollectionIdByTitle, getShopifyLocations, disconnectInventoryFromLocation, publishProductToSalesChannels, deleteProduct, deleteProductVariant, startProductExportBulkOperation as startShopifyBulkOp, checkBulkOperationStatus as checkShopifyBulkOpStatus, getBulkOperationResult, parseBulkOperationResult, getFullProduct, addProductImage, deleteProductImage, getProductImageCounts as getShopifyProductImageCounts, getProductByHandle, addProductTags, removeProductTags } from '@/lib/shopify';
import { revalidatePath } from 'next/cache';
import fs from 'fs/promises';
import path from 'path';

const FTP_DIRECTORY = '/Gamma_Product_Files/Shopify_Files/';
const GAMMA_WAREhouse_LOCATION_ID = 93998154045;
const CACHE_DIR = path.join(process.cwd(), '.cache');
const CACHE_FILE_PATH = path.join(CACHE_DIR, 'shopify-bulk-export.jsonl');
const CACHE_INFO_PATH = path.join(CACHE_DIR, 'cache-info.json');

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function ensureCacheDirExists() {
    try {
        await fs.access(CACHE_DIR);
    } catch {
        await fs.mkdir(CACHE_DIR, { recursive: true });
    }
}

async function getFtpClient(data: FormData) {
  const host = data.get('host') as string;
  const user = data.get('username') as string;
  const password = data.get('password') as string;
  
  const client = new Client(30000); // 30 second timeout
  // client.ftp.verbose = true;
  try {
    // First, try a secure connection
    console.log('Attempting secure FTP connection...');
    await client.access({ host, user, password, secure: true });
    console.log('Secure FTP connection successful.');
  } catch(secureErr) {
    console.log("Secure FTP connection failed. Trying non-secure.", secureErr);
    // If secure fails, close the potentially broken connection and try non-secure
    client.close(); 
    const nonSecureClient = new Client(30000); // 30 second timeout
    try {
        console.log('Attempting non-secure FTP connection...');
        await nonSecureClient.access({ host, user, password, secure: false });
        console.log('Non-secure FTP connection successful.');
        return nonSecureClient;
    } catch (nonSecureErr) {
        console.error("Non-secure FTP connection also failed.", nonSecureErr);
        throw new Error('Invalid FTP credentials or failed to connect.');
    }
  }
  return client;
}


export async function connectToFtp(data: FormData) {
  const client = await getFtpClient(data);
  client.close();
  return { success: true };
}

export async function listCsvFiles(data: FormData) {
  console.log('Listing CSV files from FTP...');
  const client = await getFtpClient(data);
  try {
    await client.cd(FTP_DIRECTORY);
    const files = await client.list();
    const csvFiles = files
      .filter(file => file.name.toLowerCase().endsWith('.csv'))
      .map(file => file.name);
    console.log(`Found ${csvFiles.length} CSV files.`);
    return csvFiles;
  } catch(error) {
    console.error('Failed to list CSV files:', error);
    throw error;
  }
  finally {
    if (!client.closed) {
      client.close();
    }
  }
}

async function getCsvStreamFromFtp(csvFileName: string, ftpData: FormData): Promise<Readable> {
    const client = await getFtpClient(ftpData);
    console.log('Navigating to FTP directory:', FTP_DIRECTORY);
    await client.cd(FTP_DIRECTORY);
    console.log(`Downloading file: ${csvFileName}`);

    const chunks: any[] = [];
    const writable = new Writable({
        write(chunk, encoding, callback) {
            chunks.push(chunk);
            callback();
        }
    });

    await client.downloadTo(writable, csvFileName);
    console.log('File downloaded successfully.');
    client.close();

    return Readable.from(Buffer.concat(chunks));
}


async function parseCsvFromStream(stream: Readable): Promise<{products: Product[]}> {
    console.log('Parsing CSV from stream...');
    const records: Product[] = [];
    const handledHandles = new Set<string>();
    
    const parser = stream.pipe(parse({
        columns: true,
        skip_empty_lines: true,
        trim: true,
    }));

    for await (const record of parser) {
        const sku = record.SKU;
        const price = parseFloat(record.Price);
        const inventory = record['Variant Inventory Qty'] ? parseInt(record['Variant Inventory Qty'], 10) : null;
        
        const compareAtPriceText = record['Compare At Price'];
        const compareAtPrice = compareAtPriceText && !isNaN(parseFloat(compareAtPriceText)) ? parseFloat(compareAtPriceText) : null;

        const costPerItemText = record['Cost Per Item'];
        let costPerItem = costPerItemText ? parseFloat(costPerItemText) : null;
        if (isNaN(costPerItem as any)) {
            costPerItem = null;
        }

        const weight = record['Variant Grams'] ? parseFloat(record['Variant Grams']) : null;
        
        const tags = record.Tags || null;
        const tagArray = tags ? tags.split(',').map((t: string) => t.trim()) : [];
        const productType = tagArray.length >= 3 ? tagArray[2] : null;
        
        let handle = record.Handle;
        
        // --- Handle Collision Logic ---
        const option1Name = record['Option1 Name'] || null;
        const option1Value = record['Option1 Value'] || null;
        const isDefaultTitleVariant = option1Name === 'Title' && option1Value === 'Default Title';

        if (handle && handledHandles.has(handle) && isDefaultTitleVariant) {
            const newHandle = `${handle}-${sku}`;
            console.log(`Handle collision detected for '${handle}'. Creating unique handle: '${newHandle}' for SKU ${sku}.`);
            handle = newHandle;
        }
        // --- End Handle Collision Logic ---
        
        if (handle && sku && record.Title && !isNaN(price)) {
            records.push({
                id: '', // Shopify only
                variantId: '', // Shopify only
                inventoryItemId: '', // Shopify only
                handle: handle,
                sku: sku,
                name: record.Title,
                price: price,
                inventory: inventory,
                descriptionHtml: record['Body (HTML)'] || null,
                productType: productType,
                vendor: record.Vendor || null,
                tags: tags,
                compareAtPrice: compareAtPrice,
                costPerItem: costPerItem,
                barcode: record['Variant Barcode'] || null,
                weight: weight,
                mediaUrl: record['Variant Image'] || null,
                category: record.Category || null,
                option1Name: option1Name,
                option1Value: option1Value,
                option2Name: record['Option2 Name'] || null,
                option2Value: record['Option2 Value'] || null,
                option3Name: record['Option3 Name'] || null,
                option3Value: record['Option3 Value'] || null,
                imageId: null, // Shopify only
                templateSuffix: null, // Shopify only
            });
            handledHandles.add(handle);
        }
    }
    console.log(`Parsed ${records.length} products from CSV.`);
    
    return { products: records };
}

function findMismatches(csvProduct: Product, shopifyProduct: Product, csvFileName: string): MismatchDetail[] {
    const mismatches: MismatchDetail[] = [];
    if (csvProduct.name !== shopifyProduct.name) {
        mismatches.push({ field: 'name', csvValue: csvProduct.name, shopifyValue: shopifyProduct.name });
    }
    if (csvProduct.price !== shopifyProduct.price) {
        mismatches.push({ field: 'price', csvValue: csvProduct.price, shopifyValue: shopifyProduct.price });
    }

    if (csvProduct.inventory !== null && csvProduct.inventory !== shopifyProduct.inventory) {
        const isCappedInventory = csvProduct.inventory > 10 && shopifyProduct.inventory === 10;
        if (!isCappedInventory) {
            mismatches.push({ field: 'inventory', csvValue: csvProduct.inventory, shopifyValue: shopifyProduct.inventory });
        }
    }

    if (shopifyProduct.descriptionHtml && /<h1/i.test(shopifyProduct.descriptionHtml)) {
        mismatches.push({ field: 'h1_tag', csvValue: 'No H1 Expected', shopifyValue: 'H1 Found' });
    }

    // Heavy product check: weight > 50lbs (22679.6 grams)
    if (csvProduct.weight && csvProduct.weight > 22679.6) {
        mismatches.push({ field: 'heavy_product_flag', csvValue: `${(csvProduct.weight / 453.592).toFixed(2)} lbs`, shopifyValue: null });
    }
    
    // Clearance tag check
    if (csvFileName.toLowerCase().includes('clearance') && shopifyProduct.tags) {
        const tags = shopifyProduct.tags.split(',').map(t => t.trim().toLowerCase());
        if (!tags.includes('clearance')) {
            mismatches.push({ field: 'missing_clearance_tag', csvValue: 'Clearance', shopifyValue: 'Not Found' });
        }
    }
    
    return mismatches;
}

export async function runAuditComparison(csvProducts: Product[], shopifyProducts: Product[], csvFileName: string): Promise<{ report: AuditResult[], summary: any }> {
    const csvProductMap = new Map(csvProducts.map(p => [p.sku, p]));
    console.log(`Created map with ${csvProductMap.size} products from CSV.`);
    
    const shopifyProductMap = new Map<string, Product[]>();
    for (const p of shopifyProducts) {
        if (!shopifyProductMap.has(p.sku)) {
            shopifyProductMap.set(p.sku, []);
        }
        shopifyProductMap.get(p.sku)!.push(p);
    }
    console.log(`Created map with ${shopifyProductMap.size} unique SKUs from Shopify.`);

    // --- Duplicate Handle Detection ---
    const shopifyHandleMap = new Map<string, Product[]>();
    for (const p of shopifyProducts) {
        if (!shopifyHandleMap.has(p.handle)) {
            shopifyHandleMap.set(p.handle, []);
        }
        shopifyHandleMap.get(p.handle)!.push(p);
    }
    
    let report: AuditResult[] = [];
    let summary = { mismatched: 0, not_in_csv: 0, missing_in_shopify: 0, duplicate_in_shopify: 0, duplicate_handle: 0 };
    const handledDuplicateHandles = new Set<string>();
    
    for(const [handle, products] of shopifyHandleMap.entries()) {
        if (products.length > 1) {
            // Check if all products with this handle have unique SKUs
             const uniqueSkus = new Set(products.map(p => p.sku));
             if (uniqueSkus.size < products.length) {
                // This is a more complex issue (duplicate SKUs within a duplicate handle)
                // Let the duplicate SKU logic handle this.
             } else {
                summary.duplicate_handle++;
                report.push({
                    sku: products.map(p => p.sku).join(', '),
                    csvProducts: [],
                    shopifyProducts: products,
                    status: 'duplicate_handle',
                    mismatches: [{
                        field: 'duplicate_handle',
                        csvValue: null,
                        shopifyValue: `Handle '${handle}' used by ${products.length} products`
                    }]
                });
                handledDuplicateHandles.add(handle);
            }
        }
    }

    const shopifyProductsForSkuComparison = shopifyProducts.filter(p => !handledDuplicateHandles.has(p.handle));
    const shopifyProductMapForSkuComparison = new Map<string, Product[]>();
     for (const p of shopifyProductsForSkuComparison) {
        if (!shopifyProductMapForSkuComparison.has(p.sku)) {
            shopifyProductMapForSkuComparison.set(p.sku, []);
        }
        shopifyProductMapForSkuComparison.get(p.sku)!.push(p);
    }

    const shopifyHandleSet = new Set(shopifyProducts.map(p => p.handle));

    console.log('Running audit comparison logic...');
    let matchedCount = 0;
    
    const processedShopifySkus = new Set<string>();

    for (const csvProduct of csvProducts) {
        const shopifyVariants = shopifyProductMapForSkuComparison.get(csvProduct.sku);
        
        if (shopifyVariants) {
             processedShopifySkus.add(csvProduct.sku);
            
            if (shopifyVariants.length > 1) {
                summary.duplicate_in_shopify++;
                
                const duplicateReportItems = shopifyVariants.map(variant => {
                    const mismatches = findMismatches(csvProduct, variant, csvFileName);
                    return {
                        sku: csvProduct.sku,
                        csvProducts: [csvProduct],
                        shopifyProducts: [variant],
                        status: mismatches.length > 0 ? 'mismatched' : 'matched',
                        mismatches: mismatches
                    } as AuditResult;
                });
                
                report.push({
                    sku: csvProduct.sku,
                    csvProducts: [csvProduct],
                    shopifyProducts: shopifyVariants,
                    status: 'duplicate_in_shopify',
                    mismatches: [{
                        field: 'duplicate_in_shopify',
                        csvValue: null,
                        shopifyValue: `Used in ${shopifyVariants.length} products`
                    }]
                });
                report.push(...duplicateReportItems);


            } else {
                const shopifyProduct = shopifyVariants[0];
                const mismatches = findMismatches(csvProduct, shopifyProduct, csvFileName);

                if (mismatches.length > 0) {
                    report.push({ sku: csvProduct.sku, csvProducts: [csvProduct], shopifyProducts: [shopifyProduct], status: 'mismatched', mismatches });
                    summary.mismatched++;
                } else {
                    report.push({ sku: csvProduct.sku, csvProducts: [csvProduct], shopifyProducts: [shopifyProduct], status: 'matched', mismatches: [] });
                    matchedCount++;
                }
            }
        } else {
            const missingType = shopifyHandleSet.has(csvProduct.handle) ? 'variant' : 'product';

            const mismatches: MismatchDetail[] = [{
                field: 'missing_in_shopify',
                csvValue: `SKU: ${csvProduct.sku}`,
                shopifyValue: null,
                missingType: missingType,
            }];

            if (csvProduct.weight && csvProduct.weight > 22679.6) {
                mismatches.push({ field: 'heavy_product_flag', csvValue: `${(csvProduct.weight / 453.592).toFixed(2)} lbs`, shopifyValue: null });
            }
            
            if (csvFileName.toLowerCase().includes('clearance')) {
                // If it's a new product from clearance, it doesn't need a mismatch, it just gets created with the tag.
            }

            report.push({
                sku: csvProduct.sku,
                csvProducts: [csvProduct],
                shopifyProducts: [],
                status: 'missing_in_shopify',
                mismatches: mismatches,
            });
            summary.missing_in_shopify++;
        }
    }

    for (const [sku, variants] of shopifyProductMapForSkuComparison.entries()) {
        if (!processedShopifySkus.has(sku)) {
            for (const variant of variants) {
                 report.push({ sku: sku, csvProducts: [], shopifyProducts: [variant], status: 'not_in_csv', mismatches: [] });
                 summary.not_in_csv++;
            }
        }
    }
    
    const getHandle = (item: AuditResult) => item.shopifyProducts[0]?.handle || item.csvProducts[0]?.handle || '';

    report.sort((a, b) => {
        const handleA = getHandle(a);
        const handleB = getHandle(b);
        if (handleA !== handleB) {
            return handleA.localeCompare(handleB);
        }
        return a.sku.localeCompare(b.sku);
    });

    console.log('Audit comparison complete. Matched:', matchedCount, 'Summary:', summary);

    return { report, summary: { ...summary, matched: matchedCount } };
}


export async function runAudit(csvFileName: string, ftpData: FormData): Promise<{ report: AuditResult[], summary: any, duplicates: DuplicateSku[] } | null> {
  let csvProducts: Product[] = [];

  try {
    const readableStream = await getCsvStreamFromFtp(csvFileName, ftpData);
    const parsedData = await parseCsvFromStream(readableStream);
    csvProducts = parsedData.products;
  } catch (error) {
    console.error("Failed to download or parse CSV from FTP", error);
    throw new Error(`Could not download or process file '${csvFileName}' from FTP.`);
  }
  
  if (csvProducts.length === 0) {
    console.log('No products found in the CSV file. Aborting audit.');
    return { report: [], summary: { matched: 0, mismatched: 0, not_in_csv: 0, missing_in_shopify: 0, duplicate_in_shopify: 0, duplicate_handle: 0 }, duplicates: [] };
  }

  // Fetch Shopify products based on SKUs from the CSV
  const skusFromCsv = csvProducts.map(p => p.sku);
  const allShopifyProducts = await getShopifyProductsBySku(skusFromCsv);
  
  if (!allShopifyProducts) {
      console.error("Audit cannot run because Shopify product data could not be fetched.");
      return null;
  }

  const { report, summary } = await runAuditComparison(csvProducts, allShopifyProducts, csvFileName);

  const duplicatesForCard: DuplicateSku[] = report
    .filter(d => d.status === 'duplicate_in_shopify')
    .map(d => ({ sku: d.sku, count: d.shopifyProducts.length }));
  
  return { report: report, summary, duplicates: duplicatesForCard };
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

export async function getCsvProducts(csvFileName: string, ftpData: FormData): Promise<Product[] | null> {
    try {
        const readableStream = await getCsvStreamFromFtp(csvFileName, ftpData);
        const parsedData = await parseCsvFromStream(readableStream);
        if (parsedData.products.length === 0) {
            return [];
        }
        return parsedData.products;
    } catch (error) {
        console.error("Failed to download or parse CSV from FTP", error);
        throw new Error(`Could not download or process file '${csvFileName}' from FTP.`);
    }
}

export async function getShopifyProductsFromCache(): Promise<Product[] | null> {
    try {
        const fileContent = await fs.readFile(CACHE_FILE_PATH, 'utf-8');
        return await parseBulkOperationResult(fileContent);
    } catch (error) {
        console.error("Failed to read or parse cache file.", error);
        // This is not a throw-worthy error, it just means we need to fetch.
        return null;
    }
}

export async function startBulkOperation(): Promise<{ id: string, status: string }> {
    return await startShopifyBulkOp();
}

export async function checkBulkOperationStatus(id: string): Promise<{ id: string, status: string, resultUrl?: string }> {
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

export async function runBulkAuditComparison(csvProducts: Product[], shopifyProducts: Product[], csvFileName: string): Promise<{ report: AuditResult[], summary: any, duplicates: DuplicateSku[] }> {
    const { report, summary } = await runAuditComparison(csvProducts, shopifyProducts, csvFileName);
    const duplicatesForCard: DuplicateSku[] = report
        .filter(d => d.status === 'duplicate_in_shopify')
        .map(d => ({ sku: d.sku, count: d.shopifyProducts.length }));
    return { report, summary, duplicates: duplicatesForCard };
}


// --- FIX ACTIONS ---

async function _fixSingleMismatch(
    fixType: MismatchDetail['field'],
    csvProduct: Product,
    shopifyProduct: Product,
): Promise<{ success: boolean; message: string }> {
    console.log(`Attempting to fix '${fixType}' for SKU: ${csvProduct.sku}`);

    const fixPayload: Product = {
        ...csvProduct,
        id: shopifyProduct.id,
        variantId: shopifyProduct.variantId,
        inventoryItemId: shopifyProduct.inventoryItemId,
        descriptionHtml: shopifyProduct.descriptionHtml,
    };
    
    try {
        switch (fixType) {
            case 'name':
                await updateProduct(fixPayload.id, { title: fixPayload.name });
                break;
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
                    await updateInventoryLevel(fixPayload.inventoryItemId, fixPayload.inventory, GAMMA_WAREhouse_LOCATION_ID);
                }
                break;
            case 'h1_tag':
                if (fixPayload.id && fixPayload.descriptionHtml) {
                    const newDescription = fixPayload.descriptionHtml.replace(/<h1/gi, '<h2').replace(/<\/h1>/gi, '</h2>');
                    await updateProduct(fixPayload.id, { bodyHtml: newDescription });
                }
                break;
            case 'missing_clearance_tag':
                await addProductTags(fixPayload.id, ['Clearance']);
                break;
            case 'duplicate_in_shopify':
            case 'duplicate_handle':
            case 'heavy_product_flag':
                // This is a warning, cannot be fixed programmatically. Handled client-side.
                return { success: true, message: `SKU ${csvProduct.sku} is a warning, no server action taken.` };
        }
        return { success: true, message: `Successfully fixed ${fixType} for ${csvProduct.sku}` };
    } catch (error) {
        console.error(`Failed to fix ${fixType} for SKU ${csvProduct.sku}:`, error);
        const message = error instanceof Error ? error.message : 'An unknown error occurred.';
        return { success: false, message };
    }
}


export async function fixMultipleMismatches(items: AuditResult[]): Promise<{ success: boolean; message: string, results: any[] }> {
    let fixCount = 0;
    const itemResults = [];

    for (const item of items) {
        if (item.status !== 'mismatched' || item.csvProducts.length === 0 || item.shopifyProducts.length === 0) {
            continue;
        }

        const csvProduct = item.csvProducts[0];
        const shopifyProduct = item.shopifyProducts[0];

        for (const mismatch of item.mismatches) {
            const result = await _fixSingleMismatch(mismatch.field, csvProduct, shopifyProduct);
            if (result.success) {
                fixCount++;
            }
            itemResults.push({ sku: item.sku, field: mismatch.field, ...result });
             await sleep(600); // Add a small delay to avoid rate limiting
        }
    }
    
    if (fixCount > 0) {
        revalidatePath('/');
    }

    const successfulFixes = itemResults.filter(r => r.success);
    const message = `Attempted to fix ${itemResults.length} issues. Successfully fixed ${fixCount}.`;
    console.log(message);
    return { success: true, message, results: successfulFixes };
}



export async function createInShopify(
    product: Product,
    allVariantsForHandle: Product[],
    fileName: string,
    missingType: 'product' | 'variant'
) {
    console.log(`Attempting to create product/variant for Handle: ${product.handle}, Missing Type: ${missingType}`);
    
    // Final pre-creation check to prevent duplicates
    const skusToCreate = missingType === 'product' ? allVariantsForHandle.map(p => p.sku) : [product.sku];

    console.log(`Performing final check for SKUs: ${skusToCreate.join(', ')}`);
    const existingProducts = await getShopifyProductsBySku(skusToCreate);
    if (existingProducts.length > 0) {
        const foundSkus = existingProducts.map(p => p.sku).join(', ');
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
            console.log(`Phase 1: Creating product for handle ${product.handle} with ${allVariantsForHandle.length} variants.`);
            createdProduct = await createProduct(allVariantsForHandle, addClearanceTag);
        } else { // 'variant'
             console.log(`Adding variant with SKU ${product.sku} to existing product.`);
             createdProduct = await addProductVariant(product);
        }
        
        if (!createdProduct || !createdProduct.id) {
            throw new Error("Product creation or variant addition failed to return a valid result.");
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
                 const createdVariant = createdProduct.variants.find((v: any) => v.sku === sourceVariant.sku);
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
                    console.log(` - Assigning image ID ${imageIdToAssign} to variant ID ${createdVariant.id}...`);
                    await updateProductVariant(createdVariant.id, { image_id: imageIdToAssign });
                 } else if (sourceVariant.mediaUrl || sourceVariant.imageId) {
                    console.warn(` - Could not find a matching image for SKU: ${sourceVariant.sku}`);
                 }
            }
        }


        // 2b. Connect inventory & Set levels for each variant
        const locations = await getShopifyLocations();
        const garageLocation = locations.find(l => l.name === 'Garage Harry Stanley');
        
        const variantsToProcess = missingType === 'product' 
            ? createdProduct.variants 
            : [createdProduct.variants.find((v:any) => v.sku === product.sku)];

        for(const variant of variantsToProcess) {
             if (!variant) continue;
            const sourceVariant = allVariantsForHandle.find(p => p.sku === variant.sku);
            if (!sourceVariant) continue;

            const inventoryItemIdGid = `gid://shopify/InventoryItem/${variant.inventory_item_id}`;

            if (sourceVariant.inventory !== null && inventoryItemIdGid) {
                console.log(`Connecting inventory item ${inventoryItemIdGid} to location ${GAMMA_WAREhouse_LOCATION_ID}...`);
                await connectInventoryToLocation(inventoryItemIdGid, GAMMA_WAREhouse_LOCATION_ID);
                
                console.log('Setting inventory level...');
                await updateInventoryLevel(inventoryItemIdGid, sourceVariant.inventory, GAMMA_WAREhouse_LOCATION_ID);

                if (garageLocation) {
                    console.log(`Found 'Garage Harry Stanley' (ID: ${garageLocation.id}). Disconnecting inventory...`);
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
                console.warn(`Could not find collection with title '${product.category}'. Skipping linking.`);
            }
        }

        // 2d. Publish to all sales channels (only for new products)
        if (missingType === 'product' && productGid) {
            console.log(`Publishing product ${productGid} to all sales channels...`);
            await publishProductToSalesChannels(productGid);
        } else {
            console.warn(`Could not publish product with handle ${product.handle} because its GID was not found or it's a new variant.`);
        }


        revalidatePath('/');
        return { success: true, message: `Successfully created ${missingType} for ${product.handle}`, createdProductData: createdProduct };
    } catch (error) {
        console.error(`Failed to create ${missingType} for SKU ${product.sku}:`, error);
        const message = error instanceof Error ? error.message : 'An unknown error occurred.';
        return { success: false, message };
    }
}

export async function createMultipleInShopify(
    itemsToCreate: { product: Product; allVariants: Product[]; missingType: 'product' | 'variant' }[],
    fileName: string
): Promise<{ success: boolean; message: string, results: any[] }> {
    let successCount = 0;
    const itemResults = [];

    // Group items by handle, since we create one product per handle.
    const groupedByHandle = itemsToCreate.reduce((acc, item) => {
        const handle = item.product.handle;
        if (!acc[handle]) {
            acc[handle] = {
                product: item.product,
                allVariants: [],
                missingType: 'product', // Bulk create is always for new products
            };
        }
        // Correctly accumulate all variants for the handle
        acc[handle].allVariants.push(...item.allVariants.filter(v => v.handle === handle));
        return acc;
    }, {} as { [handle: string]: { product: Product; allVariants: Product[]; missingType: 'product' | 'variant' } });
    
    // De-duplicate variants within each handle group
    for (const handle in groupedByHandle) {
        const uniqueVariantsMap = new Map<string, Product>();
        groupedByHandle[handle].allVariants.forEach(variant => {
            uniqueVariantsMap.set(variant.sku, variant);
        });
        groupedByHandle[handle].allVariants = Array.from(uniqueVariantsMap.values());
    }


    for (const handle in groupedByHandle) {
        const item = groupedByHandle[handle];
        
        const result = await createInShopify(item.product, item.allVariants, fileName, 'product');
        
        if (result.success) {
            successCount++;
        }
        itemResults.push({ handle: item.product.handle, ...result });
        await sleep(600); // Add delay between each product creation to avoid rate limiting
    }

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
    const itemResults = [];

    if (variants.length === 0) {
        return { success: false, message: 'No variants provided to create.', results: [] };
    }
    
    const handle = variants[0].handle;
    console.log(`Starting bulk variant creation for handle: ${handle}`);

    for (const variant of variants) {
        const result = await createInShopify(variant, variants, 'N/A', 'variant');
        if (result.success) {
            successCount++;
        }
        itemResults.push({ sku: variant.sku, ...result });
        await sleep(600); // Add delay between each variant creation to avoid rate limiting
    }

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
        return { success: true, message: `Successfully deleted product ${productId}`};
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
            throw new Error(`Invalid Product or Variant GID. Product: ${productId}, Variant: ${variantId}`);
        }

        await deleteProductVariant(numericProductId, numericVariantId);
        revalidatePath('/');
        return { success: true, message: `Successfully deleted variant ${variantId}`};
    } catch (error) {
        console.error(`Failed to delete variant ${variantId}:`, error);
        const message = error instanceof Error ? error.message : 'An unknown error occurred.';
        return { success: false, message };
    }
}


// --- MEDIA ACTIONS ---

export async function getProductWithImages(productId: string): Promise<{ variants: Product[], images: ShopifyProductImage[] }> {
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
    } catch(error) {
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
        const numericProductIds = productIds.map(gid => {
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
    } catch(error) {
        console.error(`Failed to get product image counts for IDs ${productIds.join(', ')}:`, error);
        const message = error instanceof Error ? error.message : 'An unknown error occurred.';
        throw new Error(message);
    }
}


export async function addImageFromUrl(productId: string, imageUrl: string): Promise<{ success: boolean; message: string; image?: ShopifyProductImage }> {
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

export async function assignImageToVariant(variantId: string, imageId: number | null): Promise<{ success: boolean; message: string }> {
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

export async function deleteImage(productId: string, imageId: number): Promise<{ success: boolean; message: string }> {
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
    
export async function deleteUnlinkedImages(productId: string): Promise<{ success: boolean; message: string; deletedCount: number }> {
    console.log(`Starting to delete unlinked images for product GID: ${productId}`);
    try {
        const { images, variants } = await getProductWithImages(productId);
        const linkedImageIds = new Set(variants.map(v => v.imageId).filter(id => id !== null));

        const unlinkedImages = images.filter(image => !linkedImageIds.has(image.id));

        if (unlinkedImages.length === 0) {
            return { success: true, message: 'No unlinked images found to delete.', deletedCount: 0 };
        }

        console.log(`Found ${unlinkedImages.length} unlinked images to delete.`);
        let deletedCount = 0;
        
        for (const image of unlinkedImages) {
            const result = await deleteImage(productId, image.id);
            if(result.success) {
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

export async function deleteUnlinkedImagesForMultipleProducts(productIds: string[]): Promise<{ success: boolean; message: string; results: { productId: string, success: boolean, deletedCount: number, message: string }[] }> {
    console.log(`Starting bulk deletion of unlinked images for ${productIds.length} products.`);
    const results = [];
    let totalSuccessCount = 0;
    let totalDeletedCount = 0;

    for (const productId of productIds) {
        const result = await deleteUnlinkedImages(productId);
        results.push({ productId, ...result });
        if(result.success && result.deletedCount > 0) {
            totalSuccessCount++;
            totalDeletedCount += result.deletedCount;
        }
        await sleep(500); // Add delay to avoid rate limiting
    }

    const message = `Bulk operation complete. Processed ${productIds.length} products and deleted a total of ${totalDeletedCount} unlinked images.`;
    console.log(message);
    return { success: totalSuccessCount > 0, message, results };
}
      

    

    

    






    

    

    



    