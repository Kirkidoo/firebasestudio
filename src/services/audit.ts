import { Product, AuditResult, DuplicateSku, MismatchDetail } from '@/lib/types';
import { getCsvStreamFromFtp } from './ftp';
import { parseCsvFromStream } from './csv';
import { getShopifyProductsBySku } from '@/lib/shopify';

function findMismatches(
  csvProduct: Product,
  shopifyProduct: Product,
  csvFileName: string
): MismatchDetail[] {
  const mismatches: MismatchDetail[] = [];

  // Ignore products stocked at Garage Harry Stanley (ID: 86376317245)
  if (shopifyProduct.locationIds?.includes('gid://shopify/Location/86376317245')) {
    return [];
  }

  if (csvProduct.price !== shopifyProduct.price) {
    mismatches.push({
      field: 'price',
      csvValue: csvProduct.price,
      shopifyValue: shopifyProduct.price,
    });
  }

  if (csvProduct.inventory !== null && csvProduct.inventory !== shopifyProduct.inventory) {
    const isCappedInventory = csvProduct.inventory > 10 && shopifyProduct.inventory === 10;
    if (!isCappedInventory) {
      mismatches.push({
        field: 'inventory',
        csvValue: csvProduct.inventory,
        shopifyValue: shopifyProduct.inventory,
      });
    }
  }

  if (shopifyProduct.descriptionHtml && /<h1/i.test(shopifyProduct.descriptionHtml)) {
    mismatches.push({ field: 'h1_tag', csvValue: 'No H1 Expected', shopifyValue: 'H1 Found' });
  }

  // Heavy product check: weight > 50lbs (22679.6 grams)
  if (csvProduct.weight && csvProduct.weight > 22679.6) {
    mismatches.push({
      field: 'heavy_product_flag',
      csvValue: `${(csvProduct.weight / 453.592).toFixed(2)} lbs`,
      shopifyValue: null,
    });
  }

  // Clearance tag check
  // Clearance tag and template check
  if (csvFileName.toLowerCase().includes('clearance')) {
    const tags = shopifyProduct.tags
      ? shopifyProduct.tags
        .toLowerCase()
        .split(',')
        .map((t) => t.trim())
      : [];

    // Check if Price equals Compare At Price (Invalid Clearance)
    if (csvProduct.compareAtPrice !== null && csvProduct.price === csvProduct.compareAtPrice) {
      mismatches.push({
        field: 'clearance_price_mismatch', // New mismatch type
        csvValue: `Price: ${csvProduct.price}`,
        shopifyValue: `Compare At: ${csvProduct.compareAtPrice}`,
      });
    } else {
      // Only check for missing clearance tag if it's NOT an invalid clearance product
      if (!tags.includes('clearance')) {
        mismatches.push({
          field: 'missing_clearance_tag',
          csvValue: 'Clearance',
          shopifyValue: shopifyProduct.tags || 'No Tags',
        });
      }

      if (shopifyProduct.templateSuffix !== 'clearance') {
        mismatches.push({
          field: 'incorrect_template_suffix',
          csvValue: 'clearance',
          shopifyValue: shopifyProduct.templateSuffix || 'Default Template',
        });
      }
    }
  }

  // Category Tag Check
  if (csvProduct.category) {
    const tags = shopifyProduct.tags
      ? shopifyProduct.tags
        .toLowerCase()
        .split(',')
        .map((t) => t.trim())
      : [];

    const categoryLower = csvProduct.category.toLowerCase().trim();
    if (!tags.includes(categoryLower)) {
      mismatches.push({
        field: 'missing_category_tag',
        csvValue: csvProduct.category,
        shopifyValue: shopifyProduct.tags || 'No Tags',
      });
    }
  }

  return mismatches;
}

