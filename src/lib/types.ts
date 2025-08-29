export interface Product {
  id: string; // Shopify Product GID
  variantId: string; // Shopify Variant GID
  inventoryItemId: string; // Shopify Inventory Item GID
  handle: string;
  sku: string;
  name: string;
  price: number;
  inventory: number | null;
  descriptionHtml: string | null;
  productType: string | null;
  vendor: string | null;
  compareAtPrice: number | null;
  costPerItem: number | null;
  barcode: string | null;
  weight: number | null;
  mediaUrl: string | null;
  category: string | null; // For mapping to Shopify Collections
}

export type AuditStatus = 'matched' | 'mismatched' | 'not_in_csv' | 'missing_in_shopify';

export interface MismatchDetail {
  field: 'name' | 'price' | 'inventory' | 'h1_tag' | 'missing_in_shopify';
  csvValue: string | number | null;
  shopifyValue: string | number | null;
  missingType?: 'product' | 'variant';
}

export interface AuditResult {
  sku: string;
  csvProduct: Product | null;
  shopifyProduct: Product | null;
  status: AuditStatus;
  mismatches: MismatchDetail[];
}

export interface DuplicateSku {
    sku: string;
    count: number;
}

export interface Summary {
  matched: number;
  mismatched: number;
  not_in_csv: number;
  missing_in_shopify: number;
}
