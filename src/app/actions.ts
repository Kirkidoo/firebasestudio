
'use server';

import { Product, AuditResult, DuplicateSku, MismatchDetail, ShopifyProductImage } from '@/lib/types';
import { Client } from 'basic-ftp';
import { Readable, Writable } from 'stream';
import { parse } from 'csv-parse';
import { getShopifyProductsBySku, updateProduct, updateProductVariant, updateInventoryLevel, createProduct, addProductVariant, connectInventoryToLocation, linkProductToCollection, getCollectionIdByTitle, getShopifyLocations, disconnectInventoryFromLocation, publishProductToSalesChannels, deleteProduct, deleteProductVariant, startProductExportBulkOperation, checkBulkOperationStatus, getBulkOperationResult, parseBulkOperationResult, getFullProduct, addProductImage, deleteProductImage } from '@/lib/shopify';
import { revalidatePath } from 'next/cache';
import fs from 'fs/promises';
import path from 'path';

const FTP_DIRECTORY = '/Gamma_Product_Files/Shopify_Files/';
const GAMMA_WAREHOUSE_LOCATION_ID = 93998154045;
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
        const costPerItem = costPerItemText && !isNaN(parseFloat(costPerItemText)) ? parseFloat(costPerItemText) : null;

        const weight = record['Variant Grams'] ? parseFloat(record['Variant Grams']) : null;
        
        const tags = record.Tags || null;
        const tagArray = tags ? tags.split(',').map((t: string) => t.trim()) : [];
        const productType = tagArray.length >= 3 ? tagArray[2] : null;
        
        if (record.Handle && sku && record.Title && !isNaN(price)) {
            records.push({
                handle: record.Handle,
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
                option1Name: record['Option1 Name'] || null,
                option1Value: record['Option1 Value'] || null,
                option2Name: record['Option2 Name'] || null,
                option2Value: record['Option2 Value'] || null,
                option3Name: record['Option3 Name'] || null,
                option3Value: record['Option3 Value'] || null,
                id: '', // Shopify only
                variantId: '', // Shopify only
                inventoryItemId: '', // Shopify only
                imageId: null, // Shopify only
            });
        }
    }
    console.log(`Parsed ${records.length} products from CSV.`);
    
    return { products: records };
}

function findMismatches(csvProduct: Product, shopifyProduct: Product): MismatchDetail[] {
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
    return mismatches;
}

