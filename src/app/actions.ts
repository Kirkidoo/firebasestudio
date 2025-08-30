
'use server';

import { Product, AuditResult, DuplicateSku, MismatchDetail } from '@/lib/types';
import { Client } from 'basic-ftp';
import { Readable, Writable } from 'stream';
import { parse } from 'csv-parse';
import { getShopifyProductsBySku, updateProduct, updateProductVariant, updateInventoryLevel, createProduct, addProductVariant, connectInventoryToLocation, linkProductToCollection, getCollectionIdByTitle, getShopifyLocations, disconnectInventoryFromLocation, publishProductToSalesChannels, deleteProduct } from '@/lib/shopify';
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
  let matchedCount = 0;
  const summary = { mismatched: 0, not_in_csv: 0, missing_in_shopify: 0 };

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
        matchedCount++;
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
  console.log('Audit comparison complete. Matched:', matchedCount, 'Summary:', summary);

  // Filter out matched items before returning
  const finalReport = report.filter(item => item.status !== 'matched');

  return { report: finalReport, summary: {...summary, matched: matchedCount }, duplicates: duplicateSkus };
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
                    const numericVariantId = parseInt(product.variantId.split('/').pop() || '0', 10);
                    if (numericVariantId) {
                       await updateProductVariant(numericVariantId, { price: product.price });
                       console.log(`Successfully updated price for variant ID: ${numericVariantId}`);
                    }
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
    missingType: 'product' | 'variant',
    fileName: string
) {
    console.log(`Attempting to create '${missingType}' for Handle: ${product.handle}`);
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
             // The addProductVariant function now returns the full product, so we can treat it similarly
        }
        
        if (!createdProduct || !createdProduct.id) {
            throw new Error("Product creation or variant addition failed to return a valid result.");
        }
        
        const productGid = `gid://shopify/Product/${createdProduct.id}`;

        // --- Phase 2: Post-creation/addition tasks ---

        // 2a. Link variant to image
        if (missingType === 'product' && createdProduct.images && createdProduct.images.length > 0) {
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
    

    
