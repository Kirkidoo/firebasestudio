import { Readable } from 'stream';
import { parse } from 'csv-parse';
import { Product } from '@/lib/types';
import { getCsvStreamFromFtp } from './ftp';

export async function parseCsvFromStream(stream: Readable): Promise<{ products: Product[] }> {
  console.log('Parsing CSV from stream...');
  const records: Product[] = [];
  const handledHandles = new Set<string>();

  // Handle BOM if present
  let isFirstChunk = true;
  const bomStripper = new Readable({
    read() {
      const chunk = stream.read();
      if (chunk) {
        if (isFirstChunk && chunk.length >= 3 && chunk[0] === 0xEF && chunk[1] === 0xBB && chunk[2] === 0xBF) {
          this.push(chunk.slice(3));
        } else {
          this.push(chunk);
        }
        isFirstChunk = false;
      } else {
        this.push(null);
      }
    }
  });

  // If stream is already flowing, we might need a different approach, but for now assuming fresh stream
  // Actually, simpler approach: use the 'bom' option in csv-parse if available, or just strip it manually from string if we were reading string.
  // Since we are piping stream, let's use the bom option from csv-parse which handles this gracefully.

  const parser = stream.pipe(
    parse({
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true, // Enable BOM stripping
    })
  );

  stream.on('error', (err) => {
    console.error('Input stream error:', err);
    parser.destroy(err);
  });

  for await (const record of parser) {
    const rawSku = record['Variant SKU'] || record['SKU'] || record['sku'];
    const sku = rawSku ? rawSku.trim() : null;
    const priceText = record['Variant Price'] || record['Price'] || record['price'];
    const price = parseFloat(priceText);
    const inventoryText =
      record['Variant Inventory Qty'] || record['Inventory'] || record['inventory'];
    const inventory = inventoryText ? parseInt(inventoryText, 10) : null;

    const compareAtPriceText = record['Compare At Price'];
    const compareAtPrice =
      compareAtPriceText && !isNaN(parseFloat(compareAtPriceText))
        ? parseFloat(compareAtPriceText)
        : null;

    const costPerItemText = record['Cost Per Item'];
    let costPerItem = costPerItemText ? parseFloat(costPerItemText) : null;
    if (isNaN(costPerItem as any)) {
      costPerItem = null;
    }

    const weight = record['Variant Grams'] ? parseFloat(record['Variant Grams']) : null;

    const tags = record.Tags || null;
    const tagArray = tags ? tags.split(',').map((t: string) => t.trim()) : [];
    const productType = tagArray.length >= 3 ? tagArray[2] : null;

    const rawTitle = record.Title || record['Name'] || record['name'];
    const title = rawTitle ? rawTitle.trim() : null;
    const rawHandle = record.Handle || record['handle'];
    let handle = rawHandle ? rawHandle.trim() : null;

    if (!handle && title) {
      handle = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
    }

    // --- Handle Collision Logic ---
    const option1Name = record['Option1 Name'] || null;
    const option1Value = record['Option1 Value'] || null;
    const isDefaultTitleVariant = option1Name === 'Title' && option1Value === 'Default Title';

    if (handle && handledHandles.has(handle) && isDefaultTitleVariant) {
      const newHandle = `${handle}-${sku}`;
      console.log(
        `Handle collision detected for '${handle}'. Creating unique handle: '${newHandle}' for SKU ${sku}.`
      );
      handle = newHandle;
    }
    // --- End Handle Collision Logic ---

    if (handle && sku && title && !isNaN(price)) {
      records.push({
        id: '', // Shopify only
        variantId: '', // Shopify only
        inventoryItemId: '', // Shopify only
        handle: handle,
        sku: sku,
        name: title,
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
    } else {
      console.warn(
        `Skipping record due to missing fields: Handle=${handle}, SKU=${sku}, Title=${title}, Price=${price}`
      );
    }
  }
  console.log(`Parsed ${records.length} products from CSV.`);

  return { products: records };
}

export async function getCsvProducts(
  csvFileName: string,
  ftpData: FormData
): Promise<Product[] | null> {
  try {
    const readableStream = await getCsvStreamFromFtp(csvFileName, ftpData);
    const parsedData = await parseCsvFromStream(readableStream);
    if (parsedData.products.length === 0) {
      return [];
    }
    return parsedData.products;
  } catch (error) {
    console.error('Failed to download or parse CSV from FTP', error);
    throw new Error(`Could not download or process file '${csvFileName}' from FTP.`);
  }
}
