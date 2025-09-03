
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
  tags: string | null;
  compareAtPrice: number | null;
  costPerItem: number | null;
  barcode: string | null;
  weight: number | null; // Always in grams from source
  mediaUrl: string | null;
  category: string | null; // For mapping to Shopify Collections
  imageId: number | null; // Shopify Image ID
  option1Name: string | null;
  option1Value: string | null;
  option2Name: string | null;
  option2Value: string | null;
  option3Name: string | null;
  option3Value: string | null;
  templateSuffix: string | null;
}

export type AuditStatus = 'mismatched' | 'not_in_csv' | 'missing_in_shopify' | 'duplicate_in_shopify' | 'matched';

export interface MismatchDetail {
  field: 'name' | 'price' | 'inventory' | 'h1_tag' | 'missing_in_shopify' | 'duplicate_in_shopify' | 'heavy_product_template' | 'heavy_product_flag';
  csvValue: string | number | null;
  shopifyValue: string | number | null;
  missingType?: 'product' | 'variant';
}

export interface AuditResult {
  sku: string;
  csvProducts: Product[];
  shopifyProducts: Product[];
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
  duplicate_in_shopify: number;
}

export interface ShopifyProductImage {
  id: number;
  product_id: number;
  src: string;
  variant_ids: number[];
}
