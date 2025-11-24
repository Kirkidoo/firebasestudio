import { Readable } from 'stream';
import { parseCsvFromStream } from './csv';

describe('CSV Service', () => {
  it('should parse valid CSV with standard headers', async () => {
    const csvContent = `Variant SKU,Variant Price,Title,Handle
SKU1,10.00,Product 1,product-1`;
    const stream = Readable.from([csvContent]);
    const result = await parseCsvFromStream(stream);
    expect(result.products).toHaveLength(1);
    expect(result.products[0].sku).toBe('SKU1');
    expect(result.products[0].price).toBe(10.0);
    expect(result.products[0].name).toBe('Product 1');
    expect(result.products[0].handle).toBe('product-1');
  });

  it('should parse CSV with alternative headers and generate handle', async () => {
    const csvContent = `SKU,Price,Name
SKU2,20.00,Product 2`;
    const stream = Readable.from([csvContent]);
    const result = await parseCsvFromStream(stream);
    expect(result.products).toHaveLength(1);
    expect(result.products[0].sku).toBe('SKU2');
    expect(result.products[0].price).toBe(20.0);
    expect(result.products[0].name).toBe('Product 2');
    expect(result.products[0].handle).toBe('product-2'); // Auto-generated
  });

  it('should skip invalid records (missing SKU)', async () => {
    const csvContent = `Variant SKU,Variant Price,Title
,10.00,Product 3`; // Missing SKU
    const stream = Readable.from([csvContent]);
    const result = await parseCsvFromStream(stream);
    expect(result.products).toHaveLength(0);
  });

  it('should skip invalid records (missing Price)', async () => {
    const csvContent = `Variant SKU,Variant Price,Title
SKU4,,Product 4`; // Missing Price
    const stream = Readable.from([csvContent]);
    const result = await parseCsvFromStream(stream);
    expect(result.products).toHaveLength(0);
  });

  it('should skip invalid records (missing Title)', async () => {
    const csvContent = `Variant SKU,Variant Price,Title
SKU5,50.00,`; // Missing Title
    const stream = Readable.from([csvContent]);
    const result = await parseCsvFromStream(stream);
    expect(result.products).toHaveLength(0);
  });
  it('should handle BOM and whitespace correctly', async () => {
    // \uFEFF is the BOM character
    const csvContent = `\uFEFFVariant SKU , Variant Price , Title 
 SKU6 , 60.00 , Product 6 `;
    const stream = Readable.from([csvContent]);
    const result = await parseCsvFromStream(stream);
    expect(result.products).toHaveLength(1);
    expect(result.products[0].sku).toBe('SKU6');
    expect(result.products[0].price).toBe(60.0);
    expect(result.products[0].name).toBe('Product 6');
  });
});
