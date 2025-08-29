export interface Product {
  handle: string;
  sku: string;
  name: string;
  price: number;
  inventory: number | null;
  descriptionHtml: string | null;
}

export type AuditStatus = 'matched' | 'mismatched' | 'not_in_csv' | 'missing_in_shopify';

export interface MismatchDetail {
  field: 'name' | 'price' | 'inventory' | 'h1_tag';
  csvValue: string | number | null;
  shopifyValue: string | number | null;
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
