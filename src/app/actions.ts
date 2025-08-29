
'use server';

import { Product, AuditResult, DuplicateSku, MismatchDetail } from '@/lib/types';
import { Client } from 'basic-ftp';
import { Readable, Writable } from 'stream';
import { parse } from 'csv-parse';
import { getShopifyProductsBySku, updateProduct, updateProductVariant, updateInventoryLevel, createProduct, addProductVariant, connectInventoryToLocation, linkProductToCollection, getCollectionIdByTitle, getShopifyLocations, disconnectInventoryFromLocation } from '@/lib/shopify';
import { revalidatePath } from 'next/cache';

const FTP_DIRECTORY = '/Gamma_Product_Files/Shopify_Files/';
const GAMMA_WAREHOUSE_LOCATION_ID = 93998154045;


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

async function parseCsvFromStream(stream: Readable): Promise<{products: Product[], duplicates: DuplicateSku[]}> {
    console.log('Parsing CSV from stream...');
    const records: Product[] = [];
    const skuCounts = new Map<string, number>();

    const parser = stream.pipe(parse({
        columns: true,
        skip_empty_lines: true,
        trim: true,
    }));

    for await (const record of parser) {
        const sku = record.SKU;
        if (sku) {
            skuCounts.set(sku, (skuCounts.get(sku) || 0) + 1);
        }
        
        const price = parseFloat(record.Price);
        const inventory = record['Variant Inventory Qty'] ? parseInt(record['Variant Inventory Qty'], 10) : null;
        
        const compareAtPriceText = record['Compare At Price'];
        const compareAtPrice = compareAtPriceText && !isNaN(parseFloat(compareAtPriceText)) ? parseFloat(compareAtPriceText) : null;

        const costPerItemText = record['Cost Per Item'];
        const costPerItem = costPerItemText && !isNaN(parseFloat(costPerItemText)) ? parseFloat(costPerItemText) : null;

        const weight = record['Variant Grams'] ? parseFloat(record['Variant Grams']) : null;
        
        if (record.Handle && sku && record.Title && !isNaN(price)) {
            records.push({
                handle: record.Handle,
                sku: sku,
                name: record.Title,
                price: price,
                inventory: inventory,
                descriptionHtml: record['Body (HTML)'] || null,
                productType: record.Type || null,
                vendor: record.Vendor || null,
                compareAtPrice: compareAtPrice,
                costPerItem: costPerItem,
                barcode: record['Variant Barcode'] || null,
                weight: weight,
                mediaUrl: record['Variant Image'] || null,
                category: record.Category || null,
                id: '', // Shopify only
                variantId: '', // Shopify only
                inventoryItemId: '', // Shopify only
            });
        }
    }
    console.log(`Parsed ${records.length} products from CSV.`);
    
    const duplicates: DuplicateSku[] = [];
    for(const [sku, count] of skuCounts.entries()) {
        if (count > 1) {
            duplicates.push({ sku, count });
        }
    }
    console.log(`Found ${duplicates.length} duplicate SKUs in CSV.`);
    
    return { products: records, duplicates };
}

