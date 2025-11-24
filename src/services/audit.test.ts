import { runAuditComparison } from './audit';
import { Product } from '@/lib/types';

// Mock the shopify library to avoid initialization errors
jest.mock('@/lib/shopify', () => ({
  getShopifyProductsBySku: jest.fn(),
  getFullProduct: jest.fn(),
}));

describe('Audit Service', () => {
  const mockCsvProduct: Product = {
    id: '',
    variantId: '',
    inventoryItemId: '',
    handle: 'test-product',
    sku: 'TEST-SKU',
    name: 'Test Product',
    price: 20.0,
    inventory: 10,
    descriptionHtml: '<p>Description</p>',
    productType: 'Type',
    vendor: 'Vendor',
    tags: 'tag1',
    compareAtPrice: null,
    costPerItem: 10.0,
    barcode: null,
    weight: 1000,
    mediaUrl: null,
    category: null,
    option1Name: null,
    option1Value: null,
    option2Name: null,
    option2Value: null,
    option3Name: null,
    option3Value: null,
    imageId: null,
    templateSuffix: null,
  };

  const mockShopifyProduct: Product = {
    ...mockCsvProduct,
    id: 'gid://shopify/Product/123',
    variantId: 'gid://shopify/ProductVariant/456',
    inventoryItemId: 'gid://shopify/InventoryItem/789',
  };

  it('should identify a match when products are identical', async () => {
    const result = await runAuditComparison([mockCsvProduct], [mockShopifyProduct], 'test.csv');

    expect(result.summary.matched).toBe(1);
    expect(result.summary.mismatched).toBe(0);
    expect(result.report[0].status).toBe('matched');
  });

  it('should identify a mismatch in price', async () => {
    const modifiedShopifyProduct = { ...mockShopifyProduct, price: 25.0 };
    const result = await runAuditComparison([mockCsvProduct], [modifiedShopifyProduct], 'test.csv');

    expect(result.summary.mismatched).toBe(1);
    expect(result.report[0].status).toBe('mismatched');
    expect(result.report[0].mismatches).toContainEqual(expect.objectContaining({ field: 'price' }));
  });

  it('should identify a mismatch in inventory', async () => {
    const modifiedShopifyProduct = { ...mockShopifyProduct, inventory: 5 };
    const result = await runAuditComparison([mockCsvProduct], [modifiedShopifyProduct], 'test.csv');

    expect(result.summary.mismatched).toBe(1);
    expect(result.report[0].status).toBe('mismatched');
    expect(result.report[0].mismatches).toContainEqual(
      expect.objectContaining({ field: 'inventory' })
    );
  });

  it('should identify missing in Shopify', async () => {
    const result = await runAuditComparison([mockCsvProduct], [], 'test.csv');

    expect(result.summary.missing_in_shopify).toBe(1);
    expect(result.report[0].status).toBe('missing_in_shopify');
  });

  it('should identify not in CSV', async () => {
    const result = await runAuditComparison([], [mockShopifyProduct], 'test.csv');

    expect(result.summary.not_in_csv).toBe(1);
    expect(result.report[0].status).toBe('not_in_csv');
  });

  it('should flag heavy products', async () => {
    const heavyProduct = { ...mockCsvProduct, weight: 23000 }; // > 50lbs (22679.6g)
    const result = await runAuditComparison([heavyProduct], [], 'test.csv');

    expect(result.report[0].mismatches).toContainEqual(
      expect.objectContaining({ field: 'heavy_product_flag' })
    );
  });
});
