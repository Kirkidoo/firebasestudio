import { runAuditComparison } from './audit';
import { Product } from '@/lib/types';

jest.mock('@/lib/shopify', () => ({
    getShopifyProductsBySku: jest.fn(),
}));

describe('Audit Service - Category Mismatch', () => {
    const mockCsvProduct: Product = {
        id: '',
        variantId: '',
        inventoryItemId: '',
        handle: 'test-product',
        sku: 'TEST-SKU',
        name: 'Test Product',
        price: 100,
        inventory: 10,
        descriptionHtml: '',
        productType: 'Test Type',
        vendor: 'Test Vendor',
        tags: 'tag1, tag2',
        compareAtPrice: null,
        costPerItem: 50,
        barcode: '123456789',
        weight: 1000,
        mediaUrl: '',
        category: 'Test Category',
        imageId: null,
        option1Name: null,
        option1Value: null,
        option2Name: null,
        option2Value: null,
        option3Name: null,
        option3Value: null,
        templateSuffix: null,
    };

    const mockShopifyProduct: Product = {
        ...mockCsvProduct,
        id: 'gid://shopify/Product/123',
        variantId: 'gid://shopify/ProductVariant/456',
        tags: 'tag1, tag2, test category', // Has the category tag
    };

    it('should not report mismatch when category tag is present', async () => {
        const { report } = await runAuditComparison(
            [mockCsvProduct],
            [mockShopifyProduct],
            'test.csv'
        );

        expect(report[0].status).toBe('matched');
        expect(report[0].mismatches).toHaveLength(0);
    });

    it('should report mismatch when category tag is missing', async () => {
        const shopifyProductMissingTag = {
            ...mockShopifyProduct,
            tags: 'tag1, tag2', // Missing 'test category'
        };

        const { report } = await runAuditComparison(
            [mockCsvProduct],
            [shopifyProductMissingTag],
            'test.csv'
        );

        expect(report[0].status).toBe('mismatched');
        const mismatch = report[0].mismatches.find((m) => m.field === 'missing_category_tag');
        expect(mismatch).toBeDefined();
        expect(mismatch?.csvValue).toBe('Test Category');
    });

    it('should report mismatch when tags are empty', async () => {
        const shopifyProductNoTags = {
            ...mockShopifyProduct,
            tags: '',
        };

        const { report } = await runAuditComparison(
            [mockCsvProduct],
            [shopifyProductNoTags],
            'test.csv'
        );

        expect(report[0].status).toBe('mismatched');
        const mismatch = report[0].mismatches.find((m) => m.field === 'missing_category_tag');
        expect(mismatch).toBeDefined();
    });

    it('should handle case insensitivity', async () => {
        const shopifyProductCaseDiff = {
            ...mockShopifyProduct,
            tags: 'tag1, tag2, TEST CATEGORY',
        };

        const { report } = await runAuditComparison(
            [mockCsvProduct],
            [shopifyProductCaseDiff],
            'test.csv'
        );

        expect(report[0].status).toBe('matched');
        expect(report[0].mismatches).toHaveLength(0);
    });
});