export async function runAuditComparison(
  csvProducts: Product[],
  shopifyProducts: Product[],
  csvFileName: string
): Promise<{ report: AuditResult[]; summary: any }> {
  const csvProductMap = new Map(csvProducts.map((p) => [p.sku, p]));
  console.log(`Created map with ${csvProductMap.size} products from CSV.`);

  const shopifyProductMap = new Map<string, Product[]>();
  for (const p of shopifyProducts) {
    const skuLower = p.sku.toLowerCase();
    if (!shopifyProductMap.has(skuLower)) {
      shopifyProductMap.set(skuLower, []);
    }
    shopifyProductMap.get(skuLower)!.push(p);
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
  let summary = {
    mismatched: 0,
    not_in_csv: 0,
    missing_in_shopify: 0,
    duplicate_in_shopify: 0,
    duplicate_handle: 0,
  };
  const handledDuplicateHandles = new Set<string>();

  for (const [handle, products] of shopifyHandleMap.entries()) {
    if (products.length > 1) {
      // Check if all products with this handle have unique SKUs
      const uniqueSkus = new Set(products.map((p) => p.sku));
      if (uniqueSkus.size < products.length) {
        // This is a more complex issue (duplicate SKUs within a duplicate handle)
        // Let the duplicate SKU logic handle this.
      } else {
        // This is a valid multi-variant product (multiple variants, unique SKUs).
        // Do NOT flag as duplicate_handle.
      }
    }
  }

  const shopifyProductsForSkuComparison = shopifyProducts.filter(
    (p) => !handledDuplicateHandles.has(p.handle)
  );
  const shopifyProductMapForSkuComparison = new Map<string, Product[]>();
  for (const p of shopifyProductsForSkuComparison) {
    const skuLower = p.sku.toLowerCase();
    if (!shopifyProductMapForSkuComparison.has(skuLower)) {
      shopifyProductMapForSkuComparison.set(skuLower, []);
    }
    shopifyProductMapForSkuComparison.get(skuLower)!.push(p);
  }

  const shopifyHandleSet = new Set(shopifyProducts.map((p) => p.handle));

  console.log('Running audit comparison logic...');
  let matchedCount = 0;

  const processedShopifySkus = new Set<string>();

  for (const csvProduct of csvProducts) {
    const shopifyVariants = shopifyProductMapForSkuComparison.get(csvProduct.sku.toLowerCase());

    if (shopifyVariants) {
      processedShopifySkus.add(csvProduct.sku.toLowerCase());

      if (shopifyVariants.length > 1) {
        summary.duplicate_in_shopify++;

        const duplicateReportItems = shopifyVariants.map((variant) => {
          const mismatches = findMismatches(csvProduct, variant, csvFileName);
          return {
            sku: csvProduct.sku,
            csvProducts: [csvProduct],
            shopifyProducts: [variant],
            status: mismatches.length > 0 ? 'mismatched' : 'matched',
            mismatches: mismatches,
          } as AuditResult;
        });

        report.push({
          sku: csvProduct.sku,
          csvProducts: [csvProduct],
          shopifyProducts: shopifyVariants,
          status: 'duplicate_in_shopify',
          mismatches: [
            {
              field: 'duplicate_in_shopify',
              csvValue: null,
              shopifyValue: `Used in ${shopifyVariants.length} products`,
            },
          ],
        });
        report.push(...duplicateReportItems);
      } else {
        const shopifyProduct = shopifyVariants[0];
        const mismatches = findMismatches(csvProduct, shopifyProduct, csvFileName);

        if (mismatches.length > 0) {
          report.push({
            sku: csvProduct.sku,
            csvProducts: [csvProduct],
            shopifyProducts: [shopifyProduct],
            status: 'mismatched',
            mismatches,
          });
          summary.mismatched++;
        } else {
          report.push({
            sku: csvProduct.sku,
            csvProducts: [csvProduct],
            shopifyProducts: [shopifyProduct],
            status: 'matched',
            mismatches: [],
          });
          matchedCount++;
        }
      }
    } else {
      // Check if handle exists in Shopify even if SKU is missing
      const productsWithHandle = shopifyHandleMap.get(csvProduct.handle);

      if (productsWithHandle && productsWithHandle.length > 0) {
        // Handle exists, so it's likely a variant.
        // Check for title mismatch to ensure it's the same product family.
        // Handle exists, so it's likely a variant.
        // User requested to ignore title mismatches ("name/handle mismatch never happen")
        // So we assume it's the same product family and report as Missing Variant.

        const mismatches: MismatchDetail[] = [
          {
            field: 'missing_in_shopify',
            csvValue: `SKU: ${csvProduct.sku}`,
            shopifyValue: null,
            missingType: 'variant',
          },
        ];

        if (csvProduct.weight && csvProduct.weight > 22679.6) {
          mismatches.push({
            field: 'heavy_product_flag',
            csvValue: `${(csvProduct.weight / 453.592).toFixed(2)} lbs`,
            shopifyValue: null,
          });
        }

        report.push({
          sku: csvProduct.sku,
          csvProducts: [csvProduct],
          shopifyProducts: [],
          status: 'missing_in_shopify',
          mismatches: mismatches,
        });
        summary.missing_in_shopify++;
      } else {
        // Handle does not exist -> Missing Product
        const mismatches: MismatchDetail[] = [
          {
            field: 'missing_in_shopify',
            csvValue: `SKU: ${csvProduct.sku}`,
            shopifyValue: null,
            missingType: 'product',
          },
        ];

        if (csvProduct.weight && csvProduct.weight > 22679.6) {
          mismatches.push({
            field: 'heavy_product_flag',
            csvValue: `${(csvProduct.weight / 453.592).toFixed(2)} lbs`,
            shopifyValue: null,
          });
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
  }

  for (const [sku, variants] of shopifyProductMapForSkuComparison.entries()) {
    // Note: sku here is already lowercase from the map key
    // We need to check if we processed this SKU (using the original CSV SKU casing if possible, but here we only have the map key)
    // The processedShopifySkus set should also store lowercase SKUs to match.
    if (!processedShopifySkus.has(sku)) {
      for (const variant of variants) {
        report.push({
          sku: sku,
          csvProducts: [],
          shopifyProducts: [variant],
          status: 'not_in_csv',
          mismatches: [],
        });
        summary.not_in_csv++;
      }
    }
  }

  const getHandle = (item: AuditResult) =>
    item.shopifyProducts[0]?.handle || item.csvProducts[0]?.handle || '';

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

export async function runAudit(
  csvFileName: string,
  ftpData: FormData
): Promise<{ report: AuditResult[]; summary: any; duplicates: DuplicateSku[] } | null> {
  let csvProducts: Product[] = [];

  try {
    const readableStream = await getCsvStreamFromFtp(csvFileName, ftpData);
    const parsedData = await parseCsvFromStream(readableStream);
    csvProducts = parsedData.products;
  } catch (error) {
    console.error('Failed to download or parse CSV from FTP', error);
    throw new Error(`Could not download or process file '${csvFileName}' from FTP.`);
  }

  if (csvProducts.length === 0) {
    console.log('No products found in the CSV file. Aborting audit.');
    return {
      report: [],
      summary: {
        matched: 0,
        mismatched: 0,
        not_in_csv: 0,
        missing_in_shopify: 0,
        duplicate_in_shopify: 0,
        duplicate_handle: 0,
      },
      duplicates: [],
    };
  }

  // Fetch Shopify products based on SKUs from the CSV
  const skusFromCsv = csvProducts.map((p) => p.sku);
  const allShopifyProducts = await getShopifyProductsBySku(skusFromCsv);

  if (!allShopifyProducts) {
    console.error('Audit cannot run because Shopify product data could not be fetched.');
    return null;
  }

  const { report, summary } = await runAuditComparison(
    csvProducts,
    allShopifyProducts,
    csvFileName
  );

  const duplicatesForCard: DuplicateSku[] = report
    .filter((d) => d.status === 'duplicate_in_shopify')
    .map((d) => ({ sku: d.sku, count: d.shopifyProducts.length }));

  return { report: report, summary, duplicates: duplicatesForCard };
}

export async function runBulkAuditComparison(
  csvProducts: Product[],
  shopifyProducts: Product[],
  csvFileName: string
): Promise<{ report: AuditResult[]; summary: any; duplicates: DuplicateSku[] }> {
  const { report, summary } = await runAuditComparison(csvProducts, shopifyProducts, csvFileName);
  const duplicatesForCard: DuplicateSku[] = report
    .filter((d) => d.status === 'duplicate_in_shopify')
    .map((d) => ({ sku: d.sku, count: d.shopifyProducts.length }));
  return { report, summary, duplicates: duplicatesForCard };
}
