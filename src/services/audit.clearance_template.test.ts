import { runAuditComparison } from './audit';
import { Product, AuditResult } from '@/lib/types';

// Mock the shopify library to avoid initialization errors
jest.mock('@/lib/shopify', () => ({
    getShopifyProductsBySku: jest.fn(),
    getFullProduct: jest.fn(),
}));

describe('Audit Service - Clearance Template Logic', () => {
    const mockCsvProduct: Product = {
        id: '1',
        variantId: '1',
        inventoryItemId: '1',
        handle: 'test-product',
        sku: 'TEST-SKU',
        name: 'Test Product',
        price: 10.0,
        inventory: 100,
        descriptionHtml: 'Test Description',
        productType: 'Test Type',
        vendor: 'Test Vendor',
        tags: 'Clearance',
        compareAtPrice: null,
        costPerItem: null,
        barcode: null,
        weight: 1000,
        mediaUrl: null,
        category: null,
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
    };

    it('should detect incorrect_template_suffix mismatch when clearance file is used but template is missing', async () => {
        const csvFileName = 'ShopifyClearanceProductImport.csv';
        const shopifyProduct = { ...mockShopifyProduct, templateSuffix: null };

        const { report } = await runAuditComparison(
            [mockCsvProduct],
            [shopifyProduct],
            csvFileName
        );

        const result = report.find((r) => r.sku === 'TEST-SKU');
        expect(result).toBeDefined();
        expect(result?.status).toBe('mismatched');

        const templateMismatch = result?.mismatches.find(
            (m) => m.field === 'incorrect_template_suffix'
        );
        expect(templateMismatch).toBeDefined();
        expect(templateMismatch?.csvValue).toBe('clearance');
        expect(templateMismatch?.shopifyValue).toBe('Default Template');
    });

    it('should detect incorrect_template_suffix mismatch when clearance file is used but template is wrong', async () => {
        const csvFileName = 'ShopifyClearanceProductImport.csv';
        const shopifyProduct = { ...mockShopifyProduct, templateSuffix: 'heavy-products' };

        const { report } = await runAuditComparison(
            [mockCsvProduct],
            [shopifyProduct],
            csvFileName
        );

        const result = report.find((r) => r.sku === 'TEST-SKU');
        expect(result).toBeDefined();
        expect(result?.status).toBe('mismatched');

        const templateMismatch = result?.mismatches.find(
            (m) => m.field === 'incorrect_template_suffix'
        );
        expect(templateMismatch).toBeDefined();
        expect(templateMismatch?.csvValue).toBe('clearance');
        expect(templateMismatch?.shopifyValue).toBe('heavy-products');
    });

    it('should NOT detect mismatch when clearance file is used and template is correct', async () => {
        const csvFileName = 'ShopifyClearanceProductImport.csv';
        const shopifyProduct = { ...mockShopifyProduct, templateSuffix: 'clearance' };

        const { report } = await runAuditComparison(
            [mockCsvProduct],
            [shopifyProduct],
            csvFileName
        );

        const result = report.find((r) => r.sku === 'TEST-SKU');
        expect(result).toBeDefined();
        expect(result?.status).toBe('matched');
        expect(result?.mismatches).toHaveLength(0);
    });

    it('should NOT detect incorrect_template_suffix mismatch for non-clearance files', async () => {
        const csvFileName = 'RegularImport.csv';
        const shopifyProduct = { ...mockShopifyProduct, templateSuffix: null };

        const { report } = await runAuditComparison(
            [mockCsvProduct],
            [shopifyProduct],
            csvFileName
        );

        const result = report.find((r) => r.sku === 'TEST-SKU');
        expect(result).toBeDefined();
        expect(result?.status).toBe('matched');
        expect(result?.mismatches).toHaveLength(0);
    });
});
