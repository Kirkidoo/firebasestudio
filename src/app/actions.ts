'use server';

import { Product, AuditResult } from '@/lib/types';
import { Client } from 'basic-ftp';
import { Readable, Writable } from 'stream';
import { parse } from 'csv-parse';
import { getAllShopifyProducts } from '@/lib/shopify';

const FTP_DIRECTORY = '/Gamma_Product_Files/Shopify_Files/';

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

async function parseCsvFromStream(stream: Readable): Promise<Product[]> {
    console.log('Parsing CSV from stream...');
    const records: Product[] = [];
    const parser = stream.pipe(parse({
        columns: true,
        skip_empty_lines: true,
        trim: true,
    }));

    for await (const record of parser) {
        // Corrected to use 'SKU', 'Title', and 'Price' from the user's file
        const price = parseFloat(record.Price);
        if (record.SKU && record.Title && !isNaN(price)) {
            records.push({
                sku: record.SKU,
                name: record.Title,
                price: price,
            });
        }
    }
    console.log(`Parsed ${records.length} products from CSV.`);
    return records;
}

export async function runAudit(csvFileName: string, ftpData: FormData): Promise<{ report: AuditResult[], summary: { matched: number, mismatched: number, newInShopify: number, onlyInCsv: number } }> {
  console.log(`Starting audit for file: ${csvFileName}`);
  
  // 1. Fetch and parse CSV from FTP
  const client = await getFtpClient(ftpData);
  let csvProducts: Product[] = [];

  try {
    console.log('Navigating to FTP directory:', FTP_DIRECTORY);
    await client.cd(FTP_DIRECTORY);
    console.log(`Downloading file: ${csvFileName}`);
    
    // Create a temporary in-memory writable stream
    const chunks: any[] = [];
    const writable = new Writable({
        write(chunk, encoding, callback) {
            chunks.push(chunk);
            callback();
        }
    });

    await client.downloadTo(writable, csvFileName);
    console.log('File downloaded successfully.');
    
    // Once download is complete, create a readable stream from the chunks
    const readable = Readable.from(Buffer.concat(chunks));
    csvProducts = await parseCsvFromStream(readable);

  } catch (error) {
    console.error("Failed to download or parse CSV from FTP", error);
    throw new Error(`Could not download or process file '${csvFileName}' from FTP.`);
  } finally {
      if (!client.closed) {
        client.close();
        console.log('FTP client closed.');
      }
  }
  
  const csvProductMap = new Map(csvProducts.map(p => [p.sku, p]));
  console.log(`Created map with ${csvProductMap.size} products from CSV.`);

  // 2. Fetch products from Shopify
  console.log('Fetching products from Shopify...');
  const shopifyProducts = await getAllShopifyProducts();
  const shopifyProductMap = new Map(shopifyProducts.map(p => [p.sku, p]));
  console.log(`Created map with ${shopifyProductMap.size} products from Shopify.`);


  // 3. Run audit logic
  console.log('Running audit comparison logic...');
  const allSkus = new Set([...csvProductMap.keys(), ...shopifyProductMap.keys()]);
  const report: AuditResult[] = [];
  const summary = { matched: 0, mismatched: 0, newInShopify: 0, onlyInCsv: 0 };

  for (const sku of allSkus) {
    const csvProduct = csvProductMap.get(sku) || null;
    const shopifyProduct = shopifyProductMap.get(sku) || null;

    if (csvProduct && shopifyProduct) {
      if (csvProduct.price === shopifyProduct.price && csvProduct.name === shopifyProduct.name) {
        report.push({ sku, csvProduct, shopifyProduct, status: 'matched' });
        summary.matched++;
      } else {
        report.push({ sku, csvProduct, shopifyProduct, status: 'mismatched' });
        summary.mismatched++;
      }
    } else if (shopifyProduct) {
      report.push({ sku, csvProduct: null, shopifyProduct, status: 'new_in_shopify' });
      summary.newInShopify++;
    } else if (csvProduct) {
      report.push({ sku, csvProduct, shopifyProduct: null, status: 'only_in_csv' });
      summary.onlyInCsv++;
    }
  }
  
  report.sort((a, b) => a.sku.localeCompare(b.sku));
  console.log('Audit comparison complete. Summary:', summary);

  return { report, summary };
}
