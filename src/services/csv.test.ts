import { Readable } from 'stream';
import { parseCsvFromStream } from './csv';

describe('CSV Service', () => {
  it('should parse "Category" column correctly', async () => {
    const csvContent = 'Handle,Title,SKU,Price,Category\nhandle-1,Title 1,SKU-1,10.00,Test Category';
    const stream = Readable.from(csvContent);
    const { products } = await parseCsvFromStream(stream);
    expect(products[0].category).toBe('Test Category');
  });

  it('should parse "category" column correctly', async () => {
    const csvContent = 'Handle,Title,SKU,Price,category\nhandle-2,Title 2,SKU-2,20.00,lowercase category';
    const stream = Readable.from(csvContent);
    const { products } = await parseCsvFromStream(stream);
    expect(products[0].category).toBe('lowercase category');
  });

  it('should parse "Product Category" column correctly', async () => {
    const csvContent = 'Handle,Title,SKU,Price,Product Category\nhandle-3,Title 3,SKU-3,30.00,Product Cat';
    const stream = Readable.from(csvContent);
    const { products } = await parseCsvFromStream(stream);
    expect(products[0].category).toBe('Product Cat');
  });
});
