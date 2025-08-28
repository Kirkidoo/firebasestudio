'use server';

import { Product, AuditResult } from '@/lib/types';
import { Client } from 'basic-ftp';
import { Readable } from 'stream';
import { parse } from 'csv-parse';
import { getAllShopifyProducts } from '@/lib/shopify';

const FTP_DIRECTORY = '/Gamma_Product_Files/Shopify_Files/';

async function getFtpClient(data: FormData) {
  const host = data.get('host') as string;
  const user = data.get('username') as string;
  const password = data.get('password') as string;
  
  const client = new Client();
  // client.ftp.verbose = true;
  try {
    // First, try a secure connection
    await client.access({ host, user, password, secure: true });
  } catch(secureErr) {
    console.log("Secure FTP connection failed. Trying non-secure.", secureErr);
    // If secure fails, close the potentially broken connection and try non-secure
    client.close(); 
    const nonSecureClient = new Client();
    try {
        await nonSecureClient.access({ host, user, password, secure: false });
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
  const client = await getFtpClient(data);
  try {
    await client.cd(FTP_DIRECTORY);
    const files = await client.list();
    return files
      .filter(file => file.name.toLowerCase().endsWith('.csv'))
      .map(file => file.name);
  } finally {
    client.close();
  }
}

async function parseCsvFromStream(stream: Readable): Promise<Product[]> {
    const records: Product[] = [];
    const parser = stream.pipe(parse({
        columns: true,
        skip_empty_lines: true,
        trim: true,
    }));

    for await (const record of parser) {
        // Assuming column names are 'sku', 'name', 'price'
        const price = parseFloat(record.price || record.Price);
        if (record.sku && record.name && !isNaN(price)) {
            records.push({
                sku: record.sku,
                name: record.name,
                price: price,
            });
        }
    }
    return records;
}

export async function runAudit(csvFileName: string, ftpData: FormData): Promise<{ report: AuditResult[], summary: { matched: number, mismatched: number, newInShopify: number, onlyInCsv: number } }> {
  
  // 1. Fetch and parse CSV from FTP
  const client = await getFtpClient(ftpData);
  const csvStream = new Readable();
  try {
    await client.cd(FTP_DIRECTORY);
    await client.downloadTo(csvStream, csvFileName);
  } catch (error) {
    client.close();
    console.error("Failed to download CSV from FTP", error);
    throw new Error(`Could not download file '${csvFileName}' from FTP.`);
  } finally {
      client.close();
  }
  
  const csvProducts = await parseCsvFromStream(csvStream);
  const csvProductMap = new Map(csvProducts.map(p => [p.sku, p]));

  // 2. Fetch products from Shopify
  const shopifyProducts = await getAllShopifyProducts();
  const shopifyProductMap = new Map(shopifyProducts.map(p => [p.sku, p]));

  // 3. Run audit logic
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

  return { report, summary };
}