export async function runAudit(csvFileName: string, ftpData: FormData): Promise<{ report: AuditResult[], summary: any, duplicates: DuplicateSku[] }> {
  console.log(`Starting audit for file: ${csvFileName}`);
  
  // 1. Fetch and parse CSV from FTP
  const client = await getFtpClient(ftpData);
  let csvProducts: Product[] = [];
  let duplicateSkus: DuplicateSku[] = [];

  try {
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
    
    const readable = Readable.from(Buffer.concat(chunks));
    const parsedData = await parseCsvFromStream(readable);
    csvProducts = parsedData.products;
    duplicateSkus = parsedData.duplicates;

  } catch (error) {
    console.error("Failed to download or parse CSV from FTP", error);
    throw new Error(`Could not download or process file '${csvFileName}' from FTP.`);
  } finally {
      if (!client.closed) {
        client.close();
        console.log('FTP client closed.');
      }
  }
  
  if (csvProducts.length === 0) {
    console.log('No products found in the CSV file. Aborting audit.');
    throw new Error('No products with valid Handle, SKU, Title, and Price found in the CSV file.');
  }

  const csvProductMap = new Map(csvProducts.map(p => [p.sku, p]));
  console.log(`Created map with ${csvProductMap.size} products from CSV.`);

  // 2. Fetch products from Shopify using the SKUs from the CSV
  const skusFromCsv = Array.from(csvProductMap.keys());
  console.log(`Fetching ${skusFromCsv.length} products from Shopify based on CSV SKUs...`);
  const shopifyProducts = await getShopifyProductsBySku(skusFromCsv);
  const shopifyProductMap = new Map(shopifyProducts.map(p => [p.sku, p]));
  const shopifyHandleSet = new Set(shopifyProducts.map(p => p.handle));
  console.log(`Created map with ${shopifyProductMap.size} products from Shopify.`);


  // 3. Run audit logic
  console.log('Running audit comparison logic...');
  const report: AuditResult[] = [];
  const summary = { matched: 0, mismatched: 0, not_in_csv: 0, missing_in_shopify: 0 };

  // Iterate over the CSV products (source of truth)
  for (const csvProduct of csvProducts) {
    const shopifyProduct = shopifyProductMap.get(csvProduct.sku);

    if (shopifyProduct) {
      const mismatches: MismatchDetail[] = [];
      if (csvProduct.name !== shopifyProduct.name) {
          mismatches.push({ field: 'name', csvValue: csvProduct.name, shopifyValue: shopifyProduct.name });
      }
      if (csvProduct.price !== shopifyProduct.price) {
          mismatches.push({ field: 'price', csvValue: csvProduct.price, shopifyValue: shopifyProduct.price });
      }
       if (csvProduct.inventory !== null && csvProduct.inventory !== shopifyProduct.inventory) {
          mismatches.push({ field: 'inventory', csvValue: csvProduct.inventory, shopifyValue: shopifyProduct.inventory });
      }
      if (shopifyProduct.descriptionHtml && /<h1/i.test(shopifyProduct.descriptionHtml)) {
           mismatches.push({ field: 'h1_tag', csvValue: 'No H1 Expected', shopifyValue: 'H1 Found' });
      }

      if (mismatches.length > 0) {
        report.push({ sku: csvProduct.sku, csvProduct, shopifyProduct, status: 'mismatched', mismatches });
        summary.mismatched++;
      } else {
        report.push({ sku: csvProduct.sku, csvProduct, shopifyProduct, status: 'matched', mismatches: [] });
        summary.matched++;
      }
      // Remove from Shopify map to find what's left
      shopifyProductMap.delete(csvProduct.sku); 
    } else {
      const missingType = shopifyHandleSet.has(csvProduct.handle) ? 'variant' : 'product';
      report.push({ 
        sku: csvProduct.sku, 
        csvProduct, 
        shopifyProduct: null, 
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

  // Any remaining products in the Shopify map were not in the CSV
  for (const shopifyProduct of shopifyProductMap.values()) {
      report.push({ sku: shopifyProduct.sku, csvProduct: null, shopifyProduct, status: 'not_in_csv', mismatches: [] });
      summary.not_in_csv++;
  }
  
  report.sort((a, b) => {
    const handleA = a.csvProduct?.handle || a.shopifyProduct?.handle || '';
    const handleB = b.csvProduct?.handle || b.shopifyProduct?.handle || '';
    if (handleA !== handleB) {
      return handleA.localeCompare(handleB);
    }
    return a.sku.localeCompare(b.sku);
  });
  console.log('Audit comparison complete. Summary:', summary);

  return { report, summary, duplicates: duplicateSkus };
}


// --- FIX ACTIONS ---

export async function fixMismatch(
    fixType: MismatchDetail['field'],
    product: Product
) {
    console.log(`Attempting to fix '${fixType}' for SKU: ${product.sku}`);

    try {
        switch (fixType) {
            case 'name':
                if (product.id) {
                    await updateProduct(product.id, { title: product.name });
                    console.log(`Successfully updated name for product ID: ${product.id}`);
                }
                break;
            case 'price':
                 if (product.variantId) {
                    await updateProductVariant(product.variantId, { price: product.price });
                    console.log(`Successfully updated price for variant ID: ${product.variantId}`);
                }
                break;
            case 'inventory':
                 if (product.inventoryItemId && product.inventory !== null) {
                    await updateInventoryLevel(product.inventoryItemId, product.inventory, GAMMA_WAREHOUSE_LOCATION_ID);
                    console.log(`Successfully updated inventory for inventory item ID: ${product.inventoryItemId}`);
                }
                break;
            case 'h1_tag':
                if (product.id && product.descriptionHtml) {
                    const newDescription = product.descriptionHtml.replace(/<h1/gi, '<h2').replace(/<\/h1>/gi, '</h2>');
                    await updateProduct(product.id, { bodyHtml: newDescription });
                    console.log(`Successfully fixed H1 tags for product ID: ${product.id}`);
                }
                break;
        }
        revalidatePath('/'); // Re-run the audit data fetch on the client
        return { success: true, message: `Successfully fixed ${fixType} for ${product.sku}` };

    } catch (error) {
        console.error(`Failed to fix ${fixType} for SKU ${product.sku}:`, error);
        const message = error instanceof Error ? error.message : 'An unknown error occurred.';
        return { success: false, message };
    }
}

export async function createInShopify(
    product: Product,
    allVariantsForHandle: Product[],
    missingType: 'product' | 'variant'
) {
    console.log(`Attempting to create '${missingType}' for Handle: ${product.handle}`);
    try {
        let createdProductData;
        if (missingType === 'product') {
            // Pass all variants to the createProduct function
            createdProductData = await createProduct(allVariantsForHandle);
        } else {
             // For adding a variant, we only need the specific variant's data
             const { id, inventoryItemId } = await addProductVariant(product);
             // We need the parent product GID for other tasks
             createdProductData = { ...product, variantId: id, inventoryItemId, id: product.id };
        }
        
        // --- Post-creation tasks ---
        // These tasks need to be done for each variant that was part of the creation.
        const variantsToProcess = missingType === 'product' ? createdProductData.variants : [createdProductData];
        
        for(const variant of variantsToProcess) {
            const sourceVariant = allVariantsForHandle.find(p => p.sku === variant.sku);
            if (!sourceVariant) continue;

            // 1. Connect to Gamma Warehouse and set inventory
            if (sourceVariant.inventory !== null && variant.inventoryItemId) {
                console.log(`Connecting inventory item ${variant.inventoryItemId} to location ${GAMMA_WAREHOUSE_LOCATION_ID}...`);
                await connectInventoryToLocation(variant.inventoryItemId, GAMMA_WAREHOUSE_LOCATION_ID);
                
                console.log('Setting inventory level...');
                await updateInventoryLevel(variant.inventoryItemId, sourceVariant.inventory, GAMMA_WAREHOUSE_LOCATION_ID);

                 // 2. Disconnect from 'Garage Harry Stanley' location if it exists
                const locations = await getShopifyLocations();
                const garageLocation = locations.find(l => l.name === 'Garage Harry Stanley');
                if (garageLocation) {
                    console.log(`Found 'Garage Harry Stanley' (ID: ${garageLocation.id}). Disconnecting inventory...`);
                    await disconnectInventoryFromLocation(variant.inventoryItemId, garageLocation.id);
                }
            }
        }
        
        // 3. Link product to collection if category is specified (This is a product-level task)
        const productGid = missingType === 'product' ? createdProductData.id : product.id;
        if (product.category && productGid) {
            console.log(`Linking product to collection: '${product.category}'...`);
            const collectionId = await getCollectionIdByTitle(product.category);
            if (collectionId) {
                await linkProductToCollection(productGid, collectionId);
            } else {
                console.warn(`Could not find collection with title '${product.category}'. Skipping linking.`);
            }
        }

        revalidatePath('/');
        return { success: true, message: `Successfully created ${missingType} for ${product.sku}`, createdProductData };
    } catch (error) {
        console.error(`Failed to create ${missingType} for SKU ${product.sku}:`, error);
        const message = error instanceof Error ? error.message : 'An unknown error occurred.';
        return { success: false, message };
    }
}

    