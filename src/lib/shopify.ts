'use server';

import { shopifyApi, LATEST_API_VERSION, Session } from '@shopify/shopify-api';
import '@shopify/shopify-api/adapters/node';
import 'dotenv/config';
import { Product } from '@/lib/types';

// Helper function to introduce a delay
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const GET_ALL_PRODUCTS_QUERY = `
  query getAllProducts($cursor: String) {
    products(first: 50, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          title
          variants(first: 1) {
            edges {
              node {
                sku
                price
              }
            }
          }
        }
      }
    }
  }
`;

export async function getAllShopifyProducts(): Promise<Product[]> {
    console.log('Starting to fetch all Shopify products.');
    if (!process.env.SHOPIFY_SHOP_NAME || !process.env.SHOPIFY_API_ACCESS_TOKEN) {
        console.error("Shopify environment variables are not set.");
        throw new Error("Shopify environment variables are not set. Please create a .env.local file.");
    }
    
    const shopify = shopifyApi({
      apiKey: 'dummy', // Not actually used for private apps but required by the library
      apiSecretKey: 'dummy', // Not actually used for private apps but required by the library
      scopes: ['read_products'],
      hostName: 'dummy.ngrok.io', // Not actually used for private apps but required by the library
      apiVersion: LATEST_API_VERSION,
      isEmbeddedApp: false,
      //Retry on rate limits, but we will also add a delay
      maxRetries: 3,
    });

    const session = new Session({
      shop: process.env.SHOPIFY_SHOP_NAME!,
      accessToken: process.env.SHOPIFY_API_ACCESS_TOKEN!,
      isOnline: false,
      state: 'state',
    });

    const shopifyClient = new shopify.clients.Graphql({ session });

    const products: Product[] = [];
    let hasNextPage = true;
    let cursor: string | null = null;
    let requestCount = 0;
    let pageCount = 0;

    while(hasNextPage) {
        try {
            pageCount++;
            console.log(`Fetching page ${pageCount} of products from Shopify...`);
            // Add a delay every 2 requests to respect the rate limit bucket restore rate
            if (requestCount > 0 && requestCount % 2 === 0) {
                console.log('Pausing for 1 second to respect rate limits...');
                await sleep(1000); 
            }

            const response: any = await shopifyClient.query({
                data: {
                    query: GET_ALL_PRODUCTS_QUERY,
                    variables: {
                        cursor: cursor
                    }
                }
            });
            requestCount++;
            
            if (response.body.errors) {
              console.error('GraphQL Errors:', response.body.errors);
              // Check for specific throttling errors
              if (response.body.errors.some((e:any) => e.message.includes('Throttled'))) {
                 console.log("Throttled by Shopify, waiting 5 seconds before retrying...");
                 await sleep(5000); // Wait 5 seconds if we get a throttled error
                 continue; // Retry the same request
              }
              throw new Error(`GraphQL Error: ${JSON.stringify(response.body.errors)}`);
            }

            const productEdges = response.body.data.products.edges;
            console.log(`Received ${productEdges.length} products on this page.`);

            for (const edge of productEdges) {
                const variant = edge.node.variants.edges[0]?.node;
                if(variant && variant.sku) {
                    products.push({
                        sku: variant.sku,
                        name: edge.node.title,
                        price: parseFloat(variant.price)
                    });
                }
            }
            
            hasNextPage = response.body.data.products.pageInfo.hasNextPage;
            cursor = response.body.data.products.pageInfo.endCursor;
            console.log(`hasNextPage is ${hasNextPage}. Total products fetched so far: ${products.length}`);

        } catch (error) {
            console.error("Error during Shopify product fetch loop:", error);
            if (error instanceof Error && error.message.includes('Throttled')) {
                console.log("Caught throttled error, waiting 5 seconds before retrying...");
                await sleep(5000); // Wait 5 seconds
                // The loop will continue and retry
            } else {
                throw error; // Re-throw other errors
            }
        }
    }
    
    console.log(`Finished fetching all Shopify products. Total: ${products.length}`);
    return products;
}
