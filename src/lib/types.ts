export interface Product {
  handle: string;
  sku: string;
  name: string;
  price: number;
}

export type AuditStatus = 'matched' | 'mismatched' | 'not_in_csv' | 'missing_in_shopify';

export interface AuditResult {
  sku: string;
  csvProduct: Product | null;
  shopifyProduct: Product | null;
  status: AuditStatus;
}