async function runAuditComparison(csvProducts: Product[], shopifyProducts: Product[]): Promise<{ report: AuditResult[], summary: any }> {
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

    const shopifyHandleSet = new Set(shopifyProducts.map(p => p.handle));
    
    console.log('Running audit comparison logic...');
    let report: AuditResult[] = [];
    let matchedCount = 0;
    const summary = { mismatched: 0, not_in_csv: 0, missing_in_shopify: 0, duplicate_in_shopify: 0 };
    
    const processedShopifySkus = new Set<string>();

    for (const csvProduct of csvProducts) {
        const shopifyVariants = shopifyProductMap.get(csvProduct.sku);
        
        if (shopifyVariants) {
            // This SKU exists in Shopify.
             processedShopifySkus.add(csvProduct.sku);
            
            if (shopifyVariants.length > 1) {
                // --- DUPLICATE SKU IN SHOPIFY ---
                summary.duplicate_in_shopify++;
                
                const duplicateReportItems = shopifyVariants.map(variant => {
                    const mismatches = findMismatches(csvProduct, variant);
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
                // Also add individual mismatch reports for the UI to use
                report.push(...duplicateReportItems);


            } else {
                // --- SINGLE SKU IN SHOPIFY ---
                const shopifyProduct = shopifyVariants[0];
                const mismatches = findMismatches(csvProduct, shopifyProduct);

                if (mismatches.length > 0) {
                    report.push({ sku: csvProduct.sku, csvProducts: [csvProduct], shopifyProducts: [shopifyProduct], status: 'mismatched', mismatches });
                    summary.mismatched++;
                } else {
                    report.push({ sku: csvProduct.sku, csvProducts: [csvProduct], shopifyProducts: [shopifyProduct], status: 'matched', mismatches: [] });
                    matchedCount++;
                }
            }
        } else {
            // --- MISSING IN SHOPIFY ---
            const missingType = shopifyHandleSet.has(csvProduct.handle) ? 'variant' : 'product';
            report.push({
                sku: csvProduct.sku,
                csvProducts: [csvProduct],
                shopifyProducts: [],
                status: 'missing_in_shopify',
                mismatches: [{
                    field: 'missing_in_shopify',
                    csvValue: `SKU: ${csvProduct.sku}`,
                    shopifyValue: null,
                    missingType: missingType,
                }]
            });
            summary.missing_in_shopify++;
        }
    }

    // --- NOT IN CSV ---
    for (const [sku, variants] of shopifyProductMap.entries()) {
        if (!processedShopifySkus.has(sku)) {
            for (const variant of variants) {
                 report.push({ sku: sku, csvProducts: [], shopifyProducts: [variant], status: 'not_in_csv', mismatches: [] });
                 summary.not_in_csv++;
            }
        }
    }
    
    report.sort((a, b) => {
        const handleA = a.shopifyProducts[0]?.handle || a.csvProducts[0]?.handle || '';
        const handleB = b.shopifyProducts[0]?.handle || b.csvProducts[0]?.handle || '';
        if (handleA !== handleB) {
            return handleA.localeCompare(handleB);
        }
        return a.sku.localeCompare(b.sku);
    });
    console.log('Audit comparison complete. Matched:', matchedCount, 'Summary:', summary);

    // This is a list of all SKUs that have been identified as duplicates in Shopify.
    const duplicateSkuSet = new Set(
      report.filter(r => r.status === 'duplicate_in_shopify').map(r => r.sku)
    );

    // Filter out 'matched' items unless they are part of a duplicate issue.
    const finalReport = report.filter(item => {
        if (item.status === 'matched') {
            // If the item is matched, only keep it if its SKU is in our set of duplicates.
            return duplicateSkuSet.has(item.sku);
        }
        // Keep all other non-matched items.
        return true;
    });

    return { report: finalReport, summary: { ...summary, matched: matchedCount } };
}


export async function runAudit(csvFileName: string, ftpData: FormData): Promise<{ report: AuditResult[], summary: any, duplicates: DuplicateSku[] }> {
  console.log(`Starting audit for file: ${csvFileName}`);
  
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
    throw new Error('No products with valid Handle, SKU, Title, and Price found in the CSV file.');
  }

  const skusFromCsv = csvProducts.map(p => p.sku);
  console.log(`Fetching ${skusFromCsv.length} products from Shopify based on CSV SKUs...`);
  const shopifyProducts = await getShopifyProductsBySku(skusFromCsv);
  
  const { report, summary } = await runAuditComparison(csvProducts, shopifyProducts);

  const finalReport = report.filter(item => item.status !== 'matched' && item.status !== 'duplicate_in_shopify');
  return { report: finalReport, summary, duplicates: [] };
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

export async function runBulkAudit(
    csvFileName: string, 
    ftpData: FormData,
    useCache: boolean
): Promise<{ report: AuditResult[], summary: any, duplicates: DuplicateSku[] }> {
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
        throw new Error('No products with valid Handle, SKU, Title, and Price found in the CSV file.');
    }
    
    let shopifyProducts: Product[];

    if (useCache) {
        console.log('Using cached Shopify data...');
        try {
            const fileContent = await fs.readFile(CACHE_FILE_PATH, 'utf-8');
            shopifyProducts = await parseBulkOperationResult(fileContent);
        } catch (error) {
            console.error("Failed to read or parse cache file.", error);
            throw new Error("Could not read the cache file. Please start a new bulk operation.");
        }
    } else {
        console.log('Requesting product export from Shopify. This may take several minutes...');
        const operation = await startProductExportBulkOperation();
        console.log(`Bulk operation started: ${operation.id}`);

        let operationStatus = operation;
        while(operationStatus.status === 'RUNNING' || operationStatus.status === 'CREATED') {
            console.log(`Waiting for Shopify to prepare data... (Status: ${operationStatus.status})`);
            await new Promise(resolve => setTimeout(resolve, 5000)); // Poll every 5 seconds
            operationStatus = await checkBulkOperationStatus(operation.id);
            console.log(`Polling bulk operation status: ${operationStatus.status}`);
        }

        if (operationStatus.status !== 'COMPLETED') {
            throw new Error(`Shopify bulk operation failed or was cancelled. Status: ${operationStatus.status}`);
        }
        
        if(!operationStatus.resultUrl) {
            throw new Error(`Shopify bulk operation completed, but did not provide a result URL.`);
        }

        console.log('Downloading and processing exported data from Shopify...');
        const resultJsonl = await getBulkOperationResult(operationStatus.resultUrl);
        
        console.log('Caching Shopify data...');
        await ensureCacheDirExists();
        await fs.writeFile(CACHE_FILE_PATH, resultJsonl);
        await fs.writeFile(CACHE_INFO_PATH, JSON.stringify({ lastModified: new Date().toISOString() }));
        
        shopifyProducts = await parseBulkOperationResult(resultJsonl);
    }
    
    console.log('Generating audit report...');
    const { report, summary } = await runAuditComparison(csvProducts, shopifyProducts);

    // Format for legacy card, can be removed if card is updated.
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
                    await updateInventoryLevel(fixPayload.inventoryItemId, fixPayload.inventory, GAMMA_WAREHOUSE_LOCATION_ID);
                }
                break;
            case 'h1_tag':
                if (fixPayload.id && fixPayload.descriptionHtml) {
                    const newDescription = fixPayload.descriptionHtml.replace(/<h1/gi, '<h2').replace(/<\/h1>/gi, '</h2>');
                    await updateProduct(fixPayload.id, { bodyHtml: newDescription });
                }
                break;
             case 'duplicate_in_shopify':
                // This is a warning, cannot be fixed programmatically. Handled client-side.
                return { success: true, message: `SKU ${csvProduct.sku} is a duplicate in Shopify, no server action taken.` };
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
             await sleep(300); // Add a small delay to avoid rate limiting
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
    fileName: string
) {
    console.log(`Attempting to create product/variant for Handle: ${product.handle}`);
    const missingType = allVariantsForHandle.length > 1 ? 'product' : 'variant';
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
            const imageUrlToIdMap = new Map(createdProduct.images.map((img: any) => [img.src, img.id]));
            
            for (const sourceVariant of allVariantsForHandle) {
                 const createdVariant = createdProduct.variants.find((v: any) => v.sku === sourceVariant.sku);
                 if (!createdVariant || !sourceVariant.mediaUrl) continue;

                 const imageId = imageUrlToIdMap.get(sourceVariant.mediaUrl);
                 if (imageId) {
                    console.log(` - Assigning image ID ${imageId} to variant ID ${createdVariant.id}...`);
                    await updateProductVariant(createdVariant.id, { image_id: imageId });
                 } else {
                    console.warn(` - Could not find a created image matching source URL: ${sourceVariant.mediaUrl} for SKU: ${sourceVariant.sku}`);
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
                console.log(`Connecting inventory item ${inventoryItemIdGid} to location ${GAMMA_WAREHOUSE_LOCATION_ID}...`);
                await connectInventoryToLocation(inventoryItemIdGid, GAMMA_WAREHOUSE_LOCATION_ID);
                
                console.log('Setting inventory level...');
                await updateInventoryLevel(inventoryItemIdGid, sourceVariant.inventory, GAMMA_WAREHOUSE_LOCATION_ID);

                if (garageLocation) {
                    console.log(`Found 'Garage Harry Stanley' (ID: ${garageLocation.id}). Disconnecting inventory...`);
                    await disconnectInventoryFromLocation(inventoryItemIdGid, garageLocation.id);
                }
            }
        }
        
        // 2c. Link product to collection if category is specified
        if (product.category && productGid) {
            console.log(`Linking product to collection: '${product.category}'...`);
            const collectionId = await getCollectionIdByTitle(product.category);
            if (collectionId) {
                await linkProductToCollection(productGid, collectionId);
            } else {
                console.warn(`Could not find collection with title '${product.category}'. Skipping linking.`);
            }
        }

        // 2d. Publish to all sales channels
        if (productGid) {
            console.log(`Publishing product ${productGid} to all sales channels...`);
            await publishProductToSalesChannels(productGid);
        } else {
            console.warn(`Could not publish product with handle ${product.handle} because its GID was not found.`);
        }


        revalidatePath('/');
        return { success: true, message: `Successfully created ${missingType} for ${product.sku}`, createdProductData: createdProduct };
    } catch (error) {
        console.error(`Failed to create ${missingType} for SKU ${product.sku}:`, error);
        const message = error instanceof Error ? error.message : 'An unknown error occurred.';
        return { success: false, message };
    }
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

export async function assignImageToVariant(variantId: string, imageId: number): Promise<{ success: boolean; message: string }> {
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
    

    




    

    

    

    

    




    

    

      

    